import { NextResponse } from "next/server";
import { createServer } from "@/lib/supabase-server";
import { createAdmin } from "@flex/supabase/admin";
import { claimTeamInvite, mapClaimInviteError } from "@/lib/team-invites";

export async function POST(request: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { code } = await request.json();
  if (!code) return NextResponse.json({ error: "Invite code required" }, { status: 400 });

  const normalizedCode = String(code).trim().toUpperCase();
  const admin = createAdmin();

  const { data: invite } = await admin
    .from("team_invites")
    .select("*")
    .eq("code", normalizedCode)
    .single();

  if (!invite) return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });

  if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
    return NextResponse.json({ error: "Invite fully used" }, { status: 410 });
  }

  try {
    const claim = await claimTeamInvite(admin, user.id, normalizedCode);
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
    const mapped = mapClaimInviteError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
