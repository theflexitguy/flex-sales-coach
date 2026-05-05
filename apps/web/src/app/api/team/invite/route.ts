import { NextResponse } from "next/server";
import { createServer } from "@/lib/supabase-server";
import { createAdmin } from "@flex/supabase/admin";
import { randomBytes } from "crypto";

function generateInviteCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

async function getActiveRepCount(admin: ReturnType<typeof createAdmin>, teamId: string) {
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("role", "rep")
    .eq("is_active", true);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function GET() {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("team_id, role").eq("id", user.id).single();
  if (profile?.role !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  if (!profile.team_id) return NextResponse.json({ invites: [] });

  const { data: invites } = await supabase
    .from("team_invites")
    .select("*")
    .eq("team_id", profile.team_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const admin = createAdmin();
  const activeRepCount = await getActiveRepCount(admin, profile.team_id);

  return NextResponse.json({
    invites: (invites ?? []).map((invite) => ({ ...invite, uses: activeRepCount })),
  });
}

export async function POST() {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("team_id, role").eq("id", user.id).single();
  if (profile?.role !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  if (!profile.team_id) return NextResponse.json({ error: "Manager has no team" }, { status: 400 });

  const admin = createAdmin();
  const activeRepCount = await getActiveRepCount(admin, profile.team_id);
  let invite = null;

  for (let attempt = 0; attempt < 5 && !invite; attempt += 1) {
    const { data, error } = await admin
      .from("team_invites")
      .upsert(
        {
          team_id: profile.team_id,
          code: generateInviteCode(),
          created_by: user.id,
          max_uses: null,
          uses: activeRepCount,
          expires_at: null,
        },
        { onConflict: "team_id" }
      )
      .select("*")
      .single();

    if (!error && data) invite = data;
    if (error && error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (!invite) {
    return NextResponse.json({ error: "Failed to regenerate invite code" }, { status: 500 });
  }

  return NextResponse.json({ invite });
}
