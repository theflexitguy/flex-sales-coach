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

type RoleplayDifficulty = "beginner" | "intermediate" | "advanced" | "extreme";

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

function difficultyRules(difficulty: RoleplayDifficulty): string {
  switch (difficulty) {
    case "beginner":
      return "Level: EASY. Be realistic but coachable. Raise one clear objection, let good rapport soften you, and allow a clean path to a next step when the rep earns it.";
    case "intermediate":
      return "Level: MEDIUM. Be cautious and busy. Require rapport before listening, raise one or two objections, interrupt lightly, and do not accept claims without a simple reason to believe.";
    case "advanced":
      return "Level: HARD. Be guarded, impatient, and skeptical. Raise layered objections, expose weak discovery, resist generic scripts, and only soften when the rep pre-overcomes concerns and connects value to your situation.";
    case "extreme":
      return "Level: EXTREME. Make this feel like a difficult real doorstep. Combine multiple barriers: current provider, spouse/authority issue, price concern, bad timing, trust skepticism, and interruptions. Do not be rude for no reason, but do not cooperate unless the rep earns attention with rapport, sharp questions, pre-overcoming, confidence, and a strong close.";
  }
}

function buildRealtimeInstructions(
  personaPrompt: string,
  contextPrompt: string,
  difficulty: RoleplayDifficulty,
  targetObjections: readonly string[]
): string {
  const scenarioBlock = contextPrompt
    ? `\n\n--- SCENARIO CONTEXT ---\n${contextPrompt}`
    : "";
  const objectionBlock = targetObjections.length
    ? `\nTarget objections to raise naturally: ${targetObjections.join(", ")}.`
    : "";

  return `${personaPrompt}${scenarioBlock}

--- ROLEPLAY RULES ---
You are the homeowner/customer in a door-to-door pest control sales practice.
Stay fully in character as the selected homeowner. Do not coach, score, explain the exercise, or break character during the roleplay.
The sales rep must initiate the conversation. Stay silent until the user speaks first.
Speak English only. Never speak Spanish or any other language, even if source transcript text, persona data, names, or scenario context suggest another language.
Speak naturally with realistic hesitation, interruptions, short answers, and objections.
Door-to-door is hard. The rep must build rapport, ask useful questions, pre-overcome concerns, explain value clearly, and earn the next step. Do not simply answer questions or agree because the rep sounds nice.
${difficultyRules(difficulty)}${objectionBlock}
Push back when a real homeowner would push back. If the rep skips rapport, talks too much, fails to handle authority/spouse concerns, or gives a generic pitch, become shorter and harder to win back.
Do not reveal your internal logic, hidden objections, decision criteria, or what would persuade you. Homeowners do not narrate everything they think. Show resistance through tone, short answers, questions, hesitation, and selective details instead of explaining your reasoning.
Give subtle buying signals only after the rep earns trust. Reward specific, confident, human selling; punish canned scripts. Keep responses concise unless the rep earns a longer answer with a good question.
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
  let difficulty: RoleplayDifficulty = "intermediate";
  let targetObjections: readonly string[] = [];

  if (scenarioId) {
    const { data: scenario } = await admin
      .from("roleplay_scenarios")
      .select("persona_id, context_prompt, difficulty, target_objections")
      .eq("id", scenarioId)
      .single();

    if (!scenario) return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    personaId = scenario.persona_id;
    contextPrompt = scenario.context_prompt;
    difficulty = (
      /ROLEPLAY_LEVEL:\s*EXTREME/i.test(contextPrompt)
        ? "extreme"
        : ["beginner", "intermediate", "advanced"].includes(scenario.difficulty)
        ? scenario.difficulty
        : "intermediate"
    ) as RoleplayDifficulty;
    targetObjections = (scenario.target_objections as string[] | null) ?? [];
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
  const instructions = buildRealtimeInstructions(
    persona.system_prompt,
    contextPrompt,
    difficulty,
    targetObjections
  );

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
