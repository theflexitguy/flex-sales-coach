import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { supabase } = auth;

  const { data: sessions } = await supabase
    .from("recording_sessions")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(20);

  // Get rep names
  const repIds = [...new Set((sessions ?? []).map((s: { rep_id: string }) => s.rep_id))];
  const repMap: Record<string, string> = {};
  if (repIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", repIds);
    for (const p of profiles ?? []) {
      repMap[p.id] = p.full_name;
    }
  }

  return NextResponse.json({
    sessions: (sessions ?? []).map((s: Record<string, unknown>) => ({
      id: s.id,
      repId: s.rep_id,
      repName: repMap[s.rep_id as string] ?? "Unknown",
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
