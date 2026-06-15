import { NextResponse, after } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";
import { analyzeRoleplaySession } from "@/lib/roleplay-analysis";

export const maxDuration = 300;

type AnalysisRow = Record<string, unknown>;
type TranscriptUtterance = {
  speaker?: unknown;
  role?: unknown;
  text?: unknown;
  startMs?: unknown;
  endMs?: unknown;
};

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

function mapTranscript(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((line: TranscriptUtterance) => {
      const speaker = line.speaker ?? line.role;
      const role = speaker === "customer" ? "customer" : speaker === "rep" ? "rep" : null;
      const text = typeof line.text === "string" ? line.text.trim() : "";
      if (!role || !text) return null;

      return {
        role,
        text,
        startMs: typeof line.startMs === "number" ? line.startMs : 0,
        endMs: typeof line.endMs === "number" ? line.endMs : 0,
      };
    })
    .filter(Boolean);
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();
  const url = new URL(request.url);

  // Single session lookup (for polling analysis)
  const sessionId = url.searchParams.get("sessionId");
  if (sessionId) {
    const recoverAnalysis = url.searchParams.get("recoverAnalysis") === "1";
    const { data: session } = await admin
      .from("roleplay_sessions")
      .select("id, status, duration_seconds, transcript_text, transcript_utterances, audio_storage_path, started_at, ended_at, roleplay_analyses(*), roleplay_personas(name), roleplay_scenarios(title, difficulty, target_objections)")
      .eq("id", sessionId)
      .eq("rep_id", auth.user.id)
      .single();

    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const analysisRow = (session.roleplay_analyses as Array<Record<string, unknown>>)?.[0] ?? null;
    const shouldTriggerAnalysis = recoverAnalysis && !analysisRow && session.status === "completed" && !!session.transcript_text;

    if (shouldTriggerAnalysis) {
      after(async () => {
        try {
          await analyzeRoleplaySession(session.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown";
          console.error(JSON.stringify({
            route: "/api/mobile/roleplay/sessions",
            reason: "analysis_recovery_failed",
            sessionId: session.id,
            message,
          }));
        }
      });
    }

    let audioUrl: string | null = null;
    if (session.audio_storage_path) {
      const { data: signedAudio } = await admin.storage
        .from("call-recordings")
        .createSignedUrl(session.audio_storage_path, 3600);
      audioUrl = signedAudio?.signedUrl ?? null;
    }

    const persona = session.roleplay_personas as unknown as Record<string, unknown> | null;
    const scenario = session.roleplay_scenarios as unknown as Record<string, unknown> | null;

    return NextResponse.json({
      session: {
        id: session.id,
        status: session.status,
        durationSeconds: session.duration_seconds,
        scenarioTitle: (scenario?.title as string) ?? "Free Practice",
        scenarioDifficulty: (scenario?.difficulty as string) ?? null,
        targetObjections: Array.isArray(scenario?.target_objections)
          ? scenario.target_objections
          : [],
        personaName: (persona?.name as string) ?? "Customer",
        startedAt: session.started_at,
        endedAt: session.ended_at,
        audioUrl,
        transcript: mapTranscript(session.transcript_utterances),
      },
      analysis: mapAnalysis(analysisRow),
      analysisStatus: analysisRow ? "complete" : shouldTriggerAnalysis ? "processing" : "unavailable",
    });
  }

  // List recent sessions
  const { data: sessions } = await admin
    .from("roleplay_sessions")
    .select("id, scenario_id, persona_id, status, duration_seconds, started_at, ended_at, roleplay_analyses(overall_score, overall_grade, summary), roleplay_personas(name), roleplay_scenarios(title)")
    .eq("rep_id", auth.user.id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(20);

  const history = (sessions ?? []).map((s) => {
    const analysis = (s.roleplay_analyses as Array<Record<string, unknown>>)?.[0] ?? null;
    const persona = s.roleplay_personas as unknown as Record<string, unknown> | null;
    const scenario = s.roleplay_scenarios as unknown as Record<string, unknown> | null;

    return {
      id: s.id,
      scenarioTitle: (scenario?.title as string) ?? "Free Practice",
      personaName: (persona?.name as string) ?? "Unknown",
      durationSeconds: s.duration_seconds,
      score: analysis?.overall_score ?? null,
      grade: analysis?.overall_grade ?? null,
      summary: analysis?.summary ?? null,
      startedAt: s.started_at,
    };
  });

  return NextResponse.json({ sessions: history });
}
