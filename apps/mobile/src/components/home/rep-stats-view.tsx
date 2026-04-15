import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiGet } from "../../services/api";

const GRADE_COLORS: Record<string, string> = {
  excellent: "#22c55e", good: "#35b2ff", acceptable: "#eab308",
  needs_improvement: "#f97316", poor: "#ef4444",
};

interface StatsData {
  streak: number;
  overallAvgScore: number | null;
  recentAvgScore: number | null;
  totalCalls: number;
  objectionHandleRate: number | null;
  improvementAreas: Array<{ category: string; failRate: number; total: number }>;
  badges: Array<{ id: string; label: string; icon: string; earned: boolean }>;
  recentStats: Array<{ date: string; callsCount: number; avgScore: number | null }>;
}

export function RepStatsView() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<StatsData>("/api/mobile/stats")
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#35b2ff" /></View>;
  }

  if (!stats) {
    return <View style={styles.center}><Text style={styles.emptyText}>Could not load stats</Text></View>;
  }

  const scoreColor = stats.overallAvgScore
    ? stats.overallAvgScore >= 80 ? GRADE_COLORS.excellent
      : stats.overallAvgScore >= 60 ? GRADE_COLORS.good
      : GRADE_COLORS.needs_improvement
    : "#71717a";

  const scoreTrend = stats.recentAvgScore != null && stats.overallAvgScore != null
    ? stats.recentAvgScore - stats.overallAvgScore
    : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 20 }}>
      {/* Score + Streak row */}
      <View style={styles.topRow}>
        <View style={styles.scoreCard}>
          <Text style={styles.cardLabel}>Avg Score</Text>
          <Text style={[styles.bigNumber, { color: scoreColor }]}>
            {stats.overallAvgScore ?? "--"}
          </Text>
          {scoreTrend !== 0 && (
            <View style={styles.trendRow}>
              <Ionicons
                name={scoreTrend > 0 ? "trending-up" : "trending-down"}
                size={14}
                color={scoreTrend > 0 ? "#22c55e" : "#ef4444"}
              />
              <Text style={{ color: scoreTrend > 0 ? "#22c55e" : "#ef4444", fontSize: 12, fontWeight: "600" }}>
                {scoreTrend > 0 ? "+" : ""}{scoreTrend} this week
              </Text>
            </View>
          )}
        </View>

        <View style={styles.streakCard}>
          <Text style={styles.cardLabel}>Streak</Text>
          <View style={styles.streakRow}>
            <Ionicons name="flame" size={28} color={stats.streak > 0 ? "#f97316" : "#3f3f46"} />
            <Text style={[styles.bigNumber, { color: stats.streak > 0 ? "#f97316" : "#71717a" }]}>
              {stats.streak}
            </Text>
          </View>
          <Text style={styles.subLabel}>{stats.streak === 1 ? "day" : "days"}</Text>
        </View>

        <View style={styles.miniCard}>
          <Text style={styles.cardLabel}>Convos</Text>
          <Text style={[styles.bigNumber, { color: "#fff" }]}>{stats.totalCalls}</Text>
        </View>

        <View style={styles.miniCard}>
          <Text style={styles.cardLabel}>Handle %</Text>
          <Text style={[styles.bigNumber, { color: "#35b2ff" }]}>
            {stats.objectionHandleRate ?? "--"}
          </Text>
        </View>
      </View>

      {/* Badges */}
      {stats.badges.some((b) => b.earned) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Badges Earned</Text>
          <View style={styles.badgeRow}>
            {stats.badges.filter((b) => b.earned).map((badge) => (
              <View key={badge.id} style={styles.badge}>
                <Ionicons name={badge.icon as keyof typeof Ionicons.glyphMap} size={20} color="#35b2ff" />
                <Text style={styles.badgeLabel}>{badge.label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Improvement areas */}
      {stats.improvementAreas.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Areas to Improve</Text>
          <Text style={styles.sectionSubtitle}>
            Check the Learn tab for team examples on these
          </Text>
          {stats.improvementAreas.map((area) => (
            <View key={area.category} style={styles.areaCard}>
              <View style={styles.areaHeader}>
                <Text style={styles.areaCategory}>{area.category}</Text>
                <Text style={styles.areaRate}>{area.failRate}% fail rate</Text>
              </View>
              <View style={styles.areaBar}>
                <View style={[styles.areaBarFill, { width: `${100 - area.failRate}%` as `${number}%` }]} />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Recent activity */}
      {stats.recentStats.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Last 7 Days</Text>
          <View style={styles.recentGrid}>
            {stats.recentStats.slice(-7).map((day) => (
              <View key={day.date} style={styles.dayCell}>
                <View
                  style={[
                    styles.dayDot,
                    {
                      backgroundColor: day.callsCount > 0
                        ? day.avgScore != null && day.avgScore >= 80 ? "#22c55e"
                          : day.avgScore != null && day.avgScore >= 60 ? "#35b2ff"
                          : "#f97316"
                        : "#27272a",
                    },
                  ]}
                />
                <Text style={styles.dayLabel}>{day.date.slice(5)}</Text>
                <Text style={styles.dayScore}>
                  {day.callsCount > 0 ? day.avgScore ?? "-" : "·"}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: "#71717a", fontSize: 14 },
  topRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 16 },
  scoreCard: {
    flex: 1, minWidth: "45%", backgroundColor: "#18181b", borderRadius: 12,
    borderWidth: 1, borderColor: "#27272a", padding: 16, alignItems: "center",
  },
  streakCard: {
    flex: 1, minWidth: "45%", backgroundColor: "#18181b", borderRadius: 12,
    borderWidth: 1, borderColor: "#27272a", padding: 16, alignItems: "center",
  },
  miniCard: {
    flex: 1, minWidth: "45%", backgroundColor: "#18181b", borderRadius: 12,
    borderWidth: 1, borderColor: "#27272a", padding: 16, alignItems: "center",
  },
  cardLabel: { color: "#71717a", fontSize: 12, marginBottom: 4 },
  bigNumber: { fontSize: 32, fontWeight: "700" },
  subLabel: { color: "#71717a", fontSize: 11, marginTop: 2 },
  trendRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  streakRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  section: { paddingHorizontal: 16, marginTop: 20 },
  sectionTitle: { color: "#fff", fontSize: 17, fontWeight: "600", marginBottom: 8 },
  sectionSubtitle: { color: "#71717a", fontSize: 13, marginBottom: 12 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(53,178,255,0.1)",
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  badgeLabel: { color: "#35b2ff", fontSize: 13, fontWeight: "500" },
  areaCard: {
    backgroundColor: "#18181b", borderRadius: 10, borderWidth: 1,
    borderColor: "#27272a", padding: 12, marginBottom: 8,
  },
  areaHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  areaCategory: { color: "#d4d4d8", fontSize: 14, fontWeight: "500", textTransform: "capitalize" },
  areaRate: { color: "#f97316", fontSize: 13, fontWeight: "600" },
  areaBar: { height: 6, backgroundColor: "#27272a", borderRadius: 3, overflow: "hidden" },
  areaBarFill: { height: "100%", backgroundColor: "#35b2ff", borderRadius: 3 },
  recentGrid: { flexDirection: "row", justifyContent: "space-between" },
  dayCell: { alignItems: "center", gap: 4 },
  dayDot: { width: 12, height: 12, borderRadius: 6 },
  dayLabel: { color: "#71717a", fontSize: 10 },
  dayScore: { color: "#a1a1aa", fontSize: 12, fontWeight: "600" },
});
