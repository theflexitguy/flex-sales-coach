import { NextResponse, after } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { getInternalSecret } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";
import { reconcileSessionChunks } from "@/lib/session-chunk-reconcile";

// Split can run up to 300s (Vercel Hobby cap); keep this route alive long
// enough to survive the after() hand-off even if the platform recycles slow.
export const maxDuration = 300;

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

  try {
    const reconcile = await reconcileSessionChunks(admin, sessionId);
    if (reconcile.recovered > 0) {
      log(200, "reconciled_chunks", {
        userId: auth.user.id,
        sessionId,
        recovered: reconcile.recovered,
        totalChunks: reconcile.totalChunks,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    log(500, "reconcile_failed", { userId: auth.user.id, sessionId, message });
    return NextResponse.json({ error: message }, { status: 500 });
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

  // Keep the session in 'uploading' until split actually starts. That way
  // cron's heartbeat-dead-with-audio recovery path can still pick it up if
  // the after() handoff below never runs (instance recycled mid-fetch).
  await admin
    .from("recording_sessions")
    .update({
      status: "uploading",
      label,
      stopped_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  const origin = new URL(request.url).origin;

  // Run split in the same Fluid Compute instance. after() keeps the
  // instance alive until the body finishes, unlike fire-and-forget
  // fetch().catch() which can be killed the moment we return 200.
  after(async () => {
    try {
      await admin
        .from("recording_sessions")
        .update({ status: "processing" })
        .eq("id", sessionId);

      const res = await fetch(`${origin}/api/sessions/split`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": getInternalSecret(),
        },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        log(res.status, "split_failed_in_after", {
          userId: auth.user.id,
          sessionId,
          body: body.slice(0, 300),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      log(500, "split_exception_in_after", {
        userId: auth.user.id,
        sessionId,
        message,
      });
    }
  });

  log(200, "ok", { userId: auth.user.id, sessionId, chunkCount });
  return NextResponse.json({ success: true, sessionId, chunkCount });
}
