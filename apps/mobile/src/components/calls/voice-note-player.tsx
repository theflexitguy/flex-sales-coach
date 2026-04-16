import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AudioModule, setAudioModeAsync } from "expo-audio";
import type { AudioStatus } from "expo-audio";

type Player = InstanceType<typeof AudioModule.AudioPlayer>;

interface VoiceNotePlayerProps {
  audioUrl: string;
  authorName: string;
}

export function VoiceNotePlayer({ audioUrl, authorName }: VoiceNotePlayerProps) {
  const playerRef = useRef<Player | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionS, setPositionS] = useState(0);
  const [durationS, setDurationS] = useState(0);

  useEffect(() => {
    const p = new (AudioModule.AudioPlayer as unknown as new (
      s: { uri: string },
      interval: number,
      keep: boolean
    ) => Player)({ uri: audioUrl }, 250, false);

    playerRef.current = p;

    const sub = p.addListener("playbackStatusUpdate", (s: AudioStatus) => {
      setPlaying(s.playing ?? false);
      setPositionS(s.currentTime ?? 0);
      setDurationS(s.duration ?? 0);
      if (s.didJustFinish) {
        p.seekTo(0);
      }
    });

    return () => {
      sub.remove();
      try { p.pause(); p.remove(); } catch { /* ignore */ }
      playerRef.current = null;
    };
  }, [audioUrl]);

  const togglePlay = useCallback(async () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) {
      p.pause();
    } else {
      // Ensure audio mode is set for playback (recording may have changed it)
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      p.play();
    }
  }, []);

  const fmt = (s: number) => {
    const sec = Math.floor(s);
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
  };

  const progress = durationS > 0 ? positionS / durationS : 0;

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={togglePlay} style={styles.playBtn}>
        <Ionicons name={playing ? "pause" : "play"} size={14} color="#fff" />
      </TouchableOpacity>
      <View style={styles.trackArea}>
        <View style={styles.trackBg}>
          <View style={[styles.trackFill, { width: `${(progress * 100).toFixed(0)}%` as `${number}%` }]} />
        </View>
        <View style={styles.meta}>
          <Text style={styles.author}>{authorName}</Text>
          <Text style={styles.time}>
            {fmt(positionS)}{durationS > 0 ? ` / ${fmt(durationS)}` : ""}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(53,178,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(53,178,255,0.15)",
    borderRadius: 10,
    padding: 10,
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#35b2ff",
    justifyContent: "center",
    alignItems: "center",
  },
  trackArea: {
    flex: 1,
    gap: 6,
  },
  trackBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(53,178,255,0.15)",
    overflow: "hidden",
  },
  trackFill: {
    height: "100%",
    backgroundColor: "#35b2ff",
    borderRadius: 2,
  },
  meta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  author: {
    color: "#35b2ff",
    fontSize: 12,
    fontWeight: "600",
  },
  time: {
    color: "#52525b",
    fontSize: 11,
    fontFamily: "monospace",
  },
});
