import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();
  const { data: notifications } = await admin
    .from("notifications")
    .select("*")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const { count: unreadCount } = await admin
    .from("notifications")
    .select("id", { count: "exact" })
    .eq("user_id", auth.user.id)
    .eq("read", false);

  return NextResponse.json({
    notifications: (notifications ?? []).map((n: Record<string, unknown>) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data,
      read: n.read,
      createdAt: n.created_at,
    })),
    unreadCount: unreadCount ?? 0,
  });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ids, markAllRead } = await request.json();
  const admin = createAdmin();

  if (markAllRead) {
    await admin
      .from("notifications")
      .update({ read: true })
      .eq("user_id", auth.user.id)
      .eq("read", false);
  } else if (ids?.length > 0) {
    await admin
      .from("notifications")
      .update({ read: true })
      .in("id", ids)
      .eq("user_id", auth.user.id);
  }

  return NextResponse.json({ success: true });
}
