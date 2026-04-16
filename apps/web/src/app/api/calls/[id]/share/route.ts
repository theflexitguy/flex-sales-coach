import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";
import { notifyCallShared } from "@/lib/notifications";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userIds } = await request.json() as { userIds: string[] | "everyone" };

  const admin = createAdmin();

  // Get the call for customer name and team context
  const { data: call } = await admin.from("calls").select("customer_name, team_id").eq("id", id).single();
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });

  // Resolve target user IDs
  let targetIds: string[];
  if (userIds === "everyone") {
    // Get all reps on the same team
    const { data: teamMembers } = await admin
      .from("profiles")
      .select("id")
      .eq("team_id", call.team_id)
      .eq("is_active", true)
      .neq("id", auth.user.id); // Don't share with yourself
    targetIds = (teamMembers ?? []).map((m) => m.id);
  } else {
    targetIds = userIds.filter((uid) => uid !== auth.user.id);
  }

  if (targetIds.length === 0) {
    return NextResponse.json({ success: true, shared: 0 });
  }

  // Upsert shares (ignore duplicates via onConflict)
  const shares = targetIds.map((uid) => ({
    call_id: id,
    user_id: uid,
    shared_by: auth.user.id,
  }));

  await admin.from("call_shares").upsert(shares, { onConflict: "call_id,user_id" });

  // Notify each user
  const sharerName = auth.profile?.full_name ?? "Your manager";
  const customerName = call.customer_name ?? "Unknown";
  await Promise.all(
    targetIds.map((uid) => notifyCallShared(uid, sharerName, customerName, id))
  );

  return NextResponse.json({ success: true, shared: targetIds.length });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();

  const { data: shares } = await admin
    .from("call_shares")
    .select("user_id, shared_by, created_at")
    .eq("call_id", id);

  const userIds = [...new Set((shares ?? []).flatMap((s) => [s.user_id, s.shared_by]))];
  const nameMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", userIds);
    for (const p of profiles ?? []) nameMap[p.id] = p.full_name;
  }

  return NextResponse.json({
    shares: (shares ?? []).map((s) => ({
      userId: s.user_id,
      userName: nameMap[s.user_id] ?? "Unknown",
      sharedBy: nameMap[s.shared_by] ?? "Unknown",
      createdAt: s.created_at,
    })),
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await request.json() as { userId: string };

  const admin = createAdmin();
  await admin.from("call_shares").delete().eq("call_id", id).eq("user_id", userId);

  return NextResponse.json({ success: true });
}
