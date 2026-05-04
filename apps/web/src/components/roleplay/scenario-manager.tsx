"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ELEVENLABS_VOICES } from "@flex/shared";

interface Persona {
  id: string;
  name: string;
  description: string;
  personality: { tone?: string; objectionStyle?: string; patienceLevel?: string };
  voice_id: string;
  objection_categories: string[];
  is_active: boolean;
}

interface Scenario {
  id: string;
  persona_id: string;
  title: string;
  description: string;
  scenario_type: string;
  difficulty: string;
  target_objections: string[];
  is_active: boolean;
  roleplay_personas: { id: string; name: string } | null;
}

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Easy",
  intermediate: "Medium",
  advanced: "Hard",
  extreme: "Extreme",
};

export function ScenarioManager() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<"personas" | "scenarios" | null>(null);
  const router = useRouter();

  useEffect(() => {
    Promise.all([
      fetch("/api/roleplay/personas").then((r) => r.json()),
      fetch("/api/roleplay/scenarios").then((r) => r.json()),
    ]).then(([p, s]) => {
      setPersonas(p.personas ?? []);
      setScenarios(s.scenarios ?? []);
      setLoading(false);
    });
  }, []);

  async function generatePersonas() {
    setGenerating("personas");
    const res = await fetch("/api/roleplay/personas/generate", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      // Reload
      const p = await fetch("/api/roleplay/personas").then((r) => r.json());
      setPersonas(p.personas ?? []);
    } else {
      alert(data.error ?? "Failed to generate personas");
    }
    setGenerating(null);
  }

  async function generateScenarios() {
    setGenerating("scenarios");
    const res = await fetch("/api/roleplay/scenarios/generate", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      const s = await fetch("/api/roleplay/scenarios").then((r) => r.json());
      setScenarios(s.scenarios ?? []);
    } else {
      alert(data.error ?? "Failed to generate scenarios");
    }
    setGenerating(null);
  }

  function getVoiceName(voiceId: string): string {
    const entry = Object.entries(ELEVENLABS_VOICES).find(([, v]) => v.id === voiceId);
    return entry ? `${entry[0]} (${entry[1].gender}, ${entry[1].age})` : voiceId;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-zinc-800/50 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Personas section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Customer Personas</h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              AI-generated from your team&apos;s real call data
            </p>
          </div>
          <button
            onClick={generatePersonas}
            disabled={generating !== null}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {generating === "personas" ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v3m6.366-.366l-2.12 2.12M21 12h-3m.366 6.366l-2.12-2.12M12 21v-3m-6.366.366l2.12-2.12M3 12h3m-.366-6.366l2.12 2.12" />
                </svg>
                {personas.length > 0 ? "Regenerate" : "Generate from calls"}
              </>
            )}
          </button>
        </div>

        {personas.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 px-6 py-12 text-center">
            <p className="text-zinc-400">No personas yet</p>
            <p className="text-zinc-500 text-sm mt-1">
              Generate personas from your team&apos;s call data to create AI training bots
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {personas.map((p) => (
              <div key={p.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-sky-500/10 shrink-0">
                    <span className="text-sky-400 font-bold text-lg">{p.name.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white">{p.name}</h3>
                    <p className="text-xs text-zinc-500">{getVoiceName(p.voice_id)}</p>
                  </div>
                </div>
                <p className="text-sm text-zinc-400 line-clamp-2">{p.description}</p>
                <div className="flex flex-wrap gap-2">
                  {p.personality?.tone && (
                    <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">{p.personality.tone}</span>
                  )}
                  {(p.objection_categories ?? []).map((cat) => (
                    <span key={cat} className="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full capitalize">{cat}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scenarios section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Training Scenarios</h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              Practice situations targeting specific skills
            </p>
          </div>
          <button
            onClick={generateScenarios}
            disabled={generating !== null || personas.length === 0}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {generating === "scenarios" ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v3m6.366-.366l-2.12 2.12M21 12h-3m.366 6.366l-2.12-2.12M12 21v-3m-6.366.366l2.12-2.12M3 12h3m-.366-6.366l2.12 2.12" />
                </svg>
                {scenarios.length > 0 ? "Generate more" : "Generate scenarios"}
              </>
            )}
          </button>
        </div>

        {scenarios.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 px-6 py-12 text-center">
            <p className="text-zinc-400">No scenarios yet</p>
            <p className="text-zinc-500 text-sm mt-1">
              {personas.length === 0
                ? "Generate personas first, then scenarios will be created from them"
                : "Generate scenarios to give your reps practice situations"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {scenarios.map((s) => {
              const persona = s.roleplay_personas as unknown as { id: string; name: string } | null;
              return (
                <div key={s.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <h3 className="text-sm font-semibold text-white">{s.title}</h3>
                    <p className="text-sm text-zinc-400 line-clamp-1">{s.description}</p>
                    <div className="flex items-center gap-3 pt-1">
                      {persona && (
                        <span className="text-xs text-sky-400">{persona.name}</span>
                      )}
                      <span className="text-xs text-zinc-500 capitalize">
                        {s.scenario_type.replace(/_/g, " ")}
                      </span>
                      <span className={`text-xs font-medium capitalize ${
                        s.difficulty === "beginner" ? "text-green-400"
                        : s.difficulty === "advanced" ? "text-red-400"
                        : s.difficulty === "extreme" ? "text-rose-400"
                        : "text-amber-400"
                      }`}>
                        {DIFFICULTY_LABELS[s.difficulty] ?? s.difficulty}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {(s.target_objections as string[]).map((t) => (
                      <span key={t} className="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full capitalize">{t}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
