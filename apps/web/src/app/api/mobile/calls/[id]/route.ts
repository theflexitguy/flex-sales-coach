import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { supabase } = auth;

  // Fetch call
  const { data: call } = await supabase
    .from("calls")
    .select("*")
    .eq("id", id)
    .single();

  if (!call) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // Fetch all related data in parallel
  const [
    { data: transcript },
    { data: analysis },
    { data: sections },
    { data: objections },
    { data: notes },
  ] = await Promise.all([
    supabase.from("transcripts").select("*").eq("call_id", id).single(),
    supabase.from("call_analyses").select("*").eq("call_id", id).single(),
    supabase.from("call_sections").select("*").eq("call_id", id).order("order_index"),
    supabase.from("objections").select("*").eq("call_id", id),
    supabase.from("coaching_notes").select("*").eq("call_id", id).order("created_at"),
  ]);

  // Get signed audio URL
  let audioUrl: string | null = null;
  if (call.audio_storage_path) {
    const { data: signedData } = await supabase.storage
      .from("call-recordings")
      .createSignedUrl(call.audio_storage_path, 3600);
    audioUrl = signedData?.signedUrl ?? null;
  }

  // Get note author names
  const authorIds = [...new Set((notes ?? []).map((n: { author_id: string }) => n.author_id))];
  const authorMap: Record<string, string> = {};
  if (authorIds.length > 0) {
    const { data: authors } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);
    for (const a of authors ?? []) {
      authorMap[a.id] = a.full_name;
    }
  }

  return NextResponse.json({
    call: {
      id: call.id,
      customerName: call.customer_name,
      durationSeconds: call.duration_seconds,
      status: call.status,
      recordedAt: call.recorded_at,
      audioUrl,
      latitude: call.latitude ?? null,
      longitude: call.longitude ?? null,
    },
    analysis: analysis
      ? {
          overallScore: analysis.overall_score,
          overallGrade: analysis.overall_grade,
          summary: analysis.summary,
          strengths: analysis.strengths,
          improvements: analysis.improvements,
          talkRatioRep: analysis.talk_ratio_rep,
          talkRatioCustomer: analysis.talk_ratio_customer,
        }
      : null,
    sections: (sections ?? []).map((s: Record<string, unknown>) => ({
      id: s.id,
      sectionType: s.section_type,
      startMs: s.start_ms,
      endMs: s.end_ms,
      summary: s.summary,
      grade: s.grade,
      orderIndex: s.order_index,
    })),
    objections: (objections ?? []).map((o: Record<string, unknown>) => ({
      id: o.id,
      category: o.category,
      utteranceText: o.utterance_text,
      repResponse: o.rep_response,
      handlingGrade: o.handling_grade,
      suggestion: o.suggestion,
      startMs: o.start_ms,
    })),
    transcript: {
      fullText: transcript?.full_text ?? null,
      utterances: transcript?.utterances ?? [],
    },
    notes: (notes ?? []).map((n: Record<string, unknown>) => ({
      id: n.id,
      content: n.content,
      timestampMs: n.timestamp_ms,
      createdAt: n.created_at,
      authorName: authorMap[n.author_id as string] ?? "Coach",
    })),
  });
}
