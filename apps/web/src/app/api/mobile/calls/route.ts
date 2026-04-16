import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const filter = url.searchParams.get("filter") ?? "mine"; // "mine" | "team" | "shared"

  const { supabase, profile } = auth;
  const isManager = profile?.role === "manager";

  let query = supabase
    .from("calls")
    .select("*", { count: "exact" });

  if (filter === "team" && isManager) {
    // Manager sees all calls from their team (RLS handles the team_id check)
    // Don't filter by rep_id — let RLS show all team calls
  } else if (filter === "shared") {
    // Calls shared with this user (RLS includes call_shares)
    // Filter out own calls to only show shared ones
    query = query.neq("rep_id", auth.user.id);
  } else {
    // Default: own calls only
    query = query.eq("rep_id", auth.user.id);
  }

  const { data: calls, count } = await query
    .order("recorded_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Get rep names for team/shared views
  const repIds = [...new Set((calls ?? []).map((c) => c.rep_id))];
  const repNameMap: Record<string, string> = {};
  if (repIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", repIds);
    for (const p of profiles ?? []) repNameMap[p.id] = p.full_name;
  }

  // Enrich with analysis scores + rep name
  const enriched = await Promise.all(
    (calls ?? []).map(async (call) => {
      let analysis = null;
      if (call.status === "completed") {
        const { data } = await supabase
          .from("call_analyses")
          .select("overall_score, overall_grade, summary")
          .eq("call_id", call.id)
          .single();
        analysis = data;
      }

      return {
        id: call.id,
        customerName: call.customer_name,
        repName: repNameMap[call.rep_id] ?? null,
        repId: call.rep_id,
        durationSeconds: call.duration_seconds,
        status: call.status,
        recordedAt: call.recorded_at,
        sessionId: call.session_id,
        sessionOrder: call.session_order,
        overallScore: analysis?.overall_score ?? null,
        overallGrade: analysis?.overall_grade ?? null,
        summary: analysis?.summary ?? null,
      };
    })
  );

  return NextResponse.json({
    calls: enriched,
    total: count ?? 0,
    limit,
    offset,
  });
}
