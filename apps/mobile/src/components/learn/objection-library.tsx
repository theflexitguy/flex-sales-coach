import { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet } from "../../services/api";

const GRADE_COLORS: Record<string, string> = {
  excellent: "#22c55e", good: "#35b2ff", acceptable: "#eab308",
  needs_improvement: "#f97316", poor: "#ef4444",
};
const GRADE_LABELS: Record<string, string> = {
  excellent: "Excellent", good: "Good", acceptable: "Acceptable",
  needs_improvement: "Needs Work", poor: "Poor",
};
const CATEGORIES = ["price", "timing", "need", "trust", "competition", "authority", "other"];

interface ObjectionItem {
  id: string;
  callId: string;
  category: string;
  utteranceText: string;
  repResponse: string;
  handlingGrade: string;
  suggestion: string;
  repName: string;
  customerName: string;
}

export function ObjectionLibrary() {
  const [objections, setObjections] = useState<ObjectionItem[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState<string | null>(null);
  const [examples, setExamples] = useState<ObjectionItem[]>([]);
  const router = useRouter();

  const fetchData = useCallback(async () => {
    const params = activeCategory ? `?category=${activeCategory}` : "";
    const data = await apiGet<{
      objections: ObjectionItem[];
      categoryCounts: Record<string, number>;
    }>(`/api/mobile/objections/library${params}`);
    setObjections(data.objections);
    setCategoryCounts(data.categoryCounts);
    setLoading(false);
  }, [activeCategory]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function loadExamples(category: string) {
    setShowExamples(category);
    const data = await apiGet<{ examples: ObjectionItem[] }>(
      `/api/mobile/objections/library?examplesFor=${category}`
    );
    setExamples(data.examples ?? []);
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#35b2ff" /></View>;
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Category pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pills} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        <TouchableOpacity
          style={[styles.pill, !activeCategory && styles.pillActive]}
          onPress={() => setActiveCategory(null)}
        >
          <Text style={[styles.pillText, !activeCategory && styles.pillTextActive]}>All</Text>
        </TouchableOpacity>
        {CATEGORIES.filter((c) => (categoryCounts[c] ?? 0) > 0).map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.pill, activeCategory === cat && styles.pillActive]}
            onPress={() => setActiveCategory(activeCategory === cat ? null : cat)}
          >
            <Text style={[styles.pillText, activeCategory === cat && styles.pillTextActive, { textTransform: "capitalize" }]}>
              {cat} ({categoryCounts[cat]})
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={objections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={objections.length === 0 ? styles.emptyContainer : { paddingBottom: 20 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="library-outline" size={48} color="#3f3f46" />
            <Text style={styles.emptyTitle}>No objections yet</Text>
            <Text style={styles.emptySubtitle}>Objections will appear here as calls get analyzed</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.category}>{item.category}</Text>
              <Text style={[styles.grade, { color: GRADE_COLORS[item.handlingGrade] }]}>
                {GRADE_LABELS[item.handlingGrade]}
              </Text>
            </View>
            <Text style={styles.quote}>"{item.utteranceText}"</Text>
            <Text style={styles.response}>
              <Text style={{ color: "#71717a" }}>Response: </Text>{item.repResponse}
            </Text>
            <View style={styles.suggestionBox}>
              <Text style={styles.suggestion}>
                <Text style={{ fontWeight: "600" }}>Tip: </Text>{item.suggestion}
              </Text>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity onPress={() => router.push(`/(tabs)/calls/${item.callId}`)}>
                <Text style={styles.actionLink}>Listen</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => loadExamples(item.category)}>
                <Text style={[styles.actionLink, { color: "#22c55e" }]}>See team examples</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* Examples overlay */}
      {showExamples && (
        <View style={styles.overlay}>
          <View style={styles.overlayContent}>
            <View style={styles.overlayHeader}>
              <Text style={styles.overlayTitle}>{showExamples} — Best Responses</Text>
              <TouchableOpacity onPress={() => setShowExamples(null)}>
                <Ionicons name="close" size={24} color="#a1a1aa" />
              </TouchableOpacity>
            </View>
            <Text style={styles.overlaySubtitle}>Real examples from your team</Text>
            <FlatList
              data={examples}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={<Text style={styles.emptyTitle}>No examples yet</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.exampleCard}
                  onPress={() => { setShowExamples(null); router.push(`/(tabs)/calls/${item.callId}`); }}
                >
                  <View style={styles.cardHeader}>
                    <Text style={{ color: "#35b2ff", fontSize: 13, fontWeight: "600" }}>{item.repName}</Text>
                    <Text style={[styles.grade, { color: GRADE_COLORS[item.handlingGrade] }]}>
                      {GRADE_LABELS[item.handlingGrade]}
                    </Text>
                  </View>
                  <Text style={styles.quote}>"{item.utteranceText}"</Text>
                  <Text style={[styles.response, { color: "#86efac" }]}>{item.repResponse}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#09090b" },
  pills: { maxHeight: 48, marginVertical: 8 },
  pill: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: "#27272a", backgroundColor: "#18181b",
  },
  pillActive: { borderColor: "rgba(53,178,255,0.3)", backgroundColor: "rgba(53,178,255,0.1)" },
  pillText: { color: "#71717a", fontSize: 13, fontWeight: "500" },
  pillTextActive: { color: "#35b2ff" },
  emptyContainer: { flex: 1 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8 },
  emptyTitle: { color: "#a1a1aa", fontSize: 16, fontWeight: "500" },
  emptySubtitle: { color: "#52525b", fontSize: 14, textAlign: "center" },
  card: {
    marginHorizontal: 16, marginTop: 12, backgroundColor: "#18181b",
    borderRadius: 12, borderWidth: 1, borderColor: "#27272a", padding: 16, gap: 8,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  category: { color: "#a1a1aa", fontSize: 12, fontWeight: "500", textTransform: "capitalize" },
  grade: { fontSize: 12, fontWeight: "600" },
  quote: { color: "#d4d4d8", fontSize: 14, fontStyle: "italic", lineHeight: 20 },
  response: { color: "#a1a1aa", fontSize: 13, lineHeight: 18 },
  suggestionBox: {
    backgroundColor: "rgba(245,158,11,0.05)", borderWidth: 1,
    borderColor: "rgba(245,158,11,0.1)", borderRadius: 8, padding: 10,
  },
  suggestion: { color: "#f59e0b", fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: "row", gap: 16, paddingTop: 4 },
  actionLink: { color: "#35b2ff", fontSize: 13, fontWeight: "500" },
  overlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end",
  },
  overlayContent: {
    backgroundColor: "#18181b", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: "80%",
  },
  overlayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  overlayTitle: { color: "#fff", fontSize: 18, fontWeight: "700", textTransform: "capitalize" },
  overlaySubtitle: { color: "#71717a", fontSize: 13, marginBottom: 12 },
  exampleCard: {
    borderWidth: 1, borderColor: "#27272a", borderRadius: 10,
    padding: 14, marginBottom: 8, gap: 6,
  },
});
