import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet } from "../../services/api";
import { useCachedFetch } from "../../hooks/useCachedFetch";

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "#22c55e",
  intermediate: "#eab308",
  advanced: "#ef4444",
  extreme: "#f43f5e",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Easy",
  intermediate: "Medium",
  advanced: "Hard",
  extreme: "Extreme",
};

const TYPE_ICONS: Record<string, string> = {
  objection_drill: "shield-checkmark",
  full_pitch: "megaphone",
  cold_open: "hand-left",
  callback: "call",
  custom: "sparkles",
};

interface Persona {
  id: string;
  name: string;
  description: string;
  voice_id: string;
  personality: { tone: string };
}

interface Scenario {
  id: string;
  personaId: string;
  title: string;
  description: string;
  scenarioType: string;
  difficulty: string;
  targetObjections: string[];
  persona: Persona | null;
  recommended: boolean;
}

interface ScenariosResponse {
  scenarios: Scenario[];
  weakCategories: string[];
  sessionsToday: number;
}

export function ScenarioBrowser() {
  const router = useRouter();

  const { data, loading, refreshing, refresh } = useCachedFetch(
    "roleplay-scenarios",
    () => apiGet<ScenariosResponse>("/api/mobile/roleplay/scenarios")
  );

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#35b2ff" /></View>;
  }

  const recommended = data?.scenarios.filter((s) => s.recommended) ?? [];
  const allScenarios = data?.scenarios ?? [];

  return (
    <FlatList
      data={allScenarios}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor="#35b2ff"
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {/* Quick practice card */}
          <TouchableOpacity
            style={styles.quickCard}
            onPress={() => {
              const pick = allScenarios[Math.floor(Math.random() * allScenarios.length)];
              if (pick) router.push(`/roleplay/${pick.id}`);
            }}
            activeOpacity={0.8}
          >
            <View style={styles.quickCardInner}>
              <View style={styles.quickIconWrap}>
                <Ionicons name="flash" size={24} color="#000" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.quickTitle}>Quick Practice</Text>
                <Text style={styles.quickSubtitle}>Jump into a random scenario</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.5)" />
            </View>
          </TouchableOpacity>

          {/* Sessions today */}
          <Text style={styles.sessionsCount}>
            {data?.sessionsToday ?? 0}/10 sessions today
          </Text>

          {/* Recommended section */}
          {recommended.length > 0 && (
            <View>
              <Text style={styles.sectionLabel}>Recommended for you</Text>
              <Text style={styles.sectionHint}>
                Based on your weakest areas: {data?.weakCategories.join(", ")}
              </Text>
            </View>
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="game-controller-outline" size={48} color="#3f3f46" />
          <Text style={styles.emptyTitle}>No scenarios yet</Text>
          <Text style={styles.emptySubtitle}>Ask your manager to generate training scenarios</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[styles.card, item.recommended && styles.cardRecommended]}
          onPress={() => router.push(`/roleplay/${item.id}`)}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Ionicons
                name={(TYPE_ICONS[item.scenarioType] ?? "sparkles") as keyof typeof Ionicons.glyphMap}
                size={16}
                color="#71717a"
              />
              <Text style={styles.cardType}>
                {item.scenarioType.replace(/_/g, " ")}
              </Text>
            </View>
            <View style={styles.cardHeaderRight}>
              {item.recommended && (
                <View style={styles.recBadge}>
                  <Ionicons name="star" size={10} color="#f59e0b" />
                  <Text style={styles.recText}>For you</Text>
                </View>
              )}
              <Text style={[styles.difficulty, { color: DIFFICULTY_COLORS[item.difficulty] }]}>
                {DIFFICULTY_LABELS[item.difficulty] ?? item.difficulty}
              </Text>
            </View>
          </View>

          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardDesc}>{item.description}</Text>

          {item.persona && (
            <View style={styles.personaRow}>
              <View style={styles.personaAvatar}>
                <Text style={styles.personaInitial}>
                  {item.persona.name.charAt(0)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.personaName}>{item.persona.name}</Text>
                <Text style={styles.personaTone}>{item.persona.personality?.tone}</Text>
              </View>
            </View>
          )}

          {item.targetObjections.length > 0 && (
            <View style={styles.tags}>
              {item.targetObjections.map((t) => (
                <View key={t} style={styles.tag}>
                  <Text style={styles.tagText}>{t}</Text>
                </View>
              ))}
            </View>
          )}
        </TouchableOpacity>
      )}
      contentContainerStyle={allScenarios.length === 0 ? styles.emptyContainer : { padding: 16, gap: 12 }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#09090b" },
  emptyContainer: { flex: 1 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8, padding: 40 },
  emptyTitle: { color: "#a1a1aa", fontSize: 16, fontWeight: "500" },
  emptySubtitle: { color: "#52525b", fontSize: 14, textAlign: "center" },

  quickCard: {
    backgroundColor: "#35b2ff",
    borderRadius: 16,
    overflow: "hidden",
  },
  quickCardInner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  quickIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center", alignItems: "center",
  },
  quickTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  quickSubtitle: { color: "rgba(255,255,255,0.7)", fontSize: 13 },

  sessionsCount: { color: "#52525b", fontSize: 12, textAlign: "center" },
  sectionLabel: { color: "#fff", fontSize: 15, fontWeight: "600" },
  sectionHint: { color: "#52525b", fontSize: 12, marginTop: 2 },

  card: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 16,
    gap: 8,
  },
  cardRecommended: {
    borderColor: "rgba(245,158,11,0.3)",
    backgroundColor: "rgba(245,158,11,0.03)",
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardHeaderRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardType: { color: "#71717a", fontSize: 12, fontWeight: "500", textTransform: "capitalize" },
  difficulty: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
  recBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "rgba(245,158,11,0.1)",
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
  },
  recText: { color: "#f59e0b", fontSize: 10, fontWeight: "600" },
  cardTitle: { color: "#fff", fontSize: 15, fontWeight: "600" },
  cardDesc: { color: "#a1a1aa", fontSize: 13, lineHeight: 18 },
  personaRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 },
  personaAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(53,178,255,0.1)",
    justifyContent: "center", alignItems: "center",
  },
  personaInitial: { color: "#35b2ff", fontSize: 13, fontWeight: "700" },
  personaName: { color: "#d4d4d8", fontSize: 12, fontWeight: "500" },
  personaTone: { color: "#52525b", fontSize: 11 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 4 },
  tag: {
    backgroundColor: "rgba(53,178,255,0.08)",
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  tagText: { color: "#35b2ff", fontSize: 10, fontWeight: "500", textTransform: "capitalize" },
});
