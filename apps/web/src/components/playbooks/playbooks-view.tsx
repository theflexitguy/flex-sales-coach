"use client";

import { useState, useEffect } from "react";

interface Playbook {
  id: string;
  name: string;
  description: string | null;
  sections: Array<{ name: string; description: string; weight: number }>;
  scoring: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export function PlaybooksView() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sections, setSections] = useState([
    { name: "Introduction", description: "Greeting and rapport", weight: 15 },
    { name: "Discovery", description: "Identify needs and pain points", weight: 20 },
    { name: "Pitch", description: "Present the solution", weight: 25 },
    { name: "Objection Handling", description: "Address concerns", weight: 25 },
    { name: "Close", description: "Ask for the sale", weight: 15 },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/playbooks")
      .then((r) => r.json())
      .then((d) => setPlaybooks(d.playbooks ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function createPlaybook() {
    setSaving(true);
    const res = await fetch("/api/playbooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        sections,
        scoring: { totalWeight: sections.reduce((sum, s) => sum + s.weight, 0) },
      }),
    });
    const data = await res.json();
    if (data.playbook) {
      setPlaybooks((prev) => [data.playbook, ...prev]);
      setShowCreate(false);
      setName("");
      setDescription("");
    }
    setSaving(false);
  }

  function updateSection(index: number, field: string, value: string | number) {
    setSections((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  function addSection() {
    setSections((prev) => [...prev, { name: "", description: "", weight: 10 }]);
  }

  function removeSection(index: number) {
    setSections((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Playbooks</h1>
          <p className="text-zinc-400 mt-1">Define your sales process and scoring rubric</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-400 transition-colors">
          Create Playbook
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-sky-500/20 bg-zinc-900/80 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">New Playbook</h2>
          <div className="space-y-3">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Playbook name"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none resize-none" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-300">Scoring Sections</h3>
              <button onClick={addSection} className="text-xs text-sky-400 hover:text-sky-300">+ Add Section</button>
            </div>
            {sections.map((s, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input type="text" value={s.name} onChange={(e) => updateSection(i, "name", e.target.value)} placeholder="Section name"
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none" />
                <input type="text" value={s.description} onChange={(e) => updateSection(i, "description", e.target.value)} placeholder="Description"
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none" />
                <input type="number" value={s.weight} onChange={(e) => updateSection(i, "weight", parseInt(e.target.value) || 0)} min={0} max={100}
                  className="w-20 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white text-center focus:border-sky-500 focus:outline-none" />
                <button onClick={() => removeSection(i)} className="p-2 text-zinc-500 hover:text-red-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            <p className="text-xs text-zinc-500">Total weight: {sections.reduce((sum, s) => sum + s.weight, 0)}%</p>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setShowCreate(false)} className="flex-1 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800">Cancel</button>
            <button onClick={createPlaybook} disabled={!name.trim() || saving}
              className="flex-1 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50 transition-colors">
              {saving ? "Saving..." : "Create Playbook"}
            </button>
          </div>
        </div>
      )}

      {/* Existing playbooks */}
      {loading ? (
        <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-32 bg-zinc-800/50 rounded-xl animate-pulse" />)}</div>
      ) : playbooks.length === 0 && !showCreate ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-16 text-center">
          <p className="text-zinc-400">No playbooks yet</p>
          <p className="text-zinc-500 text-sm mt-1">Create a playbook to define your team&apos;s sales process and scoring</p>
        </div>
      ) : (
        <div className="space-y-3">
          {playbooks.map((pb) => (
            <div key={pb.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">{pb.name}</h3>
                  {pb.description && <p className="text-sm text-zinc-400 mt-0.5">{pb.description}</p>}
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  pb.is_active ? "bg-green-500/10 text-green-400" : "bg-zinc-500/10 text-zinc-400"
                }`}>
                  {pb.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              {(pb.sections as Array<{ name: string; weight: number }>)?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(pb.sections as Array<{ name: string; weight: number }>).map((s, i) => (
                    <span key={i} className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">
                      {s.name} ({s.weight}%)
                    </span>
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
