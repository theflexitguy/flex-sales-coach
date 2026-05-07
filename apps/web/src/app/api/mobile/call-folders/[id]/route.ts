import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { name, color } = await request.json();
  const update: Record<string, string> = {};

  if (typeof name === "string") {
    const trimmed = name.trim();
    if (!trimmed) return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
    if (trimmed.length > 80) {
      return NextResponse.json({ error: "Folder name must be 80 characters or fewer" }, { status: 400 });
    }
    update.name = trimmed;
  }
  if (typeof color === "string" && color.trim()) update.color = color.trim();

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No folder updates provided" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("call_folders")
    .update(update)
    .eq("id", id)
    .eq("owner_id", auth.user.id)
    .select("id, name, color, created_at")
    .single();

  if (error) {
    const duplicate = error.code === "23505";
    return NextResponse.json(
      { error: duplicate ? "You already have a folder with that name" : error.message },
      { status: duplicate ? 409 : 500 }
    );
  }
  if (!data) return NextResponse.json({ error: "Folder not found" }, { status: 404 });

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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { error } = await auth.supabase
    .from("call_folders")
    .delete()
    .eq("id", id)
    .eq("owner_id", auth.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
