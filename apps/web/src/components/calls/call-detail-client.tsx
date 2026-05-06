"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AudioPlayer, seekAudio } from "./audio-player";
import { CoachingNotesForm } from "./coaching-notes-form";
import { OutcomeSelector } from "./outcome-selector";
import { ShareButton } from "./share-button";
import { AudioPlayback } from "@/components/ui/audio-recorder";
import { GRADE_COLORS, GRADE_LABELS } from "@flex/shared";
import type { TranscriptUtterance } from "@flex/shared";

interface HelpRequestResponseItem {
  readonly id: string;
  readonly authorName: string;
  readonly content: string;
  readonly audioUrl: string | null;
  readonly createdAt: string;
}

interface HelpRequestItem {
  readonly id: string;
  readonly repName: string;
  readonly status: string;
  readonly transcriptExcerpt: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly message: string | null;
  readonly createdAt: string;
  readonly responses: readonly HelpRequestResponseItem[];
}

interface CallDetailClientProps {
  call: {
    id: string;
    repId: string;
    customerName: string | null;
    repName: string;
    durationSeconds: number;
    recordedAt: string;
    status: string;
    audioUrl: string | null;
    outcome: string | null;
  };
  analysis: {
    overallScore: number;
    overallGrade: string;
    summary: string;
    strengths: string[];
    improvements: string[];
    talkRatioRep: number;
    talkRatioCustomer: number;
  } | null;
  sections: Array<{
    id: string;
    sectionType: string;
    startMs: number;
    endMs: number;
    summary: string;
    grade: string;
    orderIndex: number;
  }>;
  objections: Array<{
    id: string;
    category: string;
    utteranceText: string;
    repResponse: string;
    handlingGrade: string;
    suggestion: string;
    startMs: number;
  }>;
  notes: Array<{
    id: string;
    content: string;
    timestampMs: number | null;
    createdAt: string;
    authorName: string;
    audioUrl?: string | null;
    audioDurationSeconds?: number | null;
  }>;
  utterances: TranscriptUtterance[];
  helpRequests: HelpRequestItem[];
  viewer: {
    id: string;
    role: string;
  };
}

export function CallDetailClient({
  call,
  analysis,
  sections,
  objections,
  notes,
  utterances,
  helpRequests,
  viewer,
}: CallDetailClientProps) {
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeHelpRequestId, setActiveHelpRequestId] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [activeNoteTargetMs, setActiveNoteTargetMs] = useState<number | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [userScrolledAway, setUserScrolledAway] = useState(false);
  const isAutoScrolling = useRef(false);
  const lastScrolledUtteranceIdx = useRef(-1);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const isOwnCall = viewer.id === call.repId;
  const canCoach = viewer.role === "manager" || !isOwnCall;
  const notesByUtteranceIndex = useMemo(
    () => mapNotesToUtterances(utterances, notes),
    [utterances, notes]
  );

  // Auto-navigate to help request from query param (e.g. coming from help requests queue)
  useEffect(() => {
    const hrId = searchParams.get("helpRequest");
    if (!hrId) return;
    const hr = helpRequests.find((h) => h.id === hrId);
    if (!hr) return;

    // Small delay to let the DOM render
    const timer = setTimeout(() => {
      setActiveHelpRequestId(hr.id);
      const banner = document.querySelector(`[data-help-request-id="${hr.id}"]`);
      banner?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchParams, helpRequests]);

  const handlePlayStateChange = useCallback((playing: boolean) => {
    setIsPlaying(playing);
    if (playing) {
      // Re-enable auto-follow when playback starts
      setAutoFollow(true);
      setUserScrolledAway(false);
    }
  }, []);

  // Detect manual scroll (wheel or touch) to disable auto-follow
  useEffect(() => {
    function handleManualScroll() {
      if (isAutoScrolling.current) return;
      if (isPlaying && autoFollow) {
        setAutoFollow(false);
        setUserScrolledAway(true);
      }
    }
    window.addEventListener("wheel", handleManualScroll, { passive: true });
    window.addEventListener("touchmove", handleManualScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", handleManualScroll);
      window.removeEventListener("touchmove", handleManualScroll);
    };
  }, [isPlaying, autoFollow]);

  // Auto-scroll transcript to current utterance during playback
  useEffect(() => {
    if (!isPlaying || !autoFollow) return;

    const currentIdx = utterances.findIndex((u, i, arr) => {
      const next = arr[i + 1];
      return currentTimeMs >= u.startMs && (!next || currentTimeMs < next.startMs);
    });

    if (currentIdx < 0 || currentIdx === lastScrolledUtteranceIdx.current) return;
    lastScrolledUtteranceIdx.current = currentIdx;

    const el = document.querySelector(`[data-start-ms="${utterances[currentIdx].startMs}"]`);
    if (el) {
      isAutoScrolling.current = true;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => { isAutoScrolling.current = false; }, 500);
    }
  }, [currentTimeMs, isPlaying, autoFollow, utterances]);

  const handleSnapBack = useCallback(() => {
    setAutoFollow(true);
    setUserScrolledAway(false);
    lastScrolledUtteranceIdx.current = -1; // force re-scroll
  }, []);

  function getHelpRequestForUtterance(startMs: number, endMs: number): HelpRequestItem | undefined {
    return helpRequests.find(
      (hr) => startMs < hr.endMs && endMs > hr.startMs
    );
  }

  function scrollToHelpRequest(hr: HelpRequestItem) {
    setActiveHelpRequestId(hr.id);
    jumpTo(hr.startMs);
  }

  function scrollToTranscriptNote(note: CallDetailClientProps["notes"][number]) {
    if (note.timestampMs == null) return;
    setActiveNoteId(note.id);
    jumpTo(note.timestampMs);
    window.setTimeout(() => {
      const el = document.querySelector(`[data-transcript-note-id="${note.id}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);
  }

  const handleTimeUpdate = useCallback((timeMs: number) => {
    setCurrentTimeMs(timeMs);
  }, []);

  const handleSeek = useCallback((timeMs: number) => {
    setCurrentTimeMs(timeMs);
  }, []);

  function jumpTo(timeMs: number) {
    // Manual jump pauses auto-follow so it doesn't fight the user
    if (isPlaying) {
      setAutoFollow(false);
      setUserScrolledAway(true);
    }
    lastScrolledUtteranceIdx.current = -1;
    seekAudio(timeMs);
    // Scroll transcript to the matching utterance
    isAutoScrolling.current = true;
    const el = document.querySelector(`[data-start-ms="${findClosestUtterance(timeMs)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => { isAutoScrolling.current = false; }, 500);
  }

  function findClosestUtterance(timeMs: number): number {
    let closest = 0;
    let minDiff = Infinity;
    for (const u of utterances) {
      const diff = Math.abs(u.startMs - timeMs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = u.startMs;
      }
    }
    return closest;
  }

  return (
    <>
    <div className={`space-y-6 max-w-6xl ${call.audioUrl ? "pb-24" : ""}`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-zinc-500 mb-1">
            {new Date(call.recordedAt).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
          <h1 className="text-2xl font-bold text-white">
            {call.customerName ?? "Unknown Customer"}
          </h1>
          <p className="text-zinc-400 mt-1">
            Rep: {call.repName} &middot; {formatDuration(call.durationSeconds)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ShareButton callId={call.id} />
          {analysis && (
          <div className="text-right">
            <div
              className="text-4xl font-bold"
              style={{ color: GRADE_COLORS[analysis.overallGrade] ?? "#a1a1aa" }}
            >
              {analysis.overallScore}
            </div>
            <div
              className="text-sm font-medium"
              style={{ color: GRADE_COLORS[analysis.overallGrade] ?? "#a1a1aa" }}
            >
              {GRADE_LABELS[analysis.overallGrade] ?? analysis.overallGrade}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Outcome */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-4">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-sm font-medium text-zinc-400">Conversation Outcome</h3>
        </div>
        <OutcomeSelector callId={call.id} currentOutcome={call.outcome} />
      </div>

      {/* AI Summary */}
      {analysis && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">AI Summary</h2>
          <p className="text-zinc-300 leading-relaxed">{analysis.summary}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-sky-400">Strengths</h3>
              <ul className="space-y-1">
                {analysis.strengths.map((s, i) => (
                  <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                    <span className="text-sky-400 mt-0.5">+</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-amber-400">Areas to Improve</h3>
              <ul className="space-y-1">
                {analysis.improvements.map((s, i) => (
                  <li
                    key={i}
                    className="text-sm text-zinc-300 flex items-start gap-2 cursor-pointer hover:text-white transition-colors group"
                    onClick={() => {
                      // Try to find matching utterance for this improvement
                      const match = utterances.find((u) =>
                        u.text.toLowerCase().includes(s.toLowerCase().slice(0, 20))
                      );
                      if (match) jumpTo(match.startMs);
                    }}
                  >
                    <span className="text-amber-400 mt-0.5">-</span>
                    <span className="group-hover:underline">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Talk ratio bar */}
          <div className="pt-2">
            <p className="text-xs text-zinc-500 mb-2">Talk Ratio</p>
            <div className="flex h-3 rounded-full overflow-hidden bg-zinc-800">
              <div
                className="bg-sky-500 transition-all"
                style={{ width: `${(analysis.talkRatioRep * 100).toFixed(0)}%` }}
              />
              <div
                className="bg-blue-500 transition-all"
                style={{ width: `${(analysis.talkRatioCustomer * 100).toFixed(0)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-zinc-500">
              <span>Rep {(analysis.talkRatioRep * 100).toFixed(0)}%</span>
              <span>Customer {(analysis.talkRatioCustomer * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Transcript + Sections */}
        <div className="lg:col-span-2 space-y-4">
          {/* Sections */}
          {sections.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-3">
              <h2 className="text-lg font-semibold text-white">Conversation Sections</h2>
              <div className="space-y-2">
                {sections
                  .sort((a, b) => a.orderIndex - b.orderIndex)
                  .map((section) => (
                    <button
                      key={section.id}
                      onClick={() => jumpTo(section.startMs)}
                      className="w-full flex items-start gap-3 rounded-lg border border-zinc-800 px-4 py-3 text-left hover:border-zinc-700 hover:bg-zinc-800/30 transition-colors group"
                    >
                      <div
                        className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: GRADE_COLORS[section.grade] ?? "#a1a1aa" }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-200 capitalize group-hover:text-white">
                            {section.sectionType.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-zinc-600 font-mono">
                            {formatMs(section.startMs)}
                          </span>
                        </div>
                        <p className="text-sm text-zinc-400 mt-0.5">{section.summary}</p>
                      </div>
                      <span
                        className="text-xs font-medium shrink-0"
                        style={{ color: GRADE_COLORS[section.grade] ?? "#a1a1aa" }}
                      >
                        {GRADE_LABELS[section.grade] ?? section.grade}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Transcript */}
          <div
            ref={transcriptRef}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-3"
          >
            <h2 className="text-lg font-semibold text-white">Transcript</h2>
            {utterances.length === 0 ? (
              <p className="text-sm text-zinc-500">
                {call.status === "completed"
                  ? "No transcript available"
                  : "Transcript will appear once processing completes"}
              </p>
            ) : (
              <div className="space-y-2">
                {utterances.map((u, i) => {
                  const isActive =
                    currentTimeMs >= u.startMs && currentTimeMs < u.endMs;
                  const matchedHr = getHelpRequestForUtterance(u.startMs, u.endMs);
                  const isHelpRequestStart = matchedHr && (
                    i === 0 || !getHelpRequestForUtterance(utterances[i - 1].startMs, utterances[i - 1].endMs)
                    || getHelpRequestForUtterance(utterances[i - 1].startMs, utterances[i - 1].endMs)?.id !== matchedHr.id
                  );

                  return (
                    <div key={i}>
                      {/* Help request banner — shown once at the start of the range */}
                      {isHelpRequestStart && matchedHr && (
                        <button
                          data-help-request-id={matchedHr.id}
                          onClick={() => {
                            setActiveHelpRequestId(matchedHr.id);
                            const el = document.querySelector(`[data-sidebar-hr="${matchedHr.id}"]`);
                            el?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }}
                          className="w-full flex items-center gap-2 rounded-lg bg-amber-500/8 border border-amber-500/20 px-3 py-2 mb-1 text-left hover:bg-amber-500/15 transition-colors"
                        >
                          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                              <circle cx="12" cy="12" r="10" />
                              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                              <line x1="12" y1="17" x2="12.01" y2="17" />
                            </svg>
                          </span>
                          <span className="text-xs font-medium text-amber-400">
                            {matchedHr.repName} requested help
                          </span>
                          <span className="text-xs text-zinc-500 ml-auto">
                            {matchedHr.status === "pending" ? "Pending" : matchedHr.status === "responded" ? "Responded" : "Resolved"}
                          </span>
                        </button>
                      )}

                      <button
                        data-start-ms={u.startMs}
                        data-utterance-active={isActive}
                        onClick={() => {
                          setActiveNoteTargetMs(u.startMs);
                          jumpTo(u.startMs);
                        }}
                        className={`w-full flex gap-3 text-left rounded-lg px-3 py-2 transition-colors ${
                          matchedHr
                            ? activeHelpRequestId === matchedHr.id
                              ? "bg-amber-500/10 border border-amber-500/30"
                              : "bg-amber-500/5 border border-amber-500/10 hover:bg-amber-500/10"
                            : isActive
                              ? "bg-sky-500/10 border border-sky-500/20"
                              : "hover:bg-zinc-800/30 border border-transparent"
                        }`}
                      >
                        <div className="shrink-0 mt-0.5">
                          <span
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium ${
                              u.speaker === "rep"
                                ? "bg-sky-500/10 text-sky-400"
                                : "bg-violet-500/10 text-violet-400"
                            }`}
                          >
                            {u.speaker === "rep" ? "R" : "C"}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span
                              className={`text-xs font-medium ${
                                u.speaker === "rep" ? "text-sky-400" : "text-violet-400"
                              }`}
                            >
                              {u.speaker === "rep" ? "Rep" : "Customer"}
                            </span>
                            <span className="text-xs text-zinc-600 font-mono">
                              {formatMs(u.startMs)}
                            </span>
                            {matchedHr && isHelpRequestStart && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                                Help requested
                              </span>
                            )}
                          </div>
                          <p
                            className={`text-sm leading-relaxed ${
                              isActive ? "text-white" : "text-zinc-300"
                            }`}
                          >
                            {u.text}
                          </p>
                        </div>
                      </button>

                      {(notesByUtteranceIndex.get(i)?.length ?? 0) > 0 && (
                        <div className="ml-10 mt-1 space-y-1.5">
                          {notesByUtteranceIndex.get(i)!.map((note) => (
                            <div
                              key={note.id}
                              data-transcript-note-id={note.id}
                              className={`rounded-lg border px-3 py-2 transition-colors ${
                                activeNoteId === note.id
                                  ? "border-sky-500/50 bg-sky-500/10"
                                  : "border-sky-500/20 bg-sky-500/5"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-medium text-sky-400">
                                  {note.authorName}
                                </span>
                                {note.timestampMs != null && (
                                  <span className="text-[10px] text-sky-400/80 font-mono">
                                    @ {formatMs(note.timestampMs)}
                                  </span>
                                )}
                              </div>
                              {note.content !== "Audio note" && (
                                <p className="mt-1 text-sm text-zinc-200">{note.content}</p>
                              )}
                              {note.audioUrl && (
                                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                                  <AudioPlayback
                                    url={note.audioUrl}
                                    durationSeconds={note.audioDurationSeconds ?? undefined}
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {canCoach && activeNoteTargetMs === u.startMs && (
                        <div className="ml-10 mt-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-zinc-300">
                              Coaching note for {formatMs(u.startMs)}
                            </span>
                            <button
                              type="button"
                              onClick={() => setActiveNoteTargetMs(null)}
                              className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
                            >
                              Close
                            </button>
                          </div>
                          <CoachingNotesForm
                            callId={call.id}
                            currentTimeMs={u.startMs}
                            autoFocus
                            defaultPinned
                            lockAnchor
                            placeholder="Leave coaching for this exact moment..."
                            submitLabel="Add Here"
                            onSaved={() => setActiveNoteTargetMs(null)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Objections */}
          {objections.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
              <h2 className="text-base font-semibold text-white">
                Objections ({objections.length})
              </h2>
              <div className="space-y-3">
                {objections.map((obj) => (
                  <button
                    key={obj.id}
                    onClick={() => jumpTo(obj.startMs)}
                    className="w-full rounded-lg border border-zinc-800 p-3 space-y-2 text-left hover:border-zinc-700 hover:bg-zinc-800/20 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-zinc-400 capitalize">
                        {obj.category}
                      </span>
                      <span
                        className="text-xs font-medium"
                        style={{ color: GRADE_COLORS[obj.handlingGrade] ?? "#a1a1aa" }}
                      >
                        {GRADE_LABELS[obj.handlingGrade] ?? obj.handlingGrade}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-300 italic">
                      &ldquo;{obj.utteranceText}&rdquo;
                    </p>
                    <p className="text-sm text-zinc-400">
                      <span className="text-zinc-500">Response:</span> {obj.repResponse}
                    </p>
                    <div className="rounded-md bg-amber-500/5 border border-amber-500/10 px-3 py-2">
                      <p className="text-xs text-amber-400">
                        <span className="font-medium">Suggestion:</span> {obj.suggestion}
                      </p>
                    </div>
                    <p className="text-xs text-zinc-600 font-mono">
                      Jump to {formatMs(obj.startMs)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Coaching — unified timeline of help requests + notes */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Coaching</h2>
              {helpRequests.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                  {helpRequests.filter((hr) => hr.status === "pending").length} pending
                </span>
              )}
            </div>

            <CoachingNotesForm callId={call.id} currentTimeMs={currentTimeMs} />

            {(notes.length > 0 || helpRequests.length > 0) && (
              <div className="space-y-2 pt-2 border-t border-zinc-800">
                {buildCoachingTimeline(helpRequests, notes).map((item) =>
                  item.kind === "help-request" ? (
                    <div
                      key={`hr-${item.data.id}`}
                      data-sidebar-hr={item.data.id}
                      className={`rounded-lg border p-3 space-y-2 transition-colors ${
                        activeHelpRequestId === item.data.id
                          ? "border-amber-500/40 bg-amber-500/10"
                          : "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10"
                      }`}
                    >
                      <button
                        onClick={() => scrollToHelpRequest(item.data)}
                        className="w-full text-left"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 shrink-0">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                          </svg>
                          <span className="text-xs font-medium text-amber-400 truncate">
                            {item.data.repName}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${
                              item.data.status === "pending"
                                ? "bg-amber-500/15 text-amber-400"
                                : item.data.status === "responded"
                                  ? "bg-sky-500/15 text-sky-400"
                                  : "bg-green-500/15 text-green-400"
                            }`}
                          >
                            {item.data.status}
                          </span>
                          <span className="text-[10px] text-zinc-600 font-mono shrink-0 ml-auto">
                            {formatMs(item.data.startMs)}
                          </span>
                        </div>
                        <p className="text-sm text-zinc-300 italic line-clamp-2">
                          &ldquo;{item.data.transcriptExcerpt}&rdquo;
                        </p>
                        {item.data.message && (
                          <p className="text-xs text-zinc-400 mt-1">{item.data.message}</p>
                        )}
                      </button>

                      {/* Responses thread */}
                      {item.data.responses.length > 0 && (
                        <div className="space-y-1.5 pt-1 border-t border-amber-500/10">
                          {item.data.responses.map((resp) => (
                            <div key={resp.id} className="rounded-md bg-zinc-800/50 px-3 py-2">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-medium text-sky-400">
                                  {resp.authorName}
                                </span>
                                <span className="text-[10px] text-zinc-600">
                                  {new Date(resp.createdAt).toLocaleDateString("en-US", {
                                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                                  })}
                                </span>
                              </div>
                              <p className="text-xs text-zinc-300">{resp.content}</p>
                              {resp.audioUrl && (
                                <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                                  <AudioPlayback url={resp.audioUrl} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reply form */}
                      {item.data.status !== "resolved" && (
                        <HelpRequestReplyForm
                          callId={call.id}
                          helpRequestId={item.data.id}
                          timestampMs={item.data.startMs}
                        />
                      )}
                    </div>
                  ) : (
                    <div
                      key={`note-${item.data.id}`}
                      className={`rounded-lg border border-zinc-800 px-3 py-2.5 space-y-1 ${
                        item.data.timestampMs != null
                          ? "cursor-pointer hover:border-zinc-700 hover:bg-zinc-800/20 transition-colors"
                          : ""
                      }`}
                      onClick={() => {
                        scrollToTranscriptNote(item.data);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-500">
                          {item.data.authorName}
                        </span>
                        {item.data.timestampMs != null && (
                          <span className="text-xs text-sky-400 font-mono">
                            @ {formatMs(item.data.timestampMs)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-300">{item.data.content}</p>
                      {item.data.audioUrl && (
                        <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                          <AudioPlayback url={item.data.audioUrl} durationSeconds={item.data.audioDurationSeconds ?? undefined} />
                        </div>
                      )}
                      <p className="text-xs text-zinc-600">
                        {new Date(item.data.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Sticky bottom audio player */}
    {call.audioUrl && (
      <AudioPlayer
        audioUrl={call.audioUrl}
        currentTimeMs={currentTimeMs}
        onTimeUpdate={handleTimeUpdate}
        onSeek={handleSeek}
        onPlayStateChange={handlePlayStateChange}
      />
    )}

    {/* Snap back to conversation pill */}
    {userScrolledAway && isPlaying && (
      <button
        onClick={handleSnapBack}
        className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-sky-500/90 backdrop-blur-sm px-5 py-2.5 shadow-lg shadow-sky-500/20 hover:bg-sky-400 transition-colors animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className="text-sm font-semibold text-white">Snap back to conversation</span>
      </button>
    )}
    </>
  );
}

function mapNotesToUtterances(
  utterances: readonly TranscriptUtterance[],
  notes: readonly CallDetailClientProps["notes"][number][]
): Map<number, CallDetailClientProps["notes"][number][]> {
  const mapped = new Map<number, CallDetailClientProps["notes"][number][]>();
  if (utterances.length === 0) return mapped;

  for (const note of notes) {
    if (note.timestampMs == null) continue;
    let index = utterances.findIndex((u, i, arr) => {
      const endMs = arr[i + 1]?.startMs ?? u.endMs;
      return note.timestampMs! >= u.startMs && note.timestampMs! < endMs;
    });

    if (index < 0) {
      index = note.timestampMs < utterances[0].startMs ? 0 : utterances.length - 1;
    }

    const existing = mapped.get(index) ?? [];
    existing.push(note);
    mapped.set(index, existing);
  }

  for (const noteList of mapped.values()) {
    noteList.sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
  }

  return mapped;
}

type CoachingTimelineItem =
  | { kind: "help-request"; sortMs: number; data: HelpRequestItem }
  | { kind: "note"; sortMs: number; data: CallDetailClientProps["notes"][number] };

function buildCoachingTimeline(
  helpRequests: readonly HelpRequestItem[],
  notes: readonly CallDetailClientProps["notes"][number][]
): readonly CoachingTimelineItem[] {
  const items: CoachingTimelineItem[] = [
    ...helpRequests.map((hr) => ({
      kind: "help-request" as const,
      sortMs: hr.startMs,
      data: hr,
    })),
    ...notes.map((n) => ({
      kind: "note" as const,
      sortMs: n.timestampMs ?? Infinity,
      data: n,
    })),
  ];
  // Sort by transcript position so requests and notes interleave naturally.
  // Items without a timestamp (general notes) go to the end.
  items.sort((a, b) => a.sortMs - b.sortMs);
  return items;
}

function HelpRequestReplyForm({
  callId,
  helpRequestId,
  timestampMs,
}: {
  callId: string;
  helpRequestId: string;
  timestampMs: number;
}) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() && !audioBlob) return;
    setSaving(true);

    // Upload audio first if present
    let audioUrl: string | null = null;
    if (audioBlob) {
      const ext = audioBlob.type.includes("mp4") ? "m4a" : "webm";
      const uploadForm = new FormData();
      uploadForm.append("audio", audioBlob, `reply.${ext}`);
      const uploadRes = await fetch("/api/audio-upload", { method: "POST", body: uploadForm });
      const uploadData = await uploadRes.json();
      audioUrl = uploadData.audioUrl ?? null;
    }

    // Post the coaching response to the help request
    await fetch(`/api/mobile/help-requests/${helpRequestId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: content.trim() || (audioUrl ? "Audio response" : ""),
        audioUrl,
      }),
    });

    // Also create a coaching note pinned to the same timestamp
    const formData = new FormData();
    formData.append("content", content.trim() || (audioBlob ? "Audio note" : ""));
    formData.append("timestampMs", String(timestampMs));
    if (audioBlob) {
      formData.append("audio", audioBlob, `note.${audioBlob.type.includes("mp4") ? "m4a" : "webm"}`);
      formData.append("audioDuration", String(audioDuration));
    }
    await fetch(`/api/calls/${callId}/notes`, {
      method: "POST",
      body: formData,
    });

    setContent("");
    setAudioBlob(null);
    setAudioDuration(0);
    setSaving(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="pt-1 border-t border-zinc-800 space-y-2">
      {audioBlob && (
        <div className="flex items-center gap-2 rounded-lg bg-sky-500/5 border border-sky-500/20 px-2.5 py-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400 shrink-0">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
          <span className="text-[10px] text-sky-400 flex-1">Audio recorded ({audioDuration}s)</span>
          <button
            type="button"
            onClick={() => { setAudioBlob(null); setAudioDuration(0); }}
            className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
          >
            Remove
          </button>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={audioBlob ? "Add text (optional)..." : "Leave coaching note..."}
          className="flex-1 min-w-0 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        {!audioBlob && (
          <CompactAudioRecorder
            onRecorded={(blob, dur) => { setAudioBlob(blob); setAudioDuration(dur); }}
            disabled={saving}
          />
        )}
        <button
          type="submit"
          disabled={saving || (!content.trim() && !audioBlob)}
          className="shrink-0 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "..." : "Reply"}
        </button>
      </div>
    </form>
  );
}

/** Icon-only mic button that fits tight sidebar reply forms */
function CompactAudioRecorder({
  onRecorded,
  disabled,
}: {
  onRecorded: (blob: Blob, durationSeconds: number) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  function start() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const mp4Types = [
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4;codecs=aac",
        "audio/mp4",
        "audio/aac",
      ];
      const mp4Type = mp4Types.find((t) => MediaRecorder.isTypeSupported(t));
      const mimeType = mp4Type
        ?? (MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm");
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        onRecorded(blob, Math.round((Date.now() - startTimeRef.current) / 1000));
      };
      mediaRecorderRef.current = mr;
      startTimeRef.current = Date.now();
      mr.start(1000);
      setRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => {
        setDuration(Math.round((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    }).catch(() => {});
  }

  function stop() {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
    setDuration(0);
  }

  if (recording) {
    return (
      <button
        type="button"
        onClick={stop}
        className="shrink-0 flex items-center gap-1 rounded-lg bg-red-500/10 border border-red-500/30 px-2 py-1.5 text-[10px] font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        {duration}s
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-50 transition-colors"
      title="Record audio note"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      </svg>
    </button>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
