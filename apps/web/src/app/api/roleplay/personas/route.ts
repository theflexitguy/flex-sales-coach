import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();
  const teamId = auth.profile?.team_id;
  if (!teamId) return NextResponse.json({ error: "No team" }, { status: 400 });

  const { data: personas } = await admin
    .from("roleplay_personas")
    .select("id, name, description, personality, voice_id, objection_categories, is_active, created_at")
    .eq("team_id", teamId)
    .eq("is_active", true)
    .order("created_at");

  return NextResponse.json({ personas: personas ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.profile?.role !== "manager") {
    return NextResponse.json({ error: "Managers only" }, { status: 403 });
  }

  const admin = createAdmin();
  const teamId = auth.profile.team_id;
  if (!teamId) return NextResponse.json({ error: "No team" }, { status: 400 });

  const body = await request.json();
  const { name, description, personality, voiceId, objectionCategories, systemPrompt } = body;

  if (!name || !description || !voiceId || !systemPrompt) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("roleplay_personas")
    .insert({
      team_id: teamId,
      name,
      description,
      personality: personality ?? {},
      voice_id: voiceId,
      objection_categories: objectionCategories ?? [],
      system_prompt: systemPrompt,
    })
    .select("id, name, description")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ persona: data });
}
