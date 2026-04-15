import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();

  const { data: req } = await admin.from("help_requests").select("*").eq("id", id).single();
  if (!req) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: responses } = await admin
    .from("help_request_responses")
    .select("*")
    .eq("request_id", id)
    .order("created_at");

  const authorIds = [...new Set([req.rep_id, req.manager_id, ...(responses ?? []).map((r: { author_id: string }) => r.author_id)])];
  const nameMap: Record<string, string> = {};
  if (authorIds.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", authorIds);
    for (const p of profiles ?? []) nameMap[p.id] = p.full_name;
  }

  return NextResponse.json({
    request: {
      id: req.id,
      callId: req.call_id,
      repName: nameMap[req.rep_id] ?? "Unknown",
      status: req.status,
      transcriptExcerpt: req.transcript_excerpt,
      startMs: req.start_ms,
      endMs: req.end_ms,
      message: req.message,
      createdAt: req.created_at,
    },
    responses: (responses ?? []).map((r: Record<string, unknown>) => ({
      id: r.id,
      authorName: nameMap[r.author_id as string] ?? "Unknown",
      content: r.content,
      audioUrl: r.audio_url,
      linkedCallId: r.linked_call_id,
      linkedStartMs: r.linked_start_ms,
      createdAt: r.created_at,
    })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { status } = await request.json();
  const admin = createAdmin();

  await admin.from("help_requests").update({ status }).eq("id", id);

  return NextResponse.json({ success: true });
}
