"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AudioRecorder } from "@/components/ui/audio-recorder";

interface TeamMember {
  id: string;
  fullName: string;
  role: string;
}

interface CoachingNotesFormProps {
  callId: string;
  currentTimeMs: number;
}

export function CoachingNotesForm({ callId, currentTimeMs }: CoachingNotesFormProps) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [anchorTime, setAnchorTime] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [mentionIds, setMentionIds] = useState<Set<string>>(new Set());
  const [mentionNames, setMentionNames] = useState<Map<string, string>>(new Map());
  const [showMentions, setShowMentions] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [mentionEveryone, setMentionEveryone] = useState(false);
  const mentionRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close mention dropdown on outside click
  useEffect(() => {
    if (!showMentions) return;
    function handleClick(e: MouseEvent) {
      if (mentionRef.current && !mentionRef.current.contains(e.target as Node)) {
        setShowMentions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMentions]);

  async function openMentionPicker() {
    if (teamMembers.length === 0) {
      const res = await fetch("/api/mobile/team-members");
      const data = await res.json();
      setTeamMembers(data.members ?? []);
    }
    setShowMentions(true);
  }

  function toggleMention(id: string, name: string) {
    setMentionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMentionNames((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });
    if (mentionEveryone) setMentionEveryone(false);
  }

  function toggleEveryone() {
    setMentionEveryone(!mentionEveryone);
    if (!mentionEveryone) {
      setMentionIds(new Set());
      setMentionNames(new Map());
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() && !audioBlob) return;

    setSaving(true);

    const formData = new FormData();
    formData.append("content", content.trim());
    if (anchorTime) formData.append("timestampMs", String(Math.round(currentTimeMs)));
    if (audioBlob) {
      formData.append("audio", audioBlob, "note.webm");
      formData.append("audioDuration", String(audioDuration));
    }
    if (mentionEveryone) {
      formData.append("mentionIds", "everyone");
    } else if (mentionIds.size > 0) {
      formData.append("mentionIds", [...mentionIds].join(","));
    }

    await fetch(`/api/calls/${callId}/notes`, {
      method: "POST",
      body: formData,
    });

    setContent("");
    setAnchorTime(false);
    setAudioBlob(null);
    setAudioDuration(0);
    setMentionIds(new Set());
    setMentionNames(new Map());
    setMentionEveryone(false);
    setSaving(false);
    router.refresh();
  }

  const hasMentions = mentionEveryone || mentionIds.size > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={audioBlob ? "Add a note to go with the audio (optional)..." : "Add a coaching note..."}
        rows={3}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-colors resize-none"
      />

      {/* Mention tags */}
      {hasMentions && (
        <div className="flex flex-wrap gap-1.5">
          {mentionEveryone ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-400">
              @everyone
              <button type="button" onClick={() => setMentionEveryone(false)} className="hover:text-red-400 transition-colors">&times;</button>
            </span>
          ) : (
            [...mentionNames.entries()].map(([id, name]) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-400">
                @{name}
                <button type="button" onClick={() => toggleMention(id, name)} className="hover:text-red-400 transition-colors">&times;</button>
              </span>
            ))
          )}
          <span className="text-[10px] text-zinc-600 self-center">will be notified &amp; can view this call</span>
        </div>
      )}

      {audioBlob && (
        <div className="flex items-center gap-2 rounded-lg bg-sky-500/5 border border-sky-500/20 px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
          <span className="text-xs text-sky-400 flex-1">Audio recorded ({audioDuration}s)</span>
          <button
            type="button"
            onClick={() => { setAudioBlob(null); setAudioDuration(0); }}
            className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
          >
            Remove
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={anchorTime}
              onChange={(e) => setAnchorTime(e.target.checked)}
              className="rounded border-zinc-600 bg-zinc-800 text-sky-500 focus:ring-sky-500 focus:ring-offset-0"
            />
            <span className="text-xs text-zinc-400">
              Pin to {formatMs(currentTimeMs)}
            </span>
          </label>

          {!audioBlob && (
            <AudioRecorder
              onRecorded={(blob, dur) => { setAudioBlob(blob); setAudioDuration(dur); }}
              disabled={saving}
            />
          )}

          {/* @mention button */}
          <div className="relative" ref={mentionRef}>
            <button
              type="button"
              onClick={openMentionPicker}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                hasMentions
                  ? "border-sky-500/30 text-sky-400 bg-sky-500/10"
                  : "border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500"
              }`}
            >
              @
            </button>

            {showMentions && (
              <div className="absolute bottom-full left-0 mb-2 w-56 rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl z-50">
                <button
                  type="button"
                  onClick={() => { toggleEveryone(); setShowMentions(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                    mentionEveryone ? "bg-sky-500/10 text-sky-400" : "text-zinc-400 hover:bg-zinc-800/50"
                  }`}
                >
                  <span className="font-semibold">@everyone</span>
                  <span className="text-zinc-600 text-[10px]">entire team</span>
                </button>
                <div className="border-t border-zinc-800 max-h-36 overflow-y-auto">
                  {teamMembers.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMention(m.id, m.fullName)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                        mentionIds.has(m.id) ? "bg-sky-500/10 text-sky-400" : "text-zinc-300 hover:bg-zinc-800/50"
                      }`}
                    >
                      <span className="flex-1">{m.fullName}</span>
                      <span className="text-[10px] text-zinc-600 capitalize">{m.role}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={saving || (!content.trim() && !audioBlob)}
          className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving..." : "Add Note"}
        </button>
      </div>
    </form>
  );
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
