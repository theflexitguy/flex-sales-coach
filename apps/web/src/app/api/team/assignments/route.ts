import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";
import { normalizeRoleTrack } from "@/lib/role-tracks";

/** GET: list all reps and managers on the team with current assignments */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.profile?.role !== "manager") {
    return NextResponse.json({ error: "Managers only" }, { status: 403 });
  }

  const admin = createAdmin();
  const teamId = auth.profile.team_id;

  const [{ data: profiles }, { data: assignments }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, email, role, playbook_role")
      .eq("team_id", teamId)
      .eq("is_active", true)
      .order("full_name"),
    admin
      .from("manager_rep_assignments")
      .select("manager_id, rep_id")
      .eq("team_id", teamId),
  ]);

  const managers = (profiles ?? []).filter((p) => p.role === "manager");
  const reps = (profiles ?? []).filter((p) => p.role === "rep");

  // Build a map: repId -> [managerId, ...]
  const repAssignments: Record<string, string[]> = {};
  for (const a of assignments ?? []) {
    if (!repAssignments[a.rep_id]) repAssignments[a.rep_id] = [];
    repAssignments[a.rep_id].push(a.manager_id);
  }

  return NextResponse.json({
    managers: managers.map((m) => ({
      id: m.id,
      fullName: m.full_name,
      email: m.email,
      playbookRole: m.playbook_role,
    })),
    reps: reps.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      email: r.email,
      playbookRole: r.playbook_role,
      managerIds: repAssignments[r.id] ?? [],
    })),
  });
}

/** PUT: assign or unassign a rep to/from a manager */
export async function PUT(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.profile?.role !== "manager") {
    return NextResponse.json({ error: "Managers only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { repId, managerId, action } = body;
  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const admin = createAdmin();
  const teamId = auth.profile.team_id;

  if (action === "set-playbook-role") {
    const { userId, playbookRole } = body;
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

    const { data: profile } = await admin
      .from("profiles")
      .select("id, team_id, role")
      .eq("id", userId)
      .eq("team_id", teamId)
      .single();

    if (!profile) return NextResponse.json({ error: "User not found on this team" }, { status: 404 });

    const nextRoleTrack = normalizeRoleTrack(playbookRole);
    const { error } = await admin
      .from("profiles")
      .update({ playbook_role: nextRoleTrack })
      .eq("id", userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, playbookRole: nextRoleTrack });
  }

  if (action === "set-account-role") {
    const { userId, accountRole } = body;
    if (!userId || !["rep", "manager"].includes(accountRole)) {
      return NextResponse.json({ error: "userId and accountRole (rep|manager) required" }, { status: 400 });
    }
    if (userId === auth.user.id && accountRole === "rep") {
      return NextResponse.json({ error: "You cannot demote your own manager account" }, { status: 400 });
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("id, team_id")
      .eq("id", userId)
      .eq("team_id", teamId)
      .single();

    if (!profile) return NextResponse.json({ error: "User not found on this team" }, { status: 404 });

    const { error } = await admin.from("profiles").update({ role: accountRole }).eq("id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (accountRole === "rep") {
      await admin.from("manager_rep_assignments").delete().eq("manager_id", userId);
    }

    return NextResponse.json({ success: true, accountRole });
  }

  if (!repId || !managerId) {
    return NextResponse.json({ error: "repId and managerId required" }, { status: 400 });
  }

  // Verify both users are on the same team
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, team_id, role")
    .in("id", [repId, managerId])
    .eq("team_id", teamId);

  if ((profiles ?? []).length !== 2) {
    return NextResponse.json({ error: "Both users must be on the same team" }, { status: 400 });
  }

  const rep = profiles?.find((p) => p.id === repId);
  const manager = profiles?.find((p) => p.id === managerId);
  if (rep?.role !== "rep" || manager?.role !== "manager") {
    return NextResponse.json({ error: "Invalid role pairing" }, { status: 400 });
  }

  if (action === "assign") {
    const { error } = await admin.from("manager_rep_assignments").upsert(
      { manager_id: managerId, rep_id: repId, team_id: teamId },
      { onConflict: "manager_id,rep_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (action === "unassign") {
    await admin
      .from("manager_rep_assignments")
      .delete()
      .eq("manager_id", managerId)
      .eq("rep_id", repId);
  } else {
    return NextResponse.json({ error: "action must be 'assign' or 'unassign'" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
