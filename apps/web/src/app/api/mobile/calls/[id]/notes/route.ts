import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { content, timestampMs, audioUrl, audioDurationSeconds } = await request.json();
  if (!content?.trim() && !audioUrl) return NextResponse.json({ error: "Content or audio required" }, { status: 400 });

  const admin = createAdmin();
  const { error } = await admin.from("coaching_notes").insert({
    call_id: id,
    author_id: auth.user.id,
    content: content?.trim() || (audioUrl ? "Audio note" : ""),
    timestamp_ms: timestampMs ?? null,
    audio_url: audioUrl ?? null,
    audio_duration_seconds: audioDurationSeconds ?? null,
  });

  if (error) return NextResponse.json({ error: "Failed to save note" }, { status: 500 });

  return NextResponse.json({ success: true });
}
