import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRecordingStore } from "../../stores/recording-store";
import { useAuthStore } from "../../stores/auth-store";
import { RepStatsView } from "../../components/home/rep-stats-view";
import { ManagerDashboardView } from "../../components/home/manager-dashboard-view";
import { haptic } from "../../lib/haptics";

export default function RecordScreen() {
  const profile = useAuthStore((s) => s.profile);
  const isManager = profile?.role === "manager";
  const isRecording = useRecordingStore((s) => s.isRecording);

  // Everyone sees the recording view — managers also get a dashboard toggle
  return <RecordingView isManager={isManager} />;
}

function RecordingView({ isManager }: { isManager: boolean }) {
  const [showDashboard, setShowDashboard] = useState(isManager);
  const {
    isRecording,
    elapsedMs,
    chunkCount,
    uploadedChunks,
    totalChunks,
    meteringDb,
    error,
    startDay,
    stopAndName,
    updateElapsed,
    updateMetering,
  } = useRecordingStore();

  const [showStopModal, setShowStopModal] = useState(false);
  const [label, setLabel] = useState("");
  const [pausedTime, setPausedTime] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update elapsed time every second — pause when modal is open
  useEffect(() => {
    if (isRecording && !showStopModal) {
      timerRef.current = setInterval(() => {
        updateElapsed();
        updateMetering();
      }, 500);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, showStopModal]);

  function openStopModal() {
    // Freeze the displayed time
    setPausedTime(timeString);
    setShowStopModal(true);
  }

  function closeStopModal() {
    // Resume — timer restarts via effect
    setPausedTime(null);
    setShowStopModal(false);
    setLabel("");
  }

  async function handleStart() {
    await startDay();
  }

  async function handleStop() {
    if (!label.trim()) return;
    await stopAndName(label.trim());
    setShowStopModal(false);
    setPausedTime(null);
    setLabel("");
    haptic.success();
    Alert.alert(
      "Session Saved",
      "Uploading in the background. It may take a minute for the conversation to appear in Calls. If something goes wrong, you'll see it on this screen or in Profile → Diagnostics."
    );
  }

  const hours = Math.floor(elapsedMs / 3600000);
  const minutes = Math.floor((elapsedMs % 3600000) / 60000);
  const seconds = Math.floor((elapsedMs % 60000) / 1000);
  const timeString = `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  // Show paused time when modal is open, live time otherwise
  const displayTime = pausedTime ?? timeString;

  return (
    <View style={styles.container}>
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Manager toggle: Dashboard / Record */}
      {isManager && !isRecording && (
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleButton, showDashboard && styles.toggleActive]}
            onPress={() => setShowDashboard(true)}
          >
            <Ionicons name="grid" size={16} color={showDashboard ? "#35b2ff" : "#71717a"} />
            <Text style={[styles.toggleText, showDashboard && styles.toggleTextActive]}>Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, !showDashboard && styles.toggleActive]}
            onPress={() => setShowDashboard(false)}
          >
            <Ionicons name="mic" size={16} color={!showDashboard ? "#35b2ff" : "#71717a"} />
            <Text style={[styles.toggleText, !showDashboard && styles.toggleTextActive]}>Record</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Manager dashboard view */}
      {isManager && showDashboard && !isRecording ? (
        <ManagerDashboardView />
      ) : !isRecording ? (
        <View style={styles.idleContainer}>
          <RepStatsView />
          <View style={styles.startButtonContainer}>
            <TouchableOpacity style={styles.startButton} onPress={handleStart}>
              <Ionicons name="play" size={24} color="#fff" />
              <Text style={styles.startButtonText}>Start Day</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.recordingContainer}>
          <View style={styles.pulseOuter}>
            <View style={styles.pulseInner}>
              <Ionicons name="mic" size={32} color="#fff" />
            </View>
          </View>

          <Text style={styles.recordingLabel}>
            {showStopModal ? "Paused" : "Recording"}
          </Text>
          <Text style={styles.timer}>{displayTime}</Text>

          {isRecording && !showStopModal && (
            <View style={styles.meterRow}>
              <View style={styles.meterBar}>
                <View
                  style={[
                    styles.meterFill,
                    {
                      width: `${Math.max(0, Math.min(100, Math.round(((meteringDb + 60) / 60) * 100)))}%` as `${number}%`,
                      backgroundColor: meteringDb > -6 ? "#ef4444" : meteringDb > -24 ? "#22c55e" : "#71717a",
                    },
                  ]}
                />
              </View>
              <Text style={styles.meterLabel}>
                {meteringDb <= -60 ? "No audio" : meteringDb > -6 ? "Too loud" : "Picking up audio"}
              </Text>
            </View>
          )}

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{chunkCount}</Text>
              <Text style={styles.statLabel}>Chunks</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>
                {uploadedChunks}/{totalChunks}
              </Text>
              <Text style={styles.statLabel}>Uploaded</Text>
            </View>
          </View>

          {totalChunks > 0 && (
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.round(
                      (uploadedChunks / Math.max(totalChunks, 1)) * 100
                    )}%` as `${number}%`,
                  },
                ]}
              />
            </View>
          )}

          <TouchableOpacity style={styles.stopButton} onPress={openStopModal}>
            <Ionicons name="stop" size={20} color="#fff" />
            <Text style={styles.stopButtonText}>Stop & Name</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Stop & Name Modal */}
      <Modal visible={showStopModal} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={closeStopModal}
          />
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Name This Recording</Text>
            <Text style={styles.modalSubtitle}>
              The last conversation will get this name.{"\n"}
              Earlier conversations will be auto-named.
            </Text>

            <TextInput
              style={styles.modalInput}
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. Taylor Armstrong - Sale"
              placeholderTextColor="#71717a"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleStop}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={closeStopModal}
              >
                <Text style={styles.modalCancelText}>Keep Recording</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSave,
                  !label.trim() && styles.buttonDisabled,
                ]}
                onPress={handleStop}
                disabled={!label.trim()}
              >
                <Text style={styles.modalSaveText}>Save & Process</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  toggleRow: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  toggleButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "transparent",
  },
  toggleActive: {
    backgroundColor: "rgba(53,178,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(53,178,255,0.2)",
  },
  toggleText: { color: "#71717a", fontSize: 14, fontWeight: "500" },
  toggleTextActive: { color: "#35b2ff" },
  errorBanner: {
    backgroundColor: "rgba(239,68,68,0.1)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(239,68,68,0.2)",
    padding: 12,
  },
  errorText: { color: "#f87171", fontSize: 14, textAlign: "center" },
  idleContainer: {
    flex: 1,
  },
  startButtonContainer: {
    padding: 16,
    paddingBottom: 24,
    alignItems: "center",
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(53,178,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  idleTitle: { color: "#fff", fontSize: 24, fontWeight: "700", marginBottom: 8 },
  idleSubtitle: {
    color: "#a1a1aa",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#35b2ff",
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 16,
  },
  startButtonText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  recordingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  pulseOuter: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(239,68,68,0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  pulseInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
  },
  recordingLabel: {
    color: "#ef4444",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  timer: {
    color: "#fff",
    fontSize: 48,
    fontWeight: "200",
    fontVariant: ["tabular-nums"],
    marginBottom: 24,
  },
  statsRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  stat: { alignItems: "center", paddingHorizontal: 20 },
  statValue: { color: "#fff", fontSize: 20, fontWeight: "600" },
  statLabel: { color: "#71717a", fontSize: 12, marginTop: 2 },
  statDivider: { width: 1, height: 24, backgroundColor: "#27272a" },
  progressBar: {
    width: "80%",
    height: 4,
    backgroundColor: "#27272a",
    borderRadius: 2,
    marginBottom: 32,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#35b2ff", borderRadius: 2 },
  meterRow: {
    width: "80%",
    alignItems: "center",
    marginTop: 16,
    gap: 6,
  },
  meterBar: {
    width: "100%",
    height: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 3,
    overflow: "hidden",
  },
  meterFill: {
    height: "100%",
    borderRadius: 3,
  },
  meterLabel: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "500" as const,
  },
  stopButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#dc2626",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 16,
  },
  stopButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  // Modal
  modalOverlay: { flex: 1 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  modalContent: {
    backgroundColor: "#18181b",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "700", marginBottom: 8 },
  modalSubtitle: { color: "#a1a1aa", fontSize: 14, lineHeight: 20, marginBottom: 20 },
  modalInput: {
    backgroundColor: "rgba(39,39,42,0.5)",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    padding: 14,
    color: "#fff",
    fontSize: 16,
    marginBottom: 20,
  },
  modalActions: { flexDirection: "row", gap: 12 },
  modalCancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  modalCancelText: { color: "#d4d4d8", fontSize: 15, fontWeight: "500" },
  modalSave: {
    flex: 1,
    backgroundColor: "#35b2ff",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  modalSaveText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  buttonDisabled: { opacity: 0.5 },
});
