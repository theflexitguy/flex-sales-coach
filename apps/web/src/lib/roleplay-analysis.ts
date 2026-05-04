import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { createAdmin } from "@flex/supabase/admin";

const PROMPT_VERSION = "1.0.1";
const MODEL_ID = process.env.ROLEPLAY_ANALYSIS_MODEL ?? "claude-sonnet-4-20250514";

type Grade = "excellent" | "good" | "acceptable" | "needs_improvement" | "poor";

interface RawObjectionScore {
  readonly category?: unknown;
  readonly grade?: unknown;
  readonly feedback?: unknown;
}

interface RawAnalysis {
  readonly overall_score?: unknown;
  readonly overall_grade?: unknown;
  readonly summary?: unknown;
  readonly strengths?: unknown;
  readonly improvements?: unknown;
  readonly objection_handling_scores?: unknown;
}

const GRADES = new Set<Grade>(["excellent", "good", "acceptable", "needs_improvement", "poor"]);

const ROLEPLAY_ANALYSIS_PROMPT = `You are an expert door-to-door sales coach AI. You analyze roleplay training transcripts where a sales rep practices with an AI homeowner.

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

Score the rep against realistic door-to-door pest control selling. Reward rapport, discovery, pre-overcoming objections, concise value framing, control of the conversation, and a clear next-step close. Penalize generic scripts, talking too much, accepting spouse/authority objections without creating a spouse-involved next step, and failing to ask for the business.
Be direct but useful. Reference exact things the rep said when possible.
Return ONLY valid JSON, no markdown or explanation.`;

function log(status: number, reason: string, ctx: Record<string, unknown>): void {
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  console[level](JSON.stringify({ route: "roleplay-analysis", status, reason, ...ctx }));
}

function cleanJson(text: string): string {
  const trimmed = text
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function scoreToGrade(score: number): Grade {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 60) return "acceptable";
  if (score >= 40) return "needs_improvement";
  return "poor";
}

function normalizeGrade(value: unknown, fallback: Grade): Grade {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return GRADES.has(normalized as Grade) ? (normalized as Grade) : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeAnalysis(raw: RawAnalysis) {
  const rawScore = typeof raw.overall_score === "number" && Number.isFinite(raw.overall_score)
    ? raw.overall_score
    : 50;
  const overallScore = Math.max(0, Math.min(100, Math.round(rawScore)));
  const overallGrade = normalizeGrade(raw.overall_grade, scoreToGrade(overallScore));
  const strengths = normalizeStringArray(raw.strengths);
  const improvements = normalizeStringArray(raw.improvements);

  const objectionHandlingScores = Array.isArray(raw.objection_handling_scores)
    ? raw.objection_handling_scores
      .map((item: RawObjectionScore) => {
        const category = typeof item.category === "string" ? item.category.trim() : "Objection";
        const feedback = typeof item.feedback === "string" ? item.feedback.trim() : "";
        if (!feedback) return null;
        return {
          category: category || "Objection",
          grade: normalizeGrade(item.grade, overallGrade),
          feedback,
        };
      })
      .filter(Boolean)
      .slice(0, 8)
    : [];

  return {
    overall_score: overallScore,
    overall_grade: overallGrade,
    summary: typeof raw.summary === "string" && raw.summary.trim()
      ? raw.summary.trim()
      : "The roleplay was completed, but the analysis summary was unavailable.",
    strengths,
    improvements,
    objection_handling_scores: objectionHandlingScores,
  };
}

export async function analyzeRoleplaySession(sessionId: string) {
  const admin = createAdmin();

  const { data: existing } = await admin
    .from("roleplay_analyses")
    .select("id")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existing) {
    return { status: "already_analyzed" as const, analysisId: existing.id };
  }

  const { data: session, error: sessionError } = await admin
    .from("roleplay_sessions")
    .select("id, rep_id, transcript_text")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session?.transcript_text) {
    log(400, "missing_transcript", { sessionId, message: sessionError?.message });
    throw new Error("No transcript to analyze");
  }

  const { text: responseText } = await generateText({
    model: anthropic(MODEL_ID),
    system: ROLEPLAY_ANALYSIS_PROMPT,
    prompt: `Analyze this roleplay practice transcript:\n\n${session.transcript_text}`,
    maxOutputTokens: 2048,
  });

  let parsed: RawAnalysis;
  try {
    parsed = JSON.parse(cleanJson(responseText)) as RawAnalysis;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    log(500, "invalid_model_json", {
      sessionId,
      message,
      response: responseText.slice(0, 500),
    });
    throw new Error("Roleplay analysis returned invalid JSON");
  }

  const analysis = normalizeAnalysis(parsed);

  const { data: callIds } = await admin
    .from("calls")
    .select("id")
    .eq("rep_id", session.rep_id)
    .eq("status", "completed")
    .order("recorded_at", { ascending: false })
    .limit(10);

  const ids = callIds?.map((c) => c.id) ?? [];
  const { data: realAnalyses } = ids.length
    ? await admin.from("call_analyses").select("overall_score").in("call_id", ids)
    : { data: null };

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

  const { data: saved, error } = await admin
    .from("roleplay_analyses")
    .insert({
      session_id: sessionId,
      overall_score: analysis.overall_score,
      overall_grade: analysis.overall_grade,
      summary: analysis.summary,
      strengths: analysis.strengths,
      improvements: analysis.improvements,
      objection_handling_scores: analysis.objection_handling_scores,
      compared_to_real: comparedToReal,
      model_id: MODEL_ID,
      prompt_version: PROMPT_VERSION,
    })
    .select("id")
    .single();

  if (error) {
    log(500, "insert_failed", { sessionId, message: error.message });
    throw new Error(error.message);
  }

  log(200, "ok", { sessionId, analysisId: saved?.id });
  return { status: "analyzed" as const, analysisId: saved?.id };
}
