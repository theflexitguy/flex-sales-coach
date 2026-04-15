"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { GRADE_COLORS, GRADE_LABELS, OBJECTION_CATEGORIES } from "@flex/shared";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

interface CallData {
  id: string; repId: string; repName: string; customerName: string;
  recordedAt: string; overallScore: number | null; overallGrade: string | null; summary: string | null;
}
interface ObjectionData {
  id: string; callId: string; repId: string | null; repName: string;
  category: string; utteranceText: string; repResponse: string; handlingGrade: string;
}
interface RepStat {
  repId: string; repName: string; totalCalls: number; avgScore: number | null;
  totalObjections: number; objectionHandleRate: number | null;
}

type DrillView =
  | { type: "none" }
  | { type: "grade"; grade: string }
  | { type: "objection_category"; category: string }
  | { type: "rep"; repId: string; repName: string }
  | { type: "all_objections" }
  | { type: "all_calls" };

const DATE_PRESETS = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: 0 },
];

export function AnalyticsDashboard() {
  const [calls, setCalls] = useState<CallData[]>([]);
  const [objections, setObjections] = useState<ObjectionData[]>([]);
  const [repStats, setRepStats] = useState<RepStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<DrillView>({ type: "none" });
  const [dateRange, setDateRange] = useState(30);
  const [repFilter, setRepFilter] = useState("");

  useEffect(() => {
    fetch("/api/analytics").then((r) => r.json()).then((data) => {
      setCalls(data.calls ?? []);
      setObjections(data.objections ?? []);
      setRepStats(data.repStats ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const now = Date.now();
  const fc = calls.filter((c) => {
    if (dateRange > 0 && now - new Date(c.recordedAt).getTime() > dateRange * 86400000) return false;
    if (repFilter && c.repId !== repFilter) return false;
    return true;
  });
  const fo = objections.filter((o) => !repFilter || o.repId === repFilter);

  const scores = fc.map((c) => c.overallScore).filter((s): s is number => s != null);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const wellHandled = fo.filter((o) => o.handlingGrade === "excellent" || o.handlingGrade === "good").length;
  const handleRate = fo.length > 0 ? Math.round((wellHandled / fo.length) * 100) : 0;

  const gradeDistribution: Record<string, CallData[]> = {};
  for (const c of fc) { if (c.overallGrade) { (gradeDistribution[c.overallGrade] ??= []).push(c); } }

  const objectionsByCategory: Record<string, ObjectionData[]> = {};
  for (const o of fo) { (objectionsByCategory[o.category] ??= []).push(o); }

  // Daily trends
  const dailyMap: Record<string, { scores: number[]; count: number }> = {};
  for (const c of fc) {
    const d = c.recordedAt.split("T")[0];
    if (!dailyMap[d]) dailyMap[d] = { scores: [], count: 0 };
    if (c.overallScore != null) dailyMap[d].scores.push(c.overallScore);
    dailyMap[d].count += 1;
  }
  const trendData = Object.entries(dailyMap).map(([date, d]) => ({
    date,
    avgScore: d.scores.length > 0 ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length) : null,
    calls: d.count,
  })).sort((a, b) => a.date.localeCompare(b.date));

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <div key={i} className="h-24 bg-zinc-800/50 rounded-xl animate-pulse" />)}</div>
        <div className="grid grid-cols-2 gap-6">{[1,2].map(i => <div key={i} className="h-56 bg-zinc-800/50 rounded-xl animate-pulse" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header + Filters */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-zinc-400 mt-1">{repFilter ? repStats.find(r => r.repId === repFilter)?.repName : "Full team"} &middot; Click anything to drill in</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
            {DATE_PRESETS.map(p => (
              <button key={p.label} onClick={() => setDateRange(p.days)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${dateRange === p.days ? "bg-sky-500/10 text-sky-400" : "text-zinc-500 hover:text-zinc-300"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <select value={repFilter} onChange={e => setRepFilter(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 focus:border-sky-500 focus:outline-none">
            <option value="">All Reps</option>
            {repStats.map(r => <option key={r.repId} value={r.repId}>{r.repName}</option>)}
          </select>
          {(repFilter || dateRange !== 30) && (
            <button onClick={() => { setRepFilter(""); setDateRange(30); }}
              className="px-3 py-1.5 text-xs text-zinc-500 hover:text-white border border-zinc-800 rounded-lg transition-colors">Reset</button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Conversations", value: fc.length, color: "text-white", action: () => setDrill({ type: "all_calls" }) },
          { label: "Avg Score", value: avgScore || "--", color: "text-sky-400", action: () => setDrill({ type: "all_calls" }) },
          { label: "Objections", value: fo.length, color: "text-white", action: () => setDrill({ type: "all_objections" }) },
          { label: "Handle Rate", value: `${handleRate}%`, color: "text-white", action: () => setDrill({ type: "all_objections" }) },
        ].map((s, i) => (
          <button key={i} onClick={s.action}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4 text-left hover:border-zinc-700 hover:scale-[1.02] transition-all">
            <p className="text-sm text-zinc-400">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </button>
        ))}
      </div>

      {/* Charts */}
      {trendData.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="text-base font-semibold text-white mb-3">Score Trend</h2>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#35b2ff" stopOpacity={0.3}/><stop offset="100%" stopColor="#35b2ff" stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tickFormatter={(d:string) => d.slice(5)} tick={{fill:"#52525b",fontSize:10}} axisLine={false} tickLine={false} />
                  <YAxis domain={[0,100]} tick={{fill:"#52525b",fontSize:10}} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={{backgroundColor:"#18181b",border:"1px solid #27272a",borderRadius:8}} formatter={(v:unknown)=>[`${v}`,"Score"]} labelFormatter={(l:unknown)=>String(l).slice(5)} />
                  <Area type="monotone" dataKey="avgScore" stroke="#35b2ff" strokeWidth={2} fill="url(#sg)" connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="text-base font-semibold text-white mb-3">Call Volume</h2>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tickFormatter={(d:string) => d.slice(5)} tick={{fill:"#52525b",fontSize:10}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fill:"#52525b",fontSize:10}} axisLine={false} tickLine={false} width={25} />
                  <Tooltip contentStyle={{backgroundColor:"#18181b",border:"1px solid #27272a",borderRadius:8}} formatter={(v:unknown)=>[`${v}`,"Conversations"]} labelFormatter={(l:unknown)=>String(l).slice(5)} />
                  <Bar dataKey="calls" fill="#35b2ff" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Three column: Reps, Objections, Grades */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-2">
          <h2 className="text-base font-semibold text-white mb-1">Reps</h2>
          {repStats.filter(r => !repFilter || r.repId === repFilter).map(rep => (
            <button key={rep.repId} onClick={() => setDrill({ type: "rep", repId: rep.repId, repName: rep.repName })}
              className="w-full flex items-center gap-3 rounded-lg border border-zinc-800 px-3 py-2.5 text-left hover:border-zinc-700 transition-all">
              <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-semibold text-zinc-300">{rep.repName.charAt(0)}</div>
              <div className="flex-1 min-w-0"><p className="text-sm font-medium text-white truncate">{rep.repName}</p><p className="text-xs text-zinc-500">{rep.totalCalls} convos</p></div>
              <span className="text-lg font-bold" style={{color: rep.avgScore ? (rep.avgScore >= 80 ? GRADE_COLORS.excellent : rep.avgScore >= 60 ? GRADE_COLORS.good : GRADE_COLORS.needs_improvement) : "#71717a"}}>{rep.avgScore ?? "--"}</span>
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-2">
          <h2 className="text-base font-semibold text-white mb-1">Objections</h2>
          {OBJECTION_CATEGORIES.filter(cat => (objectionsByCategory[cat]?.length ?? 0) > 0).map(cat => {
            const co = objectionsByCategory[cat] ?? [];
            const cw = co.filter(o => o.handlingGrade === "excellent" || o.handlingGrade === "good").length;
            const r = Math.round((cw / co.length) * 100);
            return (
              <button key={cat} onClick={() => setDrill({ type: "objection_category", category: cat })}
                className="w-full text-left rounded-lg p-2 hover:bg-zinc-800/30 transition-colors space-y-1">
                <div className="flex items-center justify-between"><span className="text-sm text-zinc-300 capitalize">{cat}</span><span className="text-xs text-zinc-400">{r}%</span></div>
                <div className="h-2 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full rounded-full bg-sky-500 transition-all duration-700" style={{width:`${r}%`}} /></div>
              </button>
            );
          })}
          {Object.keys(objectionsByCategory).length === 0 && <p className="text-sm text-zinc-500">No data yet</p>}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-2">
          <h2 className="text-base font-semibold text-white mb-1">Grades</h2>
          {["excellent","good","acceptable","needs_improvement","poor"].map(g => {
            const gc = gradeDistribution[g] ?? [];
            const p = fc.length > 0 ? Math.round((gc.length / fc.length) * 100) : 0;
            return (
              <button key={g} onClick={() => { if (gc.length > 0) setDrill({ type: "grade", grade: g }); }}
                className={`w-full flex items-center gap-3 rounded-lg p-2 transition-all ${gc.length > 0 ? "hover:bg-zinc-800/30" : "opacity-40"}`}>
                <div className="w-3 h-3 rounded-full shrink-0" style={{backgroundColor: GRADE_COLORS[g]}} />
                <span className="text-sm text-zinc-300 w-28 text-left">{GRADE_LABELS[g]}</span>
                <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full rounded-full transition-all duration-700" style={{width:`${p}%`,backgroundColor:GRADE_COLORS[g]}} /></div>
                <span className="text-sm font-medium text-zinc-400 w-6 text-right">{gc.length}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Drill-down */}
      {drill.type !== "none" && (
        <div className="rounded-xl border border-sky-500/20 bg-zinc-900/80 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              {drill.type === "grade" && `${GRADE_LABELS[drill.grade]} Calls`}
              {drill.type === "objection_category" && `${drill.category.charAt(0).toUpperCase() + drill.category.slice(1)} Objections`}
              {drill.type === "rep" && drill.repName}
              {drill.type === "all_calls" && "All Conversations"}
              {drill.type === "all_objections" && "All Objections"}
            </h2>
            <button onClick={() => setDrill({ type: "none" })} className="p-1.5 text-zinc-500 hover:text-zinc-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {(drill.type === "grade" ? gradeDistribution[drill.grade] ?? []
              : drill.type === "rep" ? fc.filter(c => c.repId === drill.repId)
              : drill.type === "all_calls" ? fc
              : []
            ).map(call => (
              <Link key={call.id} href={`/calls/${call.id}`}
                className="flex items-center gap-4 rounded-lg border border-zinc-800 px-4 py-3 hover:border-zinc-700 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{call.customerName}</p>
                  <p className="text-xs text-zinc-500">{call.repName} &middot; {new Date(call.recordedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</p>
                </div>
                {call.overallScore != null && <span className="text-lg font-bold" style={{color:GRADE_COLORS[call.overallGrade ?? ""]}}>{call.overallScore}</span>}
              </Link>
            ))}
            {(drill.type === "objection_category" ? objectionsByCategory[drill.category] ?? []
              : drill.type === "all_objections" ? fo
              : []
            ).map(obj => (
              <Link key={obj.id} href={`/calls/${obj.callId}`}
                className="block rounded-lg border border-zinc-800 p-4 space-y-1 hover:border-zinc-700 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400 capitalize">{obj.category} &middot; {obj.repName}</span>
                  <span className="text-xs" style={{color:GRADE_COLORS[obj.handlingGrade]}}>{GRADE_LABELS[obj.handlingGrade]}</span>
                </div>
                <p className="text-sm text-zinc-300 italic">&ldquo;{obj.utteranceText}&rdquo;</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
