import { useState, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from "expo-audio";
import { supabase } from "../../lib/supabase";
import { haptic } from "../../lib/haptics";

type Recorder = InstanceType<typeof AudioModule.AudioRecorder>;

interface VoiceNoteRecorderProps {
  onRecorded: (audioUrl: string) => void;
  storagePath: string;
}

export function VoiceNoteRecorder({ onRecorded, storagePath }: VoiceNoteRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [duration, setDuration] = useState(0);
  const recorderRef = useRef<Recorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  async function startRecording() {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) return;

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
    await recorder.prepareToRecordAsync();
    recorder.record();

    recorderRef.current = recorder;
    startTimeRef.current = Date.now();
    setRecording(true);
    setDuration(0);

    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 500);

    haptic.medium();
  }

  async function stopAndUpload() {
    if (!recorderRef.current) return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setRecording(false);
    setUploading(true);

    try {
      await recorderRef.current.stop();
      const uri = recorderRef.current.uri;
      recorderRef.current.release();
      recorderRef.current = null;

      await setAudioModeAsync({ allowsRecording: false });

      if (!uri) throw new Error("No recording URI");

      // Upload to Supabase storage using FormData (reliable on React Native)
      const fileName = `${storagePath}/${Date.now()}.m4a`;
      const formData = new FormData();
      formData.append("", {
        uri,
        name: fileName,
        type: "audio/mp4",
      } as unknown as Blob);

      const { error } = await supabase.storage
        .from("audio-notes")
        .upload(fileName, formData, { contentType: "multipart/form-data" });

      if (error) throw error;

      const { data: signedData } = await supabase.storage
        .from("audio-notes")
        .createSignedUrl(fileName, 365 * 24 * 3600); // 1 year

      if (!signedData?.signedUrl) throw new Error("Failed to get audio URL");
      onRecorded(signedData.signedUrl);
      haptic.success();
    } catch (err) {
      haptic.error();
      Alert.alert("Upload Failed", err instanceof Error ? err.message : "Could not upload voice note. Please try again.");
    }

    setUploading(false);
    setDuration(0);
  }

  async function cancel() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current) {
      try {
        await recorderRef.current.stop();
        recorderRef.current.release();
      } catch { /* ignore */ }
      recorderRef.current = null;
    }
    await setAudioModeAsync({ allowsRecording: false });
    setRecording(false);
    setDuration(0);
  }

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  if (uploading) {
    return <Text style={styles.uploadingText}>Uploading...</Text>;
  }

  if (recording) {
    return (
      <View style={styles.recordingBar}>
        <View style={styles.recordingDot} />
        <Text style={styles.recordingTime}>{formatDuration(duration)}</Text>
        <TouchableOpacity onPress={cancel} style={styles.cancelBtn}>
          <Ionicons name="close" size={16} color="#71717a" />
        </TouchableOpacity>
        <TouchableOpacity onPress={stopAndUpload} style={styles.stopBtn}>
          <Ionicons name="checkmark" size={16} color="#fff" />
          <Text style={styles.stopBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableOpacity onPress={startRecording} style={styles.micButton}>
      <Ionicons name="mic" size={16} color="#f59e0b" />
      <Text style={styles.micButtonText}>Voice Note</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  recordingBar: { flexDirection: "row", alignItems: "center", gap: 8 },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444" },
  recordingTime: { color: "#fff", fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"], minWidth: 32 },
  cancelBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#27272a", justifyContent: "center", alignItems: "center" },
  stopBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#22c55e", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  stopBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  uploadingText: { color: "#71717a", fontSize: 13 },
  micButton: { flexDirection: "row", alignItems: "center", gap: 6 },
  micButtonText: { color: "#f59e0b", fontSize: 13, fontWeight: "500" },
});
