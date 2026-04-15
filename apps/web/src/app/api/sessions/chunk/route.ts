import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const sessionId = formData.get("sessionId") as string;
  const chunkIndex = parseInt(formData.get("chunkIndex") as string, 10);
  const durationSeconds = parseInt(formData.get("durationSeconds") as string ?? "0", 10);
  const latitude = formData.get("latitude") ? parseFloat(formData.get("latitude") as string) : null;
  const longitude = formData.get("longitude") ? parseFloat(formData.get("longitude") as string) : null;
  const audioFile = formData.get("audio") as File | null;

  if (!sessionId || isNaN(chunkIndex) || !audioFile) {
    return NextResponse.json({ error: "Missing sessionId, chunkIndex, or audio" }, { status: 400 });
  }

  const admin = createAdmin();

  // Verify session belongs to this user
  const { data: session } = await admin
    .from("recording_sessions")
    .select("id, rep_id")
    .eq("id", sessionId)
    .single();

  if (!session || session.rep_id !== auth.user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Upload chunk to storage
  const storagePath = `${sessionId}/${chunkIndex}.m4a`;
  const { error: uploadError } = await admin.storage
    .from("recording-chunks")
    .upload(storagePath, audioFile, {
      contentType: audioFile.type || "audio/mp4",
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 500 }
    );
  }

  // Create chunk record
  await admin.from("session_chunks").upsert(
    {
      session_id: sessionId,
      chunk_index: chunkIndex,
      storage_path: storagePath,
      duration_seconds: durationSeconds,
      latitude,
      longitude,
    },
    { onConflict: "session_id,chunk_index" }
  );

  // Update session counters
  const { data: chunks } = await admin
    .from("session_chunks")
    .select("duration_seconds")
    .eq("session_id", sessionId);

  const totalChunks = chunks?.length ?? 0;
  const totalDuration = (chunks ?? []).reduce((sum, c) => sum + (c.duration_seconds ?? 0), 0);

  await admin
    .from("recording_sessions")
    .update({
      chunk_count: totalChunks,
      total_duration_s: totalDuration,
    })
    .eq("id", sessionId);

  return NextResponse.json({ success: true, chunkIndex, totalChunks });
}
