import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet } from "../../services/api";
import { SkeletonList } from "../ui/skeleton";

const GRADE_COLORS: Record<string, string> = {
  excellent: "#22c55e", good: "#35b2ff", acceptable: "#eab308",
  needs_improvement: "#f97316", poor: "#ef4444",
};

interface DashboardData {
  todayActivity: { callsToday: number; activeSessions: number; analyzedToday: number };
  leaderboard: Array<{ repId: string; repName: string; avgScore: number | null; totalCalls: number; objectionHandleRate: number | null }>;
  helpRequests: { pendingCount: number; recent: Array<{ id: string; repName: string; excerpt: string }> };
  quickActions: { worstCallToday: string | null; topFailedObjection: string | null; strugglingRepName: string | null };
}

export function ManagerDashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const [error, setError] = useState(false);

  async function fetchData() {
    setError(false);
    try {
      const d = await apiGet<DashboardData>("/api/dashboard");
      setData(d);
    } catch {
      setError(true);
    }
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  if (loading) return <SkeletonList count={6} />;
  if (error || !data) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 12, padding: 32 }}>
        <Ionicons name="cloud-offline-outline" size={48} color="#3f3f46" />
        <Text style={{ color: "#a1a1aa", fontSize: 15, textAlign: "center" }}>
          {error ? "Couldn't load dashboard" : "No data yet"}
        </Text>
        <TouchableOpacity onPress={() => { setLoading(true); fetchData(); }}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: "rgba(53,178,255,0.1)" }}>
          <Ionicons name="refresh" size={16} color="#35b2ff" />
          <Text style={{ color: "#35b2ff", fontSize: 14, fontWeight: "600" }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }} tintColor="#35b2ff" />}>

      {/* Today */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{data.todayActivity.callsToday}</Text>
          <Text style={styles.statLabel}>Convos Today</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: "#35b2ff" }]}>{data.todayActivity.analyzedToday}</Text>
          <Text style={styles.statLabel}>Analyzed</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{data.todayActivity.activeSessions}</Text>
          <Text style={styles.statLabel}>Recording</Text>
        </View>
      </View>

      {/* Quick Actions */}
      {(data.quickActions.worstCallToday || data.quickActions.topFailedObjection) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={{ gap: 8 }}>
            {data.quickActions.worstCallToday && (
              <TouchableOpacity style={[styles.actionCard, { borderColor: "rgba(239,68,68,0.2)" }]}
                onPress={() => router.push(`/(tabs)/calls/${data.quickActions.worstCallToday}`)}>
                <Ionicons name="warning-outline" size={20} color="#f87171" />
                <View style={{ flex: 1 }}><Text style={styles.actionTitle}>Review Worst Call</Text><Text style={styles.actionSubtitle}>Lowest score today</Text></View>
                <Ionicons name="chevron-forward" size={16} color="#52525b" />
              </TouchableOpacity>
            )}
            {data.quickActions.topFailedObjection && (
              <TouchableOpacity style={[styles.actionCard, { borderColor: "rgba(245,158,11,0.2)" }]}
                onPress={() => router.push("/(tabs)/learn")}>
                <Ionicons name="shield-outline" size={20} color="#f59e0b" />
                <View style={{ flex: 1 }}><Text style={styles.actionTitle}>Top Failed Objection</Text><Text style={styles.actionSubtitle}>{data.quickActions.topFailedObjection}</Text></View>
                <Ionicons name="chevron-forward" size={16} color="#52525b" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Help Requests */}
      {data.helpRequests.pendingCount > 0 && (
        <View style={styles.section}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.sectionTitle}>Help Requests</Text>
            <View style={styles.badge}><Text style={styles.badgeText}>{data.helpRequests.pendingCount} pending</Text></View>
          </View>
          {data.helpRequests.recent.map((r) => (
            <TouchableOpacity key={r.id} style={styles.helpCard} onPress={() => router.push("/(tabs)/coaching")}>
              <Text style={styles.helpRep}>{r.repName}</Text>
              <Text style={styles.helpExcerpt} numberOfLines={1}>{r.excerpt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Leaderboard */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Team Leaderboard</Text>
        {data.leaderboard.map((rep, i) => (
          <View key={rep.repId} style={styles.repRow}>
            <Text style={styles.rank}>{i + 1}</Text>
            <View style={styles.repAvatar}><Text style={styles.repInitial}>{rep.repName.charAt(0)}</Text></View>
            <View style={{ flex: 1 }}><Text style={styles.repName}>{rep.repName}</Text><Text style={styles.repMeta}>{rep.totalCalls} convos</Text></View>
            <Text style={[styles.repScore, { color: rep.avgScore ? (rep.avgScore >= 80 ? GRADE_COLORS.excellent : rep.avgScore >= 60 ? GRADE_COLORS.good : GRADE_COLORS.needs_improvement) : "#71717a" }]}>{rep.avgScore ?? "--"}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  statsRow: { flexDirection: "row", gap: 10, padding: 16 },
  statCard: { flex: 1, backgroundColor: "#18181b", borderRadius: 12, borderWidth: 1, borderColor: "#27272a", padding: 16, alignItems: "center" },
  statValue: { color: "#fff", fontSize: 28, fontWeight: "700" },
  statLabel: { color: "#71717a", fontSize: 11, marginTop: 2 },
  section: { paddingHorizontal: 16, marginTop: 20, gap: 8 },
  sectionTitle: { color: "#fff", fontSize: 17, fontWeight: "600" },
  actionCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#18181b", borderRadius: 12, borderWidth: 1, borderColor: "#27272a", padding: 14 },
  actionTitle: { color: "#fff", fontSize: 14, fontWeight: "500" },
  actionSubtitle: { color: "#71717a", fontSize: 12, marginTop: 1, textTransform: "capitalize" },
  badge: { backgroundColor: "rgba(245,158,11,0.1)", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: "#f59e0b", fontSize: 12, fontWeight: "600" },
  helpCard: { backgroundColor: "#18181b", borderRadius: 10, borderWidth: 1, borderColor: "#27272a", padding: 12 },
  helpRep: { color: "#35b2ff", fontSize: 13, fontWeight: "600" },
  helpExcerpt: { color: "#a1a1aa", fontSize: 13, marginTop: 2 },
  repRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#18181b", borderRadius: 10, borderWidth: 1, borderColor: "#27272a", padding: 12 },
  rank: { color: "#52525b", fontSize: 16, fontWeight: "700", width: 20, textAlign: "center" },
  repAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#27272a", justifyContent: "center", alignItems: "center" },
  repInitial: { color: "#d4d4d8", fontSize: 14, fontWeight: "600" },
  repName: { color: "#fff", fontSize: 14, fontWeight: "500" },
  repMeta: { color: "#52525b", fontSize: 12 },
  repScore: { fontSize: 20, fontWeight: "700" },
});
