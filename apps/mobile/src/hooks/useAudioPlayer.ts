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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!source) {
      setReady(false);
      return;
    }

    // Native Expo Go binary expects 3 args: (source, updateInterval, keepAudioSessionActive)
    const p = new (AudioModule.AudioPlayer as unknown as new (
      s: { uri: string } | null,
      interval: number,
      keep: boolean
    ) => Player)(source, 500, false);

    playerRef.current = p;
    setReady(true);

    return () => {
      try {
        p.pause();
        p.remove();
      } catch { /* ignore */ }
      playerRef.current = null;
      setReady(false);
    };
  }, [source]);

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
    const p = playerRef.current;
    if (!p || !ready) return;
    const sub = p.addListener("playbackStatusUpdate", (s: AudioStatus) => {
      setStatus(s);
    });
    return () => sub.remove();
  }, [ready]);

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

  // All callbacks read from playerRef.current at call time, not capture time
  const play = useCallback(() => {
    playerRef.current?.play();
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) p.pause();
    else p.play();
  }, []);

  const seekTo = useCallback((ms: number) => {
    playerRef.current?.seekTo(ms / 1000);
  }, []);

  const skip = useCallback(
    (seconds: number) => {
      const newPos = Math.max(0, Math.min(positionMs + seconds * 1000, durationMs));
      playerRef.current?.seekTo(newPos / 1000);
    },
    [positionMs, durationMs]
  );

  const setPlaybackRate = useCallback((newRate: number) => {
    setRate(newRate);
    playerRef.current?.setPlaybackRate(newRate);
  }, []);

  const cycleRate = useCallback(() => {
    const rates = [1, 1.25, 1.5, 1.75, 2];
    const idx = rates.indexOf(rate);
    const next = rates[(idx + 1) % rates.length];
    setRate(next);
    playerRef.current?.setPlaybackRate(next);
  }, [rate]);

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
