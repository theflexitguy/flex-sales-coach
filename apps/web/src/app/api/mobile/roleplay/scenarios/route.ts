import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();

  // Get rep's team and role
  const { data: profile } = await admin
    .from("profiles")
    .select("team_id, role")
    .eq("id", auth.user.id)
    .single();

  if (!profile?.team_id) {
    return NextResponse.json({ error: "Not on a team" }, { status: 400 });
  }

  // Roleplay is in beta — managers only
  if (profile.role !== "manager") {
    return NextResponse.json({ scenarios: [], weakCategories: [], sessionsToday: 0 });
  }

  // Get scenarios with persona data
  const { data: scenarios } = await admin
    .from("roleplay_scenarios")
    .select("id, persona_id, title, description, scenario_type, difficulty, target_objections, roleplay_personas(id, name, description, voice_id, personality)")
    .eq("team_id", profile.team_id)
    .eq("is_active", true)
    .order("difficulty")
    .order("created_at");

  // Find rep's weakest objection categories for recommendations
  const { data: recentSessions } = await admin
    .from("roleplay_sessions")
    .select("id")
    .eq("rep_id", auth.user.id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: recentObjections } = await admin
    .from("objections")
    .select("category, handling_grade")
    .in(
      "call_id",
      (await admin.from("calls").select("id").eq("rep_id", auth.user.id).eq("status", "completed").order("recorded_at", { ascending: false }).limit(10)).data?.map((c) => c.id) ?? []
    );

  // Calculate weak categories
  const categoryScores: Record<string, { total: number; weak: number }> = {};
  for (const o of recentObjections ?? []) {
    const cat = o.category as string;
    if (!categoryScores[cat]) categoryScores[cat] = { total: 0, weak: 0 };
    categoryScores[cat].total++;
    if (o.handling_grade === "poor" || o.handling_grade === "needs_improvement") {
      categoryScores[cat].weak++;
    }
  }

  const weakCategories = Object.entries(categoryScores)
    .filter(([, s]) => s.total >= 2 && s.weak / s.total > 0.4)
    .sort(([, a], [, b]) => (b.weak / b.total) - (a.weak / a.total))
    .map(([cat]) => cat);

  // Mark recommended scenarios
  const enriched = (scenarios ?? []).map((s) => {
    const targets = s.target_objections as string[];
    const isRecommended = targets.some((t) => weakCategories.includes(t));
    return {
      id: s.id,
      personaId: s.persona_id,
      title: s.title,
      description: s.description,
      scenarioType: s.scenario_type,
      difficulty: s.difficulty,
      targetObjections: s.target_objections,
      persona: s.roleplay_personas,
      recommended: isRecommended,
    };
  });

  // Sort: recommended first, then by difficulty
  enriched.sort((a, b) => {
    if (a.recommended && !b.recommended) return -1;
    if (!a.recommended && b.recommended) return 1;
    return 0;
  });

  return NextResponse.json({
    scenarios: enriched,
    weakCategories,
    sessionsToday: recentSessions?.length ?? 0,
  });
}
