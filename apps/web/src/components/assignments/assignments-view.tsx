"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Assignment {
  id: string;
  callId: string;
  callName: string;
  repName: string;
  managerName: string;
  status: string;
  instructions: string;
  dueDate: string | null;
  completedAt: string | null;
  repResponse: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  assigned: { bg: "bg-amber-500/10", text: "text-amber-400", label: "Assigned" },
  in_progress: { bg: "bg-sky-500/10", text: "text-sky-400", label: "In Progress" },
  completed: { bg: "bg-green-500/10", text: "text-green-400", label: "Completed" },
  overdue: { bg: "bg-red-500/10", text: "text-red-400", label: "Overdue" },
};

export function AssignmentsView({ isManager }: { isManager: boolean }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/assignments")
      .then((r) => r.json())
      .then((d) => setAssignments(d.assignments ?? []))
      .finally(() => setLoading(false));
  }, []);

  const pending = assignments.filter((a) => a.status === "assigned" || a.status === "in_progress");
  const completed = assignments.filter((a) => a.status === "completed");

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Coaching Assignments</h1>
        <p className="text-zinc-400 mt-1">
          {isManager ? "Review and assign calls for coaching" : "Your assigned reviews"}
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <div key={i} className="h-24 bg-zinc-800/50 rounded-xl animate-pulse" />)}
        </div>
      ) : assignments.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-16 text-center">
          <p className="text-zinc-400">No assignments yet</p>
          <p className="text-zinc-500 text-sm mt-1">
            {isManager ? "Assign calls to reps from the call detail page" : "Your manager will assign calls for you to review"}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Active ({pending.length})</h2>
              {pending.map((a) => (
                <AssignmentCard key={a.id} assignment={a} isManager={isManager} />
              ))}
            </div>
          )}
          {completed.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Completed ({completed.length})</h2>
              {completed.map((a) => (
                <AssignmentCard key={a.id} assignment={a} isManager={isManager} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssignmentCard({ assignment: a, isManager }: { assignment: Assignment; isManager: boolean }) {
  const s = STATUS_STYLES[a.status] ?? STATUS_STYLES.assigned;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href={`/calls/${a.callId}`} className="text-sm font-semibold text-white hover:text-sky-400">
              {a.callName}
            </Link>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}>
              {s.label}
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            {isManager ? `Assigned to ${a.repName}` : `From ${a.managerName}`}
            {a.dueDate && <> &middot; Due {new Date(a.dueDate).toLocaleDateString()}</>}
          </p>
        </div>
      </div>
      <p className="text-sm text-zinc-300">{a.instructions}</p>
      {a.repResponse && (
        <div className="rounded-lg bg-sky-500/5 border border-sky-500/10 px-3 py-2">
          <p className="text-xs text-sky-400 font-medium mb-1">Rep&apos;s response:</p>
          <p className="text-sm text-zinc-300">{a.repResponse}</p>
        </div>
      )}
    </div>
  );
}
