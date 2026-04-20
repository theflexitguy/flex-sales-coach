import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";
import { DAILY_ROLEPLAY_SESSION_LIMIT } from "@flex/shared";

const ELEVENLABS_BASE = "https://api.elevenlabs.io";

interface Persona {
  id: string;
  name: string;
  system_prompt: string;
  voice_id: string;
  elevenlabs_agent_id: string | null;
}

/**
 * Create an ElevenLabs Conversational AI agent for this persona.
 * Returns the agent_id.
 */
async function createElevenLabsAgent(
  persona: Persona,
  apiKey: string
): Promise<string> {
  const res = await fetch(`${ELEVENLABS_BASE}/v1/convai/agents/create`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `flex-coach-${persona.name}`.slice(0, 60),
      conversation_config: {
        agent: {
          prompt: {
            prompt: persona.system_prompt,
          },
          first_message: "Hello?",
          language: "en",
        },
        tts: {
          voice_id: persona.voice_id,
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs agent create failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { agent_id?: string };
  if (!data.agent_id) {
    throw new Error(`ElevenLabs agent create returned no agent_id`);
  }
  return data.agent_id;
}

/**
 * Request a signed WebSocket URL for a specific agent.
 * The client uses this to connect; the URL is short-lived.
 */
async function getSignedUrl(agentId: string, apiKey: string): Promise<string> {
  const res = await fetch(
    `${ELEVENLABS_BASE}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
    {
      method: "GET",
      headers: { "xi-api-key": apiKey },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs signed URL failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { signed_url?: string };
  if (!data.signed_url) {
    throw new Error("ElevenLabs returned no signed_url");
  }
  return data.signed_url;
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { scenarioId, personaId: directPersonaId } = await request.json();
  if (!scenarioId && !directPersonaId) {
    return NextResponse.json({ error: "scenarioId or personaId required" }, { status: 400 });
  }

  const admin = createAdmin();

  const { data: profile } = await admin
    .from("profiles")
    .select("team_id")
    .eq("id", auth.user.id)
    .single();

  if (!profile?.team_id) {
    return NextResponse.json({ error: "Not on a team" }, { status: 400 });
  }

  // Daily limit
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

  // Resolve persona + scenario context
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
    contextPrompt = scenario.context_prompt ?? "";
  }

  const { data: personaRow } = await admin
    .from("roleplay_personas")
    .select("id, name, system_prompt, voice_id, elevenlabs_agent_id")
    .eq("id", personaId)
    .single();

  if (!personaRow) {
    return NextResponse.json({ error: "Persona not found" }, { status: 404 });
  }
  const persona = personaRow as Persona;

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ElevenLabs not configured" }, { status: 500 });
  }

  try {
    // Lazy-create the agent on first use for this persona.
    let agentId = persona.elevenlabs_agent_id;
    if (!agentId) {
      agentId = await createElevenLabsAgent(persona, apiKey);
      await admin
        .from("roleplay_personas")
        .update({ elevenlabs_agent_id: agentId })
        .eq("id", persona.id);
    }

    const signedUrl = await getSignedUrl(agentId, apiKey);

    // Build a scenario-specific prompt override. The SDK sends this in the
    // first WS message (conversation_initiation_client_data) so the agent's
    // base persona prompt is extended with scenario context per session.
    const overridePrompt = contextPrompt
      ? `${persona.system_prompt}\n\n--- SCENARIO CONTEXT ---\n${contextPrompt}`
      : persona.system_prompt;

    const { data: session, error: insertErr } = await admin
      .from("roleplay_sessions")
      .insert({
        rep_id: auth.user.id,
        team_id: profile.team_id,
        scenario_id: scenarioId ?? null,
        persona_id: persona.id,
        status: "active",
        elevenlabs_conversation_id: null, // filled in by client after WS open if desired
      })
      .select("id")
      .single();

    if (insertErr || !session) {
      return NextResponse.json(
        { error: insertErr?.message ?? "Failed to create session" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      sessionId: session.id,
      agentId,
      signedUrl,
      personaName: persona.name,
      overridePrompt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ElevenLabs error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
