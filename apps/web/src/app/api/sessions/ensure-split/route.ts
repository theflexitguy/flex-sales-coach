import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

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

const HEARTBEAT_STALE_MS = 5 * 60 * 1000; // 5 minutes
const PROCESSING_STALE_MS = 3 * 60 * 1000; // 3 minutes

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

  // Pull this rep's recent in-flight sessions. We deliberately look at
  // the last 7 days so old abandoned sessions don't get picked up forever.
  const weekAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  const { data: sessions } = await admin
    .from("recording_sessions")
    .select("id, status, started_at, stopped_at, last_heartbeat_at, label")
    .eq("rep_id", auth.user.id)
    .in("status", ["recording", "uploading", "processing"])
    .gte("started_at", weekAgo)
    .order("started_at", { ascending: false });

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ recovered: [] });
  }

  const origin = new URL(request.url).origin;
  const internalSecret = process.env.INTERNAL_API_SECRET || "flex-internal-2024";
  const recovered: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const s of sessions) {
    const stoppedAt = s.stopped_at ? new Date(s.stopped_at).getTime() : null;
    const heartbeat = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : null;

    // Case 1: stuck in processing — split didn't finish.
    const processingStuck =
      s.status === "processing" &&
      stoppedAt != null &&
      now - stoppedAt > PROCESSING_STALE_MS;

    // Case 2: still marked recording/uploading but the app has been
    // silent for too long — treat as killed mid-session.
    const heartbeatDead =
      (s.status === "recording" || s.status === "uploading") &&
      heartbeat != null &&
      now - heartbeat > HEARTBEAT_STALE_MS;

    if (!processingStuck && !heartbeatDead) {
      skipped.push({ id: s.id, reason: "in_progress" });
      continue;
    }

    // For heartbeat-dead recording sessions, transition them to processing
    // and set a stopped_at so the split worker can finalize whatever
    // chunks landed.
    if (heartbeatDead) {
      const { count: chunkCount } = await admin
        .from("session_chunks")
        .select("*", { count: "exact", head: true })
        .eq("session_id", s.id);

      if (!chunkCount || chunkCount === 0) {
        // No audio ever arrived — mark failed, don't bother splitting.
        await admin
          .from("recording_sessions")
          .update({
            status: "failed",
            stopped_at: new Date(heartbeat ?? now).toISOString(),
            error_message: "App went silent before any audio uploaded",
          })
          .eq("id", s.id);
        skipped.push({ id: s.id, reason: "no_chunks" });
        continue;
      }

      await admin
        .from("recording_sessions")
        .update({
          status: "processing",
          stopped_at: new Date(heartbeat ?? now).toISOString(),
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
