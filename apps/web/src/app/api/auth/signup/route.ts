import { NextResponse } from "next/server";
import { createAdmin } from "@flex/supabase/admin";
import { claimTeamInvite, mapClaimInviteError } from "@/lib/team-invites";

export async function POST(request: Request) {
  const body = await request.json();
  const { email, password, fullName, inviteCode } = body;

  if (!email || !password || !fullName || !inviteCode) {
    return NextResponse.json(
      { error: "Email, password, full name, and invite code are all required" },
      { status: 400 }
    );
  }

  const normalizedInviteCode = String(inviteCode).trim().toUpperCase();
  const admin = createAdmin();

  // Validate invite code before creating account
  const { data: invite } = await admin
    .from("team_invites")
    .select("*")
    .eq("code", normalizedInviteCode)
    .single();

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });
  }

  if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
    return NextResponse.json({ error: "Invite code has been fully used" }, { status: 410 });
  }

  // Create the user via admin API
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: "rep" },
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const userId = authData.user.id;

  try {
    const claim = await claimTeamInvite(admin, userId, normalizedInviteCode);
    return NextResponse.json({
      success: true,
      teamId: claim.team_id,
      billing: {
        activeReps: claim.current_reps,
        includedReps: claim.included_reps,
        overageReps: claim.overage_reps,
        estimatedMonthlyCents: claim.estimated_monthly_cents,
      },
    });
  } catch (err) {
    await admin.auth.admin.deleteUser(userId);
    const mapped = mapClaimInviteError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
