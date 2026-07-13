import type { SupabaseClient } from "@supabase/supabase-js";

type TranscriptLine = {
  readonly speaker?: unknown;
  readonly text?: unknown;
};

type GroundingOptions = {
  readonly teamId: string;
  readonly playbookRole: string;
  readonly sourceCallIds: readonly string[];
  readonly targetObjections: readonly string[];
};

function cleanLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function formatTranscriptExamples(rows: Array<{ call_id: string; utterances: unknown }>): string[] {
  return rows.slice(0, 3).flatMap((row, index) => {
    if (!Array.isArray(row.utterances)) return [];

    const lines = (row.utterances as TranscriptLine[])
      .map((line) => {
        const speaker = line.speaker === "customer" ? "HOMEOWNER" : line.speaker === "rep" ? "REP" : null;
        const text = cleanLine(line.text);
        return speaker && text ? `${speaker}: ${text}` : null;
      })
      .filter((line): line is string => line != null)
      .slice(0, 24);

    return lines.length ? [`REAL CALL ${index + 1}:\n${lines.join("\n")}`] : [];
  });
}

async function loadTranscriptExamples(
  admin: SupabaseClient,
  callIds: readonly string[]
): Promise<Array<{ call_id: string; utterances: unknown }>> {
  if (callIds.length === 0) return [];

  const { data } = await admin
    .from("transcripts")
    .select("call_id, utterances")
    .in("call_id", [...callIds]);

  const order = new Map(callIds.map((callId, index) => [callId, index]));
  return ((data ?? []) as Array<{ call_id: string; utterances: unknown }>)
    .filter((row) => Array.isArray(row.utterances) && row.utterances.length > 0)
    .sort((a, b) => (order.get(a.call_id) ?? 999) - (order.get(b.call_id) ?? 999));
}

export async function buildRoleplayGrounding(
  admin: SupabaseClient,
  options: GroundingOptions
): Promise<string> {
  const { data: playbook } = await admin
    .from("playbooks")
    .select("name, description, sections, scoring")
    .eq("team_id", options.teamId)
    .eq("target_role", options.playbookRole)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sourceCallIds = [...new Set(options.sourceCallIds.filter(Boolean))].slice(0, 10);
  let transcripts = await loadTranscriptExamples(admin, sourceCallIds);
  let candidateCallIds = [...sourceCallIds];

  if (transcripts.length < 3) {
    const { data: roleProfiles } = await admin
      .from("profiles")
      .select("id")
      .eq("team_id", options.teamId)
      .eq("playbook_role", options.playbookRole)
      .limit(100);

    const roleRepIds = (roleProfiles ?? []).map((profile) => profile.id);
    let recentCallsQuery = admin
      .from("calls")
      .select("id")
      .eq("team_id", options.teamId)
      .eq("status", "completed")
      .order("recorded_at", { ascending: false })
      .limit(10);

    if (roleRepIds.length > 0) {
      recentCallsQuery = recentCallsQuery.in("rep_id", roleRepIds);
    }

    const { data: recentCalls } = await recentCallsQuery;
    candidateCallIds = [
      ...new Set([...candidateCallIds, ...(recentCalls ?? []).map((call) => call.id)]),
    ].slice(0, 20);
    transcripts = await loadTranscriptExamples(admin, candidateCallIds);
  }

  const selectedTranscripts = transcripts.slice(0, 3);
  const groundedCallIds = selectedTranscripts.map((row) => row.call_id);
  let objections: Array<{ category: string; utterance_text: string }> = [];
  if (groundedCallIds.length > 0) {
    let objectionQuery = admin
      .from("objections")
      .select("category, utterance_text")
      .in("call_id", groundedCallIds)
      .limit(12);

    if (options.targetObjections.length > 0) {
      objectionQuery = objectionQuery.in("category", [...options.targetObjections]);
    }
    const { data } = await objectionQuery;
    objections = (data ?? []) as Array<{ category: string; utterance_text: string }>;
  }

  const transcriptExamples = formatTranscriptExamples(selectedTranscripts);
  const objectionExamples = (objections ?? [])
    .map((objection) => {
      const text = cleanLine(objection.utterance_text);
      return text ? `[${objection.category}] HOMEOWNER: ${text}` : null;
    })
    .filter((line): line is string => line != null);

  const blocks: string[] = [];
  if (playbook) {
    blocks.push(`--- REP PLAYBOOK EXPECTATIONS (HIDDEN FROM THE REP) ---
Role: ${options.playbookRole.replace(/_/g, " ")}
Playbook: ${playbook.name}
${cleanLine(playbook.description)}
Sections: ${JSON.stringify(playbook.sections ?? []).slice(0, 2400)}
Scoring: ${JSON.stringify(playbook.scoring ?? {}).slice(0, 1600)}
Use this only to decide whether the rep has earned trust and a next step. Never mention the playbook or coach the rep.`);
  }

  if (transcriptExamples.length || objectionExamples.length) {
    blocks.push(`--- REAL TEAM CALL REFERENCES (HIDDEN FROM THE REP) ---
The excerpts below came from this team's real English-language calls. Match their brevity, cadence, partial answers, interruptions, objection wording, and gradual disclosure. Do not recite them, reuse identifying details, or tell the rep you have examples. Do not copy a real customer's full story. Build a new conversation that feels like the same market.
${transcriptExamples.join("\n\n")}
${objectionExamples.length ? `\nREAL OBJECTION WORDING:\n${objectionExamples.join("\n")}` : ""}`);
  }

  return blocks.join("\n\n").slice(0, 10000);
}
