import { useState, useEffect, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiGet } from "../../services/api";

const GRADE_COLORS: Record<string, string> = {
  excellent: "#22c55e", good: "#35b2ff", acceptable: "#eab308",
  needs_improvement: "#f97316", poor: "#ef4444",
};

interface HistoryItem {
  id: string;
  scenarioTitle: string;
  personaName: string;
  durationSeconds: number;
  score: number | null;
  grade: string | null;
  startedAt: string;
}

export function RoleplayHistory() {
  const [sessions, setSessions] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const data = await apiGet<{ sessions: HistoryItem[] }>("/api/mobile/roleplay/sessions");
    setSessions(data.sessions);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#35b2ff" /></View>;
  }

  if (sessions.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="time-outline" size={36} color="#3f3f46" />
        <Text style={styles.emptyText}>No practice sessions yet</Text>
      </View>
    );
  }

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <FlatList
      data={sessions}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{item.scenarioTitle}</Text>
              <Text style={styles.meta}>
                {item.personaName} · {formatDuration(item.durationSeconds)}
              </Text>
            </View>
            {item.score != null && (
              <View style={styles.scoreWrap}>
                <Text style={[styles.score, { color: GRADE_COLORS[item.grade ?? ""] ?? "#a1a1aa" }]}>
                  {item.score}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.date}>
            {new Date(item.startedAt).toLocaleDateString("en-US", {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
            })}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8, padding: 40 },
  emptyText: { color: "#52525b", fontSize: 14 },
  card: {
    backgroundColor: "#18181b", borderRadius: 10, borderWidth: 1,
    borderColor: "#27272a", padding: 14, gap: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { color: "#d4d4d8", fontSize: 14, fontWeight: "500" },
  meta: { color: "#52525b", fontSize: 12, marginTop: 2 },
  scoreWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#09090b", justifyContent: "center", alignItems: "center",
  },
  score: { fontSize: 16, fontWeight: "700" },
  date: { color: "#3f3f46", fontSize: 11 },
});
