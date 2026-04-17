import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

function log(status: number, reason: string, ctx: Record<string, unknown>): void {
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  console[level](JSON.stringify({ route: "/api/sessions/complete", status, reason, ...ctx }));
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    log(401, "unauthorized", { hasAuthHeader: !!request.headers.get("authorization") });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId, label } = await request.json();

  if (!sessionId || !label) {
    log(400, "missing_fields", { userId: auth.user.id, hasSessionId: !!sessionId, hasLabel: !!label });
    return NextResponse.json({ error: "sessionId and label required" }, { status: 400 });
  }

  const admin = createAdmin();

  const { data: session } = await admin
    .from("recording_sessions")
    .select("id, rep_id, status")
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

  if (session.status !== "recording" && session.status !== "uploading") {
    log(400, "bad_status", { userId: auth.user.id, sessionId, status: session.status });
    return NextResponse.json({ error: `Session is ${session.status}, cannot complete` }, { status: 400 });
  }

  // Refuse to finalize a session with no chunks — that's a guaranteed silent loss.
  const { count: chunkCount } = await admin
    .from("session_chunks")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId);

  if (!chunkCount || chunkCount === 0) {
    log(409, "no_chunks", { userId: auth.user.id, sessionId });
    return NextResponse.json(
      { error: "No audio chunks were uploaded for this session. Check Profile → Diagnostics for upload errors." },
      { status: 409 }
    );
  }

  await admin
    .from("recording_sessions")
    .update({
      status: "processing",
      label,
      stopped_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  const origin = new URL(request.url).origin;
  fetch(`${origin}/api/sessions/split`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET || "flex-internal-2024",
    },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {
    // Split worker failures surface via session.status = 'failed'
  });

  log(200, "ok", { userId: auth.user.id, sessionId, chunkCount });
  return NextResponse.json({ success: true, sessionId, chunkCount });
}
