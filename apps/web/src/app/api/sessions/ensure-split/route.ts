import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";
import { getInternalSecret } from "@/lib/api-auth-server";
import { reconcileSessionChunks } from "@/lib/session-chunk-reconcile";

/**
 * Finds this rep's sessions that are stuck and re-runs the split
 * worker on them. Called from the mobile + web Conversations list on
 * focus, so recordings never silently disappear just because the split
 * fire-and-forget died in a previous request.
 *
 * A session is "stuck" when:
 *   - status = 'processing' AND stopped_at is set (split was triggered
 *     but never completed a run)
 *   - OR status in ('recording', 'uploading') AND last_heartbeat is
 *     older than HEARTBEAT_STALE_MS (the app was killed mid-session —
 *     we mark it processing and run split on whatever chunks arrived)
 */

const HEARTBEAT_STALE_MS = 5 * 60 * 1000;   // 5 minutes
const PROCESSING_STALE_MS = 3 * 60 * 1000;  // 3 minutes
// Chunk uploads can lag for hours if the rep is on spotty cell / offline
// and only syncs later. A failed session with no chunks at write-time
// may gain chunks long after. We re-check any failed session in the
// last day so late-arriving audio still gets processed.
const FAILED_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function log(status: number, reason: string, ctx: Record<string, unknown>): void {
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  console[level](JSON.stringify({ route: "/api/sessions/ensure-split", status, reason, ...ctx }));
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdmin();
  const now = Date.now();

  // Pull this rep's recent in-flight sessions, AND recent failed ones —
  // chunks can land hours after a session was prematurely marked failed
  // (spotty cell, rep syncs at the end of the day), and we want those
  // to still make it into Conversations.
  const weekAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  const failedLookback = new Date(now - FAILED_LOOKBACK_MS).toISOString();
  const { data: sessions } = await admin
    .from("recording_sessions")
    .select("id, status, started_at, stopped_at, last_heartbeat_at, label")
    .eq("rep_id", auth.user.id)
    .or(
      `and(status.in.(recording,uploading,processing),started_at.gte.${weekAgo}),` +
      `and(status.eq.failed,started_at.gte.${failedLookback})`
    )
    .order("started_at", { ascending: false });

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ recovered: [] });
  }

  const origin = new URL(request.url).origin;
  const internalSecret = getInternalSecret();
  const recovered: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const s of sessions) {
    const stoppedAt = s.stopped_at ? new Date(s.stopped_at).getTime() : null;
    const heartbeat = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : null;

    try {
      await reconcileSessionChunks(admin, s.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      skipped.push({ id: s.id, reason: `reconcile_error: ${message}` });
      log(500, "reconcile_error", { userId: auth.user.id, sessionId: s.id, message });
      continue;
    }

    // Always check chunk count first — it's the real source of truth
    // about whether there's audio worth processing. A heartbeat-dead
    // session with chunks should be recovered; one without chunks is a
    // wait-and-see, not a hard failure, because pending uploads from
    // the device can arrive hours later over flaky cell.
    const { count: chunkCount } = await admin
      .from("session_chunks")
      .select("*", { count: "exact", head: true })
      .eq("session_id", s.id);

    const hasChunks = (chunkCount ?? 0) > 0;

    // Case 1: stuck in processing — split didn't finish.
    const processingStuck =
      s.status === "processing" &&
      stoppedAt != null &&
      now - stoppedAt > PROCESSING_STALE_MS;

    // Case 2: heartbeat-dead but has audio → mark processing and split.
    const heartbeatDeadWithAudio =
      (s.status === "recording" || s.status === "uploading") &&
      heartbeat != null &&
      now - heartbeat > HEARTBEAT_STALE_MS &&
      hasChunks;

    // Case 3: previously-failed session whose chunks have since arrived.
    // This is the "Peyton recorded on bad cell and chunks uploaded
    // 3 hours later" bug — the session got written off too early.
    const failedButHasAudio = s.status === "failed" && hasChunks;

    if (!processingStuck && !heartbeatDeadWithAudio && !failedButHasAudio) {
      skipped.push({
        id: s.id,
        reason: hasChunks ? "in_progress" : "awaiting_chunks",
      });
      continue;
    }

    // Transition to processing if we're coming from recording/uploading
    // or failed. Preserve the existing label so the rep's naming sticks
    // when they named before the interruption.
    if (heartbeatDeadWithAudio || failedButHasAudio) {
      await admin
        .from("recording_sessions")
        .update({
          status: "processing",
          stopped_at:
            s.stopped_at ?? new Date(heartbeat ?? now).toISOString(),
          error_message: null,
          label: s.label ?? "Recovered session",
        })
        .eq("id", s.id);
    }

    // Fire split. Await so we can tell whether it actually started this
    // round — the previous fire-and-forget pattern is exactly how
    // sessions ended up stuck in the first place.
    try {
      const res = await fetch(`${origin}/api/sessions/split`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": internalSecret,
        },
        body: JSON.stringify({ sessionId: s.id }),
      });
      if (res.ok) {
        recovered.push(s.id);
      } else {
        const text = await res.text().catch(() => "");
        skipped.push({ id: s.id, reason: `split_failed_${res.status}` });
        log(res.status, "split_failed", {
          userId: auth.user.id,
          sessionId: s.id,
          body: text.slice(0, 300),
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      skipped.push({ id: s.id, reason: `split_error: ${message}` });
      log(500, "split_error", { userId: auth.user.id, sessionId: s.id, message });
    }
  }

  log(200, "ok", {
    userId: auth.user.id,
    scanned: sessions.length,
    recoveredCount: recovered.length,
    skippedCount: skipped.length,
  });
  return NextResponse.json({ recovered, skipped });
}
