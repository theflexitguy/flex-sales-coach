import type { SupabaseClient } from "@supabase/supabase-js";

interface ObjectionLibraryFilters {
  category?: string;
  grade?: string;
  repId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function queryObjectionLibrary(
  supabase: SupabaseClient,
  filters: ObjectionLibraryFilters
) {
  let query = supabase
    .from("objections")
    .select("*, calls!inner(customer_name, recorded_at, rep_id, audio_storage_path)")
    .order("created_at", { ascending: false });

  if (filters.category) {
    query = query.eq("category", filters.category);
  }
  if (filters.grade) {
    const grades = filters.grade.split(",");
    query = query.in("handling_grade", grades);
  }
  if (filters.repId) {
    query = query.eq("rep_id", filters.repId);
  }
  if (filters.search) {
    query = query.ilike("utterance_text", `%${filters.search}%`);
  }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data: objections } = await query;

  // Get rep names
  const repIds = [...new Set((objections ?? []).map((o: { rep_id: string }) => o.rep_id).filter(Boolean))];
  const repMap: Record<string, string> = {};
  if (repIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", repIds);
    for (const p of profiles ?? []) {
      repMap[p.id] = p.full_name;
    }
  }

  // Get category counts
  const { data: categoryCounts } = await supabase
    .from("objections")
    .select("category");

  const categoryMap: Record<string, number> = {};
  for (const c of categoryCounts ?? []) {
    categoryMap[c.category] = (categoryMap[c.category] ?? 0) + 1;
  }

  // Get best practices: top-graded per category
  const { data: bestPractices } = await supabase
    .from("objections")
    .select("*")
    .in("handling_grade", ["excellent", "good"])
    .order("handling_grade")
    .limit(20);

  return {
    objections: (objections ?? []).map((o: Record<string, unknown>) => ({
      id: o.id,
      callId: o.call_id,
      category: o.category,
      utteranceText: o.utterance_text,
      repResponse: o.rep_response,
      handlingGrade: o.handling_grade,
      suggestion: o.suggestion,
      startMs: o.start_ms,
      repId: o.rep_id,
      repName: repMap[o.rep_id as string] ?? "Unknown",
      customerName: (o.calls as Record<string, unknown>)?.customer_name ?? "Unknown",
      recordedAt: (o.calls as Record<string, unknown>)?.recorded_at,
    })),
    categoryCounts: categoryMap,
    bestPractices: (bestPractices ?? []).map((o: Record<string, unknown>) => ({
      id: o.id,
      callId: o.call_id,
      category: o.category,
      utteranceText: o.utterance_text,
      repResponse: o.rep_response,
      handlingGrade: o.handling_grade,
      suggestion: o.suggestion,
      repId: o.rep_id,
      repName: repMap[o.rep_id as string] ?? "Unknown",
    })),
  };
}

export async function getExamplesForCategory(
  supabase: SupabaseClient,
  category: string,
  excludeObjectionId?: string
) {
  let query = supabase
    .from("objections")
    .select("*")
    .eq("category", category)
    .in("handling_grade", ["excellent", "good"])
    .order("handling_grade")
    .limit(10);

  if (excludeObjectionId) {
    query = query.neq("id", excludeObjectionId);
  }

  const { data } = await query;

  const repIds = [...new Set((data ?? []).map((o: { rep_id: string }) => o.rep_id).filter(Boolean))];
  const repMap: Record<string, string> = {};
  if (repIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", repIds);
    for (const p of profiles ?? []) {
      repMap[p.id] = p.full_name;
    }
  }

  return (data ?? []).map((o: Record<string, unknown>) => ({
    id: o.id,
    callId: o.call_id,
    category: o.category,
    utteranceText: o.utterance_text,
    repResponse: o.rep_response,
    handlingGrade: o.handling_grade,
    suggestion: o.suggestion,
    repId: o.rep_id,
    repName: repMap[o.rep_id as string] ?? "Unknown",
  }));
}
