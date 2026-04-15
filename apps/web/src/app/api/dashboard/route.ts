import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { supabase } = auth;

  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  // Parallel fetches
  const [
    { data: todayCalls },
    { data: activeSessions },
    { data: pendingHelp, count: pendingHelpCount },
    { data: dailyStats },
    { data: allAnalyses },
    { data: allObjections },
    { data: recentNotes },
    { data: reps },
  ] = await Promise.all([
    supabase.from("calls").select("id, rep_id, customer_name, status, recorded_at, duration_seconds").gte("recorded_at", today).order("recorded_at", { ascending: false }),
    supabase.from("recording_sessions").select("*").in("status", ["recording", "uploading", "processing"]),
    supabase.from("help_requests").select("*", { count: "exact" }).eq("status", "pending").order("created_at", { ascending: false }).limit(5),
    supabase.from("rep_daily_stats").select("*").gte("stat_date", thirtyDaysAgo).order("stat_date"),
    supabase.from("call_analyses").select("overall_score, overall_grade, call_id, created_at").gte("created_at", `${thirtyDaysAgo}T00:00:00`),
    supabase.from("objections").select("category, handling_grade, rep_id").gte("created_at", `${thirtyDaysAgo}T00:00:00`),
    supabase.from("coaching_notes").select("call_id, author_id, created_at").gte("created_at", `${thirtyDaysAgo}T00:00:00`),
    supabase.from("profiles").select("id, full_name, role").eq("is_active", true),
  ]);

  const repMap: Record<string, string> = {};
  for (const r of reps ?? []) repMap[r.id] = r.full_name;

  // Leaderboard
  const repScores: Record<string, { scores: number[]; objections: number; handled: number; calls: number }> = {};
  for (const stat of dailyStats ?? []) {
    if (!repScores[stat.rep_id]) repScores[stat.rep_id] = { scores: [], objections: 0, handled: 0, calls: 0 };
    if (stat.avg_score != null) repScores[stat.rep_id].scores.push(stat.avg_score);
    repScores[stat.rep_id].objections += stat.total_objections;
    repScores[stat.rep_id].handled += stat.handled_well;
    repScores[stat.rep_id].calls += stat.calls_count;
  }

  const leaderboard = Object.entries(repScores)
    .map(([repId, data]) => ({
      repId,
      repName: repMap[repId] ?? "Unknown",
      avgScore: data.scores.length > 0 ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length) : null,
      objectionHandleRate: data.objections > 0 ? Math.round((data.handled / data.objections) * 100) : null,
      totalCalls: data.calls,
    }))
    .sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0));

  // Trends: daily scores
  const dailyTrends: Record<string, { scores: number[]; count: number }> = {};
  for (const a of allAnalyses ?? []) {
    const date = (a.created_at as string).split("T")[0];
    if (!dailyTrends[date]) dailyTrends[date] = { scores: [], count: 0 };
    dailyTrends[date].scores.push(a.overall_score);
    dailyTrends[date].count += 1;
  }

  const trends = Object.entries(dailyTrends)
    .map(([date, d]) => ({
      date,
      avgScore: Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length),
      callCount: d.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Worst call today
  const todayScores = (allAnalyses ?? [])
    .filter((a) => (a.created_at as string).startsWith(today))
    .sort((a, b) => a.overall_score - b.overall_score);
  const worstCallToday = todayScores[0]?.call_id ?? null;

  // Most common failed objection
  const failedByCategory: Record<string, number> = {};
  for (const o of allObjections ?? []) {
    if (o.handling_grade === "needs_improvement" || o.handling_grade === "poor") {
      failedByCategory[o.category] = (failedByCategory[o.category] ?? 0) + 1;
    }
  }
  const topFailedObjection = Object.entries(failedByCategory).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return NextResponse.json({
    todayActivity: {
      callsToday: (todayCalls ?? []).length,
      activeSessions: (activeSessions ?? []).length,
      analyzedToday: todayScores.length,
    },
    leaderboard,
    trends,
    helpRequests: {
      pendingCount: pendingHelpCount ?? 0,
      recent: (pendingHelp ?? []).map((r: Record<string, unknown>) => ({
        id: r.id,
        callId: r.call_id,
        repName: repMap[r.rep_id as string] ?? "Unknown",
        excerpt: (r.transcript_excerpt as string)?.slice(0, 100),
        createdAt: r.created_at,
      })),
    },
    quickActions: {
      worstCallToday,
      topFailedObjection,
      strugglingRep: leaderboard[leaderboard.length - 1]?.repId ?? null,
      strugglingRepName: leaderboard[leaderboard.length - 1]?.repName ?? null,
    },
  });
}
