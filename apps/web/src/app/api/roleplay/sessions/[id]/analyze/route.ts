import { NextResponse } from "next/server";
import { isInternalCall } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const ROLEPLAY_ANALYSIS_PROMPT = `You are an expert door-to-door sales coach AI. You analyze roleplay training transcripts where a sales rep practices with an AI customer.

Analyze the practice conversation and return a JSON object:

{
  "overall_score": <number 0-100>,
  "overall_grade": <"excellent"|"good"|"acceptable"|"needs_improvement"|"poor">,
  "summary": "<2-3 sentence coaching summary>",
  "strengths": ["<what they did well>"],
  "improvements": ["<specific things to work on>"],
  "objection_handling_scores": [
    {
      "category": "<objection category if any were raised>",
      "grade": <"excellent"|"good"|"acceptable"|"needs_improvement"|"poor">,
      "feedback": "<specific feedback on how they handled this objection>"
    }
  ]
}

Score generously for effort but be specific about technique. This is practice — encourage experimentation while pointing out what would work better in a real conversation.
Return ONLY valid JSON, no markdown or explanation.`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Allow both internal calls and authenticated users
  const isInternal = isInternalCall(request);
  if (!isInternal) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdmin();

  const { data: session } = await admin
    .from("roleplay_sessions")
    .select("id, rep_id, transcript_text, persona_id")
    .eq("id", id)
    .single();

  if (!session?.transcript_text) {
    return NextResponse.json({ error: "No transcript to analyze" }, { status: 400 });
  }

  // Check if already analyzed
  const { data: existing } = await admin
    .from("roleplay_analyses")
    .select("id")
    .eq("session_id", id)
    .single();

  if (existing) {
    return NextResponse.json({ message: "Already analyzed" });
  }

  const modelId = "claude-sonnet-4-20250514";

  const { text: responseText } = await generateText({
    model: anthropic(modelId),
    system: ROLEPLAY_ANALYSIS_PROMPT,
    prompt: `Analyze this roleplay practice transcript:\n\n${session.transcript_text}`,
    maxOutputTokens: 2048,
  });

  const cleanedText = responseText
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  const analysis = JSON.parse(cleanedText);

  // Get rep's average real call score for comparison
  const { data: realAnalyses } = await admin
    .from("call_analyses")
    .select("overall_score")
    .in(
      "call_id",
      (await admin.from("calls").select("id").eq("rep_id", session.rep_id).eq("status", "completed").order("recorded_at", { ascending: false }).limit(10)).data?.map((c) => c.id) ?? []
    );

  let comparedToReal = null;
  if (realAnalyses && realAnalyses.length > 0) {
    const avgReal = Math.round(
      realAnalyses.reduce((sum, a) => sum + a.overall_score, 0) / realAnalyses.length
    );
    comparedToReal = {
      avgRealScore: avgReal,
      delta: analysis.overall_score - avgReal,
    };
  }

  const { error } = await admin.from("roleplay_analyses").insert({
    session_id: id,
    overall_score: analysis.overall_score,
    overall_grade: analysis.overall_grade,
    summary: analysis.summary,
    strengths: analysis.strengths,
    improvements: analysis.improvements,
    objection_handling_scores: analysis.objection_handling_scores ?? [],
    compared_to_real: comparedToReal,
    model_id: modelId,
    prompt_version: "1.0.0",
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
