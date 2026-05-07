import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { supabase, user } = auth;
  const { data: folders, error } = await supabase
    .from("call_folders")
    .select("id, name, color, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const folderIds = (folders ?? []).map((f) => f.id);
  const countByFolderId = new Map<string, number>();
  if (folderIds.length > 0) {
    const { data: calls } = await supabase
      .from("calls")
      .select("folder_id")
      .eq("rep_id", user.id)
      .in("folder_id", folderIds);

    for (const call of calls ?? []) {
      if (!call.folder_id) continue;
      countByFolderId.set(call.folder_id, (countByFolderId.get(call.folder_id) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    folders: (folders ?? []).map((folder) => ({
      id: folder.id,
      name: folder.name,
      color: folder.color,
      callCount: countByFolderId.get(folder.id) ?? 0,
      createdAt: folder.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, color } = await request.json();
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
  }
  if (trimmedName.length > 80) {
    return NextResponse.json({ error: "Folder name must be 80 characters or fewer" }, { status: 400 });
  }
  if (!auth.profile?.team_id) {
    return NextResponse.json({ error: "Join a team before creating folders" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("call_folders")
    .insert({
      owner_id: auth.user.id,
      team_id: auth.profile.team_id,
      name: trimmedName,
      color: typeof color === "string" && color.trim() ? color.trim() : "#35b2ff",
    })
    .select("id, name, color, created_at")
    .single();

  if (error) {
    const duplicate = error.code === "23505";
    return NextResponse.json(
      { error: duplicate ? "You already have a folder with that name" : error.message },
      { status: duplicate ? 409 : 500 }
    );
  }

  return NextResponse.json({
    folder: {
      id: data.id,
      name: data.name,
      color: data.color,
      callCount: 0,
      createdAt: data.created_at,
    },
  });
}
