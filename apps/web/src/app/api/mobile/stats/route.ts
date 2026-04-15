import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";
import { BADGES } from "@flex/shared";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();
  const repId = auth.user.id;

  // Get daily stats for last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const { data: dailyStats } = await admin
    .from("rep_daily_stats")
    .select("*")
    .eq("rep_id", repId)
    .gte("stat_date", thirtyDaysAgo)
    .order("stat_date");

  // Calculate streak
  const sortedDates = (dailyStats ?? [])
    .filter((s) => s.calls_count > 0)
    .map((s) => s.stat_date)
    .sort()
    .reverse();

  let streak = 0;
  const today = new Date().toISOString().split("T")[0];
  let checkDate = today;
  for (const date of sortedDates) {
    if (date === checkDate || date === getPreviousDate(checkDate)) {
      streak += 1;
      checkDate = date;
    } else {
      break;
    }
  }

  // All-time stats
  const { count: totalCalls } = await admin
    .from("calls")
    .select("id", { count: "exact" })
    .eq("rep_id", repId)
    .eq("status", "completed");

  const { data: allScores } = await admin
    .from("call_analyses")
    .select("overall_score, calls!inner(rep_id)")
    .eq("calls.rep_id", repId);

  const scores = (allScores ?? []).map((a) => a.overall_score);
  const overallAvgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  // Recent 7-day avg
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const recentStats = (dailyStats ?? []).filter((s) => s.stat_date >= sevenDaysAgo);
  const recentScores = recentStats.filter((s) => s.avg_score != null).map((s) => s.avg_score as number);
  const recentAvgScore = recentScores.length > 0 ? Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length) : null;

  // Objection handle rate
  const totalObjections = (dailyStats ?? []).reduce((sum, s) => sum + s.total_objections, 0);
  const handledWell = (dailyStats ?? []).reduce((sum, s) => sum + s.handled_well, 0);
  const objectionHandleRate = totalObjections > 0 ? Math.round((handledWell / totalObjections) * 100) : null;

  // Improvement areas: worst objection categories
  const { data: repObjections } = await admin
    .from("objections")
    .select("category, handling_grade")
    .eq("rep_id", repId);

  const categoryPerf: Record<string, { total: number; bad: number }> = {};
  for (const o of repObjections ?? []) {
    if (!categoryPerf[o.category]) categoryPerf[o.category] = { total: 0, bad: 0 };
    categoryPerf[o.category].total += 1;
    if (o.handling_grade === "needs_improvement" || o.handling_grade === "poor") {
      categoryPerf[o.category].bad += 1;
    }
  }

  const improvementAreas = Object.entries(categoryPerf)
    .map(([category, { total, bad }]) => ({
      category,
      total,
      failRate: Math.round((bad / total) * 100),
    }))
    .sort((a, b) => b.failRate - a.failRate)
    .slice(0, 3);

  // Badges
  const badges = BADGES.map((b) => {
    let earned = false;
    if ("calls" in b.threshold) earned = (totalCalls ?? 0) >= b.threshold.calls;
    if ("streak" in b.threshold) earned = streak >= b.threshold.streak;
    if ("avgScore" in b.threshold) earned = (overallAvgScore ?? 0) >= b.threshold.avgScore;
    if ("handleRate" in b.threshold) earned = (objectionHandleRate ?? 0) >= b.threshold.handleRate;
    return { id: b.id, label: b.label, icon: b.icon, earned };
  });

  return NextResponse.json({
    recentStats: (dailyStats ?? []).map((s) => ({
      date: s.stat_date,
      callsCount: s.calls_count,
      avgScore: s.avg_score,
      totalObjections: s.total_objections,
      handledWell: s.handled_well,
    })),
    streak,
    overallAvgScore,
    recentAvgScore,
    totalCalls: totalCalls ?? 0,
    objectionHandleRate,
    improvementAreas,
    badges,
  });
}

function getPreviousDate(dateStr: string): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}
