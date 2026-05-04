import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from "react-native";
import { uploadQueue, type UploadDiagnostics } from "../services/recording/UploadQueue";

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

function formatExpiry(epochSec: number | null): string {
  if (!epochSec) return "—";
  const ms = epochSec * 1000;
  const deltaMs = ms - Date.now();
  const mins = Math.round(deltaMs / 60000);
  return `${new Date(ms).toLocaleString()} (${mins >= 0 ? "in " : ""}${mins} min)`;
}

function formatDelay(ms: number | undefined): string {
  if (!ms) return "now";
  const deltaMs = ms - Date.now();
  if (deltaMs <= 0) return "now";
  const mins = Math.ceil(deltaMs / 60000);
  return `${mins} min`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export default function DiagnosticsScreen() {
  const [diag, setDiag] = useState<UploadDiagnostics | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const d = await uploadQueue.getDiagnostics();
    setDiag(d);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onClear = useCallback(() => {
    Alert.alert("Clear errors?", "This clears the error log (not the queue).", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          await uploadQueue.clearErrors();
          await load();
        },
      },
    ]);
  }, [load]);

  if (!diag) {
    return (
      <View style={styles.container}>
        <Text style={styles.dim}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
    >
      <Text style={styles.sectionTitle}>Queue</Text>
      <Row label="Pending" value={String(diag.queueSize)} />
      <Row label="Uploaded" value={String(diag.uploadedCount)} />
      <Row label="Local audio files" value={String(diag.localSpoolFiles)} />
      <Row label="Local audio size" value={formatBytes(diag.localSpoolBytes)} />
      <Row
        label="Native uploads"
        value={diag.nativePendingUploads == null ? "—" : String(diag.nativePendingUploads)}
      />
      <Row label="Processing" value={diag.processing ? "yes" : "no"} />
      <Row label="Online" value={diag.isOnline ? "yes" : "no"} />
      <Row label="Pending complete" value={String(diag.pendingCompletes.length)} />

      {diag.pendingCompletes.map((pc) => (
        <View key={pc.sessionId} style={styles.pendingCard}>
          <Text style={styles.pendingTitle} numberOfLines={1}>
            {pc.failedAt ? "Completion failed" : "Completion pending"}
          </Text>
          <Text style={styles.pendingMeta}>
            attempts {pc.attempts ?? 0} · next {formatDelay(pc.nextAttemptAt)}
          </Text>
          {pc.lastStatus != null && (
            <Text style={styles.pendingMeta}>HTTP {pc.lastStatus}</Text>
          )}
          {pc.lastError && (
            <Text style={styles.pendingError} numberOfLines={4}>
              {pc.lastError}
            </Text>
          )}
          <Text style={styles.errorSession} numberOfLines={1}>
            session: {pc.sessionId}
          </Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Session</Text>
      <Row label="User ID" value={diag.userId ?? "—"} mono />
      <Row label="Token valid" value={diag.tokenValid ? "yes" : "NO"} />
      <Row label="Token expires" value={formatExpiry(diag.tokenExpiry)} />

      <Text style={styles.sectionTitle}>Config</Text>
      <Row label="API base URL" value={diag.apiBaseUrl} mono />
      <Row label="API URL valid" value={diag.apiBaseUrlValid ? "yes" : "NO"} />
      {diag.apiBaseUrlError && (
        <Text style={styles.configError}>{diag.apiBaseUrlError}</Text>
      )}

      <View style={styles.errorHeader}>
        <Text style={styles.sectionTitle}>Recent upload errors ({diag.errors.length})</Text>
        {diag.errors.length > 0 && (
          <TouchableOpacity onPress={onClear} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {diag.errors.length === 0 && (
        <Text style={styles.dim}>No errors logged.</Text>
      )}

      {diag.errors.map((e, i) => (
        <View key={`${e.at}-${i}`} style={styles.errorCard}>
          <Text style={styles.errorWhen}>{formatTime(e.at)}</Text>
          <Text style={styles.errorStage}>
            [{e.stage}] chunk {e.chunkIndex} · retry {e.retries}
          </Text>
          <Text style={styles.errorMsg} numberOfLines={6}>
            {e.message}
          </Text>
          <Text style={styles.errorSession} numberOfLines={1}>
            session: {e.sessionId}
          </Text>
        </View>
      ))}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  content: { padding: 16 },
  sectionTitle: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#18181b",
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#27272a",
  },
  rowLabel: { color: "#71717a", fontSize: 13, flex: 0.45 },
  rowValue: { color: "#d4d4d8", fontSize: 13, flex: 0.55, textAlign: "right" },
  mono: { fontFamily: "Menlo" },
  dim: { color: "#71717a", fontSize: 13, marginTop: 8 },
  configError: {
    color: "#f87171",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    marginBottom: 8,
  },
  pendingCard: {
    backgroundColor: "#18181b",
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(250,204,21,0.35)",
  },
  pendingTitle: { color: "#facc15", fontSize: 13, fontWeight: "700" },
  pendingMeta: { color: "#a1a1aa", fontSize: 12, marginTop: 3 },
  pendingError: { color: "#d4d4d8", fontSize: 12, marginTop: 6, fontFamily: "Menlo" },
  errorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  clearBtn: {
    backgroundColor: "rgba(239,68,68,0.1)",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  clearBtnText: { color: "#f87171", fontSize: 12, fontWeight: "600" },
  errorCard: {
    backgroundColor: "#18181b",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
  },
  errorWhen: { color: "#71717a", fontSize: 11 },
  errorStage: { color: "#f87171", fontSize: 13, fontWeight: "600", marginTop: 2 },
  errorMsg: { color: "#d4d4d8", fontSize: 12, marginTop: 4, fontFamily: "Menlo" },
  errorSession: { color: "#52525b", fontSize: 11, marginTop: 6, fontFamily: "Menlo" },
});
