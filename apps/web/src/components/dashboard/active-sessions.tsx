"use client";

import { useState, useEffect } from "react";

interface SessionData {
  id: string;
  repName: string;
  status: string;
  label: string | null;
  chunkCount: number;
  totalDurationSeconds: number;
  conversationsFound: number | null;
  startedAt: string;
  stoppedAt: string | null;
  errorMessage: string | null;
}

export function ActiveSessions() {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 10000);
    return () => clearInterval(interval);
  }, []);

  async function fetchSessions() {
    try {
      const res = await fetch("/api/sessions/list");
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  if (loading || sessions.length === 0) return null;

  const activeSessions = sessions.filter(
    (s) => s.status === "recording" || s.status === "uploading" || s.status === "processing"
  );
  const recentSessions = sessions.filter(
    (s) => s.status === "completed" || s.status === "failed"
  ).slice(0, 5);

  if (activeSessions.length === 0 && recentSessions.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
      <div className="px-6 py-4 border-b border-zinc-800">
        <h2 className="text-lg font-semibold text-white">Recording Sessions</h2>
      </div>
      <div className="divide-y divide-zinc-800/50">
        {activeSessions.map((s) => (
          <div key={s.id} className="px-6 py-4 flex items-center gap-4">
            <div className="relative">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="absolute inset-0 w-3 h-3 rounded-full bg-red-500 animate-ping" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{s.repName}</span>
                <StatusPill status={s.status} />
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                {s.chunkCount} chunks &middot; {formatDuration(s.totalDurationSeconds)}
                {s.label && <> &middot; &ldquo;{s.label}&rdquo;</>}
              </p>
            </div>
            {s.status === "processing" && s.conversationsFound != null && (
              <span className="text-sm text-sky-400 font-medium">
                {s.conversationsFound} conversations found
              </span>
            )}
          </div>
        ))}

        {recentSessions.map((s) => (
          <div key={s.id} className="px-6 py-3 flex items-center gap-4">
            <div className="w-3 h-3 rounded-full bg-zinc-700" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-300">{s.repName}</span>
                <StatusPill status={s.status} />
                {s.label && (
                  <span className="text-xs text-zinc-500">&ldquo;{s.label}&rdquo;</span>
                )}
              </div>
              <p className="text-xs text-zinc-600 mt-0.5">
                {formatDuration(s.totalDurationSeconds)}
                {s.conversationsFound != null && (
                  <> &middot; {s.conversationsFound} conversations</>
                )}
                {s.errorMessage && (
                  <> &middot; <span className="text-red-400">{s.errorMessage}</span></>
                )}
              </p>
            </div>
            <span className="text-xs text-zinc-600">
              {timeAgo(s.stoppedAt ?? s.startedAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    recording: { bg: "bg-red-500/10", text: "text-red-400", label: "Recording" },
    uploading: { bg: "bg-yellow-500/10", text: "text-yellow-400", label: "Uploading" },
    processing: { bg: "bg-sky-500/10", text: "text-sky-400", label: "Processing" },
    completed: { bg: "bg-green-500/10", text: "text-green-400", label: "Done" },
    failed: { bg: "bg-red-500/10", text: "text-red-400", label: "Failed" },
  };
  const c = config[status] ?? { bg: "bg-zinc-500/10", text: "text-zinc-400", label: status };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
