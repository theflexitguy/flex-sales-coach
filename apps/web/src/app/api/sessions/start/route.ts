import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profile } = auth;
  if (!profile?.team_id) {
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
    // Return the existing session instead of creating a new one
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
    return NextResponse.json(
      { error: `Failed to start session: ${error?.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ sessionId: session.id, resumed: false });
}
