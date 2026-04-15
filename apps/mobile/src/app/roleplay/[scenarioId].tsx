import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Alert, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useRoleplaySession } from "../../hooks/useRoleplaySession";
import { apiGet } from "../../services/api";
import { haptic } from "../../lib/haptics";

const GRADE_COLORS: Record<string, string> = {
  excellent: "#22c55e", good: "#35b2ff", acceptable: "#eab308",
  needs_improvement: "#f97316", poor: "#ef4444",
};

interface ScenarioDetail {
  id: string;
  title: string;
  description: string;
  scenarioType: string;
  difficulty: string;
  targetObjections: string[];
  persona: {
    id: string;
    name: string;
    description: string;
    personality: { tone: string };
  } | null;
}

interface AnalysisResult {
  overallScore: number;
  overallGrade: string;
  summary: string;
  strengths: string[];
  improvements: string[];
  objectionHandlingScores: Array<{ category: string; grade: string; feedback: string }>;
  comparedToReal: { avgRealScore: number; delta: number } | null;
}

export default function RoleplaySessionScreen() {
  const { scenarioId } = useLocalSearchParams<{ scenarioId: string }>();
  const router = useRouter();
  const [scenario, setScenario] = useState<ScenarioDetail | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  const {
    phase, personaName, agentSpeaking, transcript,
    duration, result, errorMessage,
    startSession, endSession, reset,
  } = useRoleplaySession();

  // Load scenario details
  useEffect(() => {
    if (!scenarioId) return;
    apiGet<{ scenarios: ScenarioDetail[] }>("/api/mobile/roleplay/scenarios")
      .then((d) => {
        const match = d.scenarios.find((s) => s.id === scenarioId);
        if (match) setScenario(match);
      })
      .catch(() => {});
  }, [scenarioId]);

  // Poll for analysis after completion
  useEffect(() => {
    if (phase !== "completed" || !result?.sessionId) return;
    setLoadingAnalysis(true);

    const pollInterval = setInterval(async () => {
      try {
        const data = await apiGet<{ analysis: AnalysisResult | null }>(
          `/api/mobile/roleplay/sessions?sessionId=${result.sessionId}`
        );
        if (data.analysis) {
          setAnalysis(data.analysis);
          setLoadingAnalysis(false);
          clearInterval(pollInterval);
        }
      } catch { /* keep polling */ }
    }, 3000);

    // Stop after 30s
    const timeout = setTimeout(() => {
      clearInterval(pollInterval);
      setLoadingAnalysis(false);
    }, 30000);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [phase, result?.sessionId]);

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // ── PRE-SESSION BRIEFING ──
  if (phase === "idle") {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.briefing}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#a1a1aa" />
          </TouchableOpacity>

          {scenario?.persona && (
            <View style={styles.personaCard}>
              <View style={styles.personaAvatarLarge}>
                <Text style={styles.personaInitialLarge}>
                  {scenario.persona.name.charAt(0)}
                </Text>
              </View>
              <Text style={styles.personaNameLarge}>{scenario.persona.name}</Text>
              <Text style={styles.personaDesc}>{scenario.persona.description}</Text>
              <Text style={styles.personaTone}>{scenario.persona.personality?.tone}</Text>
            </View>
          )}

          <Text style={styles.scenarioTitle}>{scenario?.title ?? "Roleplay Practice"}</Text>
          <Text style={styles.scenarioDesc}>{scenario?.description}</Text>

          {(scenario?.targetObjections?.length ?? 0) > 0 && (
            <View style={styles.objectionTags}>
              <Text style={styles.objectionLabel}>Objections you'll face:</Text>
              <View style={styles.tags}>
                {scenario?.targetObjections.map((t) => (
                  <View key={t} style={styles.tag}>
                    <Text style={styles.tagText}>{t}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.tips}>
            <Ionicons name="bulb-outline" size={16} color="#f59e0b" />
            <Text style={styles.tipsText}>
              Speak naturally like you would at a door. The AI will respond as a real customer would.
              {Platform.OS === "ios" ? " Headphones recommended for best experience." : ""}
            </Text>
          </View>
        </ScrollView>

        <View style={styles.bottomAction}>
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => {
              haptic("medium");
              startSession(scenarioId);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="mic" size={22} color="#000" />
            <Text style={styles.startBtnText}>Start Conversation</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── CONNECTING ──
  if (phase === "connecting") {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#35b2ff" />
        <Text style={styles.connectingText}>Connecting to {scenario?.persona?.name ?? "customer"}...</Text>
      </View>
    );
  }

  // ── ACTIVE SESSION ──
  if (phase === "active") {
    return (
      <View style={styles.container}>
        {/* Live transcript */}
        <ScrollView style={styles.liveTranscript} contentContainerStyle={{ padding: 16, paddingBottom: 160 }}>
          {transcript.map((line, i) => (
            <View key={i} style={[styles.chatBubble, line.role === "rep" ? styles.repBubble : styles.customerBubble]}>
              <Text style={styles.chatRole}>{line.role === "rep" ? "You" : personaName}</Text>
              <Text style={styles.chatText}>{line.text}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Bottom controls */}
        <View style={styles.activeControls}>
          {/* Speaking indicator */}
          <View style={styles.speakingIndicator}>
            <View style={[styles.speakingDot, agentSpeaking && styles.speakingDotActive]} />
            <Text style={styles.speakingLabel}>
              {agentSpeaking ? `${personaName} is speaking...` : "Listening..."}
            </Text>
          </View>

          <Text style={styles.timer}>{formatDuration(duration)}</Text>

          <TouchableOpacity
            style={styles.endBtn}
            onPress={() => {
              haptic("heavy");
              Alert.alert("End Session", "Ready to wrap up?", [
                { text: "Keep Going", style: "cancel" },
                { text: "End & Review", style: "destructive", onPress: endSession },
              ]);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="stop" size={20} color="#fff" />
            <Text style={styles.endBtnText}>End Session</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── ENDING ──
  if (phase === "ending") {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#35b2ff" />
        <Text style={styles.connectingText}>Wrapping up...</Text>
      </View>
    );
  }

  // ── ERROR ──
  if (phase === "error") {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="warning" size={48} color="#ef4444" />
        <Text style={styles.errorText}>{errorMessage ?? "Something went wrong"}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={reset}>
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── COMPLETED — RESULTS ──
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={styles.resultsTitle}>Session Complete</Text>
      <Text style={styles.resultsDuration}>{formatDuration(result?.durationSeconds ?? duration)}</Text>

      {loadingAnalysis ? (
        <View style={styles.analysisLoading}>
          <ActivityIndicator color="#35b2ff" />
          <Text style={styles.analysisLoadingText}>Analyzing your performance...</Text>
        </View>
      ) : analysis ? (
        <View style={styles.analysisCard}>
          {/* Score */}
          <View style={styles.scoreRow}>
            <Text style={[styles.scoreBig, { color: GRADE_COLORS[analysis.overallGrade] }]}>
              {analysis.overallScore}
            </Text>
            <Text style={[styles.gradeLabel, { color: GRADE_COLORS[analysis.overallGrade] }]}>
              {analysis.overallGrade.replace(/_/g, " ")}
            </Text>
          </View>

          <Text style={styles.analysisSummary}>{analysis.summary}</Text>

          {/* Compared to real */}
          {analysis.comparedToReal && (
            <View style={styles.comparedCard}>
              <Text style={styles.comparedLabel}>vs. your real calls</Text>
              <Text style={[styles.comparedDelta, { color: analysis.comparedToReal.delta >= 0 ? "#22c55e" : "#f97316" }]}>
                {analysis.comparedToReal.delta >= 0 ? "+" : ""}{analysis.comparedToReal.delta} points
              </Text>
            </View>
          )}

          {/* Strengths */}
          {analysis.strengths.length > 0 && (
            <View style={styles.feedbackSection}>
              <Text style={styles.feedbackTitle}>Strengths</Text>
              {analysis.strengths.map((s, i) => (
                <Text key={i} style={styles.feedbackItem}>
                  <Text style={{ color: "#22c55e" }}>+ </Text>{s}
                </Text>
              ))}
            </View>
          )}

          {/* Improvements */}
          {analysis.improvements.length > 0 && (
            <View style={styles.feedbackSection}>
              <Text style={[styles.feedbackTitle, { color: "#f59e0b" }]}>To Improve</Text>
              {analysis.improvements.map((s, i) => (
                <Text key={i} style={styles.feedbackItem}>
                  <Text style={{ color: "#f59e0b" }}>- </Text>{s}
                </Text>
              ))}
            </View>
          )}

          {/* Objection scores */}
          {analysis.objectionHandlingScores.length > 0 && (
            <View style={styles.feedbackSection}>
              <Text style={styles.feedbackTitle}>Objection Handling</Text>
              {analysis.objectionHandlingScores.map((o, i) => (
                <View key={i} style={styles.objectionScore}>
                  <View style={styles.objectionScoreHeader}>
                    <Text style={styles.objectionCat}>{o.category}</Text>
                    <Text style={[styles.objectionGrade, { color: GRADE_COLORS[o.grade] }]}>
                      {o.grade.replace(/_/g, " ")}
                    </Text>
                  </View>
                  <Text style={styles.objectionFeedback}>{o.feedback}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <Text style={styles.noAnalysis}>Analysis not available yet</Text>
      )}

      {/* Actions */}
      <View style={styles.resultActions}>
        <TouchableOpacity
          style={styles.tryAgainBtn}
          onPress={() => { reset(); }}
          activeOpacity={0.8}
        >
          <Ionicons name="refresh" size={18} color="#35b2ff" />
          <Text style={styles.tryAgainText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  center: { justifyContent: "center", alignItems: "center", gap: 12 },

  // Briefing
  briefing: { padding: 20, paddingBottom: 120, gap: 16 },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  personaCard: { alignItems: "center", gap: 8, paddingVertical: 12 },
  personaAvatarLarge: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "rgba(53,178,255,0.1)",
    justifyContent: "center", alignItems: "center",
  },
  personaInitialLarge: { color: "#35b2ff", fontSize: 28, fontWeight: "700" },
  personaNameLarge: { color: "#fff", fontSize: 20, fontWeight: "700" },
  personaDesc: { color: "#a1a1aa", fontSize: 14, textAlign: "center", lineHeight: 20 },
  personaTone: { color: "#52525b", fontSize: 12 },
  scenarioTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  scenarioDesc: { color: "#a1a1aa", fontSize: 14, lineHeight: 20 },
  objectionTags: { gap: 6 },
  objectionLabel: { color: "#71717a", fontSize: 12 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { backgroundColor: "rgba(245,158,11,0.1)", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { color: "#f59e0b", fontSize: 12, fontWeight: "500", textTransform: "capitalize" },
  tips: {
    flexDirection: "row", gap: 8, padding: 14,
    backgroundColor: "rgba(245,158,11,0.05)",
    borderWidth: 1, borderColor: "rgba(245,158,11,0.1)", borderRadius: 12,
  },
  tipsText: { color: "#a1a1aa", fontSize: 13, lineHeight: 18, flex: 1 },

  bottomAction: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: Platform.OS === "ios" ? 36 : 20, backgroundColor: "#09090b" },
  startBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#35b2ff", borderRadius: 14, padding: 16,
  },
  startBtnText: { color: "#000", fontSize: 17, fontWeight: "700" },

  // Connecting
  connectingText: { color: "#a1a1aa", fontSize: 15, marginTop: 8 },

  // Active
  liveTranscript: { flex: 1 },
  chatBubble: { marginBottom: 10, maxWidth: "85%", borderRadius: 14, padding: 12 },
  repBubble: { backgroundColor: "rgba(53,178,255,0.1)", alignSelf: "flex-end", borderBottomRightRadius: 4 },
  customerBubble: { backgroundColor: "#18181b", alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  chatRole: { color: "#71717a", fontSize: 10, fontWeight: "600", marginBottom: 2, textTransform: "uppercase" },
  chatText: { color: "#d4d4d8", fontSize: 14, lineHeight: 20 },
  activeControls: {
    borderTopWidth: 1, borderTopColor: "#27272a",
    backgroundColor: "#18181b", padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 20,
    alignItems: "center", gap: 12,
  },
  speakingIndicator: { flexDirection: "row", alignItems: "center", gap: 8 },
  speakingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#3f3f46" },
  speakingDotActive: { backgroundColor: "#22c55e" },
  speakingLabel: { color: "#71717a", fontSize: 13 },
  timer: { color: "#fff", fontSize: 28, fontWeight: "700", fontFamily: "monospace" },
  endBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#ef4444", borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, width: "100%",
  },
  endBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // Error
  errorText: { color: "#ef4444", fontSize: 15, textAlign: "center", maxWidth: 280 },
  retryBtn: { backgroundColor: "#27272a", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, marginTop: 8 },
  retryText: { color: "#d4d4d8", fontSize: 14, fontWeight: "500" },

  // Results
  resultsTitle: { color: "#fff", fontSize: 24, fontWeight: "700", textAlign: "center", marginTop: 20 },
  resultsDuration: { color: "#52525b", fontSize: 14, textAlign: "center", marginTop: 4, fontFamily: "monospace" },
  analysisLoading: { alignItems: "center", gap: 8, paddingVertical: 40 },
  analysisLoadingText: { color: "#71717a", fontSize: 14 },
  analysisCard: {
    backgroundColor: "#18181b", borderRadius: 16, borderWidth: 1,
    borderColor: "#27272a", padding: 20, marginTop: 16, gap: 16,
  },
  scoreRow: { alignItems: "center", gap: 4 },
  scoreBig: { fontSize: 56, fontWeight: "700" },
  gradeLabel: { fontSize: 14, fontWeight: "600", textTransform: "capitalize" },
  analysisSummary: { color: "#a1a1aa", fontSize: 14, lineHeight: 20, textAlign: "center" },
  comparedCard: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "rgba(53,178,255,0.05)", borderRadius: 10, padding: 12,
  },
  comparedLabel: { color: "#71717a", fontSize: 12 },
  comparedDelta: { fontSize: 14, fontWeight: "700" },
  feedbackSection: { gap: 6 },
  feedbackTitle: { color: "#22c55e", fontSize: 13, fontWeight: "600" },
  feedbackItem: { color: "#d4d4d8", fontSize: 13, lineHeight: 18 },
  objectionScore: { backgroundColor: "#09090b", borderRadius: 8, padding: 10, gap: 4 },
  objectionScoreHeader: { flexDirection: "row", justifyContent: "space-between" },
  objectionCat: { color: "#a1a1aa", fontSize: 12, textTransform: "capitalize" },
  objectionGrade: { fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
  objectionFeedback: { color: "#71717a", fontSize: 12, lineHeight: 16 },
  noAnalysis: { color: "#52525b", fontSize: 14, textAlign: "center", paddingVertical: 20 },
  resultActions: { flexDirection: "row", gap: 12, marginTop: 20 },
  tryAgainBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1, borderColor: "#27272a", borderRadius: 12, padding: 14,
  },
  tryAgainText: { color: "#35b2ff", fontSize: 15, fontWeight: "600" },
  doneBtn: {
    flex: 1, backgroundColor: "#35b2ff", borderRadius: 12, padding: 14,
    alignItems: "center", justifyContent: "center",
  },
  doneBtnText: { color: "#000", fontSize: 15, fontWeight: "700" },
});
