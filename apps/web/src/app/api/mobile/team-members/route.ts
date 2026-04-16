import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();

  // Get the user's team
  const teamId = auth.profile?.team_id;
  if (!teamId) return NextResponse.json({ members: [] });

  const { data: members } = await admin
    .from("profiles")
    .select("id, full_name, role, avatar_url")
    .eq("team_id", teamId)
    .eq("is_active", true)
    .neq("id", auth.user.id)
    .order("full_name");

  return NextResponse.json({
    members: (members ?? []).map((m) => ({
      id: m.id,
      fullName: m.full_name,
      role: m.role,
      avatarUrl: m.avatar_url,
    })),
  });
}
