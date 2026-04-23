import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";
import { notifyCallShared } from "@/lib/notifications";

// Bulk share: share multiple calls with specific users or everyone on the team.
// POST body: { callIds: string[], userIds: string[] | "everyone" }

export async function POST(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { callIds, userIds } = await request.json() as {
    callIds: string[];
    userIds: string[] | "everyone";
  };

  if (!Array.isArray(callIds) || callIds.length === 0) {
    return NextResponse.json({ error: "callIds required" }, { status: 400 });
  }

  const admin = createAdmin();

  // Verify caller owns all the calls (or is the manager of the team).
  const { data: calls } = await admin
    .from("calls")
    .select("id, customer_name, team_id, rep_id")
    .in("id", callIds);

  if (!calls || calls.length !== callIds.length) {
    return NextResponse.json({ error: "One or more calls not found" }, { status: 404 });
  }

  // Enforce authorization: caller must own each call (rep_id) or manage its team.
  const teamIds = [...new Set(calls.map((c) => c.team_id))];
  const { data: managedTeams } = await admin
    .from("teams")
    .select("id")
    .in("id", teamIds)
    .eq("manager_id", auth.user.id);
  const managedTeamIds = new Set((managedTeams ?? []).map((t) => t.id));

  const unauthorized = calls.filter(
    (c) => c.rep_id !== auth.user.id && !managedTeamIds.has(c.team_id)
  );
  if (unauthorized.length > 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // For "everyone", resolve to all active team members across all relevant teams.
  let targetIds: string[];
  if (userIds === "everyone") {
    const teamIds = [...new Set(calls.map((c) => c.team_id))];
    const { data: members } = await admin
      .from("profiles")
      .select("id")
      .in("team_id", teamIds)
      .eq("is_active", true)
      .neq("id", auth.user.id);
    targetIds = (members ?? []).map((m) => m.id);
  } else {
    targetIds = (userIds as string[]).filter((uid) => uid !== auth.user.id);
  }

  if (targetIds.length === 0) {
    return NextResponse.json({ success: true, shared: 0 });
  }

  // Build all share rows across all calls × all target users.
  const shareRows = callIds.flatMap((callId) =>
    targetIds.map((uid) => ({
      call_id: callId,
      user_id: uid,
      shared_by: auth.user.id,
    }))
  );

  await admin
    .from("call_shares")
    .upsert(shareRows, { onConflict: "call_id,user_id" });

  // Send one notification per user (summarise all calls rather than one per call).
  const sharerName = auth.profile?.full_name ?? "Your manager";
  await Promise.all(
    targetIds.map((uid) =>
      notifyCallShared(uid, sharerName, `${callIds.length} conversation${callIds.length > 1 ? "s" : ""}`, callIds[0])
    )
  );

  return NextResponse.json({ success: true, shared: targetIds.length * callIds.length });
}
