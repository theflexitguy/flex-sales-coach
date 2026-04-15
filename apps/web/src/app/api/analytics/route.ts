import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { supabase } = auth;

  // Fetch everything we need for analytics
  const [
    { data: calls },
    { data: analyses },
    { data: objections },
    { data: sections },
    { data: profiles },
  ] = await Promise.all([
    supabase.from("calls").select("id, rep_id, customer_name, recorded_at, status, duration_seconds"),
    supabase.from("call_analyses").select("*"),
    supabase.from("objections").select("*"),
    supabase.from("call_sections").select("*"),
    supabase.from("profiles").select("id, full_name, role").eq("is_active", true),
  ]);

  // Build rep name lookup
  const repMap: Record<string, string> = {};
  for (const p of profiles ?? []) {
    repMap[p.id] = p.full_name;
  }

  // Enrich calls with analysis and rep name
  const enrichedCalls = (calls ?? [])
    .filter((c) => c.status === "completed")
    .map((c) => {
      const a = (analyses ?? []).find((a) => a.call_id === c.id);
      return {
        id: c.id,
        repId: c.rep_id,
        repName: repMap[c.rep_id] ?? "Unknown",
        customerName: c.customer_name ?? "Unknown",
        recordedAt: c.recorded_at,
        durationSeconds: c.duration_seconds,
        overallScore: a?.overall_score ?? null,
        overallGrade: a?.overall_grade ?? null,
        summary: a?.summary ?? null,
      };
    });

  // Enrich objections with call/rep info
  const enrichedObjections = (objections ?? []).map((o) => {
    const call = (calls ?? []).find((c) => c.id === o.call_id);
    return {
      id: o.id,
      callId: o.call_id,
      repId: call?.rep_id ?? null,
      repName: call ? (repMap[call.rep_id] ?? "Unknown") : "Unknown",
      customerName: call?.customer_name ?? "Unknown",
      category: o.category,
      utteranceText: o.utterance_text,
      repResponse: o.rep_response,
      handlingGrade: o.handling_grade,
      suggestion: o.suggestion,
      startMs: o.start_ms,
    };
  });

  // Rep performance summary
  const repStats = Object.entries(repMap).map(([repId, repName]) => {
    const repCalls = enrichedCalls.filter((c) => c.repId === repId);
    const scores = repCalls.map((c) => c.overallScore).filter((s): s is number => s != null);
    const repObjections = enrichedObjections.filter((o) => o.repId === repId);
    const wellHandled = repObjections.filter(
      (o) => o.handlingGrade === "excellent" || o.handlingGrade === "good"
    ).length;

    return {
      repId,
      repName,
      totalCalls: repCalls.length,
      avgScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      totalObjections: repObjections.length,
      objectionHandleRate: repObjections.length > 0 ? Math.round((wellHandled / repObjections.length) * 100) : null,
    };
  });

  return NextResponse.json({
    calls: enrichedCalls,
    objections: enrichedObjections,
    repStats,
  });
}
