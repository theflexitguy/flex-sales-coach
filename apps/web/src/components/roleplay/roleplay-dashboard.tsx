"use client";

import { useState, useEffect } from "react";
import { GRADE_COLORS } from "@flex/shared";

interface RepStat {
  repId: string;
  repName: string;
  totalSessions: number;
  totalMinutes: number;
  sessionsThisWeek: number;
  avgRoleplayScore: number | null;
  avgRealScore: number | null;
  scoreDelta: number | null;
}

interface TeamStats {
  totalSessions: number;
  totalMinutes: number;
  personaCount: number;
  scenarioCount: number;
}

interface AnalyticsData {
  team: TeamStats;
  reps: RepStat[];
}

function gradeFromScore(score: number): string {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 60) return "acceptable";
  if (score >= 40) return "needs_improvement";
  return "poor";
}

export function RoleplayDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics/roleplay")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-zinc-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-zinc-800/50 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Team overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Sessions" value={String(data.team.totalSessions)} />
        <StatCard label="Practice Time" value={`${data.team.totalMinutes}m`} />
        <StatCard label="Active Personas" value={String(data.team.personaCount)} />
        <StatCard label="Scenarios" value={String(data.team.scenarioCount)} />
      </div>

      {/* Per-rep breakdown */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800">
          <h2 className="text-base font-semibold text-white">Rep Practice Activity</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
                <th className="px-6 py-3 font-medium">Rep</th>
                <th className="px-4 py-3 font-medium">Sessions</th>
                <th className="px-4 py-3 font-medium">This Week</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Roleplay Avg</th>
                <th className="px-4 py-3 font-medium">Real Call Avg</th>
                <th className="px-4 py-3 font-medium">Delta</th>
              </tr>
            </thead>
            <tbody>
              {data.reps.map((rep) => (
                <tr key={rep.repId} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800 text-zinc-300 text-sm font-medium">
                        {rep.repName.charAt(0)}
                      </div>
                      <span className="text-sm font-medium text-white">{rep.repName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-300">{rep.totalSessions}</td>
                  <td className="px-4 py-3">
                    <span className={`text-sm font-medium ${rep.sessionsThisWeek > 0 ? "text-sky-400" : "text-zinc-600"}`}>
                      {rep.sessionsThisWeek}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">{rep.totalMinutes}m</td>
                  <td className="px-4 py-3">
                    {rep.avgRoleplayScore != null ? (
                      <span
                        className="text-sm font-semibold"
                        style={{ color: GRADE_COLORS[gradeFromScore(rep.avgRoleplayScore)] }}
                      >
                        {rep.avgRoleplayScore}
                      </span>
                    ) : (
                      <span className="text-sm text-zinc-600">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {rep.avgRealScore != null ? (
                      <span
                        className="text-sm font-semibold"
                        style={{ color: GRADE_COLORS[gradeFromScore(rep.avgRealScore)] }}
                      >
                        {rep.avgRealScore}
                      </span>
                    ) : (
                      <span className="text-sm text-zinc-600">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {rep.scoreDelta != null ? (
                      <span className={`text-sm font-semibold ${rep.scoreDelta >= 0 ? "text-green-400" : "text-amber-400"}`}>
                        {rep.scoreDelta >= 0 ? "+" : ""}{rep.scoreDelta}
                      </span>
                    ) : (
                      <span className="text-sm text-zinc-600">--</span>
                    )}
                  </td>
                </tr>
              ))}
              {data.reps.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-zinc-500 text-sm">
                    No reps on the team yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}
