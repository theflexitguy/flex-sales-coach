import { NextResponse } from "next/server";
import { createAdmin } from "@flex/supabase/admin";

export async function POST(request: Request) {
  const body = await request.json();
  const { email, password, fullName, inviteCode } = body;

  if (!email || !password || !fullName || !inviteCode) {
    return NextResponse.json(
      { error: "Email, password, full name, and invite code are all required" },
      { status: 400 }
    );
  }

  const admin = createAdmin();

  // Validate invite code before creating account
  const { data: invite } = await admin
    .from("team_invites")
    .select("*")
    .eq("code", inviteCode.toUpperCase())
    .single();

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "Invite code has expired" }, { status: 410 });
  }

  if (invite.uses >= invite.max_uses) {
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

  // Assign user to the invite's team
  await admin
    .from("profiles")
    .update({ team_id: invite.team_id })
    .eq("id", userId);

  // Increment invite usage
  await admin
    .from("team_invites")
    .update({ uses: invite.uses + 1 })
    .eq("id", invite.id);

  return NextResponse.json({ success: true, teamId: invite.team_id });
}
