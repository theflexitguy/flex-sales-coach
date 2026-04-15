import { NextResponse } from "next/server";
import { createServer } from "@/lib/supabase-server";
import { requireApiAuth } from "@/lib/api-auth-server";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createServer();
  const url = new URL(request.url);
  const callAId = url.searchParams.get("a");
  const callBId = url.searchParams.get("b");

  if (!callAId || !callBId) {
    return NextResponse.json({ error: "Both call IDs required (?a=...&b=...)" }, { status: 400 });
  }

  async function getCallData(callId: string) {
    const [{ data: call }, { data: analysis }, { data: sections }, { data: objections }] = await Promise.all([
      supabase.from("calls").select("*").eq("id", callId).single(),
      supabase.from("call_analyses").select("*").eq("call_id", callId).single(),
      supabase.from("call_sections").select("*").eq("call_id", callId).order("order_index"),
      supabase.from("objections").select("*").eq("call_id", callId),
    ]);

    const { data: repProfile } = call?.rep_id
      ? await supabase.from("profiles").select("full_name").eq("id", call.rep_id).single()
      : { data: null };

    return {
      call: {
        id: call?.id,
        customerName: call?.customer_name,
        repName: repProfile?.full_name ?? "Unknown",
        durationSeconds: call?.duration_seconds,
        recordedAt: call?.recorded_at,
        outcome: call?.outcome,
      },
      analysis: analysis ? {
        overallScore: analysis.overall_score,
        overallGrade: analysis.overall_grade,
        summary: analysis.summary,
        strengths: analysis.strengths,
        improvements: analysis.improvements,
        talkRatioRep: analysis.talk_ratio_rep,
        talkRatioCustomer: analysis.talk_ratio_customer,
      } : null,
      sections: (sections ?? []).map((s: Record<string, unknown>) => ({
        type: s.section_type,
        grade: s.grade,
        summary: s.summary,
      })),
      objections: (objections ?? []).map((o: Record<string, unknown>) => ({
        category: o.category,
        handlingGrade: o.handling_grade,
        utteranceText: o.utterance_text,
        repResponse: o.rep_response,
      })),
    };
  }

  const [callA, callB] = await Promise.all([getCallData(callAId), getCallData(callBId)]);

  return NextResponse.json({ callA, callB });
}
