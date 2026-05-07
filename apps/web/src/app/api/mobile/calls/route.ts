import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { durationFromTranscriptUtterances } from "@/lib/call-duration";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const filter = url.searchParams.get("filter") ?? "mine"; // "mine" | "team" | "shared"
  const folderId = url.searchParams.get("folderId");

  const { supabase, profile } = auth;
  const isManager = profile?.role === "manager";

  let query = supabase
    .from("calls")
    .select("*", { count: "exact" });

  if (filter === "team" && isManager) {
    // Manager sees all calls from their team (RLS handles the team_id check)
    // Don't filter by rep_id — let RLS show all team calls
  } else if (filter === "shared") {
    // Calls shared with this user (RLS includes call_shares)
    // Filter out own calls to only show shared ones
    query = query.neq("rep_id", auth.user.id);
  } else {
    // Default: own calls only
    query = query.eq("rep_id", auth.user.id);
    if (folderId === "unfiled") {
      query = query.is("folder_id", null);
    } else if (folderId) {
      query = query.eq("folder_id", folderId);
    }
  }

  const { data: calls, count } = await query
    .order("recorded_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Get rep names for team/shared views
  const repIds = [...new Set((calls ?? []).map((c) => c.rep_id))];
  const folderIds = [...new Set((calls ?? []).map((c) => c.folder_id).filter(Boolean))];
  const repNameMap: Record<string, string> = {};
  const folderNameMap: Record<string, string> = {};
  if (repIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", repIds);
    for (const p of profiles ?? []) repNameMap[p.id] = p.full_name;
  }
  if (folderIds.length > 0) {
    const { data: folders } = await supabase.from("call_folders").select("id, name").in("id", folderIds);
    for (const f of folders ?? []) folderNameMap[f.id] = f.name;
  }

  const durationByCallId = new Map<string, number>();
  const missingDurationCallIds = (calls ?? [])
    .filter((c) => !c.duration_seconds || c.duration_seconds <= 0)
    .map((c) => c.id);
  if (missingDurationCallIds.length > 0) {
    const { data: transcripts } = await supabase
      .from("transcripts")
      .select("call_id, utterances")
      .in("call_id", missingDurationCallIds);

    for (const transcript of transcripts ?? []) {
      const duration = durationFromTranscriptUtterances(transcript.utterances);
      if (duration != null) {
        durationByCallId.set(transcript.call_id, duration);
      }
    }
  }

  // Enrich with analysis scores + rep name
  const enriched = await Promise.all(
    (calls ?? []).map(async (call) => {
      let analysis = null;
      if (call.status === "completed") {
        const { data } = await supabase
          .from("call_analyses")
          .select("overall_score, overall_grade, summary")
          .eq("call_id", call.id)
          .single();
        analysis = data;
      }

      return {
        id: call.id,
        customerName: call.customer_name,
        repName: repNameMap[call.rep_id] ?? null,
        repId: call.rep_id,
        durationSeconds:
          call.duration_seconds && call.duration_seconds > 0
            ? call.duration_seconds
            : durationByCallId.get(call.id) ?? 0,
        status: call.status,
        recordedAt: call.recorded_at,
        sessionId: call.session_id,
        sessionOrder: call.session_order,
        folderId: call.folder_id ?? null,
        folderName: call.folder_id ? folderNameMap[call.folder_id] ?? null : null,
        overallScore: analysis?.overall_score ?? null,
        overallGrade: analysis?.overall_grade ?? null,
        summary: analysis?.summary ?? null,
      };
    })
  );

  return NextResponse.json({
    calls: enriched,
    total: count ?? 0,
    limit,
    offset,
  });
}
