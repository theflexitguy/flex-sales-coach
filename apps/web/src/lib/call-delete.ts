import { createAdmin } from "@flex/supabase/admin";

interface DeleteCallAuth {
  user: { id: string };
  profile: {
    id?: string;
    role?: string | null;
    team_id?: string | null;
  } | null;
  supabase: {
    from: (table: string) => unknown;
  };
}

interface SupabaseLikeQuery<T> {
  select(columns: string): SupabaseLikeQuery<T>;
  eq(column: string, value: string): SupabaseLikeQuery<T>;
  single(): Promise<{ data: T | null; error?: { message?: string } | null }>;
}

interface DeleteableCall {
  id: string;
  rep_id: string;
  team_id: string;
  audio_storage_path: string | null;
}

export async function deleteCallForManager(auth: DeleteCallAuth, callId: string) {
  if (auth.profile?.role !== "manager") {
    return { status: 403, body: { error: "Only managers can delete conversations" } };
  }

  const callQuery = auth.supabase.from("calls") as SupabaseLikeQuery<DeleteableCall>;
  const { data: call } = await callQuery
    .select("id, rep_id, team_id, audio_storage_path")
    .eq("id", callId)
    .single();

  if (!call) {
    return { status: 404, body: { error: "Conversation not found" } };
  }

  if (auth.profile.team_id && call.team_id !== auth.profile.team_id) {
    return { status: 403, body: { error: "Cannot delete a conversation outside your team" } };
  }

  const admin = createAdmin();
  const { error } = await admin.from("calls").delete().eq("id", callId);
  if (error) {
    return { status: 500, body: { error: error.message } };
  }

  if (call.audio_storage_path) {
    await admin.storage.from("call-recordings").remove([call.audio_storage_path]);
  }

  return { status: 200, body: { ok: true } };
}
