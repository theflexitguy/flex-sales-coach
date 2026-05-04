import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";
import { DAILY_ROLEPLAY_SESSION_LIMIT } from "@flex/shared";

type OpenAIVoice = "cedar" | "marin" | "echo" | "sage" | "coral" | "shimmer";

interface OpenAIClientSecretResponse {
  readonly value?: string;
  readonly expires_at?: number;
  readonly session?: {
    readonly model?: string;
  };
  readonly error?: {
    readonly message?: string;
  };
}

function pickOpenAIVoice(persona: {
  name: string;
  description: string;
  personality: unknown;
  system_prompt: string;
}): OpenAIVoice {
  const haystack = [
    persona.name,
    persona.description,
    persona.system_prompt,
    JSON.stringify(persona.personality ?? {}),
  ].join(" ").toLowerCase();

  if (/\b(female|wife|woman|lady|mother|mom|she|her)\b/.test(haystack)) return "marin";
  if (/\b(older|senior|authority|stern|terse|skeptical|impatient|direct)\b/.test(haystack)) {
    return /\b(female|wife|woman|lady|mother|mom|she|her)\b/.test(haystack) ? "sage" : "echo";
  }
  if (/\b(friendly|chatty|warm|talkative|neighborly)\b/.test(haystack)) return "coral";
  return "cedar";
}

function buildRealtimeInstructions(personaPrompt: string, contextPrompt: string): string {
  const scenarioBlock = contextPrompt
    ? `\n\n--- SCENARIO CONTEXT ---\n${contextPrompt}`
    : "";

  return `${personaPrompt}${scenarioBlock}

--- ROLEPLAY RULES ---
You are the homeowner/customer in a door-to-door pest control sales practice.
Stay fully in character as the selected homeowner. Do not coach, score, explain the exercise, or break character during the roleplay.
Speak naturally with realistic hesitation, interruptions, short answers, and objections.
Raise the target objections from the scenario when it fits the conversation.
Let the sales rep practice their word tracks. Push back when a real homeowner would push back.
End only when the rep clearly wraps up the conversation or the user taps End in the app.`;
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { scenarioId, personaId: directPersonaId } = await request.json();
  if (!scenarioId && !directPersonaId) {
    return NextResponse.json({ error: "scenarioId or personaId required" }, { status: 400 });
  }

  const admin = createAdmin();

  // Get rep profile
  const { data: profile } = await admin
    .from("profiles")
    .select("team_id")
    .eq("id", auth.user.id)
    .single();

  if (!profile?.team_id) {
    return NextResponse.json({ error: "Not on a team" }, { status: 400 });
  }

  // Check daily limit
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count } = await admin
    .from("roleplay_sessions")
    .select("id", { count: "exact", head: true })
    .eq("rep_id", auth.user.id)
    .gte("created_at", today.toISOString());

  if ((count ?? 0) >= DAILY_ROLEPLAY_SESSION_LIMIT) {
    return NextResponse.json(
      { error: `Daily limit of ${DAILY_ROLEPLAY_SESSION_LIMIT} sessions reached` },
      { status: 429 }
    );
  }

  // Resolve persona
  let personaId = directPersonaId;
  let contextPrompt = "";

  if (scenarioId) {
    const { data: scenario } = await admin
      .from("roleplay_scenarios")
      .select("persona_id, context_prompt")
      .eq("id", scenarioId)
      .single();

    if (!scenario) return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    personaId = scenario.persona_id;
    contextPrompt = scenario.context_prompt;
  }

  // Get persona
  const { data: persona } = await admin
    .from("roleplay_personas")
    .select("id, name, description, personality, system_prompt, voice_id")
    .eq("id", personaId)
    .single();

  if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

  const openAIKey = process.env.OPENAI_API_KEY;
  if (!openAIKey) {
    return NextResponse.json({ error: "OpenAI Realtime not configured: OPENAI_API_KEY missing" }, { status: 500 });
  }

  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
  const voice = pickOpenAIVoice(persona);
  const instructions = buildRealtimeInstructions(persona.system_prompt, contextPrompt);

  const secretRes = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAIKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: {
        anchor: "created_at",
        seconds: 600,
      },
      session: {
        type: "realtime",
        model,
        instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: {
              model: "gpt-4o-transcribe",
              language: "en",
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            voice,
          },
        },
      },
    }),
  });

  const secretData = await secretRes.json().catch(() => null) as OpenAIClientSecretResponse | null;
  if (!secretRes.ok || !secretData?.value) {
    const message = secretData?.error?.message ?? "Failed to create OpenAI Realtime client secret";
    return NextResponse.json(
      { error: `OpenAI Realtime error: ${message}` },
      { status: 502 }
    );
  }

  // Create session record
  const { data: session, error } = await admin
    .from("roleplay_sessions")
    .insert({
      rep_id: auth.user.id,
      team_id: profile.team_id,
      scenario_id: scenarioId ?? null,
      persona_id: personaId,
      status: "active",
      elevenlabs_conversation_id: null,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    sessionId: session?.id,
    provider: "openai-realtime",
    model,
    voice,
    personaName: persona.name,
    clientSecret: secretData.value,
    expiresAt: secretData.expires_at ?? Math.floor(Date.now() / 1000) + 600,
  });
}
