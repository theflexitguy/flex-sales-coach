"use client";

import { useState, useEffect } from "react";

interface TeamMember {
  id: string;
  fullName: string;
  role: string;
}

interface Props {
  callIds: string[];
  onClose: () => void;
  onShared: () => void;
}

export function BulkShareDialog({ callIds, onClose, onShared }: Props) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  const [done, setDone] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);

  useEffect(() => {
    fetch("/api/mobile/team-members")
      .then((r) => r.json())
      .then((d) => setMembers(d.members ?? []))
      .finally(() => setLoadingMembers(false));
  }, []);

  function toggleMember(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === members.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(members.map((m) => m.id)));
    }
  }

  async function share(userIds: string[] | "everyone") {
    setSharing(true);
    await fetch("/api/calls/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callIds, userIds }),
    });
    setSharing(false);
    setDone(true);
    setTimeout(() => {
      onShared();
      onClose();
    }, 1200);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold text-white">Share Conversations</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {callIds.length} conversation{callIds.length > 1 ? "s" : ""} selected
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={sharing}
            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {done ? (
          <div className="px-5 py-10 text-center">
            <svg className="w-8 h-8 text-emerald-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium text-emerald-400">Shared successfully</p>
          </div>
        ) : (
          <>
            {/* Share with everyone */}
            <button
              onClick={() => share("everyone")}
              disabled={sharing}
              className="w-full flex items-center gap-3 px-5 py-3 text-sm text-sky-400 hover:bg-sky-500/10 transition-colors disabled:opacity-50 border-b border-zinc-800"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
              Share with Everyone on Team
            </button>

            {/* Individual member list */}
            <div className="px-5 pt-3 pb-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Or select people</span>
                {members.length > 0 && (
                  <button onClick={toggleAll} className="text-xs text-sky-400 hover:text-sky-300 transition-colors">
                    {selected.size === members.length ? "Deselect all" : "Select all"}
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-52 overflow-y-auto px-2 pb-2">
              {loadingMembers ? (
                <p className="text-xs text-zinc-600 text-center py-6">Loading…</p>
              ) : members.length === 0 ? (
                <p className="text-xs text-zinc-600 text-center py-6">No team members found</p>
              ) : (
                members.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => toggleMember(m.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/60 transition-colors text-left"
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      selected.has(m.id) ? "bg-sky-500 border-sky-500" : "border-zinc-600"
                    }`}>
                      {selected.has(m.id) && (
                        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm text-zinc-300 flex-1 truncate">{m.fullName}</span>
                    <span className="text-[10px] text-zinc-600 capitalize shrink-0">{m.role}</span>
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-zinc-800 flex gap-2">
              <button
                onClick={onClose}
                disabled={sharing}
                className="flex-1 rounded-lg border border-zinc-700 py-2 text-sm font-medium text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => share([...selected])}
                disabled={sharing || selected.size === 0}
                className="flex-1 rounded-lg bg-sky-500 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {sharing ? "Sharing…" : selected.size > 0 ? `Share with ${selected.size}` : "Share"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
