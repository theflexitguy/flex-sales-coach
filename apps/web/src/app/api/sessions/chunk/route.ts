import { NextResponse } from "next/server";
import { after } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";
import { transcribeChunk } from "@/lib/chunk-transcribe";

// The chunk handler itself stays fast (metadata write only). Deepgram
// runs in `after()` so the mobile client returns quickly and the
// transcription cost is absorbed in the same Fluid Compute instance.
export const maxDuration = 300;

function logChunk(
  status: number,
  reason: string,
  ctx: Record<string, unknown>
): void {
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  console[level](
    JSON.stringify({
      route: "/api/sessions/chunk",
      status,
      reason,
      ...ctx,
    })
  );
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    logChunk(401, "unauthorized", {
      hasAuthHeader: !!request.headers.get("authorization"),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let sessionId: string;
  let chunkIndex: number;
  let storagePath: string;
  let durationSeconds: number;
  let latitude: number | null = null;
  let longitude: number | null = null;

  if (contentType.includes("application/json")) {
    // New flow: mobile uploaded directly to Supabase storage, sends metadata only
    const body = await request.json();
    sessionId = body.sessionId;
    chunkIndex = body.chunkIndex;
    storagePath = body.storagePath;
    durationSeconds = body.durationSeconds ?? 0;
    latitude = body.latitude ?? null;
    longitude = body.longitude ?? null;
  } else {
    // Legacy flow: file included in FormData (web or older mobile clients)
    const formData = await request.formData();
    sessionId = formData.get("sessionId") as string;
    chunkIndex = parseInt(formData.get("chunkIndex") as string, 10);
    durationSeconds = parseInt(formData.get("durationSeconds") as string ?? "0", 10);
    latitude = formData.get("latitude") ? parseFloat(formData.get("latitude") as string) : null;
    longitude = formData.get("longitude") ? parseFloat(formData.get("longitude") as string) : null;
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile || audioFile.size === 0) {
      logChunk(400, "audio_missing", {
        userId: auth.user.id,
        sessionId,
        chunkIndex,
        hasFile: !!audioFile,
        size: audioFile?.size ?? 0,
      });
      return NextResponse.json({ error: "Audio file missing or empty" }, { status: 400 });
    }

    // Upload to storage from server
    const admin = createAdmin();
    storagePath = `${sessionId}/${chunkIndex}.m4a`;
    const { error: uploadError } = await admin.storage
      .from("recording-chunks")
      .upload(storagePath, audioFile, {
        contentType: audioFile.type || "audio/mp4",
        upsert: true,
      });

    if (uploadError) {
      logChunk(500, "server_upload_failed", {
        userId: auth.user.id,
        sessionId,
        chunkIndex,
        storagePath,
        supabaseError: uploadError.message,
      });
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }
  }

  if (!sessionId || isNaN(chunkIndex)) {
    logChunk(400, "missing_fields", {
      userId: auth.user.id,
      hasSessionId: !!sessionId,
      chunkIndex,
    });
    return NextResponse.json({ error: "Missing sessionId or chunkIndex" }, { status: 400 });
  }

  const admin = createAdmin();

  // Verify session belongs to this user
  const { data: session } = await admin
    .from("recording_sessions")
    .select("id, rep_id")
    .eq("id", sessionId)
    .single();

  if (!session || session.rep_id !== auth.user.id) {
    logChunk(404, "session_not_found_or_not_owned", {
      userId: auth.user.id,
      sessionId,
      chunkIndex,
      storagePath,
      sessionExists: !!session,
      sessionRepId: session?.rep_id ?? null,
    });
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
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

  // Transcribe this chunk out-of-band. Phase 4: by the time the session
  // is stopped and split runs, most chunks already have transcripts and
  // split never has to touch Deepgram for the full recording.
  after(async () => {
    try {
      const result = await transcribeChunk(sessionId, chunkIndex, storagePath);
      if (!result.ok) {
        console.warn(
          JSON.stringify({
            route: "/api/sessions/chunk",
            reason: "transcribe_failed",
            sessionId,
            chunkIndex,
            error: result.error,
          })
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error(
        JSON.stringify({
          route: "/api/sessions/chunk",
          reason: "transcribe_exception",
          sessionId,
          chunkIndex,
          error: message,
        })
      );
    }
  });

  logChunk(200, "ok", {
    userId: auth.user.id,
    sessionId,
    chunkIndex,
    storagePath,
    totalChunks,
  });
  return NextResponse.json({ success: true, chunkIndex, totalChunks });
}
