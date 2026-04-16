import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer } from "../../hooks/useAudioPlayer";

interface VoiceNotePlayerProps {
  audioUrl: string;
  authorName: string;
}

export function VoiceNotePlayer({ audioUrl, authorName }: VoiceNotePlayerProps) {
  const player = useAudioPlayer(audioUrl);

  const fmt = (s: number) => {
    const sec = Math.floor(s / 1000);
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
  };

  const progress = player.durationMs > 0 ? player.positionMs / player.durationMs : 0;

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={player.togglePlay} style={styles.playBtn}>
        <Ionicons name={player.isPlaying ? "pause" : "play"} size={14} color="#fff" />
      </TouchableOpacity>
      <View style={styles.trackArea}>
        <View style={styles.trackBg}>
          <View style={[styles.trackFill, { width: `${(progress * 100).toFixed(0)}%` as `${number}%` }]} />
        </View>
        <View style={styles.meta}>
          <Text style={styles.author}>{authorName}</Text>
          <Text style={styles.time}>
            {fmt(player.positionMs)}{player.durationMs > 0 ? ` / ${fmt(player.durationMs)}` : ""}
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
