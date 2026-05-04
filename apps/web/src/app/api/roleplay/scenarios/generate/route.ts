import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const SCENARIO_GENERATION_PROMPT = `You are an AI that creates training scenarios for door-to-door pest control sales reps.

You will receive:
1. Customer personas (name, description, objection categories)
2. The team's objection library (categories and examples)
3. The rep team's weakest objection categories

For each persona, generate 3-4 training scenarios across these levels:
- beginner = Easy: friendly homeowner, one clear objection, rep can recover from small mistakes.
- intermediate = Medium: realistic skepticism, needs rapport, one or two objections, mild interruptions.
- advanced = Hard: impatient or guarded homeowner, multiple objections, hidden decision maker or timing issue, weak rapport causes shutdown.
- EXTREME: high-pressure doorstep, layered objections, spouse/authority barrier, competitor/current service, price pressure, interruptions, and the rep must pre-overcome concerns before pitching. Store EXTREME scenarios with "difficulty": "advanced" and begin context_prompt with "ROLEPLAY_LEVEL: EXTREME".

Return a JSON array:

[
  {
    "persona_id": "<the persona's UUID>",
    "title": "<short scenario title, e.g. 'Handle price pushback from a skeptical homeowner'>",
    "description": "<1-2 sentence description of the scenario situation>",
    "scenario_type": <"objection_drill"|"full_pitch"|"cold_open"|"callback"|"custom">,
    "difficulty": <"beginner"|"intermediate"|"advanced">,
    "target_objections": [<objection categories this scenario targets>],
    "context_prompt": "<additional context appended to the persona's system prompt for this specific scenario. Include the specific situation: time of day, what the customer is doing when the rep arrives, their mood, any backstory.>"
  }
]

Prioritize scenarios that target the team's weakest objection categories.
Make scenarios realistic for door-to-door pest control. Door-to-door is hard: these should require skill, pre-overcoming objections, building rapport, asking good questions, and reading the homeowner. Do not make the customer a pushover. Even Easy should require a real close; Hard and EXTREME should punish generic scripts.
Return ONLY valid JSON, no markdown or explanation.`;

export async function POST(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.profile?.role !== "manager") {
    return NextResponse.json({ error: "Managers only" }, { status: 403 });
  }

  const admin = createAdmin();
  const teamId = auth.profile.team_id;
  if (!teamId) return NextResponse.json({ error: "No team" }, { status: 400 });

  // Get active personas for this team
  const { data: personas } = await admin
    .from("roleplay_personas")
    .select("id, name, description, objection_categories")
    .eq("team_id", teamId)
    .eq("is_active", true);

  if (!personas || personas.length === 0) {
    return NextResponse.json(
      { error: "Generate personas first" },
      { status: 400 }
    );
  }

  // Get objection library entries
  const { data: libraryEntries } = await admin
    .from("objection_library")
    .select("category, example_utterance, recommended_response")
    .eq("team_id", teamId)
    .limit(30);

  // Find weakest objection categories from recent calls
  const { data: recentObjections } = await admin
    .from("objections")
    .select("category, handling_grade")
    .in(
      "call_id",
      (await admin.from("calls").select("id").eq("team_id", teamId).eq("status", "completed").order("recorded_at", { ascending: false }).limit(20)).data?.map((c) => c.id) ?? []
    );

  const categoryScores: Record<string, { total: number; poor: number }> = {};
  for (const o of recentObjections ?? []) {
    const cat = o.category as string;
    if (!categoryScores[cat]) categoryScores[cat] = { total: 0, poor: 0 };
    categoryScores[cat].total++;
    if (o.handling_grade === "poor" || o.handling_grade === "needs_improvement") {
      categoryScores[cat].poor++;
    }
  }

  const weakestCategories = Object.entries(categoryScores)
    .sort(([, a], [, b]) => (b.poor / b.total) - (a.poor / a.total))
    .slice(0, 3)
    .map(([cat]) => cat);

  const inputText = [
    "=== PERSONAS ===",
    ...personas.map((p) => `ID: ${p.id} | ${p.name}: ${p.description} | Objections: ${(p.objection_categories as string[]).join(", ")}`),
    "\n=== OBJECTION LIBRARY ===",
    ...(libraryEntries ?? []).map((e) => `[${e.category}] "${e.example_utterance}" → "${e.recommended_response}"`),
    `\n=== WEAKEST CATEGORIES ===\n${weakestCategories.join(", ") || "No data yet"}`,
  ].join("\n");

  const { text: responseText } = await generateText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: SCENARIO_GENERATION_PROMPT,
    prompt: inputText,
    maxOutputTokens: 4096,
  });

  const cleanedText = responseText
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  const scenarios = JSON.parse(cleanedText) as Array<{
    persona_id: string;
    title: string;
    description: string;
    scenario_type: string;
    difficulty: string;
    target_objections: string[];
    context_prompt: string;
  }>;

  // Validate persona_ids exist
  const validPersonaIds = new Set(personas.map((p) => p.id));
  const validScenarios = scenarios.filter((s) => validPersonaIds.has(s.persona_id));

  const allowedDifficulties = new Set(["beginner", "intermediate", "advanced"]);

  const rows = validScenarios.map((s) => ({
    team_id: teamId,
    persona_id: s.persona_id,
    title: s.title,
    description: s.description,
    scenario_type: s.scenario_type,
    difficulty: allowedDifficulties.has(s.difficulty) ? s.difficulty : "intermediate",
    target_objections: s.target_objections,
    context_prompt: s.context_prompt,
  }));

  const { data: inserted, error } = await admin
    .from("roleplay_scenarios")
    .insert(rows)
    .select("id, title, description, scenario_type, difficulty");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ scenarios: inserted });
}
