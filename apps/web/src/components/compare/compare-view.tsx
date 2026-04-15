"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { GRADE_COLORS, GRADE_LABELS, CALL_OUTCOMES } from "@flex/shared";

interface CallSummary { id: string; customerName: string; repName: string; overallScore: number | null; overallGrade: string | null; recordedAt: string }

interface CompareData {
  call: { id: string; customerName: string; repName: string; durationSeconds: number; recordedAt: string; outcome: string | null };
  analysis: { overallScore: number; overallGrade: string; summary: string; strengths: string[]; improvements: string[]; talkRatioRep: number; talkRatioCustomer: number } | null;
  sections: Array<{ type: string; grade: string; summary: string }>;
  objections: Array<{ category: string; handlingGrade: string; utteranceText: string; repResponse: string }>;
}

export function CompareView() {
  const [calls, setCalls] = useState<CallSummary[]>([]);
  const [callAId, setCallAId] = useState("");
  const [callBId, setCallBId] = useState("");
  const [data, setData] = useState<{ callA: CompareData; callB: CompareData } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/search?limit=100&status=completed")
      .then((r) => r.json())
      .then((d) => setCalls(d.calls ?? []));
  }, []);

  async function compare() {
    if (!callAId || !callBId) return;
    setLoading(true);
    const res = await fetch(`/api/calls/compare?a=${callAId}&b=${callBId}`);
    const d = await res.json();
    setData(d);
    setLoading(false);
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Compare Calls</h1>
        <p className="text-zinc-400 mt-1">Side-by-side comparison to identify coaching opportunities</p>
      </div>

      {/* Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">Call A</label>
          <select value={callAId} onChange={(e) => setCallAId(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2.5 text-sm text-zinc-300 focus:border-sky-500 focus:outline-none">
            <option value="">Select a call...</option>
            {calls.map((c) => <option key={c.id} value={c.id}>{c.customerName ?? "Unknown"} — {c.repName} ({c.overallScore ?? "?"})</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">Call B</label>
          <select value={callBId} onChange={(e) => setCallBId(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2.5 text-sm text-zinc-300 focus:border-sky-500 focus:outline-none">
            <option value="">Select a call...</option>
            {calls.map((c) => <option key={c.id} value={c.id}>{c.customerName ?? "Unknown"} — {c.repName} ({c.overallScore ?? "?"})</option>)}
          </select>
        </div>
      </div>

      <button onClick={compare} disabled={!callAId || !callBId || loading}
        className="rounded-lg bg-sky-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50 transition-colors">
        {loading ? "Loading..." : "Compare"}
      </button>

      {/* Comparison */}
      {data && (
        <div className="grid grid-cols-2 gap-6">
          {[data.callA, data.callB].map((side, i) => (
            <div key={i} className="space-y-4">
              {/* Header */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="flex items-center justify-between mb-2">
                  <Link href={`/calls/${side.call.id}`} className="text-lg font-semibold text-white hover:text-sky-400">
                    {side.call.customerName}
                  </Link>
                  {side.analysis && (
                    <span className="text-3xl font-bold" style={{ color: GRADE_COLORS[side.analysis.overallGrade] }}>
                      {side.analysis.overallScore}
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-400">{side.call.repName}</p>
                {side.analysis && (
                  <p className="text-sm text-zinc-500 mt-1" style={{ color: GRADE_COLORS[side.analysis.overallGrade] }}>
                    {GRADE_LABELS[side.analysis.overallGrade]}
                  </p>
                )}
              </div>

              {/* Summary */}
              {side.analysis && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
                  <p className="text-sm text-zinc-300">{side.analysis.summary}</p>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-sky-400">Strengths</p>
                    {side.analysis.strengths.map((s, j) => (
                      <p key={j} className="text-xs text-zinc-400">+ {s}</p>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-amber-400">To Improve</p>
                    {side.analysis.improvements.map((s, j) => (
                      <p key={j} className="text-xs text-zinc-400">- {s}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Sections */}
              {side.sections.length > 0 && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-2">
                  <p className="text-sm font-medium text-white">Sections</p>
                  {side.sections.map((s, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: GRADE_COLORS[s.grade] }} />
                      <span className="text-xs text-zinc-300 capitalize flex-1">{s.type.replace(/_/g, " ")}</span>
                      <span className="text-xs" style={{ color: GRADE_COLORS[s.grade] }}>{GRADE_LABELS[s.grade]}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Objections */}
              {side.objections.length > 0 && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-2">
                  <p className="text-sm font-medium text-white">Objections ({side.objections.length})</p>
                  {side.objections.map((o, j) => (
                    <div key={j} className="border border-zinc-800 rounded-lg p-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-400 capitalize">{o.category}</span>
                        <span className="text-xs" style={{ color: GRADE_COLORS[o.handlingGrade] }}>{GRADE_LABELS[o.handlingGrade]}</span>
                      </div>
                      <p className="text-xs text-zinc-300 italic">"{o.utteranceText}"</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
