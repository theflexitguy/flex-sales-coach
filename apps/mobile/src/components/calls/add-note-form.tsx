import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiPost } from "../../services/api";
import { haptic } from "../../lib/haptics";
import { VoiceNoteRecorder } from "./voice-note-recorder";

export function AddNoteForm({ callId, currentTimeMs }: { callId: string; currentTimeMs?: number }) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [pinTime, setPinTime] = useState(false);
  const [success, setSuccess] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  async function submit() {
    if (!content.trim() && !audioUrl) return;
    setSaving(true);
    try {
      await apiPost(`/api/mobile/calls/${callId}/notes`, {
        content: content.trim() || (audioUrl ? "Audio note" : ""),
        timestampMs: pinTime && currentTimeMs ? Math.round(currentTimeMs) : null,
        audioUrl,
      });
      setContent("");
      setPinTime(false);
      setAudioUrl(null);
      setSuccess(true);
      haptic.success();
      setTimeout(() => setSuccess(false), 2000);
    } catch {
      haptic.error();
      Alert.alert("Error", "Failed to save note");
    }
    setSaving(false);
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={content}
        onChangeText={setContent}
        placeholder={audioUrl ? "Add text (optional)..." : "Add a coaching note..."}
        placeholderTextColor="#52525b"
        multiline
        numberOfLines={2}
      />

      {audioUrl && (
        <View style={styles.audioAttached}>
          <Ionicons name="mic" size={14} color="#35b2ff" />
          <Text style={styles.audioAttachedText}>Audio attached</Text>
          <TouchableOpacity onPress={() => setAudioUrl(null)}>
            <Text style={styles.removeText}>Remove</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.row}>
        <View style={styles.leftActions}>
          {currentTimeMs != null && (
            <TouchableOpacity onPress={() => setPinTime(!pinTime)} style={styles.pinButton}>
              <Ionicons name={pinTime ? "location" : "location-outline"} size={14} color={pinTime ? "#35b2ff" : "#52525b"} />
              <Text style={[styles.pinText, pinTime && { color: "#35b2ff" }]}>
                {formatMs(currentTimeMs)}
              </Text>
            </TouchableOpacity>
          )}
          {!audioUrl && (
            <VoiceNoteRecorder
              storagePath={`coaching-notes/${callId}`}
              onRecorded={(url) => setAudioUrl(url)}
            />
          )}
        </View>
        <TouchableOpacity
          style={[styles.sendButton, (saving || (!content.trim() && !audioUrl)) && { opacity: 0.5 }]}
          onPress={submit}
          disabled={saving || (!content.trim() && !audioUrl)}
        >
          {success ? <Ionicons name="checkmark" size={16} color="#22c55e" /> : <Ionicons name="send" size={14} color="#fff" />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  input: { backgroundColor: "rgba(39,39,42,0.5)", borderWidth: 1, borderColor: "#27272a", borderRadius: 10, padding: 10, color: "#fff", fontSize: 14, minHeight: 50, textAlignVertical: "top" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  leftActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  pinButton: { flexDirection: "row", alignItems: "center", gap: 4 },
  pinText: { color: "#52525b", fontSize: 12 },
  sendButton: { backgroundColor: "#35b2ff", borderRadius: 8, padding: 8, width: 36, alignItems: "center" },
  audioAttached: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(53,178,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(53,178,255,0.15)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  audioAttachedText: { color: "#35b2ff", fontSize: 12, fontWeight: "500", flex: 1 },
  removeText: { color: "#71717a", fontSize: 11 },
});
