import { createAdmin } from "@flex/supabase/admin";

type AdminClient = ReturnType<typeof createAdmin>;

export interface ClaimedTeamInvite {
  readonly team_id: string;
  readonly uses: number;
  readonly max_uses: number | null;
  readonly current_reps: number;
  readonly included_reps: number;
  readonly overage_reps: number;
  readonly estimated_monthly_cents: number;
}

export function mapClaimInviteError(error: unknown): { message: string; status: number } {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");

  if (rawMessage.includes("INVALID_INVITE")) {
    return { message: "Invalid invite code", status: 404 };
  }
  if (rawMessage.includes("INVITE_FULL")) {
    return { message: "Invite code has been fully used", status: 410 };
  }
  if (rawMessage.includes("ONLY_REPS_CAN_JOIN")) {
    return { message: "Only rep accounts can join a team with an invite code", status: 409 };
  }
  if (rawMessage.includes("USER_ALREADY_ON_TEAM")) {
    return { message: "This account already belongs to another team", status: 409 };
  }
  if (rawMessage.includes("TEAM_NOT_FOUND")) {
    return { message: "Invite team was not found", status: 404 };
  }
  if (rawMessage.includes("USER_NOT_FOUND")) {
    return { message: "User profile was not found", status: 404 };
  }

  return { message: rawMessage || "Failed to claim invite code", status: 500 };
}

export async function claimTeamInvite(
  admin: AdminClient,
  userId: string,
  inviteCode: string
): Promise<ClaimedTeamInvite> {
  const { data, error } = await admin.rpc("claim_team_invite", {
    p_user_id: userId,
    p_code: inviteCode,
  });

  if (error) {
    throw new Error(error.message);
  }

  const claim = Array.isArray(data) ? data[0] : data;
  if (!claim?.team_id) {
    throw new Error("Failed to claim invite code");
  }

  return claim as ClaimedTeamInvite;
}
