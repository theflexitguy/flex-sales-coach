"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { GRADE_COLORS, GRADE_LABELS } from "@flex/shared";
import { BulkShareDialog } from "./bulk-share-dialog";

interface ShareInfo {
  userId: string;
  userName: string;
}

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
  shares: ShareInfo[];
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

  // Selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showShareDialog, setShowShareDialog] = useState(false);

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

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === calls.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(calls.map((c) => c.id)));
    }
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  const allSelected = calls.length > 0 && selectedIds.size === calls.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < calls.length;

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

        {/* Select / Cancel button */}
        {!selectionMode ? (
          <button
            onClick={() => setSelectionMode(true)}
            className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors shrink-0"
          >
            Select
          </button>
        ) : (
          <button
            onClick={exitSelectionMode}
            className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors shrink-0"
          >
            Cancel
          </button>
        )}
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
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 focus:border-sky-500 focus:outline-none"
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
          {/* Select-all header row (only in selection mode) */}
          {selectionMode && calls.length > 0 && (
            <div className="flex items-center gap-3 px-6 py-3 border-b border-zinc-800 bg-zinc-800/30">
              <button
                onClick={toggleSelectAll}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                  allSelected ? "bg-sky-500 border-sky-500" : someSelected ? "bg-sky-500/50 border-sky-500" : "border-zinc-600 hover:border-zinc-400"
                }`}
              >
                {(allSelected || someSelected) && (
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                    {allSelected ? <polyline points="20 6 9 17 4 12" /> : <line x1="4" y1="12" x2="20" y2="12" />}
                  </svg>
                )}
              </button>
              <span className="text-xs text-zinc-400">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
              </span>
            </div>
          )}

          <div className="divide-y divide-zinc-800/50">
            {calls.map((call) => {
              const isSelected = selectedIds.has(call.id);
              const rowContent = (
                <>
                  {selectionMode && (
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? "bg-sky-500 border-sky-500" : "border-zinc-600"
                    }`}>
                      {isSelected && (
                        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white truncate">
                        {call.customerName ?? "Unknown"}
                      </span>
                      {isManager && (
                        <span className="text-xs text-zinc-500">{call.repName}</span>
                      )}
                      {/* Share status badge */}
                      {call.shares.length > 0 && (
                        <ShareBadge shares={call.shares} />
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
                </>
              );

              return selectionMode ? (
                <div
                  key={call.id}
                  onClick={() => toggleSelect(call.id)}
                  className={`flex items-center gap-4 px-6 py-4 cursor-pointer transition-colors ${
                    isSelected ? "bg-sky-500/5 hover:bg-sky-500/10" : "hover:bg-zinc-800/30"
                  }`}
                >
                  {rowContent}
                </div>
              ) : (
                <Link
                  key={call.id}
                  href={`/calls/${call.id}`}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-zinc-800/30 transition-colors"
                >
                  {rowContent}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
          <div className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-3 shadow-2xl shadow-black/60">
            <span className="text-sm text-zinc-300 font-medium">
              {selectedIds.size} conversation{selectedIds.size > 1 ? "s" : ""} selected
            </span>
            <div className="w-px h-4 bg-zinc-700" />
            <button
              onClick={() => setShowShareDialog(true)}
              className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
              </svg>
              Share
            </button>
            <button
              onClick={exitSelectionMode}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Bulk share dialog */}
      {showShareDialog && (
        <BulkShareDialog
          callIds={[...selectedIds]}
          onClose={() => setShowShareDialog(false)}
          onShared={() => {
            fetchCalls();
            exitSelectionMode();
          }}
        />
      )}
    </div>
  );
}

function ShareBadge({ shares }: { shares: ShareInfo[] }) {
  const names = shares.map((s) => s.userName);
  const displayNames = names.length <= 2
    ? names.join(", ")
    : `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-400 shrink-0">
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
      </svg>
      {displayNames}
    </span>
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
