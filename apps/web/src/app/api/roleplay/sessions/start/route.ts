import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";
import { DAILY_ROLEPLAY_SESSION_LIMIT } from "@flex/shared";

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
    .select("id, name, system_prompt, voice_id")
    .eq("id", personaId)
    .single();

  if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

  // Build the full system prompt
  const fullPrompt = contextPrompt
    ? `${persona.system_prompt}\n\n--- SCENARIO CONTEXT ---\n${contextPrompt}`
    : persona.system_prompt;

  // Create ElevenLabs Conversational AI agent
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenLabsKey) {
    return NextResponse.json({ error: "ElevenLabs not configured" }, { status: 500 });
  }

  const agentRes = await fetch("https://api.elevenlabs.io/v1/convai/conversation", {
    method: "POST",
    headers: {
      "xi-api-key": elevenLabsKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent: {
        prompt: {
          prompt: fullPrompt,
        },
        first_message: "Hello?",
        language: "en",
      },
      tts: {
        voice_id: persona.voice_id,
      },
    }),
  });

  if (!agentRes.ok) {
    const errBody = await agentRes.text();
    return NextResponse.json(
      { error: `ElevenLabs error: ${errBody}` },
      { status: 502 }
    );
  }

  const agentData = await agentRes.json();
  const conversationId = agentData.conversation_id;
  const signedUrl = agentData.signed_url;

  // Create session record
  const { data: session, error } = await admin
    .from("roleplay_sessions")
    .insert({
      rep_id: auth.user.id,
      team_id: profile.team_id,
      scenario_id: scenarioId ?? null,
      persona_id: personaId,
      status: "active",
      elevenlabs_conversation_id: conversationId,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    sessionId: session?.id,
    conversationId,
    signedUrl,
    personaName: persona.name,
  });
}
