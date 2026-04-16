import { requireManager } from "@/lib/auth";
import { createServer } from "@/lib/supabase-server";
import Link from "next/link";
import { GRADE_COLORS } from "@flex/shared";
import { getVisibleRepIds } from "@/lib/assignments";

export default async function RepsPage() {
  const manager = await requireManager();
  const supabase = await createServer();

  // Get visible reps (assigned + unassigned)
  const visibleRepIds = await getVisibleRepIds(manager.id, manager.teamId);

  const { data: reps } = visibleRepIds.length > 0
    ? await supabase
        .from("profiles")
        .select("*")
        .in("id", visibleRepIds)
        .eq("is_active", true)
        .order("full_name") as unknown as {
          data: Array<{ id: string; full_name: string; email: string; team_id: string }> | null;
        }
    : { data: [] as Array<{ id: string; full_name: string; email: string; team_id: string }> };

  // Get call stats per rep
  const repStats = await Promise.all(
    (reps ?? []).map(async (rep) => {
      const { count: totalCalls } = await supabase
        .from("calls")
        .select("id", { count: "exact" })
        .eq("rep_id", rep.id);

      const { data: repCalls } = await supabase
        .from("calls")
        .select("id")
        .eq("rep_id", rep.id)
        .eq("status", "completed") as unknown as { data: Array<{ id: string }> | null };

      const callIds = (repCalls ?? []).map((c) => c.id);

      const { data: analyses } = callIds.length > 0
        ? await supabase
            .from("call_analyses")
            .select("overall_score")
            .in("call_id", callIds) as unknown as { data: Array<{ overall_score: number }> | null }
        : { data: [] as Array<{ overall_score: number }> };

      const scores = (analyses ?? []).map((a) => a.overall_score);
      const avgScore =
        scores.length > 0
          ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
          : null;

      // Most common objection category
      const { data: objections } = callIds.length > 0
        ? await supabase
            .from("objections")
            .select("category")
            .in("call_id", callIds) as unknown as { data: Array<{ category: string }> | null }
        : { data: [] as Array<{ category: string }> };

      const categoryCounts: Record<string, number> = {};
      for (const obj of objections ?? []) {
        categoryCounts[obj.category] = (categoryCounts[obj.category] ?? 0) + 1;
      }
      const topObjection = Object.entries(categoryCounts).sort(
        (a, b) => b[1] - a[1]
      )[0];

      return {
        ...rep,
        totalCalls: totalCalls ?? 0,
        avgScore,
        topObjection: topObjection?.[0] ?? null,
        topObjectionCount: topObjection?.[1] ?? 0,
      };
    })
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Reps</h1>
        <p className="text-zinc-400 mt-1">Your team&apos;s performance overview</p>
      </div>

      {repStats.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-16 text-center">
          <p className="text-zinc-400">No reps on your team yet</p>
          <p className="text-zinc-500 text-sm mt-1">
            Invite reps to sign up and join your team
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {repStats.map((rep) => (
            <div
              key={rep.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-zinc-800 text-zinc-300 text-lg font-semibold">
                  {rep.full_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-white font-semibold">{rep.full_name}</h3>
                  <p className="text-sm text-zinc-500">{rep.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-zinc-500">Convos</p>
                  <p className="text-lg font-bold text-white">{rep.totalCalls}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Avg Score</p>
                  <p
                    className="text-lg font-bold"
                    style={{
                      color: rep.avgScore
                        ? rep.avgScore >= 80
                          ? GRADE_COLORS.excellent
                          : rep.avgScore >= 60
                            ? GRADE_COLORS.good
                            : GRADE_COLORS.needs_improvement
                        : "#71717a",
                    }}
                  >
                    {rep.avgScore ?? "--"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Top Objection</p>
                  <p className="text-sm font-medium text-zinc-300 capitalize">
                    {rep.topObjection ?? "--"}
                  </p>
                </div>
              </div>

              <Link
                href={`/calls?rep=${rep.id}`}
                className="inline-flex items-center text-sm text-sky-400 hover:text-sky-300 transition-colors"
              >
                View conversations
                <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
