import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { uploadQueue } from "../services/recording/UploadQueue";

// Persistent banner that sits at the top of every screen whenever the
// upload queue has pending chunks. The reason it exists: a rep hits
// Stop at the end of the day, walks to their truck, locks the phone —
// and the queue may have 40 chunks still to upload on cellular. Without
// a persistent surface the rep has no idea it's still working, can
// force-quit the app, and lose audio. This banner makes "don't close
// the app" visible no matter what screen they're on.
//
// Polls the upload queue every second. The queue itself is driven by
// NetInfo + its own processing loop, so this is just a view into state.
export function UploadProgressBanner() {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [uploaded, setUploaded] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const diag = await uploadQueue.getDiagnostics();
      if (cancelled) return;
      setPending(diag.queueSize);
      setUploaded(diag.uploadedCount);
      setLastError(diag.lastError);
    }

    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (pending === 0) return null;

  const total = pending + uploaded;
  const pct = total > 0 ? Math.round((uploaded / total) * 100) : 0;
  const hasError = !!lastError;

  return (
    <TouchableOpacity
      style={[styles.banner, hasError && styles.bannerError]}
      onPress={() => router.push("/diagnostics")}
      activeOpacity={0.85}
    >
      <View style={styles.row}>
        <View style={styles.leading}>
          {hasError ? (
            <Ionicons name="warning" size={16} color="#f59e0b" />
          ) : (
            <ActivityIndicator size="small" color="#35b2ff" />
          )}
          <View style={styles.textCol}>
            <Text style={styles.title}>
              {hasError
                ? `Upload issue — ${pending} chunk${pending === 1 ? "" : "s"} left`
                : `Uploading ${pending} chunk${pending === 1 ? "" : "s"} — do not close the app`}
            </Text>
            <Text style={styles.subtitle}>
              {uploaded} of {total} sent · tap for details
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#71717a" />
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            hasError && styles.progressFillError,
            { width: `${pct}%` as `${number}%` },
          ]}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "rgba(53,178,255,0.08)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(53,178,255,0.25)",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bannerError: {
    backgroundColor: "rgba(245,158,11,0.08)",
    borderBottomColor: "rgba(245,158,11,0.3)",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  leading: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  textCol: { flex: 1 },
  title: { color: "#fafafa", fontSize: 13, fontWeight: "600" },
  subtitle: { color: "#a1a1aa", fontSize: 11, marginTop: 1 },
  progressTrack: {
    height: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#35b2ff",
  },
  progressFillError: {
    backgroundColor: "#f59e0b",
  },
});
