import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";
import { notifyHelpRequestResponse } from "@/lib/notifications";

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

  const { data: inserted } = await admin.from("help_request_responses").insert({
    request_id: id,
    author_id: auth.user.id,
    content,
    audio_url: audioUrl ?? null,
    linked_call_id: linkedCallId ?? null,
    linked_start_ms: linkedStartMs ?? null,
  }).select("id").single();

  // Auto-update request status to responded
  await admin.from("help_requests").update({ status: "responded" }).eq("id", id).eq("status", "pending");

  // Notify the rep that their manager responded
  const { data: helpRequest } = await admin.from("help_requests").select("rep_id").eq("id", id).single();
  if (helpRequest) {
    const managerName = auth.profile?.full_name ?? "Your manager";
    await notifyHelpRequestResponse(helpRequest.rep_id, managerName, id);
  }

  return NextResponse.json({ success: true, id: inserted?.id });
}
