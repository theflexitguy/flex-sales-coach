import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { supabase } = auth;

  const { data: sessions } = await supabase
    .from("recording_sessions")
    .select("*")
    .eq("rep_id", auth.user.id)
    .order("started_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    sessions: (sessions ?? []).map((s) => ({
      id: s.id,
      status: s.status,
      label: s.label,
      chunkCount: s.chunk_count,
      totalDurationSeconds: s.total_duration_s,
      conversationsFound: s.conversations_found,
      startedAt: s.started_at,
      stoppedAt: s.stopped_at,
      errorMessage: s.error_message,
    })),
  });
}
