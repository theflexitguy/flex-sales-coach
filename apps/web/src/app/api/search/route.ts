import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { supabase } = auth;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const repId = url.searchParams.get("repId");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const minScore = url.searchParams.get("minScore");
  const maxScore = url.searchParams.get("maxScore");
  const status = url.searchParams.get("status");
  const tagId = url.searchParams.get("tagId");
  const limit = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  // Search transcripts if query provided
  let matchingCallIds: string[] | null = null;
  if (q && q.length >= 2) {
    const { data: transcripts } = await supabase
      .from("transcripts")
      .select("call_id")
      .ilike("full_text", `%${q}%`)
      .limit(100);
    matchingCallIds = (transcripts ?? []).map((t) => t.call_id);
    if (matchingCallIds.length === 0) {
      return NextResponse.json({ calls: [], total: 0 });
    }
  }

  // Build calls query
  let query = supabase
    .from("calls")
    .select("*", { count: "exact" })
    .order("recorded_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (matchingCallIds) query = query.in("id", matchingCallIds);
  if (repId) query = query.eq("rep_id", repId);
  if (dateFrom) query = query.gte("recorded_at", dateFrom);
  if (dateTo) query = query.lte("recorded_at", dateTo);
  if (status) query = query.eq("status", status);

  const { data: calls, count } = await query;

  // Filter by tag
  let filteredCalls = calls ?? [];
  if (tagId) {
    const { data: taggedCallIds } = await supabase
      .from("call_tags")
      .select("call_id")
      .eq("tag_id", tagId);
    const taggedIds = new Set((taggedCallIds ?? []).map((t) => t.call_id));
    filteredCalls = filteredCalls.filter((c) => taggedIds.has(c.id));
  }

  // Enrich with rep names and scores
  const repIds = [...new Set(filteredCalls.map((c) => c.rep_id))];
  const repMap: Record<string, string> = {};
  if (repIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", repIds);
    for (const p of profiles ?? []) repMap[p.id] = p.full_name;
  }

  const callIds = filteredCalls.map((c) => c.id);
  const scoreMap: Record<string, { score: number; grade: string; summary: string }> = {};
  if (callIds.length > 0) {
    const { data: analyses } = await supabase
      .from("call_analyses")
      .select("call_id, overall_score, overall_grade, summary")
      .in("call_id", callIds);
    for (const a of analyses ?? []) {
      scoreMap[a.call_id] = { score: a.overall_score, grade: a.overall_grade, summary: a.summary };
    }
  }

  // Transcript snippets for search results
  const snippetMap: Record<string, string> = {};
  if (q && matchingCallIds && matchingCallIds.length > 0) {
    const { data: transcripts } = await supabase
      .from("transcripts")
      .select("call_id, full_text")
      .in("call_id", callIds);
    for (const t of transcripts ?? []) {
      const idx = (t.full_text as string).toLowerCase().indexOf(q.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 60);
        const end = Math.min((t.full_text as string).length, idx + q.length + 60);
        snippetMap[t.call_id] = (start > 0 ? "..." : "") +
          (t.full_text as string).slice(start, end) +
          (end < (t.full_text as string).length ? "..." : "");
      }
    }
  }

  // Fetch share info so the list can show who each call is shared with.
  const shareMap: Record<string, { userId: string; userName: string }[]> = {};
  if (callIds.length > 0) {
    const { data: shares } = await supabase
      .from("call_shares")
      .select("call_id, user_id")
      .in("call_id", callIds);
    const shareUserIds = [...new Set((shares ?? []).map((s) => s.user_id))];
    const shareNameMap: Record<string, string> = {};
    if (shareUserIds.length > 0) {
      const { data: shareProfiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", shareUserIds);
      for (const p of shareProfiles ?? []) shareNameMap[p.id] = p.full_name;
    }
    for (const s of shares ?? []) {
      if (!shareMap[s.call_id]) shareMap[s.call_id] = [];
      shareMap[s.call_id].push({ userId: s.user_id, userName: shareNameMap[s.user_id] ?? "Unknown" });
    }
  }

  // Score filtering (post-query since it's a join)
  let results = filteredCalls.map((c) => ({
    id: c.id,
    repId: c.rep_id,
    repName: repMap[c.rep_id] ?? "Unknown",
    customerName: c.customer_name,
    durationSeconds: c.duration_seconds,
    status: c.status,
    recordedAt: c.recorded_at,
    overallScore: scoreMap[c.id]?.score ?? null,
    overallGrade: scoreMap[c.id]?.grade ?? null,
    summary: scoreMap[c.id]?.summary ?? null,
    snippet: snippetMap[c.id] ?? null,
    shares: shareMap[c.id] ?? [],
  }));

  if (minScore) results = results.filter((r) => (r.overallScore ?? 0) >= parseInt(minScore, 10));
  if (maxScore) results = results.filter((r) => (r.overallScore ?? 101) <= parseInt(maxScore, 10));

  return NextResponse.json({ calls: results, total: count ?? results.length });
}
