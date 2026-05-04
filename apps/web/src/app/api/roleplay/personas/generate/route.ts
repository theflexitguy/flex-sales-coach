import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { ELEVENLABS_VOICES } from "@flex/shared";

const PERSONA_GENERATION_PROMPT = `You are an AI that analyzes real door-to-door pest control sales call transcripts and extracts distinct customer persona archetypes for training purposes.

You will receive customer-side utterances from multiple calls. Analyze them and identify 3-5 distinct customer personality types that reps encounter.

For each persona, return a JSON array of objects:

[
  {
    "name": "<short memorable name, e.g. 'Skeptical Homeowner', 'Price-Conscious Renter'>",
    "description": "<2-3 sentence description of this customer type>",
    "personality": {
      "tone": "<e.g. 'friendly but cautious', 'impatient and dismissive', 'curious but skeptical'>",
      "objection_style": "<how they push back, e.g. 'politely deflects', 'directly challenges claims', 'goes silent'>",
      "patience_level": "<low/medium/high — how long they'll listen before wanting to end the conversation>",
      "buying_signals": "<what indicates interest, e.g. 'asks about pricing details', 'mentions current pest issues'>"
    },
    "objection_categories": [<list of objection categories this persona commonly uses: "price"|"timing"|"need"|"trust"|"competition"|"authority"|"other">],
    "voice_gender": "<male|female>",
    "voice_age": "<young|middle-aged|senior>",
    "system_prompt": "<detailed English-language prompt instructing an AI to roleplay as this customer. Include: personality traits, typical responses, how they answer the door, what objections they raise, when they soften or shut down, realistic dialogue examples drawn from the transcripts. The AI should act like a real person, not an AI. Include awkward pauses, interruptions, realistic speech patterns, subtle buying signals, and the conditions under which trust is earned. The scenario is door-to-door pest control sales.>"
  }
]

Make personas specific to door-to-door pest control. Use actual English phrases and patterns from the transcripts. Do not create pushovers: these homeowners should require rapport, curiosity, pre-overcoming objections, clear value, and a confident close before they soften. Do not include Spanish or any non-English dialogue.
Return ONLY valid JSON, no markdown or explanation.`;

export async function POST(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.profile?.role !== "manager") {
    return NextResponse.json({ error: "Managers only" }, { status: 403 });
  }

  const admin = createAdmin();
  const teamId = auth.profile.team_id;
  if (!teamId) return NextResponse.json({ error: "No team" }, { status: 400 });

  // Get recent completed calls with transcripts
  const { data: calls } = await admin
    .from("calls")
    .select("id")
    .eq("team_id", teamId)
    .eq("status", "completed")
    .order("recorded_at", { ascending: false })
    .limit(30);

  if (!calls || calls.length < 3) {
    return NextResponse.json(
      { error: "Need at least 3 completed calls to generate personas" },
      { status: 400 }
    );
  }

  const callIds = calls.map((c) => c.id);

  // Get transcripts for these calls
  const { data: transcripts } = await admin
    .from("transcripts")
    .select("call_id, utterances")
    .in("call_id", callIds);

  if (!transcripts || transcripts.length === 0) {
    return NextResponse.json({ error: "No transcripts found" }, { status: 400 });
  }

  // Extract customer utterances
  const customerExcerpts = transcripts.map((t) => {
    const utterances = t.utterances as Array<{ speaker: string; text: string }>;
    const customerLines = utterances
      .filter((u) => u.speaker === "customer")
      .map((u) => u.text);
    return { callId: t.call_id, lines: customerLines.slice(0, 20) }; // Cap per call
  });

  // Also get objection data for richer context
  const { data: objections } = await admin
    .from("objections")
    .select("utterance_text, category, rep_response")
    .in("call_id", callIds)
    .limit(50);

  const inputText = [
    "=== CUSTOMER UTTERANCES FROM RECENT CALLS ===",
    ...customerExcerpts.map(
      (e, i) => `\n--- Call ${i + 1} ---\n${e.lines.join("\n")}`
    ),
    "\n=== OBJECTIONS DETECTED ===",
    ...(objections ?? []).map(
      (o) => `[${o.category}] Customer: "${o.utterance_text}" | Rep responded: "${o.rep_response}"`
    ),
  ].join("\n");

  const { text: responseText } = await generateText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: PERSONA_GENERATION_PROMPT,
    prompt: inputText,
    maxOutputTokens: 4096,
  });

  const cleanedText = responseText
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  const personas = JSON.parse(cleanedText) as Array<{
    name: string;
    description: string;
    personality: { tone: string; objection_style: string; patience_level: string; buying_signals: string };
    objection_categories: string[];
    voice_gender: string;
    voice_age: string;
    system_prompt: string;
  }>;

  // Match each persona to an ElevenLabs voice
  const voiceEntries = Object.entries(ELEVENLABS_VOICES);
  const usedVoiceIds = new Set<string>();

  const rows = personas.map((p) => {
    // Find best voice match by gender + age, avoiding duplicates
    const match = voiceEntries.find(
      ([, v]) =>
        v.gender === p.voice_gender &&
        v.age === p.voice_age &&
        !usedVoiceIds.has(v.id)
    ) ?? voiceEntries.find(
      ([, v]) => v.gender === p.voice_gender && !usedVoiceIds.has(v.id)
    ) ?? voiceEntries.find(
      ([, v]) => !usedVoiceIds.has(v.id)
    ) ?? voiceEntries[0];

    usedVoiceIds.add(match[1].id);

    return {
      team_id: teamId,
      name: p.name,
      description: p.description,
      personality: {
        tone: p.personality.tone,
        objectionStyle: p.personality.objection_style,
        patienceLevel: p.personality.patience_level,
        buyingSignals: p.personality.buying_signals,
      },
      voice_id: match[1].id,
      source_call_ids: callIds.slice(0, 10),
      objection_categories: p.objection_categories,
      system_prompt: p.system_prompt,
    };
  });

  const { data: inserted, error } = await admin
    .from("roleplay_personas")
    .insert(rows)
    .select("id, name, description");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ personas: inserted });
}
