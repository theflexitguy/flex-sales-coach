"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface AudioRecorderProps {
  onRecorded: (blob: Blob, durationSeconds: number) => void;
  disabled?: boolean;
}

export function AudioRecorder({ onRecorded, disabled }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Prefer MP4/AAC for cross-platform compatibility (mobile can't play WebM)
      const mimeType = MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
      const mediaRecorder = new MediaRecorder(stream, { mimeType });

      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        onRecorded(blob, elapsed);
      };

      mediaRecorderRef.current = mediaRecorder;
      startTimeRef.current = Date.now();
      mediaRecorder.start(1000);
      setRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration(Math.round((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Microphone access denied. Check your browser permissions.");
    }
  }, [onRecorded]);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    setDuration(0);
  }, []);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  if (recording) {
    return (
      <button
        type="button"
        onClick={stop}
        className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        {formatTime(duration)} — Tap to stop
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-50 transition-colors"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
      </svg>
      Audio Note
    </button>
  );
}

interface AudioPlaybackProps {
  url: string;
  durationSeconds?: number;
}

export function AudioPlayback({ url, durationSeconds }: AudioPlaybackProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animRef = useRef<number>(0);

  const setAudioRef = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el;
  }, []);

  function tick() {
    const a = audioRef.current;
    if (a && !a.paused) {
      const d = a.duration && isFinite(a.duration) ? a.duration : (duration || 1);
      setProgress(a.currentTime / d);
      setCurrentTime(a.currentTime);
      animRef.current = requestAnimationFrame(tick);
    }
  }

  const handleMetadata = () => {
    const a = audioRef.current;
    if (a?.duration && isFinite(a.duration)) setDuration(a.duration);
  };

  const handleTimeUpdate = () => {
    const a = audioRef.current;
    if (!a) return;
    // Fallback duration detection (some formats don't fire loadedmetadata reliably)
    if (duration === 0 && a.duration && isFinite(a.duration)) setDuration(a.duration);
    const d = a.duration && isFinite(a.duration) ? a.duration : (duration || 1);
    setProgress(a.currentTime / d);
    setCurrentTime(a.currentTime);
  };

  const handleEnded = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      cancelAnimationFrame(animRef.current);
      setPlaying(false);
    } else {
      try {
        await a.play();
        animRef.current = requestAnimationFrame(tick);
        setPlaying(true);
      } catch { /* ignore autoplay block */ }
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const d = a.duration && isFinite(a.duration) ? a.duration : duration;
    if (d > 0) {
      a.currentTime = pct * d;
      setProgress(pct);
      setCurrentTime(pct * d);
    }
  };

  const fmt = (s: number) => {
    const sec = Math.floor(s);
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2 rounded-lg bg-sky-500/10 border border-sky-500/20 px-2.5 py-1.5">
      {/* Hidden native audio element handles format detection and decoding */}
      <audio ref={setAudioRef} preload="metadata" src={url} onLoadedMetadata={handleMetadata} onTimeUpdate={handleTimeUpdate} onEnded={handleEnded} style={{ position: "absolute", width: 0, height: 0, opacity: 0 }} />
      <button onClick={toggle} className="shrink-0 w-6 h-6 rounded-full bg-sky-500 flex items-center justify-center hover:bg-sky-400 transition-colors">
        {playing ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="6 3 20 12 6 21 6 3" /></svg>
        )}
      </button>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="h-1 rounded-full bg-sky-500/20 cursor-pointer" onClick={handleSeek}>
          <div className="h-full rounded-full bg-sky-400 transition-[width] duration-100" style={{ width: `${(progress * 100).toFixed(0)}%` }} />
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-sky-400/70 font-mono">{fmt(currentTime)}</span>
          <span className="text-[10px] text-sky-400/70 font-mono">{duration > 0 ? fmt(duration) : "--:--"}</span>
        </div>
      </div>
    </div>
  );
}
