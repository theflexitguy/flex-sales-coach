import { redirect } from "next/navigation";
import { createServer } from "@/lib/supabase-server";
import type { UserProfile, UserRole } from "@flex/shared";

export async function getUser(): Promise<UserProfile | null> {
  const supabase = await createServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single() as unknown as { data: {
      id: string; email: string; full_name: string; role: string; playbook_role?: string;
      team_id: string | null; avatar_url: string | null;
      is_active: boolean; created_at: string; updated_at: string;
    } | null };

  if (!profile) return null;

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role as UserRole,
    playbookRole: profile.playbook_role,
    teamId: profile.team_id ?? "",
    avatarUrl: profile.avatar_url,
    isActive: profile.is_active,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

export async function requireAuth(): Promise<UserProfile> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireManager(): Promise<UserProfile> {
  const user = await requireAuth();
  if (user.role !== "manager") redirect("/");
  return user;
}
