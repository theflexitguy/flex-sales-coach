"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface AudioPlayerProps {
  audioUrl: string;
  currentTimeMs: number;
  onTimeUpdate: (timeMs: number) => void;
  onSeek: (timeMs: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

export function AudioPlayer({
  audioUrl,
  currentTimeMs,
  onTimeUpdate,
  onSeek,
  onPlayStateChange,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      onTimeUpdate(audio.currentTime * 1000);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      onPlayStateChange?.(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
      onPlayStateChange?.(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      onPlayStateChange?.(false);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [onTimeUpdate, onPlayStateChange]);

  const seekTo = useCallback(
    (timeMs: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = timeMs / 1000;
      onSeek(timeMs);
      if (!isPlaying) {
        audio.play();
        setIsPlaying(true);
      }
    },
    [isPlaying, onSeek]
  );

  // Expose seekTo via a custom event so other components can trigger it
  useEffect(() => {
    const handler = (e: CustomEvent<{ timeMs: number }>) => {
      seekTo(e.detail.timeMs);
    };
    window.addEventListener("audio-seek" as string, handler as EventListener);
    return () =>
      window.removeEventListener("audio-seek" as string, handler as EventListener);
  }, [seekTo]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  }

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const timeMs = pct * duration * 1000;
    seekTo(timeMs);
  }

  function cycleSpeed() {
    const speeds = [1, 1.25, 1.5, 1.75, 2];
    const idx = speeds.indexOf(playbackRate);
    const next = speeds[(idx + 1) % speeds.length];
    setPlaybackRate(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  }

  function skip(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + seconds, duration));
  }

  const progressPct = duration > 0 ? (currentTimeMs / 1000 / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-zinc-900/95 backdrop-blur-sm px-6 py-3 space-y-2">
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* Progress bar */}
      <div
        className="h-1.5 rounded-full bg-zinc-800 cursor-pointer group"
        onClick={handleProgressClick}
      >
        <div
          className="h-full rounded-full bg-sky-500 transition-[width] duration-100 relative"
          style={{ width: `${progressPct}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Skip back 10s */}
          <button
            onClick={() => skip(-10)}
            className="p-1.5 text-zinc-400 hover:text-white transition-colors"
            title="Back 10s"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="flex items-center justify-center w-10 h-10 rounded-full bg-sky-500 text-white hover:bg-sky-400 transition-colors"
          >
            {isPlaying ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Skip forward 10s */}
          <button
            onClick={() => skip(10)}
            className="p-1.5 text-zinc-400 hover:text-white transition-colors"
            title="Forward 10s"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
            </svg>
          </button>

          {/* Speed */}
          <button
            onClick={cycleSpeed}
            className="px-2 py-1 rounded-md text-xs font-mono font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            {playbackRate}x
          </button>
        </div>

        {/* Time display */}
        <div className="text-sm text-zinc-500 font-mono">
          {formatTime(currentTimeMs / 1000)} / {formatTime(duration)}
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Dispatch from anywhere to seek the audio player */
export function seekAudio(timeMs: number) {
  window.dispatchEvent(
    new CustomEvent("audio-seek", { detail: { timeMs } })
  );
}
