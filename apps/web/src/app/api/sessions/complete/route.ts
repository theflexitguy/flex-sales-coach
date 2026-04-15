import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId, label } = await request.json();

  if (!sessionId || !label) {
    return NextResponse.json({ error: "sessionId and label required" }, { status: 400 });
  }

  const admin = createAdmin();

  // Verify session belongs to user
  const { data: session } = await admin
    .from("recording_sessions")
    .select("id, rep_id, status")
    .eq("id", sessionId)
    .single();

  if (!session || session.rep_id !== auth.user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.status !== "recording" && session.status !== "uploading") {
    return NextResponse.json({ error: `Session is ${session.status}, cannot complete` }, { status: 400 });
  }

  // Update session
  await admin
    .from("recording_sessions")
    .update({
      status: "processing",
      label,
      stopped_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  // Fire off the splitting worker
  const origin = new URL(request.url).origin;
  fetch(`${origin}/api/sessions/split`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET || "flex-internal-2024",
    },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {
    // Errors captured in session record
  });

  return NextResponse.json({ success: true, sessionId });
}
