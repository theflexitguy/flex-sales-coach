import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet } from "../../../services/api";
import { useCachedFetch } from "../../../hooks/useCachedFetch";
import { useAuthStore } from "../../../stores/auth-store";

interface CallItem {
  id: string;
  customerName: string | null;
  repName: string | null;
  repId: string;
  durationSeconds: number;
  status: string;
  recordedAt: string;
  overallScore: number | null;
  overallGrade: string | null;
  summary: string | null;
}

const GRADE_COLORS: Record<string, string> = {
  excellent: "#22c55e",
  good: "#35b2ff",
  acceptable: "#eab308",
  needs_improvement: "#f97316",
  poor: "#ef4444",
};

type CallsFilter = "mine" | "team" | "shared";

export default function CallsListScreen() {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const isManager = profile?.role === "manager";
  const [filter, setFilter] = useState<CallsFilter>("mine");

  const { data, loading, refreshing, refresh } = useCachedFetch(
    `calls-list-${filter}`,
    () => apiGet<{ calls: CallItem[] }>(`/api/mobile/calls?limit=50&filter=${filter}`)
  );

  const calls = data?.calls ?? [];

  function formatDuration(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#35b2ff" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={calls.length === 0 ? styles.emptyContainer : undefined}
      data={calls}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor="#35b2ff"
        />
      }
      ListHeaderComponent={
        isManager ? (
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleButton, filter === "mine" && styles.toggleActive]}
              onPress={() => setFilter("mine")}
            >
              <Ionicons name="person" size={16} color={filter === "mine" ? "#35b2ff" : "#71717a"} />
              <Text style={[styles.toggleText, filter === "mine" && styles.toggleTextActive]}>My Calls</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleButton, filter === "team" && styles.toggleActive]}
              onPress={() => setFilter("team")}
            >
              <Ionicons name="people" size={16} color={filter === "team" ? "#35b2ff" : "#71717a"} />
              <Text style={[styles.toggleText, filter === "team" && styles.toggleTextActive]}>Team</Text>
            </TouchableOpacity>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="mic-off-outline" size={48} color="#3f3f46" />
          <Text style={styles.emptyTitle}>
            {filter === "team" ? "No team conversations" : "No conversations yet"}
          </Text>
          <Text style={styles.emptySubtitle}>
            {filter === "team"
              ? "Your reps' conversations will appear here"
              : "Record a conversation to see it here"}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push(`/(tabs)/calls/${item.id}`)}
        >
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.customerName}>
                {item.customerName ?? "Unknown Customer"}
              </Text>
              <Text style={styles.meta}>
                {filter === "team" && item.repName ? `${item.repName} · ` : ""}
                {formatDate(item.recordedAt)} · {formatDuration(item.durationSeconds)}
              </Text>
            </View>
            {item.overallScore != null ? (
              <View style={styles.scoreBadge}>
                <Text
                  style={[
                    styles.scoreText,
                    { color: GRADE_COLORS[item.overallGrade ?? ""] ?? "#a1a1aa" },
                  ]}
                >
                  {item.overallScore}
                </Text>
              </View>
            ) : (
              <StatusBadge status={item.status} />
            )}
          </View>
          {item.summary && (
            <Text style={styles.summary} numberOfLines={2}>
              {item.summary}
            </Text>
          )}
        </TouchableOpacity>
      )}
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; label: string }> = {
    completed: { bg: "rgba(53,178,255,0.1)", color: "#35b2ff", label: "Analyzed" },
    failed: { bg: "rgba(239,68,68,0.1)", color: "#f87171", label: "Failed" },
    uploading: { bg: "rgba(234,179,8,0.1)", color: "#eab308", label: "Uploading" },
    uploaded: { bg: "rgba(53,178,255,0.1)", color: "#35b2ff", label: "Uploaded" },
    transcribing: { bg: "rgba(53,178,255,0.1)", color: "#35b2ff", label: "Transcribing" },
    analyzing: { bg: "rgba(139,92,246,0.1)", color: "#a78bfa", label: "Analyzing" },
  };
  const c = config[status] ?? { bg: "rgba(113,113,122,0.1)", color: "#71717a", label: status };

  return (
    <View style={[styles.statusBadge, { backgroundColor: c.bg }]}>
      <Text style={[styles.statusText, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#09090b" },
  emptyContainer: { flex: 1 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8 },
  emptyTitle: { color: "#a1a1aa", fontSize: 16, fontWeight: "500" },
  emptySubtitle: { color: "#52525b", fontSize: 14 },
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
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 16,
  },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  customerName: { color: "#fff", fontSize: 16, fontWeight: "600" },
  meta: { color: "#71717a", fontSize: 13, marginTop: 2 },
  scoreBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(53,178,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  scoreText: { fontSize: 18, fontWeight: "700" },
  statusBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: "600" },
  summary: { color: "#a1a1aa", fontSize: 13, lineHeight: 18, marginTop: 8 },
});
