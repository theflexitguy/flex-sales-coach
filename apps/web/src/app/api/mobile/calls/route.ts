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

  const { supabase } = auth;

  const { data: calls, count } = await supabase
    .from("calls")
    .select("*", { count: "exact" })
    .eq("rep_id", auth.user.id)
    .order("recorded_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Enrich with analysis scores
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
