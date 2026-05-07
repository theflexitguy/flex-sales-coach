import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { folderId } = await request.json();
  const nextFolderId = typeof folderId === "string" && folderId.trim() ? folderId.trim() : null;

  const { data: call } = await auth.supabase
    .from("calls")
    .select("id, rep_id, team_id")
    .eq("id", id)
    .single();

  if (!call) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  if (call.rep_id !== auth.user.id) {
    return NextResponse.json({ error: "Only the rep can organize this conversation" }, { status: 403 });
  }

  if (nextFolderId) {
    const { data: folder } = await auth.supabase
      .from("call_folders")
      .select("id, owner_id, team_id")
      .eq("id", nextFolderId)
      .eq("owner_id", auth.user.id)
      .single();

    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    if (folder.team_id !== call.team_id) {
      return NextResponse.json({ error: "Folder must belong to this conversation's team" }, { status: 400 });
    }
  }

  const { error } = await auth.supabase
    .from("calls")
    .update({ folder_id: nextFolderId })
    .eq("id", id)
    .eq("rep_id", auth.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, folderId: nextFolderId });
}
