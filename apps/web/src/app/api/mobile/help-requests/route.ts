import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const admin = createAdmin();

  let query = admin
    .from("help_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  // Reps see own, managers see team
  const isManager = auth.profile?.role === "manager";
  if (isManager) {
    query = query.eq("team_id", auth.profile?.team_id);
  } else {
    query = query.eq("rep_id", auth.user.id);
  }

  if (status) query = query.eq("status", status);

  const { data: requests } = await query;

  // Enrich with names
  const userIds = [...new Set((requests ?? []).flatMap((r: Record<string, unknown>) => [r.rep_id, r.manager_id]))];
  const nameMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", userIds);
    for (const p of profiles ?? []) nameMap[p.id] = p.full_name;
  }

  const callIds = [...new Set((requests ?? []).map((r: Record<string, unknown>) => r.call_id))];
  const callMap: Record<string, string> = {};
  if (callIds.length > 0) {
    const { data: calls } = await admin.from("calls").select("id, customer_name").in("id", callIds);
    for (const c of calls ?? []) callMap[c.id] = c.customer_name ?? "Unknown";
  }

  return NextResponse.json({
    requests: (requests ?? []).map((r: Record<string, unknown>) => ({
      id: r.id,
      callId: r.call_id,
      repName: nameMap[r.rep_id as string] ?? "Unknown",
      managerName: nameMap[r.manager_id as string] ?? "Unknown",
      callName: callMap[r.call_id as string] ?? "Unknown",
      status: r.status,
      transcriptExcerpt: r.transcript_excerpt,
      startMs: r.start_ms,
      endMs: r.end_ms,
      message: r.message,
      createdAt: r.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { callId, startMs, endMs, transcriptExcerpt, message } = body;

  if (!callId || startMs == null || endMs == null || !transcriptExcerpt) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const admin = createAdmin();

  // Get team manager
  const { data: profile } = await admin.from("profiles").select("team_id").eq("id", auth.user.id).single();
  if (!profile?.team_id) return NextResponse.json({ error: "Not on a team" }, { status: 400 });

  const { data: team } = await admin.from("teams").select("manager_id").eq("id", profile.team_id).single();
  if (!team?.manager_id) return NextResponse.json({ error: "No manager found" }, { status: 400 });

  const { data: req, error } = await admin.from("help_requests").insert({
    call_id: callId,
    rep_id: auth.user.id,
    manager_id: team.manager_id,
    team_id: profile.team_id,
    transcript_excerpt: transcriptExcerpt,
    start_ms: startMs,
    end_ms: endMs,
    message: message ?? null,
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: req?.id });
}
