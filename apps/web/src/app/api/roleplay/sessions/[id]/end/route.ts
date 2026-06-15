import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";
import { analyzeRoleplaySession } from "@/lib/roleplay-analysis";

export const maxDuration = 300;

interface ClientTranscriptLine {
  readonly role?: unknown;
  readonly text?: unknown;
  readonly startMs?: unknown;
  readonly endMs?: unknown;
}

type AnalysisRow = Record<string, unknown>;

function sanitizeTranscript(value: unknown): Array<{ speaker: string; text: string; startMs: number; endMs: number }> {
  if (!Array.isArray(value)) return [];

  const lines: Array<{ speaker: string; text: string; startMs: number; endMs: number }> = [];
  let lastKey = "";

  for (const raw of value as ClientTranscriptLine[]) {
    const role = raw.role === "customer" ? "customer" : raw.role === "rep" ? "rep" : null;
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!role || !text) continue;

    const key = `${role}:${text}`;
    if (key === lastKey) continue;
    lastKey = key;

    const startMs = typeof raw.startMs === "number" && Number.isFinite(raw.startMs)
      ? Math.max(0, Math.round(raw.startMs))
      : Math.max(0, lines.at(-1)?.endMs ?? 0);
    const endMs = typeof raw.endMs === "number" && Number.isFinite(raw.endMs)
      ? Math.max(startMs, Math.round(raw.endMs))
      : startMs + 3000;

    lines.push({ speaker: role, text, startMs, endMs });
  }

  return lines;
}

function sanitizeDuration(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(7200, Math.round(value)));
}

function mapAnalysis(row: AnalysisRow | null) {
  if (!row) return null;

  return {
    overallScore: row.overall_score,
    overallGrade: row.overall_grade,
    summary: row.summary,
    strengths: Array.isArray(row.strengths) ? row.strengths : [],
    improvements: Array.isArray(row.improvements) ? row.improvements : [],
    objectionHandlingScores: Array.isArray(row.objection_handling_scores)
      ? row.objection_handling_scores
      : [],
    comparedToReal: row.compared_to_real ?? null,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();
  const body = await request.json().catch(() => ({})) as {
    transcript?: unknown;
    durationSeconds?: unknown;
  };

  // Get the session
  const { data: session } = await admin
    .from("roleplay_sessions")
    .select("id, started_at, rep_id")
    .eq("id", id)
    .single();

  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.rep_id !== auth.user.id) {
    return NextResponse.json({ error: "Not your session" }, { status: 403 });
  }

  const fallbackDurationSeconds = Math.round(
    (Date.now() - new Date(session.started_at).getTime()) / 1000
  );
  const transcriptUtterances = sanitizeTranscript(body.transcript);
  const transcriptText = transcriptUtterances.length
    ? transcriptUtterances.map((t) => `[${t.speaker}] ${t.text}`).join("\n")
    : null;
  const durationSeconds = sanitizeDuration(body.durationSeconds, fallbackDurationSeconds);

  // Update session
  const { error } = await admin
    .from("roleplay_sessions")
    .update({
      status: "completed",
      duration_seconds: durationSeconds,
      transcript_text: transcriptText,
      transcript_utterances: transcriptUtterances.length ? transcriptUtterances : null,
      ended_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let analysisStatus: "complete" | "processing" | "failed" | "unavailable" =
    transcriptText ? "processing" : "unavailable";
  let analysisError: string | null = null;

  if (transcriptText) {
    try {
      await analyzeRoleplaySession(id);
      analysisStatus = "complete";
    } catch (err) {
      analysisStatus = "failed";
      analysisError = err instanceof Error ? err.message : "Roleplay analysis failed";
      console.error(JSON.stringify({
        route: "/api/roleplay/sessions/[id]/end",
        reason: "analysis_failed",
        sessionId: id,
        message: analysisError,
      }));
    }
  }

  const { data: analysisRow } = transcriptText
    ? await admin
      .from("roleplay_analyses")
      .select("*")
      .eq("session_id", id)
      .maybeSingle()
    : { data: null };

  if (analysisRow) analysisStatus = "complete";

  return NextResponse.json({
    sessionId: id,
    durationSeconds,
    hasTranscript: !!transcriptText,
    analysis: mapAnalysis((analysisRow as AnalysisRow | null) ?? null),
    analysisStatus,
    analysisError,
  });
}
