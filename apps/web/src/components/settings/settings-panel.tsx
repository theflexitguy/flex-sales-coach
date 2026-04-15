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

export function SettingsPanel({ user }: { user: UserProfile }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/team/invite").then((r) => r.json()).then((d) => setInvites(d.invites ?? []));
    fetch("/api/search?limit=0").catch(() => {}); // warm up
    // Fetch team members
    fetch("/api/analytics").then((r) => r.json()).then(() => {
      // Members come from a different route — just use profiles directly
    });
  }, []);

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
    </div>
  );
}
