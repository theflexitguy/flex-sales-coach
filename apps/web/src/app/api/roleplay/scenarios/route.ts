import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();
  const teamId = auth.profile?.team_id;
  if (!teamId) return NextResponse.json({ error: "No team" }, { status: 400 });

  const { data: scenarios } = await admin
    .from("roleplay_scenarios")
    .select("id, persona_id, title, description, scenario_type, difficulty, target_objections, is_active, created_at, roleplay_personas(id, name, voice_id)")
    .eq("team_id", teamId)
    .eq("is_active", true)
    .order("created_at");

  return NextResponse.json({ scenarios: scenarios ?? [] });
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
  const { personaId, title, description, scenarioType, difficulty, targetObjections, contextPrompt } = body;

  if (!personaId || !title || !description) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("roleplay_scenarios")
    .insert({
      team_id: teamId,
      persona_id: personaId,
      title,
      description,
      scenario_type: scenarioType ?? "full_pitch",
      difficulty: difficulty ?? "intermediate",
      target_objections: targetObjections ?? [],
      context_prompt: contextPrompt ?? "",
      created_by: auth.user.id,
    })
    .select("id, title, description, scenario_type, difficulty")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ scenario: data });
}
