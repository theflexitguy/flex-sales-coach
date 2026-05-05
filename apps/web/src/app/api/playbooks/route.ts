import { NextResponse } from "next/server";
import { createServer } from "@/lib/supabase-server";
import { normalizeRoleTrack } from "@/lib/role-tracks";

export async function GET() {
  const supabase = await createServer();
  const { data: playbooks } = await supabase
    .from("playbooks")
    .select("*")
    .order("created_at", { ascending: false });

  return NextResponse.json({ playbooks: playbooks ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("team_id, role").eq("id", user.id).single();
  if (profile?.role !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });

  const { name, description, sections, scoring, targetRole } = await request.json();

  const { data: playbook, error } = await supabase.from("playbooks").insert({
    team_id: profile.team_id,
    name,
    description: description ?? null,
    target_role: normalizeRoleTrack(targetRole),
    sections: sections ?? [],
    scoring: scoring ?? {},
    created_by: user.id,
  }).select("*").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ playbook });
}
