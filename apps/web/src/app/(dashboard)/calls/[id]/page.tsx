import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createServer } from "@/lib/supabase-server";
import { createAdmin } from "@flex/supabase/admin";
import type { TranscriptUtterance } from "@flex/shared";
import { CallDetailClient } from "@/components/calls/call-detail-client";
import { CallChat } from "@/components/calls/chat/call-chat";

interface CallDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CallDetailPage({ params }: CallDetailPageProps) {
  const { id } = await params;
  await requireAuth();
  const supabase = await createServer();

  // Fetch call
  const { data: call } = await supabase
    .from("calls")
    .select("*")
    .eq("id", id)
    .single();

  if (!call) notFound();

  // Fetch all related data in parallel
  const [
    { data: repProfile },
    { data: transcript },
    { data: analysis },
    { data: sections },
    { data: objections },
    { data: rawNotes },
    { data: rawHelpRequests },
  ] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", call.rep_id).single(),
    supabase.from("transcripts").select("*").eq("call_id", id).single(),
    supabase.from("call_analyses").select("*").eq("call_id", id).single(),
    supabase.from("call_sections").select("*").eq("call_id", id).order("order_index"),
    supabase.from("objections").select("*").eq("call_id", id),
    supabase.from("coaching_notes").select("*").eq("call_id", id).order("created_at"),
    supabase.from("help_requests").select("*").eq("call_id", id).order("created_at"),
  ]);

  // Fetch help request responses with admin client to avoid nested RLS issues
  const admin = createAdmin();
  const helpRequestIds = (rawHelpRequests ?? []).map((h: { id: string }) => h.id);
  let helpResponses: Array<Record<string, unknown>> = [];
  if (helpRequestIds.length > 0) {
    const { data } = await admin
      .from("help_request_responses")
      .select("*")
      .in("request_id", helpRequestIds)
      .order("created_at");
    helpResponses = data ?? [];
  }
  const responsesByRequest = new Map<string, Array<Record<string, unknown>>>();
  for (const r of helpResponses) {
    const key = r.request_id as string;
    if (!responsesByRequest.has(key)) responsesByRequest.set(key, []);
    responsesByRequest.get(key)!.push(r);
  }

  // Get signed audio URL
  let audioUrl: string | null = null;
  if (call.audio_storage_path) {
    const { data: signedData } = await supabase.storage
      .from("call-recordings")
      .createSignedUrl(call.audio_storage_path, 3600);
    audioUrl = signedData?.signedUrl ?? null;
  }

  // Get note + help-request author names
  const helpRequestAuthorIds = [
    ...(rawHelpRequests ?? []).map((hr: { rep_id: string }) => hr.rep_id),
    ...helpResponses.map((r) => r.author_id as string),
  ];
  const authorIds = [...new Set([
    ...(rawNotes ?? []).map((n: { author_id: string }) => n.author_id),
    ...helpRequestAuthorIds,
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

  // Map data to client props
  const utterances: TranscriptUtterance[] = transcript?.utterances
    ? (transcript.utterances as unknown as TranscriptUtterance[])
    : [];

  return (
    <>
    <CallDetailClient
      call={{
        id: call.id,
        customerName: call.customer_name,
        repName: repProfile?.full_name ?? "Unknown",
        durationSeconds: call.duration_seconds,
        recordedAt: call.recorded_at,
        status: call.status,
        audioUrl,
        outcome: call.outcome ?? null,
      }}
      analysis={
        analysis
          ? {
              overallScore: analysis.overall_score,
              overallGrade: analysis.overall_grade,
              summary: analysis.summary,
              strengths: analysis.strengths as string[],
              improvements: analysis.improvements as string[],
              talkRatioRep: analysis.talk_ratio_rep,
              talkRatioCustomer: analysis.talk_ratio_customer,
            }
          : null
      }
      sections={(sections ?? []).map((s: {
        id: string; section_type: string; start_ms: number; end_ms: number;
        summary: string; grade: string; order_index: number;
      }) => ({
        id: s.id,
        sectionType: s.section_type,
        startMs: s.start_ms,
        endMs: s.end_ms,
        summary: s.summary,
        grade: s.grade,
        orderIndex: s.order_index,
      }))}
      objections={(objections ?? []).map((o: {
        id: string; category: string; utterance_text: string; rep_response: string;
        handling_grade: string; suggestion: string; start_ms: number;
      }) => ({
        id: o.id,
        category: o.category,
        utteranceText: o.utterance_text,
        repResponse: o.rep_response,
        handlingGrade: o.handling_grade,
        suggestion: o.suggestion,
        startMs: o.start_ms,
      }))}
      notes={(rawNotes ?? []).map((n: {
        id: string; content: string; timestamp_ms: number | null;
        created_at: string; author_id: string; audio_url: string | null;
        audio_duration_seconds: number | null;
      }) => ({
        id: n.id,
        content: n.content,
        timestampMs: n.timestamp_ms,
        createdAt: n.created_at,
        authorName: authorMap[n.author_id] ?? "Manager",
        audioUrl: n.audio_url,
        audioDurationSeconds: n.audio_duration_seconds,
      }))}
      utterances={utterances}
      helpRequests={(rawHelpRequests ?? []).map((hr: {
        id: string; rep_id: string; status: string; transcript_excerpt: string;
        start_ms: number; end_ms: number; message: string | null;
        created_at: string; updated_at: string;
      }) => ({
        id: hr.id,
        repName: authorMap[hr.rep_id] ?? "Rep",
        status: hr.status,
        transcriptExcerpt: hr.transcript_excerpt,
        startMs: hr.start_ms,
        endMs: hr.end_ms,
        message: hr.message,
        createdAt: hr.created_at,
        responses: (responsesByRequest.get(hr.id) ?? []).map((r) => ({
          id: r.id as string,
          authorName: authorMap[r.author_id as string] ?? "Manager",
          content: r.content as string,
          audioUrl: r.audio_url as string | null,
          createdAt: r.created_at as string,
        })),
      }))}
    />
    <CallChat callId={id} />
    </>
  );
}
