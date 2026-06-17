import type { SupabaseClient } from "@supabase/supabase-js";

type ProfileForRoleplayAccess = {
  id: string;
  team_id: string | null;
  role: string | null;
};

export type RoleplayAccessResult = {
  profile: ProfileForRoleplayAccess | null;
  hasAccess: boolean;
};

export async function getRoleplayAccess(
  admin: SupabaseClient,
  userId: string
): Promise<RoleplayAccessResult> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id, team_id, role")
    .eq("id", userId)
    .single();

  if (!profile?.team_id) {
    return { profile: (profile as ProfileForRoleplayAccess | null) ?? null, hasAccess: false };
  }

  if (profile.role === "manager") {
    return { profile: profile as ProfileForRoleplayAccess, hasAccess: true };
  }

  const { data: access, error } = await admin
    .from("roleplay_beta_access")
    .select("enabled")
    .eq("user_id", userId)
    .eq("team_id", profile.team_id)
    .maybeSingle();

  // If production code is deployed before the migration, fail closed without
  // breaking the rest of the Learn tab.
  if (error) {
    return { profile: profile as ProfileForRoleplayAccess, hasAccess: false };
  }

  return {
    profile: profile as ProfileForRoleplayAccess,
    hasAccess: access?.enabled === true,
  };
}
