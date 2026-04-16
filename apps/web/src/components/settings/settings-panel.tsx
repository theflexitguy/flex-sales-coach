"use client";

import { useState, useEffect } from "react";
import type { UserProfile } from "@flex/shared";

interface Invite {
  id: string;
  code: string;
  uses: number;
  max_uses: number;
  expires_at: string | null;
  created_at: string;
}

interface TeamMember {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
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

export function SettingsPanel({ user }: { user: UserProfile }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [creating, setCreating] = useState(false);
  const [managers, setManagers] = useState<AssignmentManager[]>([]);
  const [reps, setReps] = useState<AssignmentRep[]>([]);
  const [assignmentLoading, setAssignmentLoading] = useState(true);
  const [savingAssignment, setSavingAssignment] = useState<string | null>(null);

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
  }, [user.role]);

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
                    {inv.uses}/{inv.max_uses} used
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {inv.expires_at && (
                    <span className="text-xs text-zinc-600">
                      Expires {new Date(inv.expires_at).toLocaleDateString()}
                    </span>
                  )}
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
