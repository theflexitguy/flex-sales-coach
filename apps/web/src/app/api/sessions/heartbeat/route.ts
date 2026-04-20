import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

/**
 * Called by the mobile app every ~60s while a session is actively
 * recording. Server just stamps last_heartbeat_at — that's enough for
 * ensure-split / cron to tell which sessions have gone dark.
 */
export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const admin = createAdmin();

  // Only accept heartbeats from the session's owner. Quiet 404 if
  // someone else's id got sent by accident — we don't want spurious
  // writes across reps.
  const { data: session } = await admin
    .from("recording_sessions")
    .select("id, rep_id")
    .eq("id", sessionId)
    .single();

  if (!session || session.rep_id !== auth.user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  await admin
    .from("recording_sessions")
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq("id", sessionId);

  return NextResponse.json({ ok: true });
}
