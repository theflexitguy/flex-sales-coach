"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { OBJECTION_CATEGORIES, GRADE_COLORS, GRADE_LABELS } from "@flex/shared";

interface ObjectionItem {
  id: string;
  callId: string;
  category: string;
  utteranceText: string;
  repResponse: string;
  handlingGrade: string;
  suggestion: string;
  repName: string;
  customerName: string;
  recordedAt: string;
}

export function ObjectionLibrary() {
  const [objections, setObjections] = useState<ObjectionItem[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [bestPractices, setBestPractices] = useState<ObjectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [gradeFilter, setGradeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [examplesFor, setExamplesFor] = useState<string | null>(null);
  const [examples, setExamples] = useState<ObjectionItem[]>([]);

  useEffect(() => {
    fetchData();
  }, [activeCategory, gradeFilter, search]);

  async function fetchData() {
    const params = new URLSearchParams();
    if (activeCategory) params.set("category", activeCategory);
    if (gradeFilter) params.set("grade", gradeFilter);
    if (search) params.set("search", search);

    const res = await fetch(`/api/objections/library?${params}`);
    const data = await res.json();
    setObjections(data.objections ?? []);
    setCategoryCounts(data.categoryCounts ?? {});
    setBestPractices(data.bestPractices ?? []);
    setLoading(false);
  }

  async function showExamples(category: string) {
    setExamplesFor(category);
    const res = await fetch(`/api/objections/library?examplesFor=${category}`);
    const data = await res.json();
    setExamples(data.examples ?? []);
  }

  const grades = ["excellent", "good", "acceptable", "needs_improvement", "poor"];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Objection Library</h1>
        <p className="text-zinc-400 mt-1">
          Learn from real examples across your team
        </p>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory(null)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            !activeCategory
              ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
              : "bg-zinc-800/50 text-zinc-400 border border-zinc-800 hover:border-zinc-700"
          }`}
        >
          All ({Object.values(categoryCounts).reduce((a, b) => a + b, 0)})
        </button>
        {OBJECTION_CATEGORIES.filter((c) => (categoryCounts[c] ?? 0) > 0).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
              activeCategory === cat
                ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                : "bg-zinc-800/50 text-zinc-400 border border-zinc-800 hover:border-zinc-700"
            }`}
          >
            {cat} ({categoryCounts[cat] ?? 0})
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search objections..."
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none"
        />
        <div className="flex gap-1">
          {grades.map((g) => (
            <button
              key={g}
              onClick={() => setGradeFilter(gradeFilter === g ? null : g)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                gradeFilter === g
                  ? "border border-sky-500/20"
                  : "border border-zinc-800 hover:border-zinc-700"
              }`}
              style={{
                color: gradeFilter === g ? GRADE_COLORS[g] : "#71717a",
                backgroundColor: gradeFilter === g ? `${GRADE_COLORS[g]}15` : undefined,
              }}
            >
              {GRADE_LABELS[g]}
            </button>
          ))}
        </div>
      </div>

      {/* Best Practices banner */}
      {!gradeFilter && !search && bestPractices.length > 0 && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-5 space-y-3">
          <h2 className="text-base font-semibold text-green-400">Best Practices</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {bestPractices.slice(0, 4).map((bp) => (
              <Link
                key={bp.id}
                href={`/calls/${bp.callId}`}
                className="rounded-lg border border-green-500/10 bg-zinc-900/50 p-3 hover:border-green-500/20 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-zinc-400 capitalize">{bp.category}</span>
                  <span className="text-xs text-green-400">{bp.repName}</span>
                </div>
                <p className="text-sm text-zinc-300 italic line-clamp-1">&ldquo;{bp.utteranceText}&rdquo;</p>
                <p className="text-sm text-green-300 mt-1 line-clamp-2">{bp.repResponse}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Objection list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 bg-zinc-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : objections.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-16 text-center">
          <p className="text-zinc-400">No objections found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {objections.map((obj) => (
            <div
              key={obj.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-zinc-400 capitalize px-2 py-0.5 rounded-full bg-zinc-800">
                    {obj.category}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {obj.repName} &rarr; {obj.customerName}
                  </span>
                </div>
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{
                    color: GRADE_COLORS[obj.handlingGrade] ?? "#a1a1aa",
                    backgroundColor: `${GRADE_COLORS[obj.handlingGrade] ?? "#a1a1aa"}15`,
                  }}
                >
                  {GRADE_LABELS[obj.handlingGrade]}
                </span>
              </div>

              <p className="text-sm text-zinc-300 italic">&ldquo;{obj.utteranceText}&rdquo;</p>
              <p className="text-sm text-zinc-400">
                <span className="text-zinc-500">Response:</span> {obj.repResponse}
              </p>

              <div className="rounded-md bg-amber-500/5 border border-amber-500/10 px-3 py-2">
                <p className="text-xs text-amber-400">
                  <span className="font-medium">AI suggestion:</span> {obj.suggestion}
                </p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Link
                  href={`/calls/${obj.callId}`}
                  className="text-xs text-sky-400 hover:underline"
                >
                  Listen to call
                </Link>
                <button
                  onClick={() => showExamples(obj.category)}
                  className="text-xs text-green-400 hover:underline"
                >
                  See how others handled it
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Examples drawer */}
      {examplesFor && (
        <div className="fixed inset-y-0 right-0 w-[480px] z-50 border-l border-zinc-800 bg-zinc-950 shadow-2xl overflow-y-auto">
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white capitalize">
                {examplesFor} — Best Responses
              </h2>
              <button
                onClick={() => setExamplesFor(null)}
                className="p-1.5 text-zinc-500 hover:text-zinc-300"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-zinc-400">
              These are real examples from your team where this objection type was handled well.
            </p>

            {examples.length === 0 ? (
              <p className="text-sm text-zinc-500">No excellent examples yet for this category.</p>
            ) : (
              <div className="space-y-3">
                {examples.map((ex) => (
                  <Link
                    key={ex.id}
                    href={`/calls/${ex.callId}`}
                    className="block rounded-lg border border-zinc-800 p-4 space-y-2 hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-sky-400">{ex.repName}</span>
                      <span
                        className="text-xs font-medium"
                        style={{ color: GRADE_COLORS[ex.handlingGrade] }}
                      >
                        {GRADE_LABELS[ex.handlingGrade]}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-300 italic">&ldquo;{ex.utteranceText}&rdquo;</p>
                    <p className="text-sm text-green-300">{ex.repResponse}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
