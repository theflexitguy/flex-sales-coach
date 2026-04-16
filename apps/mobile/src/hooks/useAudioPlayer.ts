import { useState, useCallback, useEffect, useRef } from "react";
import {
  useAudioPlayer as useExpoAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
} from "expo-audio";
import type { AudioStatus } from "expo-audio";

export function useAudioPlayer(audioUrl: string | null) {
  const player = useExpoAudioPlayer(audioUrl ? { uri: audioUrl } : undefined);
  const status = useAudioPlayerStatus(player);

  const [rate, setRate] = useState(1);
  const hasSetMode = useRef(false);

  useEffect(() => {
    if (!hasSetMode.current && audioUrl) {
      hasSetMode.current = true;
      setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    }
  }, [audioUrl]);

  const positionMs = (status.currentTime ?? 0) * 1000;
  const durationMs = (status.duration ?? 0) * 1000;
  const isPlaying = status.playing ?? false;

  const play = useCallback(() => {
    if (!audioUrl) return;
    player.play();
  }, [player, audioUrl]);

  const pause = useCallback(() => {
    player.pause();
  }, [player]);

  const togglePlay = useCallback(() => {
    if (!audioUrl) return;
    if (isPlaying) player.pause();
    else player.play();
  }, [isPlaying, player, audioUrl]);

  const seekTo = useCallback(
    (ms: number) => {
      player.seekTo(ms / 1000);
    },
    [player]
  );

  const skip = useCallback(
    (seconds: number) => {
      const newPos = Math.max(0, Math.min(positionMs + seconds * 1000, durationMs));
      seekTo(newPos);
    },
    [positionMs, durationMs, seekTo]
  );

  const setPlaybackRate = useCallback(
    (newRate: number) => {
      setRate(newRate);
      player.setPlaybackRate(newRate);
    },
    [player]
  );

  const cycleRate = useCallback(() => {
    const rates = [1, 1.25, 1.5, 1.75, 2];
    const idx = rates.indexOf(rate);
    const next = rates[(idx + 1) % rates.length];
    setPlaybackRate(next);
  }, [rate, setPlaybackRate]);

  return {
    isPlaying,
    positionMs,
    durationMs,
    rate,
    play,
    pause,
    togglePlay,
    seekTo,
    skip,
    cycleRate,
  };
}
