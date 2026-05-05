"use client";

import { useState, useEffect } from "react";
import type { UserProfile } from "@flex/shared";

interface Invite {
  id: string;
  code: string;
  uses: number;
  max_uses: number | null;
  expires_at: string | null;
  created_at: string;
}

interface AssignmentManager {
  id: string;
  fullName: string;
}

interface AssignmentRep {
  id: string;
  fullName: string;
  email: string;
  managerIds: string[];
}

interface PlatformTeam {
  id: string;
  name: string;
  managerName: string | null;
  managerEmail: string | null;
  memberCount: number;
  repCount: number;
  includedReps: number;
  includedRepPriceCents: number;
  extraRepPriceCents: number;
  overageReps: number;
  estimatedMonthlyCents: number;
  latestInvite: Invite | null;
  createdAt: string;
}

interface CreatedTeamResult {
  team: PlatformTeam;
  manager: {
    email: string;
    fullName: string;
    temporaryPassword: string | null;
  };
  invite: Invite;
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function dollarsToCents(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed * 100));
}

function centsToDollars(value: number): string {
  return (value / 100).toFixed(2);
}

export function SettingsPanel({
  user,
  isPlatformAdmin = false,
}: {
  user: UserProfile;
  isPlatformAdmin?: boolean;
}) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [creating, setCreating] = useState(false);
  const [managers, setManagers] = useState<AssignmentManager[]>([]);
  const [reps, setReps] = useState<AssignmentRep[]>([]);
  const [assignmentLoading, setAssignmentLoading] = useState(true);
  const [savingAssignment, setSavingAssignment] = useState<string | null>(null);
  const [platformTeams, setPlatformTeams] = useState<PlatformTeam[]>([]);
  const [platformLoading, setPlatformLoading] = useState(isPlatformAdmin);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerFullName, setManagerFullName] = useState("");
  const [includedReps, setIncludedReps] = useState("10");
  const [includedRepPrice, setIncludedRepPrice] = useState("0.00");
  const [extraRepPrice, setExtraRepPrice] = useState("0.00");
  const [savingTeamBilling, setSavingTeamBilling] = useState<string | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [createdTeam, setCreatedTeam] = useState<CreatedTeamResult | null>(null);

  useEffect(() => {
    fetch("/api/team/invite").then((r) => r.json()).then((d) => setInvites(d.invites ?? []));
    if (user.role === "manager") {
      fetch("/api/team/assignments")
        .then((r) => r.json())
        .then((d) => {
          setManagers(d.managers ?? []);
          setReps(d.reps ?? []);
        })
        .finally(() => setAssignmentLoading(false));
    }
    if (isPlatformAdmin) {
      fetch("/api/platform/teams")
        .then((r) => r.json())
        .then((d) => setPlatformTeams(d.teams ?? []))
        .finally(() => setPlatformLoading(false));
    }
  }, [user.role, isPlatformAdmin]);

  async function toggleAssignment(repId: string, managerId: string, isCurrentlyAssigned: boolean) {
    setSavingAssignment(repId);
    const res = await fetch("/api/team/assignments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repId,
        managerId,
        action: isCurrentlyAssigned ? "unassign" : "assign",
      }),
    });
    if (res.ok) {
      setReps((prev) =>
        prev.map((r) => {
          if (r.id !== repId) return r;
          const newManagerIds = isCurrentlyAssigned
            ? r.managerIds.filter((id) => id !== managerId)
            : [...r.managerIds, managerId];
          return { ...r, managerIds: newManagerIds };
        })
      );
    }
    setSavingAssignment(null);
  }

  async function createInvite() {
    setCreating(true);
    const res = await fetch("/api/team/invite", { method: "POST" });
    const data = await res.json();
    if (data.invite) setInvites((prev) => [data.invite, ...prev]);
    setCreating(false);
  }

  async function createCustomerTeam() {
    setCreatingTeam(true);
    setPlatformError(null);
    setCreatedTeam(null);
    const res = await fetch("/api/platform/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamName,
        managerEmail,
        managerFullName,
        includedReps: Number(includedReps),
        includedRepPriceCents: dollarsToCents(includedRepPrice),
        extraRepPriceCents: dollarsToCents(extraRepPrice),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPlatformError(data.error ?? "Failed to create team");
      setCreatingTeam(false);
      return;
    }
    setCreatedTeam(data);
    setPlatformTeams((prev) => [data.team, ...prev]);
    setTeamName("");
    setManagerEmail("");
    setManagerFullName("");
    setIncludedReps("10");
    setIncludedRepPrice("0.00");
    setExtraRepPrice("0.00");
    setCreatingTeam(false);
  }

  async function updateTeamBilling(team: PlatformTeam, patch: Partial<PlatformTeam>) {
    setSavingTeamBilling(team.id);
    setPlatformError(null);
    const res = await fetch("/api/platform/teams", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: team.id,
        includedReps: patch.includedReps ?? team.includedReps,
        includedRepPriceCents:
          patch.includedRepPriceCents ?? team.includedRepPriceCents,
        extraRepPriceCents: patch.extraRepPriceCents ?? team.extraRepPriceCents,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPlatformError(data.error ?? "Failed to update team billing");
      setSavingTeamBilling(null);
      return;
    }
    setPlatformTeams((prev) =>
      prev.map((team) =>
        team.id === data.teamId
          ? {
              ...team,
              includedReps: data.includedReps,
              includedRepPriceCents: data.includedRepPriceCents,
              extraRepPriceCents: data.extraRepPriceCents,
              overageReps: data.overageReps,
              estimatedMonthlyCents: data.estimatedMonthlyCents,
            }
          : team
      )
    );
    setSavingTeamBilling(null);
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-zinc-400 mt-1">Team management and configuration</p>
      </div>

      {/* Profile */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Your Profile</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-zinc-500">Name</p>
            <p className="text-sm text-white">{user.fullName}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Email</p>
            <p className="text-sm text-white">{user.email}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Role</p>
            <p className="text-sm text-sky-400 capitalize">{user.role}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Team ID</p>
            <p className="text-sm text-zinc-400 font-mono text-xs">{user.teamId}</p>
          </div>
        </div>
      </div>

      {isPlatformAdmin && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-6 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-white">Platform Teams</h2>
            <p className="text-sm text-zinc-400">
              Create a separate customer tenant with its own manager, reps, invite codes, and isolated team data.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs text-zinc-500">Team name</label>
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="XYZ Pest Control"
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Manager name</label>
              <input
                value={managerFullName}
                onChange={(e) => setManagerFullName(e.target.value)}
                placeholder="Jane Manager"
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Manager email</label>
              <input
                value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)}
                placeholder="manager@example.com"
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Included reps</label>
              <input
                value={includedReps}
                onChange={(e) => setIncludedReps(e.target.value)}
                type="number"
                min={0}
                max={500}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Bundle $/rep</label>
              <input
                value={includedRepPrice}
                onChange={(e) => setIncludedRepPrice(e.target.value)}
                type="number"
                min={0}
                step="0.01"
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Overage $/rep</label>
              <input
                value={extraRepPrice}
                onChange={(e) => setExtraRepPrice(e.target.value)}
                type="number"
                min={0}
                step="0.01"
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <button
            onClick={createCustomerTeam}
            disabled={creatingTeam || !teamName || !managerFullName || !managerEmail || includedReps === ""}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50 transition-colors"
          >
            {creatingTeam ? "Creating..." : "Create Customer Team"}
          </button>

          {platformError && (
            <div className="rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-300">
              {platformError}
            </div>
          )}

          {createdTeam && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-3">
              <p className="text-sm font-medium text-emerald-300">
                Created {createdTeam.team.name}
              </p>
              <p className="mt-1 text-sm text-zinc-300">
                Manager login: <span className="font-mono">{createdTeam.manager.email}</span>
              </p>
              {createdTeam.manager.temporaryPassword && (
                <p className="mt-1 text-sm text-zinc-300">
                  Temporary password:{" "}
                  <span className="font-mono text-emerald-300">
                    {createdTeam.manager.temporaryPassword}
                  </span>
                </p>
              )}
              <p className="mt-1 text-sm text-zinc-300">
                Rep invite code: <span className="font-mono text-sky-300">{createdTeam.invite.code}</span>
              </p>
              <p className="mt-1 text-sm text-zinc-300">
                Plan: {createdTeam.team.includedReps} included reps at{" "}
                {formatMoney(createdTeam.team.includedRepPriceCents)}/rep, then{" "}
                {formatMoney(createdTeam.team.extraRepPriceCents)}/rep overage
              </p>
            </div>
          )}

          <div className="space-y-2">
            {platformLoading ? (
              <p className="text-sm text-zinc-500">Loading teams...</p>
            ) : platformTeams.length === 0 ? (
              <p className="text-sm text-zinc-500">No customer teams yet</p>
            ) : (
              platformTeams.map((team) => (
                <div
                  key={team.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{team.name}</p>
                      <p className="text-xs text-zinc-500">
                        {team.managerName ?? "No manager"} · {team.managerEmail ?? "no email"}
                      </p>
                    </div>
                    <span className="text-xs text-zinc-500">
                      {team.repCount} active reps · {team.memberCount} member{team.memberCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-4">
                    <div>
                      <p className="text-xs text-zinc-500">Included</p>
                      <p className="text-sm text-white">
                        {team.includedReps} reps at {formatMoney(team.includedRepPriceCents)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Overage</p>
                      <p className={team.overageReps > 0 ? "text-sm text-amber-300" : "text-sm text-zinc-300"}>
                        {team.overageReps} reps at {formatMoney(team.extraRepPriceCents)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Est. monthly</p>
                      <p className="text-sm text-emerald-300">
                        {formatMoney(team.estimatedMonthlyCents)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Invite</p>
                      <p className="text-sm text-zinc-300">No expiration</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="text-xs text-zinc-500">Included reps</label>
                    <input
                      defaultValue={team.includedReps}
                      type="number"
                      min={0}
                      max={500}
                      className="w-20 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white outline-none focus:border-sky-500"
                      onBlur={(e) => {
                        const value = Number(e.currentTarget.value);
                        if (Number.isFinite(value) && value !== team.includedReps) {
                          updateTeamBilling(team, { includedReps: value });
                        }
                      }}
                    />
                    <label className="text-xs text-zinc-500">Bundle $/rep</label>
                    <input
                      defaultValue={centsToDollars(team.includedRepPriceCents)}
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-24 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white outline-none focus:border-sky-500"
                      onBlur={(e) => {
                        const value = dollarsToCents(e.currentTarget.value);
                        if (value !== team.includedRepPriceCents) {
                          updateTeamBilling(team, { includedRepPriceCents: value });
                        }
                      }}
                    />
                    <label className="text-xs text-zinc-500">Overage $/rep</label>
                    <input
                      defaultValue={centsToDollars(team.extraRepPriceCents)}
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-24 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white outline-none focus:border-sky-500"
                      onBlur={(e) => {
                        const value = dollarsToCents(e.currentTarget.value);
                        if (value !== team.extraRepPriceCents) {
                          updateTeamBilling(team, { extraRepPriceCents: value });
                        }
                      }}
                    />
                    {savingTeamBilling === team.id && (
                      <span className="text-xs text-zinc-500">Saving...</span>
                    )}
                  </div>
                  {team.latestInvite && (
                    <div className="mt-2 flex items-center justify-between rounded-md bg-zinc-900 px-3 py-2">
                      <span className="text-xs text-zinc-500">Latest invite</span>
                      <span className="font-mono text-sm text-sky-400">{team.latestInvite.code}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Invite Reps */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Invite Reps</h2>
            <p className="text-sm text-zinc-400">Share an invite code so reps can join your team</p>
          </div>
          <button
            onClick={createInvite}
            disabled={creating}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50 transition-colors"
          >
            {creating ? "Creating..." : "Generate Code"}
          </button>
        </div>

        {invites.length > 0 && (
          <div className="space-y-2">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-3"
              >
                <div className="flex items-center gap-4">
                  <span className="font-mono text-lg font-bold text-sky-400 tracking-wider">
                    {inv.code}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {inv.max_uses === null ? `${inv.uses} used` : `${inv.uses}/${inv.max_uses} used`}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-600">No expiration</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(inv.code)}
                    className="text-xs text-zinc-400 hover:text-white transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg bg-zinc-800/50 px-4 py-3">
          <p className="text-sm text-zinc-400">
            <span className="font-medium text-zinc-300">How reps join:</span>{" "}
            Reps sign up at the login page, then enter the invite code on their profile to join your team.
          </p>
        </div>
      </div>

      {/* Rep Assignments */}
      {user.role === "manager" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Rep Assignments</h2>
            <p className="text-sm text-zinc-400">
              Assign reps to managers. Managers only see data from their assigned reps.
              Unassigned reps are visible to all managers.
            </p>
          </div>

          {assignmentLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : reps.length === 0 ? (
            <p className="text-sm text-zinc-500 py-4">No reps on the team yet</p>
          ) : (
            <div className="space-y-3">
              {reps.map((rep) => (
                <div
                  key={rep.id}
                  className="flex items-center gap-4 rounded-lg border border-zinc-800 px-4 py-3"
                >
                  <div className="flex items-center justify-center w-9 h-9 rounded-full bg-zinc-800 text-zinc-300 text-sm font-semibold shrink-0">
                    {rep.fullName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{rep.fullName}</p>
                    <p className="text-xs text-zinc-500 truncate">{rep.email}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {managers.map((mgr) => {
                      const isAssigned = rep.managerIds.includes(mgr.id);
                      return (
                        <button
                          key={mgr.id}
                          onClick={() => toggleAssignment(rep.id, mgr.id, isAssigned)}
                          disabled={savingAssignment === rep.id}
                          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors disabled:opacity-50 ${
                            isAssigned
                              ? "bg-sky-500/20 text-sky-400 border border-sky-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30"
                              : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-sky-500/30 hover:text-sky-400"
                          }`}
                        >
                          {isAssigned ? `✓ ${mgr.fullName}` : mgr.fullName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg bg-zinc-800/50 px-4 py-3">
            <p className="text-sm text-zinc-400">
              <span className="font-medium text-zinc-300">How it works:</span>{" "}
              Click a manager name to assign them to a rep. A rep can have multiple managers.
              Reps with no assignment are visible to everyone.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
