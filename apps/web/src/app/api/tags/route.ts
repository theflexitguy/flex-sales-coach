import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createServer } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { supabase } = auth;
  const { data: tags } = await supabase.from("tags").select("*").order("name");
  return NextResponse.json({ tags: tags ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createServer();
  const { name, color } = await request.json();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("team_id").eq("id", user.id).single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const { data: tag, error } = await supabase.from("tags").insert({
    name, color: color ?? "#35b2ff", team_id: profile.team_id, created_by: user.id,
  }).select("*").single();

  if (error) {
    console.error("Failed to create tag:", error.message);
    return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
  }
  return NextResponse.json({ tag });
}
