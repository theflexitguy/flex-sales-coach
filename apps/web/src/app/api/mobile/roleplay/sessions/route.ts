import { NextResponse, after } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";
import { analyzeRoleplaySession } from "@/lib/roleplay-analysis";

export const maxDuration = 300;

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
      .select("id, status, duration_seconds, transcript_text, started_at, ended_at, roleplay_analyses(*)")
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

    return NextResponse.json({
      session: {
        id: session.id,
        status: session.status,
        durationSeconds: session.duration_seconds,
        startedAt: session.started_at,
        endedAt: session.ended_at,
      },
      analysis: analysisRow ? {
        overallScore: analysisRow.overall_score,
        overallGrade: analysisRow.overall_grade,
        summary: analysisRow.summary,
        strengths: analysisRow.strengths,
        improvements: analysisRow.improvements,
        objectionHandlingScores: analysisRow.objection_handling_scores,
        comparedToReal: analysisRow.compared_to_real,
      } : null,
      analysisStatus: analysisRow ? "complete" : shouldTriggerAnalysis ? "processing" : "unavailable",
    });
  }

  // List recent sessions
  const { data: sessions } = await admin
    .from("roleplay_sessions")
    .select("id, scenario_id, persona_id, status, duration_seconds, started_at, ended_at, roleplay_analyses(overall_score, overall_grade), roleplay_personas(name), roleplay_scenarios(title)")
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
      startedAt: s.started_at,
    };
  });

  return NextResponse.json({ sessions: history });
}
