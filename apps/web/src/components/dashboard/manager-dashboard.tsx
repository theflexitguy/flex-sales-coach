"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { GRADE_COLORS } from "@flex/shared";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";

interface DashboardData {
  todayActivity: { callsToday: number; activeSessions: number; analyzedToday: number };
  leaderboard: Array<{
    repId: string; repName: string; avgScore: number | null;
    objectionHandleRate: number | null; totalCalls: number;
  }>;
  trends: Array<{ date: string; avgScore: number; callCount: number }>;
  helpRequests: { pendingCount: number; recent: Array<{ id: string; repName: string; excerpt: string; createdAt: string }> };
  quickActions: { worstCallToday: string | null; topFailedObjection: string | null; strugglingRep: string | null; strugglingRepName: string | null };
}

export function ManagerDashboard({ userName }: { userName: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-zinc-800 rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-zinc-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-zinc-400 mt-1">Welcome back, {userName}</p>
      </div>

      {/* Today's Activity */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Convos Today" value={data.todayActivity.callsToday} />
        <StatCard label="Analyzed Today" value={data.todayActivity.analyzedToday} accent />
        <StatCard label="Active Sessions" value={data.todayActivity.activeSessions} />
        <StatCard
          label="Pending Help"
          value={data.helpRequests.pendingCount}
          alert={data.helpRequests.pendingCount > 0}
          href="/help-requests"
        />
      </div>

      {/* Quick Actions */}
      {(data.quickActions.worstCallToday || data.quickActions.topFailedObjection || data.quickActions.strugglingRep) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.quickActions.worstCallToday && (
            <Link
              href={`/calls/${data.quickActions.worstCallToday}`}
              className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 hover:border-red-500/30 transition-colors"
            >
              <p className="text-xs text-red-400 font-medium">Needs Attention</p>
              <p className="text-sm text-white mt-1">Lowest scoring call today</p>
              <p className="text-xs text-zinc-500 mt-1">Click to review</p>
            </Link>
          )}
          {data.quickActions.topFailedObjection && (
            <Link
              href={`/objections?category=${data.quickActions.topFailedObjection}`}
              className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 hover:border-amber-500/30 transition-colors"
            >
              <p className="text-xs text-amber-400 font-medium">Top Failed Objection</p>
              <p className="text-sm text-white mt-1 capitalize">{data.quickActions.topFailedObjection}</p>
              <p className="text-xs text-zinc-500 mt-1">View team examples</p>
            </Link>
          )}
          {data.quickActions.strugglingRepName && (
            <Link
              href={`/reps`}
              className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 hover:border-sky-500/30 transition-colors"
            >
              <p className="text-xs text-sky-400 font-medium">Needs Coaching</p>
              <p className="text-sm text-white mt-1">{data.quickActions.strugglingRepName}</p>
              <p className="text-xs text-zinc-500 mt-1">Lowest avg score (30d)</p>
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Leaderboard */}
        <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-3">
          <h2 className="text-lg font-semibold text-white">Team Leaderboard</h2>
          {data.leaderboard.length === 0 ? (
            <p className="text-sm text-zinc-500">No data yet</p>
          ) : (
            <div className="space-y-2">
              {data.leaderboard.map((rep, i) => (
                <Link
                  key={rep.repId}
                  href={`/reps`}
                  className="flex items-center gap-4 rounded-lg border border-zinc-800 px-4 py-3 hover:border-zinc-700 transition-colors"
                >
                  <span className="text-lg font-bold text-zinc-600 w-6 text-center">
                    {i + 1}
                  </span>
                  <div className="flex items-center justify-center w-9 h-9 rounded-full bg-zinc-800 text-zinc-300 text-sm font-semibold">
                    {rep.repName.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{rep.repName}</p>
                    <p className="text-xs text-zinc-500">{rep.totalCalls} convos</p>
                  </div>
                  <div className="text-right">
                    <p
                      className="text-xl font-bold"
                      style={{
                        color: rep.avgScore
                          ? rep.avgScore >= 80 ? GRADE_COLORS.excellent
                            : rep.avgScore >= 60 ? GRADE_COLORS.good
                            : GRADE_COLORS.needs_improvement
                          : "#71717a",
                      }}
                    >
                      {rep.avgScore ?? "--"}
                    </p>
                  </div>
                  <div className="text-right w-16">
                    <p className="text-sm text-zinc-300">{rep.objectionHandleRate ?? "--"}%</p>
                    <p className="text-xs text-zinc-600">handled</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Help Requests + Score Trend */}
        <div className="space-y-6">
          {/* Pending help */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Help Requests</h2>
              {data.helpRequests.pendingCount > 0 && (
                <span className="text-xs font-medium text-amber-400 px-2 py-0.5 rounded-full bg-amber-500/10">
                  {data.helpRequests.pendingCount} pending
                </span>
              )}
            </div>
            {data.helpRequests.recent.length === 0 ? (
              <p className="text-sm text-zinc-500">No pending requests</p>
            ) : (
              <div className="space-y-2">
                {data.helpRequests.recent.map((r) => (
                  <Link
                    key={r.id}
                    href="/help-requests"
                    className="block rounded-lg border border-zinc-800 px-3 py-2 hover:border-zinc-700 transition-colors"
                  >
                    <p className="text-xs text-sky-400">{r.repName}</p>
                    <p className="text-sm text-zinc-300 line-clamp-1">{r.excerpt}</p>
                  </Link>
                ))}
              </div>
            )}
            <Link href="/help-requests" className="text-xs text-sky-400 hover:underline">
              View all
            </Link>
          </div>

          {/* Score trend chart */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
            <h2 className="text-base font-semibold text-white">Score Trend (30d)</h2>
            {data.trends.length === 0 ? (
              <p className="text-sm text-zinc-500">No trend data</p>
            ) : (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trends.slice(-30)}>
                    <defs>
                      <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#35b2ff" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#35b2ff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => d.slice(5)}
                      tick={{ fill: "#52525b", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: "#52525b", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={30}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
                      labelStyle={{ color: "#a1a1aa" }}
                      itemStyle={{ color: "#35b2ff" }}
                      formatter={(value: unknown) => [`${value}`, "Avg Score"]}
                      labelFormatter={(label: unknown) => String(label).slice(5)}
                    />
                    <Area
                      type="monotone"
                      dataKey="avgScore"
                      stroke="#35b2ff"
                      strokeWidth={2}
                      fill="url(#scoreGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  alert,
  href,
}: {
  label: string;
  value: number;
  accent?: boolean;
  alert?: boolean;
  href?: string;
}) {
  const content = (
    <div className={`rounded-xl border bg-zinc-900/50 px-5 py-4 ${
      alert ? "border-amber-500/20" : "border-zinc-800"
    } ${href ? "hover:border-zinc-700 transition-colors" : ""}`}>
      <p className="text-sm text-zinc-400">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${
        alert ? "text-amber-400" : accent ? "text-sky-400" : "text-white"
      }`}>
        {value}
      </p>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
