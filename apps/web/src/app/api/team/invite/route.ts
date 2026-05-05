import { NextResponse } from "next/server";
import { createServer } from "@/lib/supabase-server";
import { randomBytes } from "crypto";

export async function GET() {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("team_id, role").eq("id", user.id).single();
  if (profile?.role !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });

  const { data: invites } = await supabase
    .from("team_invites")
    .select("*")
    .eq("team_id", profile.team_id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ invites: invites ?? [] });
}

export async function POST() {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("team_id, role").eq("id", user.id).single();
  if (profile?.role !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });

  const code = randomBytes(4).toString("hex").toUpperCase();

  const { data: invite, error } = await supabase.from("team_invites").insert({
    team_id: profile.team_id,
    code,
    created_by: user.id,
    max_uses: null,
    expires_at: null,
  }).select("*").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ invite });
}
