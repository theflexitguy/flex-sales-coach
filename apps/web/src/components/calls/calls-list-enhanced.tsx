"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { GRADE_COLORS, GRADE_LABELS } from "@flex/shared";

interface CallResult {
  id: string;
  repName: string;
  customerName: string | null;
  durationSeconds: number;
  status: string;
  recordedAt: string;
  overallScore: number | null;
  overallGrade: string | null;
  summary: string | null;
  snippet: string | null;
}

interface Rep { id: string; name: string }

export function CallsListEnhanced({ reps, isManager }: { reps: Rep[]; isManager: boolean }) {
  const [calls, setCalls] = useState<CallResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [scoreRange, setScoreRange] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (repFilter) params.set("repId", repFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (statusFilter) params.set("status", statusFilter);
    if (scoreRange === "high") { params.set("minScore", "80"); }
    else if (scoreRange === "mid") { params.set("minScore", "60"); params.set("maxScore", "79"); }
    else if (scoreRange === "low") { params.set("maxScore", "59"); }

    const res = await fetch(`/api/search?${params}`);
    const data = await res.json();
    setCalls(data.calls ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, [search, repFilter, dateFrom, dateTo, scoreRange, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchCalls, 300);
    return () => clearTimeout(timer);
  }, [fetchCalls]);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transcripts..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap gap-2">
        {isManager && (
          <select
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 focus:border-sky-500 focus:outline-none"
          >
            <option value="">All Reps</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 focus:border-sky-500 focus:outline-none"
          placeholder="From"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 focus:border-sky-500 focus:outline-none"
          placeholder="To"
        />
        <select
          value={scoreRange}
          onChange={(e) => setScoreRange(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 focus:border-sky-500 focus:outline-none"
        >
          <option value="">All Scores</option>
          <option value="high">80+ (Excellent/Good)</option>
          <option value="mid">60-79 (Acceptable)</option>
          <option value="low">Below 60</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 focus:border-sky-500 focus:outline-none"
        >
          <option value="">All Status</option>
          <option value="completed">Analyzed</option>
          <option value="transcribing">Processing</option>
          <option value="failed">Failed</option>
        </select>
        {(search || repFilter || dateFrom || dateTo || scoreRange || statusFilter) && (
          <button
            onClick={() => { setSearch(""); setRepFilter(""); setDateFrom(""); setDateTo(""); setScoreRange(""); setStatusFilter(""); }}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results count */}
      <p className="text-xs text-zinc-500">
        {loading ? "Searching..." : `${total} conversation${total !== 1 ? "s" : ""} found`}
        {search && !loading && <span> matching &ldquo;{search}&rdquo;</span>}
      </p>

      {/* Results */}
      {!loading && calls.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-16 text-center">
          <p className="text-zinc-400">{search ? "No conversations match your search" : "No conversations yet"}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="divide-y divide-zinc-800/50">
            {calls.map((call) => (
              <Link
                key={call.id}
                href={`/calls/${call.id}`}
                className="flex items-center gap-4 px-6 py-4 hover:bg-zinc-800/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">
                      {call.customerName ?? "Unknown"}
                    </span>
                    {isManager && (
                      <span className="text-xs text-zinc-500">{call.repName}</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {new Date(call.recordedAt).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                    {" · "}{formatDuration(call.durationSeconds)}
                  </p>
                  {call.snippet && (
                    <p className="text-xs text-zinc-400 mt-1 line-clamp-1 italic">
                      ...{highlightMatch(call.snippet, search)}...
                    </p>
                  )}
                </div>

                {call.overallScore != null ? (
                  <div className="text-right shrink-0">
                    <span
                      className="text-xl font-bold"
                      style={{ color: GRADE_COLORS[call.overallGrade ?? ""] ?? "#a1a1aa" }}
                    >
                      {call.overallScore}
                    </span>
                    <p
                      className="text-xs"
                      style={{ color: GRADE_COLORS[call.overallGrade ?? ""] ?? "#a1a1aa" }}
                    >
                      {GRADE_LABELS[call.overallGrade ?? ""] ?? ""}
                    </p>
                  </div>
                ) : (
                  <StatusBadge status={call.status} />
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-sky-400 font-medium">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    completed: { bg: "bg-sky-500/10", text: "text-sky-400", label: "Analyzed" },
    failed: { bg: "bg-red-500/10", text: "text-red-400", label: "Failed" },
    uploading: { bg: "bg-yellow-500/10", text: "text-yellow-400", label: "Uploading" },
    transcribing: { bg: "bg-sky-500/10", text: "text-sky-400", label: "Processing" },
    analyzing: { bg: "bg-violet-500/10", text: "text-violet-400", label: "Analyzing" },
  };
  const c = config[status] ?? { bg: "bg-zinc-500/10", text: "text-zinc-400", label: status };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}
