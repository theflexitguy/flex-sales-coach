import { NextResponse } from "next/server";
import { createAdmin } from "@flex/supabase/admin";
import { isInternalCall } from "@/lib/api-auth-server";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const PROMPT_VERSION = "1.0.0";

const SYSTEM_PROMPT = `You are an expert door-to-door sales coach AI. You analyze sales call transcripts and provide detailed, actionable coaching feedback.

You will receive a transcript of a door-to-door sales conversation with speaker labels [rep] and [customer].

Analyze the conversation and return a JSON object with this exact structure:

{
  "overall_score": <number 0-100>,
  "overall_grade": <"excellent"|"good"|"acceptable"|"needs_improvement"|"poor">,
  "summary": "<2-3 sentence summary of the call>",
  "strengths": ["<strength 1>", "<strength 2>", ...],
  "improvements": ["<improvement 1>", "<improvement 2>", ...],
  "talk_ratio_rep": <number 0-1, estimated percentage of talk time>,
  "talk_ratio_customer": <number 0-1>,
  "sections": [
    {
      "type": <"introduction"|"rapport_building"|"pitch"|"objection_handling"|"closing"|"other">,
      "start_text": "<first few words of this section>",
      "end_text": "<last few words of this section>",
      "summary": "<1 sentence summary>",
      "grade": <"excellent"|"good"|"acceptable"|"needs_improvement"|"poor">,
      "order_index": <number, 0-based>
    }
  ],
  "objections": [
    {
      "utterance_text": "<the customer's objection verbatim>",
      "category": <"price"|"timing"|"need"|"trust"|"competition"|"authority"|"other">,
      "rep_response": "<how the rep responded>",
      "handling_grade": <"excellent"|"good"|"acceptable"|"needs_improvement"|"poor">,
      "suggestion": "<specific coaching tip for handling this objection better>"
    }
  ],
  "predicted_outcome": <"sale"|"no_sale"|"callback"|"not_home"|"not_interested"|"already_has_service">
}

For predicted_outcome, determine the most likely result based on the conversation:
- "sale": Customer agreed to purchase/sign up
- "no_sale": Customer explicitly declined
- "callback": Customer asked rep to come back or call later
- "not_home": Nobody answered or was unavailable
- "not_interested": Customer showed no interest
- "already_has_service": Customer mentioned existing pest control service

Scoring guidelines:
- 90-100 (excellent): Masterful objection handling, strong rapport, clear close
- 75-89 (good): Solid performance with minor areas to improve
- 60-74 (acceptable): Adequate but missing key techniques
- 40-59 (needs_improvement): Significant gaps in sales technique
- 0-39 (poor): Fundamental issues with approach

Be specific in your feedback. Reference exact things the rep said. Suggestions should be actionable and practical for door-to-door pest control sales.

Return ONLY valid JSON, no markdown or explanation.`;

export async function POST(request: Request) {
  if (!isInternalCall(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { callId } = await request.json();

  if (!callId) {
    return NextResponse.json({ error: "callId required" }, { status: 400 });
  }

  const supabase = createAdmin();

  await supabase
    .from("calls")
    .update({ status: "analyzing" })
    .eq("id", callId);

  try {
    // Get transcript
    const { data: transcript } = await supabase
      .from("transcripts")
      .select("full_text, utterances")
      .eq("call_id", callId)
      .single();

    if (!transcript) {
      throw new Error("No transcript found for this call");
    }

    // Call Claude via AI SDK
    const modelId = "claude-sonnet-4-20250514";

    const { text: responseText } = await generateText({
      model: anthropic(modelId),
      system: SYSTEM_PROMPT,
      prompt: `Analyze this door-to-door sales call transcript:\n\n${transcript.full_text}`,
      maxOutputTokens: 4096,
    });

    // Strip markdown code fences if present
    const cleanedText = responseText
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();
    const analysis = JSON.parse(cleanedText);

    // Save analysis
    const { data: savedAnalysis } = await supabase
      .from("call_analyses")
      .insert({
        call_id: callId,
        overall_score: analysis.overall_score,
        overall_grade: analysis.overall_grade,
        summary: analysis.summary,
        strengths: analysis.strengths,
        improvements: analysis.improvements,
        talk_ratio_rep: analysis.talk_ratio_rep,
        talk_ratio_customer: analysis.talk_ratio_customer,
        model_id: modelId,
        prompt_version: PROMPT_VERSION,
      })
      .select("id")
      .single();

    if (!savedAnalysis) throw new Error("Failed to save analysis");

    // Save sections with timestamp mapping
    const utterances = transcript.utterances as Array<{
      startMs: number;
      endMs: number;
      text: string;
    }>;

    if (analysis.sections?.length > 0) {
      const totalSections = analysis.sections.length;
      const totalUtterances = utterances.length;
      let lastEndMs = 0;

      const sectionRows = analysis.sections.map(
        (s: {
          type: string;
          start_text: string;
          end_text: string;
          summary: string;
          grade: string;
          order_index: number;
        }) => {
          // Find approximate timestamps from utterances by text matching
          const searchStart = s.start_text?.toLowerCase().slice(0, 20) ?? "";
          const searchEnd = s.end_text?.toLowerCase().slice(0, 20) ?? "";

          const startUtterance = searchStart
            ? utterances.find((u) => u.text.toLowerCase().includes(searchStart))
            : null;
          const endUtterance = searchEnd
            ? [...utterances].reverse().find((u) => u.text.toLowerCase().includes(searchEnd))
            : null;

          // Fallback: estimate position proportionally from order_index
          const proportionStart = totalUtterances > 0
            ? utterances[Math.floor((s.order_index / totalSections) * totalUtterances)]?.startMs ?? lastEndMs
            : lastEndMs;
          const proportionEnd = totalUtterances > 0
            ? utterances[Math.min(Math.floor(((s.order_index + 1) / totalSections) * totalUtterances), totalUtterances - 1)]?.endMs ?? 0
            : 0;

          const startMs = startUtterance?.startMs ?? proportionStart;
          const endMs = endUtterance?.endMs ?? proportionEnd;
          lastEndMs = endMs;

          return {
            call_id: callId,
            analysis_id: savedAnalysis.id,
            section_type: s.type,
            start_ms: startMs,
            end_ms: endMs,
            summary: s.summary,
            grade: s.grade,
            order_index: s.order_index,
          };
        }
      );

      await supabase.from("call_sections").insert(sectionRows);
    }

    // Save objections
    if (analysis.objections?.length > 0) {
      const objectionRows = analysis.objections.map(
        (o: {
          utterance_text: string;
          category: string;
          rep_response: string;
          handling_grade: string;
          suggestion: string;
        }) => {
          const matchingUtterance = utterances.find((u) =>
            u.text.toLowerCase().includes(o.utterance_text?.toLowerCase().slice(0, 30) ?? "")
          );

          return {
            call_id: callId,
            analysis_id: savedAnalysis.id,
            utterance_text: o.utterance_text,
            category: o.category,
            rep_response: o.rep_response,
            handling_grade: o.handling_grade,
            suggestion: o.suggestion,
            start_ms: matchingUtterance?.startMs ?? 0,
            end_ms: matchingUtterance?.endMs ?? 0,
          };
        }
      );

      await supabase.from("objections").insert(objectionRows);
    }

    // Mark call as completed + set AI-predicted outcome
    const validOutcomes = ["sale", "no_sale", "callback", "not_home", "not_interested", "already_has_service"];
    const predictedOutcome = validOutcomes.includes(analysis.predicted_outcome)
      ? analysis.predicted_outcome
      : null;

    await supabase
      .from("calls")
      .update({
        status: "completed",
        ...(predictedOutcome ? { outcome: predictedOutcome } : {}),
      })
      .eq("id", callId);

    // Notify rep
    try {
      const { data: call } = await supabase.from("calls").select("rep_id, customer_name, team_id").eq("id", callId).single();
      if (call) {
        const { notifyCallAnalyzed } = await import("@/lib/notifications");
        await notifyCallAnalyzed(callId, call.rep_id, analysis.overall_score, call.customer_name ?? "Unknown");

        // Auto-refresh roleplay personas every 20 completed calls
        try {
          const { count } = await supabase
            .from("calls")
            .select("id", { count: "exact", head: true })
            .eq("team_id", call.team_id)
            .eq("status", "completed");

          if (count && count > 0 && count % 20 === 0) {
            // Get the team manager to auth the generation
            const { data: team } = await supabase
              .from("teams")
              .select("manager_id")
              .eq("id", call.team_id)
              .single();

            if (team?.manager_id) {
              const baseUrl = request.url.split("/api/")[0];
              fetch(`${baseUrl}/api/roleplay/personas/generate`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-internal-secret": process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
                },
              }).catch(() => {});
            }
          }
        } catch { /* persona refresh is non-critical */ }
      }
    } catch { /* notification failure is non-critical */ }

    return NextResponse.json({ success: true, callId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Analysis failed";

    await supabase
      .from("calls")
      .update({ status: "failed", error_message: message })
      .eq("id", callId);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
