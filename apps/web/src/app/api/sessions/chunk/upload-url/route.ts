import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

// Issues a short-lived signed upload URL for a chunk. The mobile client
// hands this URL to iOS's URLSessionConfiguration.background so uploads
// continue even while the app is suspended or killed. The signed URL
// has a token baked into the query string, so iOS doesn't need our
// bearer token (which would expire mid-day).
//
// Signed upload URLs are scoped to a specific bucket path and are
// valid for 2 hours (Supabase default). If an upload can't complete
// in that window, the client re-requests a fresh URL and retries.

function log(status: number, reason: string, ctx: Record<string, unknown>): void {
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  console[level](JSON.stringify({
    route: "/api/sessions/chunk/upload-url",
    status,
    reason,
    ...ctx,
  }));
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    log(401, "unauthorized", { hasAuthHeader: !!request.headers.get("authorization") });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const sessionId: string | undefined = body?.sessionId;
  const chunkIndex: number | undefined = body?.chunkIndex;

  if (!sessionId || typeof chunkIndex !== "number") {
    log(400, "missing_fields", { userId: auth.user.id, hasSessionId: !!sessionId, chunkIndex });
    return NextResponse.json(
      { error: "sessionId and chunkIndex required" },
      { status: 400 }
    );
  }

  const admin = createAdmin();

  // Verify session ownership before handing out a signed write URL.
  const { data: session } = await admin
    .from("recording_sessions")
    .select("id, rep_id")
    .eq("id", sessionId)
    .single();

  if (!session || session.rep_id !== auth.user.id) {
    log(404, "session_not_found_or_not_owned", {
      userId: auth.user.id,
      sessionId,
      sessionExists: !!session,
    });
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const storagePath = `${sessionId}/${chunkIndex}.m4a`;
  const { data, error } = await admin.storage
    .from("recording-chunks")
    .createSignedUploadUrl(storagePath, { upsert: true });

  if (error || !data) {
    log(500, "signed_url_failed", {
      userId: auth.user.id,
      sessionId,
      chunkIndex,
      supabaseError: error?.message,
    });
    return NextResponse.json(
      { error: `Failed to create signed URL: ${error?.message}` },
      { status: 500 }
    );
  }

  log(200, "ok", { userId: auth.user.id, sessionId, chunkIndex, storagePath });
  return NextResponse.json({
    signedUrl: data.signedUrl,
    token: data.token,
    storagePath,
  });
}
