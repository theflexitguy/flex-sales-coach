import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

function log(status: number, reason: string, ctx: Record<string, unknown>): void {
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  console[level](JSON.stringify({ route: "/api/sessions/start", status, reason, ...ctx }));
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    log(401, "unauthorized", { hasAuthHeader: !!request.headers.get("authorization") });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profile } = auth;
  if (!profile?.team_id) {
    log(400, "no_team", { userId: auth.user.id });
    return NextResponse.json({ error: "Not assigned to a team" }, { status: 400 });
  }

  const admin = createAdmin();

  // Guard: check for existing active session
  const { data: existingSessions } = await admin
    .from("recording_sessions")
    .select("id, status")
    .eq("rep_id", auth.user.id)
    .in("status", ["recording", "uploading"]);

  if (existingSessions && existingSessions.length > 0) {
    log(200, "resumed", { userId: auth.user.id, sessionId: existingSessions[0].id });
    return NextResponse.json({
      sessionId: existingSessions[0].id,
      resumed: true,
    });
  }

  const body = await request.json();

  const { data: session, error } = await admin
    .from("recording_sessions")
    .insert({
      rep_id: auth.user.id,
      team_id: profile.team_id,
      status: "recording",
      started_at: body.startedAt ?? new Date().toISOString(),
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
    })
    .select("id")
    .single();

  if (error || !session) {
    log(500, "insert_failed", { userId: auth.user.id, supabaseError: error?.message });
    return NextResponse.json(
      { error: `Failed to start session: ${error?.message}` },
      { status: 500 }
    );
  }

  log(200, "created", { userId: auth.user.id, sessionId: session.id });
  return NextResponse.json({ sessionId: session.id, resumed: false });
}
