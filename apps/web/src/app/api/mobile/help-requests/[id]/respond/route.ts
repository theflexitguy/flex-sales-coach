import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { content, audioUrl, linkedCallId, linkedStartMs } = await request.json();
  if (!content) return NextResponse.json({ error: "Content required" }, { status: 400 });

  const admin = createAdmin();

  await admin.from("help_request_responses").insert({
    request_id: id,
    author_id: auth.user.id,
    content,
    audio_url: audioUrl ?? null,
    linked_call_id: linkedCallId ?? null,
    linked_start_ms: linkedStartMs ?? null,
  });

  // Auto-update request status to responded
  await admin.from("help_requests").update({ status: "responded" }).eq("id", id).eq("status", "pending");

  return NextResponse.json({ success: true });
}
