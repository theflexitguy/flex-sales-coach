"use client";

import { useState, useEffect, useRef } from "react";

interface TeamMember {
  id: string;
  fullName: string;
  role: string;
}

export function ShareButton({ callId }: { callId: string }) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  const [done, setDone] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function openPanel() {
    const res = await fetch("/api/mobile/team-members");
    const data = await res.json();
    setMembers(data.members ?? []);
    setSelected(new Set());
    setDone(false);
    setOpen(true);
  }

  async function shareWithSelected() {
    if (selected.size === 0) return;
    setSharing(true);
    await fetch(`/api/calls/${callId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: [...selected] }),
    });
    setSharing(false);
    setDone(true);
    setTimeout(() => setOpen(false), 1200);
  }

  async function shareWithEveryone() {
    setSharing(true);
    await fetch(`/api/calls/${callId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: "everyone" }),
    });
    setSharing(false);
    setDone(true);
    setTimeout(() => setOpen(false), 1200);
  }

  function toggleMember(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={openPanel}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        Share
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-zinc-800 bg-zinc-900 shadow-xl z-50">
          <div className="p-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-white">Share Conversation</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Select who can view this call</p>
          </div>

          {done ? (
            <div className="p-6 text-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-400 mx-auto mb-2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <p className="text-sm text-green-400 font-medium">Shared successfully</p>
            </div>
          ) : (
            <>
              <button
                onClick={shareWithEveryone}
                disabled={sharing}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-sky-400 hover:bg-sky-500/10 transition-colors disabled:opacity-50 border-b border-zinc-800"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                Share with Everyone
              </button>

              <div className="max-h-48 overflow-y-auto">
                {members.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => toggleMember(m.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      selected.has(m.id) ? "bg-sky-500 border-sky-500" : "border-zinc-600"
                    }`}>
                      {selected.has(m.id) && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm text-zinc-300 flex-1">{m.fullName}</span>
                    <span className="text-[10px] text-zinc-600 capitalize">{m.role}</span>
                  </button>
                ))}
                {members.length === 0 && (
                  <p className="text-xs text-zinc-600 text-center py-4">No team members found</p>
                )}
              </div>

              {selected.size > 0 && (
                <div className="p-2 border-t border-zinc-800">
                  <button
                    onClick={shareWithSelected}
                    disabled={sharing}
                    className="w-full rounded-lg bg-sky-500 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50 transition-colors"
                  >
                    {sharing ? "Sharing..." : `Share with ${selected.size} member${selected.size > 1 ? "s" : ""}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
