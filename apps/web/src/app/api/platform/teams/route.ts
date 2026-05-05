import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createAdmin } from "@flex/supabase/admin";
import { requirePlatformAdmin } from "@/lib/platform-admin";

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function generateInviteCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function generateTemporaryPassword(): string {
  return `${randomBytes(18).toString("base64url")}aA1!`;
}

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdmin();
  const { data: teams, error: teamsError } = await admin
    .from("teams")
    .select("id, name, manager_id, created_at")
    .order("created_at", { ascending: false });

  if (teamsError) {
    return NextResponse.json({ error: teamsError.message }, { status: 500 });
  }

  const teamIds = (teams ?? []).map((team) => team.id);
  const managerIds = (teams ?? [])
    .map((team) => team.manager_id)
    .filter((id): id is string => Boolean(id));

  const [{ data: members }, { data: managers }, { data: invites }] = await Promise.all([
    teamIds.length
      ? admin.from("profiles").select("id, team_id").in("team_id", teamIds)
      : Promise.resolve({ data: [] }),
    managerIds.length
      ? admin.from("profiles").select("id, full_name, email").in("id", managerIds)
      : Promise.resolve({ data: [] }),
    teamIds.length
      ? admin
          .from("team_invites")
          .select("id, team_id, code, uses, max_uses, expires_at, created_at")
          .in("team_id", teamIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const managerById = new Map((managers ?? []).map((manager) => [manager.id, manager]));
  const memberCountByTeam = new Map<string, number>();
  for (const member of members ?? []) {
    if (!member.team_id) continue;
    memberCountByTeam.set(member.team_id, (memberCountByTeam.get(member.team_id) ?? 0) + 1);
  }

  const latestInviteByTeam = new Map<string, NonNullable<typeof invites>[number]>();
  for (const invite of invites ?? []) {
    if (!latestInviteByTeam.has(invite.team_id)) {
      latestInviteByTeam.set(invite.team_id, invite);
    }
  }

  return NextResponse.json({
    teams: (teams ?? []).map((team) => {
      const manager = team.manager_id ? managerById.get(team.manager_id) : null;
      return {
        id: team.id,
        name: team.name,
        managerId: team.manager_id,
        managerName: manager?.full_name ?? null,
        managerEmail: manager?.email ?? null,
        memberCount: memberCountByTeam.get(team.id) ?? 0,
        latestInvite: latestInviteByTeam.get(team.id) ?? null,
        createdAt: team.created_at,
      };
    }),
  });
}

export async function POST(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const teamName = normalizeText(body.teamName);
  const managerEmail = normalizeEmail(body.managerEmail);
  const managerFullName = normalizeText(body.managerFullName);

  if (!teamName || !managerEmail || !managerFullName) {
    return NextResponse.json(
      { error: "teamName, managerEmail, and managerFullName are required" },
      { status: 400 }
    );
  }

  const admin = createAdmin();
  const { data: existingProfile, error: profileError } = await admin
    .from("profiles")
    .select("id, email, full_name, role, team_id")
    .eq("email", managerEmail)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (existingProfile?.team_id) {
    return NextResponse.json(
      { error: "That manager email already belongs to a team" },
      { status: 409 }
    );
  }

  let managerId = existingProfile?.id ?? null;
  let temporaryPassword: string | null = null;

  if (!managerId) {
    temporaryPassword = generateTemporaryPassword();
    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email: managerEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: managerFullName,
        role: "manager",
      },
    });

    if (createUserError || !createdUser.user) {
      return NextResponse.json(
        { error: createUserError?.message ?? "Failed to create manager account" },
        { status: 400 }
      );
    }
    managerId = createdUser.user.id;
  }

  const { data: team, error: teamError } = await admin
    .from("teams")
    .insert({
      name: teamName,
      manager_id: managerId,
    })
    .select("id, name, manager_id, created_at")
    .single();

  if (teamError || !team) {
    return NextResponse.json(
      { error: teamError?.message ?? "Failed to create team" },
      { status: 500 }
    );
  }

  const { error: updateProfileError } = await admin
    .from("profiles")
    .upsert(
      {
        id: managerId,
        email: managerEmail,
        full_name: managerFullName,
        role: "manager",
        team_id: team.id,
        is_active: true,
      },
      { onConflict: "id" }
    );

  if (updateProfileError) {
    return NextResponse.json({ error: updateProfileError.message }, { status: 500 });
  }

  let invite = null;
  for (let attempt = 0; attempt < 5 && !invite; attempt += 1) {
    const { data, error } = await admin
      .from("team_invites")
      .insert({
        team_id: team.id,
        code: generateInviteCode(),
        created_by: managerId,
        max_uses: 25,
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      })
      .select("id, code, uses, max_uses, expires_at, created_at")
      .single();

    if (!error && data) invite = data;
    if (error && error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (!invite) {
    return NextResponse.json({ error: "Failed to create unique invite code" }, { status: 500 });
  }

  return NextResponse.json({
    team: {
      id: team.id,
      name: team.name,
      managerId,
      managerName: managerFullName,
      managerEmail,
      memberCount: 1,
      latestInvite: invite,
      createdAt: team.created_at,
    },
    manager: {
      id: managerId,
      email: managerEmail,
      fullName: managerFullName,
      temporaryPassword,
    },
    invite,
  });
}
