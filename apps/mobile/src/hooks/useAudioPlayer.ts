import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { AudioModule, setAudioModeAsync } from "expo-audio";
import type { AudioStatus } from "expo-audio";

type Player = InstanceType<typeof AudioModule.AudioPlayer>;

export function useAudioPlayer(audioUrl: string | null) {
  const source = useMemo(
    () => (audioUrl ? { uri: audioUrl } : null),
    [audioUrl]
  );

  const playerRef = useRef<Player | null>(null);

  useEffect(() => {
    if (!source) return;

    // Native Expo Go binary expects 3 args: (source, updateInterval, keepAudioSessionActive)
    const p = new (AudioModule.AudioPlayer as unknown as new (
      s: { uri: string } | null,
      interval: number,
      keep: boolean
    ) => Player)(source, 500, false);

    playerRef.current = p;

    return () => {
      try { p.remove(); } catch { /* ignore */ }
      playerRef.current = null;
    };
  }, [source]);

  const player = playerRef.current;

  const [status, setStatus] = useState<AudioStatus>({
    id: 0,
    currentTime: 0,
    duration: 0,
    playing: false,
    mute: false,
    loop: false,
    isLoaded: false,
    isBuffering: false,
    playbackRate: 1,
    playbackState: "",
    timeControlStatus: "",
    reasonForWaitingToPlay: "",
    didJustFinish: false,
    shouldCorrectPitch: false,
  });

  useEffect(() => {
    if (!player) return;
    const sub = player.addListener("playbackStatusUpdate", (s: AudioStatus) => {
      setStatus(s);
    });
    return () => sub.remove();
  }, [player]);

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
    if (!audioUrl || !player) return;
    player.play();
  }, [player, audioUrl]);

  const pause = useCallback(() => {
    player?.pause();
  }, [player]);

  const togglePlay = useCallback(() => {
    if (!audioUrl || !player) return;
    if (isPlaying) player.pause();
    else player.play();
  }, [isPlaying, player, audioUrl]);

  const seekTo = useCallback(
    (ms: number) => {
      player?.seekTo(ms / 1000);
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
      player?.setPlaybackRate(newRate);
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
