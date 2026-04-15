import { NextResponse } from "next/server";
import { createServer } from "@/lib/supabase-server";
import { createAdmin } from "@flex/supabase/admin";

export async function GET(request: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role, team_id").eq("id", user.id).single();

  const admin = createAdmin();
  let query = admin.from("coaching_assignments").select("*").order("created_at", { ascending: false });

  if (profile?.role === "manager") {
    query = query.eq("manager_id", user.id);
  } else {
    query = query.eq("rep_id", user.id);
  }

  const { data: assignments } = await query;

  // Enrich
  const userIds = [...new Set((assignments ?? []).flatMap((a: Record<string, unknown>) => [a.rep_id, a.manager_id]))];
  const nameMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", userIds);
    for (const p of profiles ?? []) nameMap[p.id] = p.full_name;
  }

  const callIds = [...new Set((assignments ?? []).map((a: Record<string, unknown>) => a.call_id))];
  const callMap: Record<string, string> = {};
  if (callIds.length > 0) {
    const { data: calls } = await admin.from("calls").select("id, customer_name").in("id", callIds);
    for (const c of calls ?? []) callMap[c.id] = c.customer_name ?? "Unknown";
  }

  return NextResponse.json({
    assignments: (assignments ?? []).map((a: Record<string, unknown>) => ({
      id: a.id,
      callId: a.call_id,
      callName: callMap[a.call_id as string] ?? "Unknown",
      repId: a.rep_id,
      repName: nameMap[a.rep_id as string] ?? "Unknown",
      managerName: nameMap[a.manager_id as string] ?? "Unknown",
      status: a.status,
      instructions: a.instructions,
      dueDate: a.due_date,
      completedAt: a.completed_at,
      repResponse: a.rep_response,
      createdAt: a.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { callId, repId, instructions, dueDate } = await request.json();
  if (!callId || !repId || !instructions) {
    return NextResponse.json({ error: "callId, repId, and instructions required" }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("team_id").eq("id", user.id).single();

  const admin = createAdmin();
  const { data: assignment, error } = await admin.from("coaching_assignments").insert({
    call_id: callId,
    rep_id: repId,
    manager_id: user.id,
    team_id: profile?.team_id,
    instructions,
    due_date: dueDate ?? null,
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify rep
  try {
    const { notifyCoachingNote } = await import("@/lib/notifications");
    const { data: call } = await admin.from("calls").select("customer_name").eq("id", callId).single();
    const { data: managerProfile } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
    await notifyCoachingNote(repId, managerProfile?.full_name ?? "Manager", callId, call?.customer_name ?? "Unknown");
  } catch { /* non-critical */ }

  return NextResponse.json({ id: assignment?.id });
}
