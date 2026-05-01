import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";
import { durationFromTranscriptUtterances } from "@/lib/call-duration";

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
    { data: helpRequests },
  ] = await Promise.all([
    supabase.from("transcripts").select("*").eq("call_id", id).single(),
    supabase.from("call_analyses").select("*").eq("call_id", id).single(),
    supabase.from("call_sections").select("*").eq("call_id", id).order("order_index"),
    supabase.from("objections").select("*").eq("call_id", id),
    supabase.from("coaching_notes").select("*").eq("call_id", id).order("created_at"),
    supabase.from("help_requests").select("*").eq("call_id", id).order("created_at"),
  ]);

  // Admin client for tasks where the user-scoped RLS would block us even
  // though access was already established via the authenticated `calls`
  // lookup above (nested RLS on help responses, signed URL for shared calls).
  const admin = createAdmin();
  const helpRequestIds = (helpRequests ?? []).map((h: { id: string }) => h.id);
  let helpResponses: Record<string, unknown>[] = [];
  if (helpRequestIds.length > 0) {
    const { data } = await admin
      .from("help_request_responses")
      .select("*")
      .in("request_id", helpRequestIds)
      .order("created_at");
    helpResponses = data ?? [];
  }
  const responsesByRequest = new Map<string, Record<string, unknown>[]>();
  for (const r of helpResponses) {
    const key = r.request_id as string;
    if (!responsesByRequest.has(key)) responsesByRequest.set(key, []);
    responsesByRequest.get(key)!.push(r);
  }

  // Get signed audio URL via admin — user access is already enforced by the
  // calls RLS check above; the call-recordings bucket's SELECT policy may not
  // include shared users, which would otherwise silently return a null URL.
  let audioUrl: string | null = null;
  if (call.audio_storage_path) {
    const { data: signedData } = await admin.storage
      .from("call-recordings")
      .createSignedUrl(call.audio_storage_path, 3600);
    audioUrl = signedData?.signedUrl ?? null;
  }

  // Get author names for notes + help request responses
  const responseAuthorIds = helpResponses.map((r) => r.author_id as string);
  const authorIds = [...new Set([
    ...(notes ?? []).map((n: { author_id: string }) => n.author_id),
    ...responseAuthorIds,
  ])];
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
      durationSeconds:
        call.duration_seconds && call.duration_seconds > 0
          ? call.duration_seconds
          : durationFromTranscriptUtterances(transcript?.utterances) ?? 0,
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
      audioUrl: n.audio_url ?? null,
      audioDurationSeconds: n.audio_duration_seconds ?? null,
    })),
    helpRequests: (helpRequests ?? []).map((h: Record<string, unknown>) => ({
      id: h.id,
      startMs: h.start_ms,
      endMs: h.end_ms,
      transcriptExcerpt: h.transcript_excerpt,
      message: h.message,
      status: h.status,
      repName: authorMap[h.rep_id as string] ?? "Rep",
      createdAt: h.created_at,
      responses: (responsesByRequest.get(h.id as string) ?? []).map((r) => ({
        id: r.id,
        content: r.content,
        audioUrl: r.audio_url,
        authorName: authorMap[r.author_id as string] ?? "Coach",
        createdAt: r.created_at,
      })),
    })),
  });
}
