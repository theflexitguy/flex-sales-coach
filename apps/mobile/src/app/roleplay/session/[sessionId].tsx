import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { apiGet } from "../../../services/api";
import { useAudioPlayer } from "../../../hooks/useAudioPlayer";

const GRADE_COLORS: Record<string, string> = {
  excellent: "#22c55e",
  good: "#35b2ff",
  acceptable: "#eab308",
  needs_improvement: "#f97316",
  poor: "#ef4444",
};

interface AnalysisResult {
  overallScore: number;
  overallGrade: string;
  summary: string;
  strengths: string[];
  improvements: string[];
  objectionHandlingScores: Array<{ category: string; grade: string; feedback: string }>;
  comparedToReal: { avgRealScore: number; delta: number } | null;
}

interface TranscriptLine {
  role: "rep" | "customer";
  text: string;
  startMs: number;
  endMs: number;
}

interface SessionReview {
  id: string;
  status: string;
  durationSeconds: number;
  scenarioTitle: string;
  scenarioDifficulty: string | null;
  targetObjections: string[];
  personaName: string;
  startedAt: string;
  endedAt: string | null;
  audioUrl: string | null;
  transcript: TranscriptLine[];
}

interface ReviewResponse {
  session: SessionReview;
  analysis: AnalysisResult | null;
  analysisStatus: "complete" | "processing" | "unavailable";
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, "0")}`;
}

function formatMs(ms: number) {
  return formatDuration(Math.floor(ms / 1000));
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function RoleplayAudioPlayer({ audioUrl, title }: { audioUrl: string; title: string }) {
  const player = useAudioPlayer(audioUrl, { title, artist: "Roleplay" });
  const durationMs = player.durationMs || 0;
  const progress = durationMs > 0 ? Math.min(100, Math.max(0, (player.positionMs / durationMs) * 100)) : 0;

  return (
    <View style={styles.audioPanel}>
      <TouchableOpacity style={styles.playButton} onPress={player.togglePlay} activeOpacity={0.8}>
        <Ionicons name={player.isPlaying ? "pause" : "play"} size={22} color="#000" />
      </TouchableOpacity>
      <View style={styles.audioMeta}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.audioTime}>
          {formatMs(player.positionMs)} / {durationMs ? formatMs(durationMs) : "--:--"}
        </Text>
      </View>
      <TouchableOpacity style={styles.skipButton} onPress={() => player.skip(-15)} activeOpacity={0.8}>
        <Ionicons name="play-back" size={18} color="#a1a1aa" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.skipButton} onPress={() => player.skip(15)} activeOpacity={0.8}>
        <Ionicons name="play-forward" size={18} color="#a1a1aa" />
      </TouchableOpacity>
    </View>
  );
}

export default function RoleplaySessionReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId: string }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const [session, setSession] = useState<SessionReview | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<ReviewResponse["analysisStatus"]>("unavailable");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async (recover = false) => {
    if (!sessionId) return;
    setRefreshing(true);
    setError(null);
    try {
      const data = await apiGet<ReviewResponse>(
        `/api/mobile/roleplay/sessions?sessionId=${encodeURIComponent(sessionId)}${recover ? "&recoverAnalysis=1" : ""}`
      );
      setSession(data.session);
      setAnalysis(data.analysis);
      setAnalysisStatus(data.analysisStatus);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load roleplay session");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSession(true);
  }, [loadSession]);

  useEffect(() => {
    if (!session || analysis || analysisStatus !== "processing") return;
    const timer = setInterval(() => {
      void loadSession(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [analysis, analysisStatus, loadSession, session]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#35b2ff" />
      </View>
    );
  }

  if (error || !session) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="warning" size={42} color="#ef4444" />
        <Text style={styles.errorText}>{error ?? "Roleplay session not found"}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => loadSession(true)} activeOpacity={0.8}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color="#d4d4d8" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Roleplay Review</Text>
        <TouchableOpacity style={styles.headerButton} onPress={() => loadSession(true)} activeOpacity={0.8}>
          {refreshing ? (
            <ActivityIndicator color="#35b2ff" size="small" />
          ) : (
            <Ionicons name="refresh" size={20} color="#35b2ff" />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroPanel}>
          <View style={styles.heroText}>
            <Text style={styles.title}>{session.scenarioTitle}</Text>
            <Text style={styles.meta}>
              {session.personaName} · {formatDuration(session.durationSeconds)}
            </Text>
            <Text style={styles.date}>
              {new Date(session.startedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          </View>
          {analysis && (
            <View style={styles.scorePill}>
              <Text style={[styles.scoreText, { color: GRADE_COLORS[analysis.overallGrade] ?? "#a1a1aa" }]}>
                {analysis.overallScore}
              </Text>
            </View>
          )}
        </View>

        {session.audioUrl ? (
          <RoleplayAudioPlayer audioUrl={session.audioUrl} title={session.scenarioTitle} />
        ) : (
          <Text style={styles.notice}>No audio recording saved for this session.</Text>
        )}

        {analysis ? (
          <View style={styles.section}>
            <View style={styles.gradeRow}>
              <Text style={styles.sectionTitle}>Score</Text>
              <Text style={[styles.gradeText, { color: GRADE_COLORS[analysis.overallGrade] ?? "#a1a1aa" }]}>
                {titleCase(analysis.overallGrade)}
              </Text>
            </View>
            <Text style={styles.summary}>{analysis.summary}</Text>

            {analysis.strengths.length > 0 && (
              <View style={styles.feedbackGroup}>
                <Text style={[styles.feedbackTitle, { color: "#22c55e" }]}>Strengths</Text>
                {analysis.strengths.map((item, index) => (
                  <Text key={`strength-${index}`} style={styles.feedbackText}>
                    <Text style={{ color: "#22c55e" }}>+ </Text>{item}
                  </Text>
                ))}
              </View>
            )}

            {analysis.improvements.length > 0 && (
              <View style={styles.feedbackGroup}>
                <Text style={[styles.feedbackTitle, { color: "#f59e0b" }]}>To Improve</Text>
                {analysis.improvements.map((item, index) => (
                  <Text key={`improvement-${index}`} style={styles.feedbackText}>
                    <Text style={{ color: "#f59e0b" }}>- </Text>{item}
                  </Text>
                ))}
              </View>
            )}

            {analysis.objectionHandlingScores.length > 0 && (
              <View style={styles.feedbackGroup}>
                <Text style={styles.feedbackTitle}>Objections</Text>
                {analysis.objectionHandlingScores.map((item, index) => (
                  <View key={`objection-${index}`} style={styles.objectionRow}>
                    <View style={styles.gradeRow}>
                      <Text style={styles.objectionCategory}>{item.category}</Text>
                      <Text style={[styles.objectionGrade, { color: GRADE_COLORS[item.grade] ?? "#a1a1aa" }]}>
                        {titleCase(item.grade)}
                      </Text>
                    </View>
                    <Text style={styles.objectionFeedback}>{item.feedback}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Score</Text>
            <Text style={styles.notice}>
              {analysisStatus === "processing"
                ? "Analysis is still processing."
                : "Analysis is not available for this session."}
            </Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Transcript</Text>
          {session.transcript.length > 0 ? (
            session.transcript.map((line, index) => (
              <View
                key={`${line.role}-${line.startMs}-${index}`}
                style={[styles.transcriptLine, line.role === "rep" ? styles.repLine : styles.customerLine]}
              >
                <View style={styles.transcriptHeader}>
                  <Text style={[styles.transcriptRole, line.role === "rep" ? styles.repRole : styles.customerRole]}>
                    {line.role === "rep" ? "You" : session.personaName}
                  </Text>
                  <Text style={styles.transcriptTime}>{formatMs(line.startMs)}</Text>
                </View>
                <Text style={styles.transcriptText}>{line.text}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.notice}>No transcript captured for this session.</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  center: { alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 58,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#18181b",
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  heroPanel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 12,
    backgroundColor: "#18181b",
    padding: 16,
  },
  heroText: { flex: 1, gap: 3 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  meta: { color: "#a1a1aa", fontSize: 13 },
  date: { color: "#52525b", fontSize: 12 },
  scorePill: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#09090b",
    alignItems: "center",
    justifyContent: "center",
  },
  scoreText: { fontSize: 22, fontWeight: "800" },
  audioPanel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 12,
    backgroundColor: "#18181b",
    padding: 12,
  },
  playButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#35b2ff",
    alignItems: "center",
    justifyContent: "center",
  },
  audioMeta: { flex: 1, gap: 7 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: "#27272a", overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: "#35b2ff" },
  audioTime: { color: "#71717a", fontSize: 11, fontFamily: "monospace" },
  skipButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#09090b",
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 12,
    backgroundColor: "#18181b",
    padding: 16,
    gap: 12,
  },
  sectionTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  gradeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  gradeText: { fontSize: 13, fontWeight: "800" },
  summary: { color: "#d4d4d8", fontSize: 14, lineHeight: 20 },
  feedbackGroup: { gap: 8 },
  feedbackTitle: { color: "#35b2ff", fontSize: 13, fontWeight: "800" },
  feedbackText: { color: "#d4d4d8", fontSize: 13, lineHeight: 19 },
  objectionRow: { backgroundColor: "#09090b", borderRadius: 10, padding: 12, gap: 6 },
  objectionCategory: { color: "#d4d4d8", fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  objectionGrade: { fontSize: 12, fontWeight: "800" },
  objectionFeedback: { color: "#a1a1aa", fontSize: 12, lineHeight: 17 },
  transcriptLine: {
    borderRadius: 10,
    padding: 12,
    gap: 6,
    borderWidth: 1,
  },
  repLine: { backgroundColor: "rgba(53,178,255,0.08)", borderColor: "rgba(53,178,255,0.18)" },
  customerLine: { backgroundColor: "#09090b", borderColor: "#27272a" },
  transcriptHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  transcriptRole: { fontSize: 12, fontWeight: "800" },
  repRole: { color: "#35b2ff" },
  customerRole: { color: "#a78bfa" },
  transcriptTime: { color: "#52525b", fontSize: 12, fontFamily: "monospace" },
  transcriptText: { color: "#e4e4e7", fontSize: 14, lineHeight: 20 },
  notice: { color: "#71717a", fontSize: 13, lineHeight: 18 },
  errorText: { color: "#ef4444", fontSize: 15, textAlign: "center" },
  retryButton: { backgroundColor: "#27272a", borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: "#d4d4d8", fontSize: 14, fontWeight: "700" },
});
