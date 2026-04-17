import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";

/**
 * Recover orphaned recording sessions (app crashed, killed, or never completed).
 * Returns any active sessions for this rep and, if requested, finalizes them so
 * the server-side split/analyze pipeline runs on whatever chunks made it through.
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();
  const { data: active } = await admin
    .from("recording_sessions")
    .select("id, status, started_at, chunk_count, label")
    .eq("rep_id", auth.user.id)
    .in("status", ["recording", "uploading"])
    .order("started_at", { ascending: false });

  return NextResponse.json({ sessions: active ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId, label } = await request.json() as { sessionId: string; label?: string };
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const admin = createAdmin();

  const { data: session } = await admin
    .from("recording_sessions")
    .select("id, rep_id, chunk_count, label")
    .eq("id", sessionId)
    .single();

  if (!session || session.rep_id !== auth.user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // If no chunks made it through, mark as failed and move on — nothing to process
  if ((session.chunk_count ?? 0) === 0) {
    await admin
      .from("recording_sessions")
      .update({
        status: "failed",
        stopped_at: new Date().toISOString(),
        error_message: "App crashed before any audio uploaded",
      })
      .eq("id", sessionId);
    return NextResponse.json({ success: true, recovered: false, reason: "no_audio" });
  }

  // Finalize and trigger split so whatever audio was uploaded gets processed
  await admin
    .from("recording_sessions")
    .update({
      status: "processing",
      label: label ?? session.label ?? "Recovered session",
      stopped_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  // Fire split worker (same pattern as /api/sessions/complete)
  const origin = new URL(request.url).origin;
  const internalSecret = process.env.INTERNAL_API_SECRET || "flex-internal-2024";
  fetch(`${origin}/api/sessions/split`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": internalSecret,
    },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {});

  return NextResponse.json({ success: true, recovered: true });
}
