"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AudioRecorder } from "@/components/ui/audio-recorder";

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
  const router = useRouter();

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

    await fetch(`/api/calls/${callId}/notes`, {
      method: "POST",
      body: formData,
    });

    setContent("");
    setAnchorTime(false);
    setAudioBlob(null);
    setAudioDuration(0);
    setSaving(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={audioBlob ? "Add a note to go with the audio (optional)..." : "Add a coaching note..."}
        rows={3}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-colors resize-none"
      />

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
