import { NextResponse } from "next/server";
import { createServer } from "@/lib/supabase-server";
import { createAdmin } from "@flex/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { code } = await request.json();
  if (!code) return NextResponse.json({ error: "Invite code required" }, { status: 400 });

  const admin = createAdmin();

  const { data: invite } = await admin
    .from("team_invites")
    .select("*")
    .eq("code", code.toUpperCase())
    .single();

  if (!invite) return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }

  if (invite.uses >= invite.max_uses) {
    return NextResponse.json({ error: "Invite fully used" }, { status: 410 });
  }

  // Assign user to team
  await admin
    .from("profiles")
    .update({ team_id: invite.team_id })
    .eq("id", user.id);

  // Increment uses
  await admin
    .from("team_invites")
    .update({ uses: invite.uses + 1 })
    .eq("id", invite.id);

  return NextResponse.json({ success: true, teamId: invite.team_id });
}
