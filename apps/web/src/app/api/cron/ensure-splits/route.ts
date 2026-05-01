import { NextResponse } from "next/server";
import { createAdmin } from "@flex/supabase/admin";
import { getInternalSecret } from "@/lib/api-auth-server";
import { reconcileSessionChunks } from "@/lib/session-chunk-reconcile";

// Cron sweep — runs every 5 min via vercel.json and recovers stuck
// sessions across ALL reps. This is the platform-level safety net:
// even if a rep never reopens the app, their recording still gets
// processed.
//
// Auth: Vercel cron sends Authorization: Bearer <CRON_SECRET>. Also
// accept the internal secret so we can invoke manually from the web
// dashboard's admin tools.

export const maxDuration = 60;

const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
// Must exceed split maxDuration (300s) + headroom; otherwise cron retriggers
// a still-running split and produces duplicate calls.
const PROCESSING_STALE_MS = 6 * 60 * 1000;
const FAILED_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SCAN_LOOKBACK_MS = 7 * 24 * 3600 * 1000;

function log(status: number, reason: string, ctx: Record<string, unknown>): void {
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  console[level](JSON.stringify({ route: "/api/cron/ensure-splits", status, reason, ...ctx }));
}

function isAuthorized(request: Request): boolean {
  const authHeader = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  const internalSecret = request.headers.get("x-internal-secret");
  const expected = process.env.INTERNAL_API_SECRET;
  if (expected && expected.length >= 16 && internalSecret === expected) return true;

  return false;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    log(401, "unauthorized", {});
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdmin();
  const now = Date.now();
  const lookback = new Date(now - SCAN_LOOKBACK_MS).toISOString();
  const failedLookback = new Date(now - FAILED_LOOKBACK_MS).toISOString();

  const { data: sessions } = await admin
    .from("recording_sessions")
    .select("id, rep_id, status, started_at, stopped_at, last_heartbeat_at, label")
    .or(
      `and(status.in.(recording,uploading,processing),started_at.gte.${lookback}),` +
      `and(status.eq.failed,started_at.gte.${failedLookback})`
    )
    .order("started_at", { ascending: false })
    .limit(500);

  if (!sessions || sessions.length === 0) {
    log(200, "nothing_to_do", {});
    return NextResponse.json({ recovered: [], skipped: [] });
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
      log(500, "reconcile_error", { sessionId: s.id, repId: s.rep_id, message });
      continue;
    }

    const { count: chunkCount } = await admin
      .from("session_chunks")
      .select("*", { count: "exact", head: true })
      .eq("session_id", s.id);

    const hasChunks = (chunkCount ?? 0) > 0;

    const processingStuck =
      s.status === "processing" &&
      stoppedAt != null &&
      now - stoppedAt > PROCESSING_STALE_MS;

    const heartbeatDeadWithAudio =
      (s.status === "recording" || s.status === "uploading") &&
      heartbeat != null &&
      now - heartbeat > HEARTBEAT_STALE_MS &&
      hasChunks;

    const failedButHasAudio = s.status === "failed" && hasChunks;

    if (!processingStuck && !heartbeatDeadWithAudio && !failedButHasAudio) {
      skipped.push({
        id: s.id,
        reason: hasChunks ? "in_progress" : "awaiting_chunks",
      });
      continue;
    }

    if (heartbeatDeadWithAudio || failedButHasAudio) {
      await admin
        .from("recording_sessions")
        .update({
          status: "processing",
          stopped_at: s.stopped_at ?? new Date(heartbeat ?? now).toISOString(),
          error_message: null,
          label: s.label ?? "Recovered session",
        })
        .eq("id", s.id);
    }

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
          sessionId: s.id,
          repId: s.rep_id,
          body: text.slice(0, 300),
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      skipped.push({ id: s.id, reason: `split_error: ${message}` });
      log(500, "split_error", { sessionId: s.id, repId: s.rep_id, message });
    }
  }

  log(200, "ok", {
    scanned: sessions.length,
    recoveredCount: recovered.length,
    skippedCount: skipped.length,
  });
  return NextResponse.json({ recovered, skipped });
}
