import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.profile?.role !== "manager") {
    return NextResponse.json({ error: "Managers only" }, { status: 403 });
  }

  const admin = createAdmin();
  const teamId = auth.profile.team_id;
  if (!teamId) return NextResponse.json({ error: "No team" }, { status: 400 });

  // Get all team reps
  const { data: reps } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("team_id", teamId)
    .eq("role", "rep")
    .eq("is_active", true);

  const repIds = (reps ?? []).map((r) => r.id);

  // Get all completed roleplay sessions for the team
  const { data: sessions } = await admin
    .from("roleplay_sessions")
    .select("id, rep_id, duration_seconds, started_at, roleplay_analyses(overall_score, overall_grade)")
    .eq("team_id", teamId)
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(200);

  // Get real call scores for comparison
  const { data: realCalls } = await admin
    .from("calls")
    .select("rep_id, call_analyses(overall_score)")
    .eq("team_id", teamId)
    .eq("status", "completed")
    .order("recorded_at", { ascending: false })
    .limit(100);

  // Build per-rep stats
  const repStats = (reps ?? []).map((rep) => {
    const repSessions = (sessions ?? []).filter((s) => s.rep_id === rep.id);
    const repAnalyses = repSessions
      .map((s) => (s.roleplay_analyses as unknown as Array<{ overall_score: number }>)?.[0])
      .filter(Boolean);

    const totalSessions = repSessions.length;
    const totalMinutes = Math.round(
      repSessions.reduce((sum, s) => sum + s.duration_seconds, 0) / 60
    );
    const avgScore = repAnalyses.length > 0
      ? Math.round(repAnalyses.reduce((sum, a) => sum + a.overall_score, 0) / repAnalyses.length)
      : null;

    // Last 7 days sessions
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentSessions = repSessions.filter((s) => s.started_at > weekAgo).length;

    // Real call avg for comparison
    const repRealCalls = (realCalls ?? []).filter((c) => c.rep_id === rep.id);
    const realAnalyses = repRealCalls
      .map((c) => (c.call_analyses as unknown as Array<{ overall_score: number }>)?.[0])
      .filter(Boolean);
    const avgRealScore = realAnalyses.length > 0
      ? Math.round(realAnalyses.reduce((sum, a) => sum + a.overall_score, 0) / realAnalyses.length)
      : null;

    return {
      repId: rep.id,
      repName: rep.full_name,
      totalSessions,
      totalMinutes,
      sessionsThisWeek: recentSessions,
      avgRoleplayScore: avgScore,
      avgRealScore,
      scoreDelta: avgScore != null && avgRealScore != null ? avgScore - avgRealScore : null,
    };
  });

  // Team totals
  const totalSessions = (sessions ?? []).length;
  const totalMinutes = Math.round(
    (sessions ?? []).reduce((sum, s) => sum + s.duration_seconds, 0) / 60
  );

  // Persona count
  const { count: personaCount } = await admin
    .from("roleplay_personas")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("is_active", true);

  const { count: scenarioCount } = await admin
    .from("roleplay_scenarios")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("is_active", true);

  return NextResponse.json({
    team: {
      totalSessions,
      totalMinutes,
      personaCount: personaCount ?? 0,
      scenarioCount: scenarioCount ?? 0,
    },
    reps: repStats,
  });
}
