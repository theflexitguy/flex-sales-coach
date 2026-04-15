import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";
import { randomUUID } from "crypto";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: callId } = await params;
  const admin = createAdmin();
  const formData = await request.formData();

  const content = (formData.get("content") as string) ?? "";
  const timestampMs = formData.get("timestampMs")
    ? parseInt(formData.get("timestampMs") as string, 10)
    : null;
  const audioFile = formData.get("audio") as File | null;

  if (!content.trim() && !audioFile) {
    return NextResponse.json({ error: "Content or audio required" }, { status: 400 });
  }

  let audioUrl: string | null = null;
  let audioDurationSeconds: number | null = null;

  if (audioFile) {
    const storagePath = `${auth.user.id}/${randomUUID()}.webm`;
    const buffer = Buffer.from(await audioFile.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from("audio-notes")
      .upload(storagePath, buffer, {
        contentType: audioFile.type || "audio/webm",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    // Get signed URL for playback
    const { data: signedData } = await admin.storage
      .from("audio-notes")
      .createSignedUrl(storagePath, 365 * 24 * 3600); // 1 year

    audioUrl = signedData?.signedUrl ?? null;
    audioDurationSeconds = formData.get("audioDuration")
      ? parseInt(formData.get("audioDuration") as string, 10)
      : null;
  }

  const { error } = await admin.from("coaching_notes").insert({
    call_id: callId,
    author_id: auth.user.id,
    content: content.trim() || (audioFile ? "Audio note" : ""),
    timestamp_ms: timestampMs,
    audio_url: audioUrl,
    audio_duration_seconds: audioDurationSeconds,
  });

  if (error) {
    return NextResponse.json({ error: "Failed to save note" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
