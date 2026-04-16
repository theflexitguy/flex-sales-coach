import { useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet } from "../../services/api";
import { useCachedFetch } from "../../hooks/useCachedFetch";

interface HelpRequestItem {
  id: string;
  callId: string;
  callName: string;
  status: string;
  transcriptExcerpt: string;
  message: string | null;
  startMs: number | null;
  createdAt: string;
  repName: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "#eab308",
  responded: "#35b2ff",
  resolved: "#22c55e",
};

type Tab = "pending" | "responded";

export default function CoachingScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("pending");

  const { data, loading, refreshing, refresh } = useCachedFetch(
    "coaching-requests",
    () => apiGet<{ requests: HelpRequestItem[] }>("/api/mobile/help-requests")
  );

  const allRequests = data?.requests ?? [];
  const filtered = allRequests.filter((r) =>
    activeTab === "pending" ? r.status === "pending" : r.status !== "pending"
  );

  const pendingCount = allRequests.filter((r) => r.status === "pending").length;
  const respondedCount = allRequests.filter((r) => r.status !== "pending").length;

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#35b2ff" /></View>;
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : undefined}
      data={filtered}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#35b2ff" />}
      ListHeaderComponent={
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleButton, activeTab === "pending" && styles.toggleActive]}
            onPress={() => setActiveTab("pending")}
          >
            <Ionicons name="time" size={16} color={activeTab === "pending" ? "#eab308" : "#71717a"} />
            <Text style={[styles.toggleText, activeTab === "pending" && styles.toggleTextActivePending]}>
              Pending{pendingCount > 0 ? ` (${pendingCount})` : ""}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, activeTab === "responded" && styles.toggleActive]}
            onPress={() => setActiveTab("responded")}
          >
            <Ionicons name="checkmark-circle" size={16} color={activeTab === "responded" ? "#35b2ff" : "#71717a"} />
            <Text style={[styles.toggleText, activeTab === "responded" && styles.toggleTextActiveResponded]}>
              Responded{respondedCount > 0 ? ` (${respondedCount})` : ""}
            </Text>
          </TouchableOpacity>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons
            name={activeTab === "pending" ? "checkmark-done-outline" : "chatbubbles-outline"}
            size={48}
            color="#3f3f46"
          />
          <Text style={styles.emptyTitle}>
            {activeTab === "pending" ? "All caught up" : "No responses yet"}
          </Text>
          <Text style={styles.emptySubtitle}>
            {activeTab === "pending"
              ? "No pending help requests right now"
              : "Responded coaching items will appear here"}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push(`/(tabs)/calls/${item.callId}${item.startMs != null ? `?seekMs=${item.startMs}` : ""}`)}
        >
          <View style={styles.cardHeader}>
            <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[item.status] ?? "#71717a" }]} />
            <Text style={styles.callName}>{item.callName}</Text>
            <Text style={styles.status}>{item.status}</Text>
          </View>
          <Text style={styles.excerpt} numberOfLines={2}>"{item.transcriptExcerpt}"</Text>
          {item.message && <Text style={styles.message}>{item.message}</Text>}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.repName}>{item.repName}</Text>
            <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#09090b" },
  emptyContainer: { flex: 1 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8, paddingHorizontal: 32 },
  emptyTitle: { color: "#a1a1aa", fontSize: 16, fontWeight: "500" },
  emptySubtitle: { color: "#52525b", fontSize: 14, textAlign: "center", lineHeight: 20 },
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
  toggleTextActivePending: { color: "#eab308" },
  toggleTextActiveResponded: { color: "#35b2ff" },
  card: {
    marginHorizontal: 16, marginTop: 12, backgroundColor: "#18181b",
    borderRadius: 12, borderWidth: 1, borderColor: "#27272a", padding: 16, gap: 6,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  callName: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "600" },
  status: { color: "#71717a", fontSize: 12, textTransform: "capitalize" },
  excerpt: { color: "#a1a1aa", fontSize: 13, fontStyle: "italic", lineHeight: 18 },
  message: { color: "#d4d4d8", fontSize: 13 },
  repName: { color: "#71717a", fontSize: 12 },
  time: { color: "#52525b", fontSize: 12 },
});
