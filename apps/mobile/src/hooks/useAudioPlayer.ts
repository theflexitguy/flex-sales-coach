import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { AudioModule, setAudioModeAsync } from "expo-audio";
import type { AudioStatus } from "expo-audio";

type Player = InstanceType<typeof AudioModule.AudioPlayer>;

interface LockScreenMetadata {
  title: string;
  artist?: string;
  albumTitle?: string;
  artworkUrl?: string;
}

type LockScreenCapablePlayer = Player & {
  setActiveForLockScreen?: (
    active: boolean,
    metadata?: LockScreenMetadata,
    options?: {
      showSeekBackward?: boolean;
      showSeekForward?: boolean;
      isLiveStream?: boolean;
    }
  ) => void;
  updateLockScreenMetadata?: (metadata: LockScreenMetadata) => void;
};

export function useAudioPlayer(audioUrl: string | null, metadata?: LockScreenMetadata) {
  const source = useMemo(
    () => (audioUrl ? { uri: audioUrl } : null),
    [audioUrl]
  );

  const playerRef = useRef<Player | null>(null);
  const metadataRef = useRef<LockScreenMetadata | undefined>(metadata);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    metadataRef.current = metadata;
    const player = playerRef.current as LockScreenCapablePlayer | null;
    if (metadata && player?.updateLockScreenMetadata) {
      try {
        player.updateLockScreenMetadata(metadata);
      } catch { /* ignore */ }
    }
  }, [metadata]);

  useEffect(() => {
    if (!source) {
      setReady(false);
      return;
    }

    const p = new AudioModule.AudioPlayer(source, 500);

    playerRef.current = p;
    setReady(true);

    return () => {
      try {
        (p as LockScreenCapablePlayer).setActiveForLockScreen?.(false);
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
      setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: "doNotMix",
      }).catch(() => {});
    }
  }, [audioUrl]);

  const activateLockScreen = useCallback(() => {
    const player = playerRef.current as LockScreenCapablePlayer | null;
    if (!player?.setActiveForLockScreen) return;
    try {
      player.setActiveForLockScreen(
        true,
        metadataRef.current,
        {
          showSeekBackward: true,
          showSeekForward: true,
        }
      );
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!status.didJustFinish) return;
    try {
      (playerRef.current as LockScreenCapablePlayer | null)?.setActiveForLockScreen?.(false);
    } catch { /* ignore */ }
  }, [status.didJustFinish]);

  const positionMs = (status.currentTime ?? 0) * 1000;
  const durationMs = (status.duration ?? 0) * 1000;
  const isPlaying = status.playing ?? false;

  // All callbacks read from playerRef.current at call time, not capture time
  const play = useCallback(() => {
    activateLockScreen();
    playerRef.current?.play();
  }, [activateLockScreen]);

  const pause = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) p.pause();
    else {
      activateLockScreen();
      p.play();
    }
  }, [activateLockScreen]);

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

  const isLoaded = status.isLoaded ?? false;

  return {
    isPlaying,
    isLoaded,
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
