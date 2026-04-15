"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { AudioRecorder, AudioPlayback } from "@/components/ui/audio-recorder";

interface HelpRequestItem {
  id: string;
  callId: string;
  repName: string;
  callName: string;
  status: string;
  transcriptExcerpt: string;
  startMs: number;
  message: string | null;
  createdAt: string;
}

interface ResponseItem {
  id: string;
  authorName: string;
  content: string;
  audioUrl?: string | null;
  createdAt: string;
}

export function HelpRequestQueue() {
  const [requests, setRequests] = useState<HelpRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, ResponseItem[]>>({});
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyAudio, setReplyAudio] = useState<{ blob: Blob; duration: number } | null>(null);

  useEffect(() => {
    fetch("/api/mobile/help-requests")
      .then((r) => r.json())
      .then((d) => setRequests(d.requests ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!responses[id]) {
      const res = await fetch(`/api/mobile/help-requests/${id}`);
      const data = await res.json();
      setResponses((prev) => ({ ...prev, [id]: data.responses ?? [] }));
    }
  }

  async function submitReply(requestId: string) {
    if (!replyText.trim() && !replyAudio) return;
    setReplying(true);

    let audioUrl: string | null = null;
    if (replyAudio) {
      const formData = new FormData();
      formData.append("audio", replyAudio.blob, "reply.webm");
      const uploadRes = await fetch("/api/audio-upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      audioUrl = uploadData.audioUrl ?? null;
    }

    await fetch(`/api/mobile/help-requests/${requestId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: replyText.trim() || (audioUrl ? "Audio response" : ""),
        audioUrl,
      }),
    });
    const res = await fetch(`/api/mobile/help-requests/${requestId}`);
    const data = await res.json();
    setResponses((prev) => ({ ...prev, [requestId]: data.responses ?? [] }));
    setReplyText("");
    setReplyAudio(null);
    setReplying(false);
    setRequests((prev) =>
      prev.map((r) => (r.id === requestId ? { ...r, status: "responded" } : r))
    );
  }

  async function markResolved(requestId: string) {
    await fetch(`/api/mobile/help-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    setRequests((prev) =>
      prev.map((r) => (r.id === requestId ? { ...r, status: "resolved" } : r))
    );
  }

  const pending = requests.filter((r) => r.status === "pending");
  const responded = requests.filter((r) => r.status === "responded");
  const resolved = requests.filter((r) => r.status === "resolved");

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-zinc-800/50 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Help Requests</h1>
        <p className="text-zinc-400 mt-1">
          {pending.length} pending &middot; {responded.length} responded &middot; {resolved.length} resolved
        </p>
      </div>

      {requests.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-16 text-center">
          <p className="text-zinc-400">No help requests yet</p>
          <p className="text-zinc-500 text-sm mt-1">
            Reps can request help by long-pressing transcript sections on mobile
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...pending, ...responded, ...resolved].map((req) => (
            <div
              key={req.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden"
            >
              <button
                onClick={() => toggleExpand(req.id)}
                className="w-full px-6 py-4 text-left hover:bg-zinc-800/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${
                        req.status === "pending"
                          ? "bg-amber-400"
                          : req.status === "responded"
                            ? "bg-sky-400"
                            : "bg-green-400"
                      }`}
                    />
                    <span className="text-sm font-medium text-white">{req.repName}</span>
                    <span className="text-xs text-zinc-500">on</span>
                    <Link
                      href={`/calls/${req.callId}`}
                      className="text-sm text-sky-400 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {req.callName}
                    </Link>
                  </div>
                  <span className="text-xs text-zinc-500">{timeAgo(req.createdAt)}</span>
                </div>
                <p className="text-sm text-zinc-300 mt-2 italic line-clamp-2">
                  &ldquo;{req.transcriptExcerpt}&rdquo;
                </p>
                {req.message && (
                  <p className="text-sm text-zinc-400 mt-1">{req.message}</p>
                )}
              </button>

              {expandedId === req.id && (
                <div className="border-t border-zinc-800 px-6 py-4 space-y-3">
                  {/* Responses */}
                  {(responses[req.id] ?? []).map((resp) => (
                    <div key={resp.id} className="rounded-lg bg-zinc-800/50 px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-sky-400">{resp.authorName}</span>
                        <span className="text-xs text-zinc-600">{timeAgo(resp.createdAt)}</span>
                      </div>
                      <p className="text-sm text-zinc-300">{resp.content}</p>
                      {resp.audioUrl && (
                        <div className="mt-1.5">
                          <AudioPlayback url={resp.audioUrl} />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Reply form */}
                  {req.status !== "resolved" && (
                    <div className="space-y-2">
                      {replyAudio && (
                        <div className="flex items-center gap-2 rounded-lg bg-sky-500/5 border border-sky-500/20 px-3 py-2">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          </svg>
                          <span className="text-xs text-sky-400 flex-1">Audio recorded ({replyAudio.duration}s)</span>
                          <button onClick={() => setReplyAudio(null)} className="text-xs text-zinc-500 hover:text-red-400">Remove</button>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder={replyAudio ? "Add text (optional)..." : "Type your coaching response..."}
                          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              submitReply(req.id);
                            }
                          }}
                        />
                        {!replyAudio && (
                          <AudioRecorder
                            onRecorded={(blob, dur) => setReplyAudio({ blob, duration: dur })}
                            disabled={replying}
                          />
                        )}
                        <button
                          onClick={() => submitReply(req.id)}
                          disabled={replying || (!replyText.trim() && !replyAudio)}
                          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50 transition-colors"
                        >
                          Reply
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <Link
                      href={`/calls/${req.callId}?helpRequest=${req.id}`}
                      className="text-xs text-sky-400 hover:underline"
                    >
                      Open call at this moment
                    </Link>
                    {req.status !== "resolved" && (
                      <button
                        onClick={() => markResolved(req.id)}
                        className="text-xs text-green-400 hover:underline"
                      >
                        Mark resolved
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
