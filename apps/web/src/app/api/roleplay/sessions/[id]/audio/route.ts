import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

async function getOwnedSession(admin: ReturnType<typeof createAdmin>, id: string, userId: string) {
  const { data } = await admin
    .from("roleplay_sessions")
    .select("id, rep_id")
    .eq("id", id)
    .maybeSingle();
  return data?.rep_id === userId ? data : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const admin = createAdmin();
  if (!await getOwnedSession(admin, id, auth.user.id)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const storagePath = `${auth.user.id}/roleplay/${id}.m4a`;
  const { data, error } = await admin.storage
    .from("call-recordings")
    .createSignedUploadUrl(storagePath, { upsert: true });
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not prepare roleplay audio upload" }, { status: 500 });
  }
  return NextResponse.json({ signedUrl: data.signedUrl, storagePath });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const admin = createAdmin();
  if (!await getOwnedSession(admin, id, auth.user.id)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const expectedPath = `${auth.user.id}/roleplay/${id}.m4a`;
  const body = await request.json().catch(() => ({})) as { storagePath?: unknown };
  if (body.storagePath !== expectedPath) {
    return NextResponse.json({ error: "Invalid storage path" }, { status: 400 });
  }

  const { data: files, error: listError } = await admin.storage
    .from("call-recordings")
    .list(`${auth.user.id}/roleplay`, { search: `${id}.m4a`, limit: 1 });
  if (listError || !files?.some((file) => file.name === `${id}.m4a`)) {
    return NextResponse.json({ error: "Uploaded roleplay audio was not found" }, { status: 409 });
  }

  const { error } = await admin
    .from("roleplay_sessions")
    .update({ audio_storage_path: expectedPath })
    .eq("id", id)
    .eq("rep_id", auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved: true });
}
