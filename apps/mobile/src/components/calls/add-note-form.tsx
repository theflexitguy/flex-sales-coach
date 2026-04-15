import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiPost } from "../../services/api";
import { haptic } from "../../lib/haptics";

export function AddNoteForm({ callId, currentTimeMs }: { callId: string; currentTimeMs?: number }) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [pinTime, setPinTime] = useState(false);
  const [success, setSuccess] = useState(false);

  async function submit() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await apiPost(`/api/mobile/calls/${callId}/notes`, {
        content: content.trim(),
        timestampMs: pinTime && currentTimeMs ? Math.round(currentTimeMs) : null,
      });
      setContent("");
      setPinTime(false);
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
        placeholder="Add a coaching note..."
        placeholderTextColor="#52525b"
        multiline
        numberOfLines={2}
      />
      <View style={styles.row}>
        {currentTimeMs != null && (
          <TouchableOpacity onPress={() => setPinTime(!pinTime)} style={styles.pinButton}>
            <Ionicons name={pinTime ? "location" : "location-outline"} size={14} color={pinTime ? "#35b2ff" : "#52525b"} />
            <Text style={[styles.pinText, pinTime && { color: "#35b2ff" }]}>
              {formatMs(currentTimeMs)}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.sendButton, saving && { opacity: 0.5 }]} onPress={submit} disabled={saving || !content.trim()}>
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
  pinButton: { flexDirection: "row", alignItems: "center", gap: 4 },
  pinText: { color: "#52525b", fontSize: 12 },
  sendButton: { backgroundColor: "#35b2ff", borderRadius: 8, padding: 8, width: 36, alignItems: "center" },
});
