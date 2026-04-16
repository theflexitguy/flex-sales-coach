import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Pressable,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Linking,
} from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer } from "../../../hooks/useAudioPlayer";
import { OutcomeSelector } from "../../../components/calls/outcome-selector";
import { AddNoteForm } from "../../../components/calls/add-note-form";
import { CallAIChat } from "../../../components/chat/call-ai-chat";
import { SkeletonList } from "../../../components/ui/skeleton";
import { ErrorState } from "../../../components/ui/error-state";
import { haptic } from "../../../lib/haptics";
import { apiGet, apiPost } from "../../../services/api";
import { reverseGeocode } from "../../../services/location";
import { VoiceNoteRecorder } from "../../../components/calls/voice-note-recorder";

const GRADE_COLORS: Record<string, string> = {
  excellent: "#22c55e",
  good: "#35b2ff",
  acceptable: "#eab308",
  needs_improvement: "#f97316",
  poor: "#ef4444",
};
const GRADE_LABELS: Record<string, string> = {
  excellent: "Excellent",
  good: "Good",
  acceptable: "Acceptable",
  needs_improvement: "Needs Improvement",
  poor: "Poor",
};

interface CallDetail {
  call: {
    id: string;
    customerName: string | null;
    durationSeconds: number;
    status: string;
    recordedAt: string;
    audioUrl: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  analysis: {
    overallScore: number;
    overallGrade: string;
    summary: string;
    strengths: string[];
    improvements: string[];
    talkRatioRep: number;
    talkRatioCustomer: number;
  } | null;
  sections: Array<{
    id: string;
    sectionType: string;
    startMs: number;
    endMs: number;
    summary: string;
    grade: string;
  }>;
  objections: Array<{
    id: string;
    category: string;
    utteranceText: string;
    repResponse: string;
    handlingGrade: string;
    suggestion: string;
  }>;
  transcript: {
    fullText: string | null;
    utterances: Array<{
      speaker: string;
      startMs: number;
      endMs: number;
      text: string;
    }>;
  };
  notes: Array<{
    id: string;
    content: string;
    timestampMs: number | null;
    createdAt: string;
    authorName: string;
  }>;
  helpRequests: Array<{
    id: string;
    startMs: number;
    endMs: number;
    transcriptExcerpt: string;
    message: string | null;
    status: string;
    repName: string;
    createdAt: string;
  }>;
}

export default function CallDetailScreen() {
  const { id, seekMs: seekMsParam } = useLocalSearchParams<{ id: string; seekMs?: string }>();
  const initialSeekMs = seekMsParam ? parseInt(seekMsParam, 10) : null;
  const didInitialSeek = useRef<string | null>(null);
  const [data, setData] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [helpModal, setHelpModal] = useState<{ text: string; startMs: number; endMs: number } | null>(null);
  const [helpMessage, setHelpMessage] = useState("");
  const [sendingHelp, setSendingHelp] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [localHelpRequests, setLocalHelpRequests] = useState<CallDetail["helpRequests"]>([]);

  const navigation = useNavigation();
  const router = useRouter();
  const audioPlayer = useAudioPlayer(data?.call.audioUrl ?? null);
  const [address, setAddress] = useState<string | null>(null);

  // Set header with back button
  useEffect(() => {
    navigation.setOptions({
      title: data?.call.customerName ?? "Conversation",
      headerShown: true,
      headerLeft: () => (
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 8 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
      ),
    });
  }, [data?.call.customerName, navigation, router]);

  // Reverse geocode location
  useEffect(() => {
    if (data?.call.latitude && data?.call.longitude) {
      reverseGeocode({ latitude: data.call.latitude, longitude: data.call.longitude })
        .then(setAddress)
        .catch(() => {});
    }
  }, [data?.call.latitude, data?.call.longitude]);

  // Transcript auto-follow state
  const scrollViewRef = useRef<ScrollView>(null);
  const utteranceYPositions = useRef<Record<number, number>>({});
  const transcriptSectionY = useRef(0);
  const [autoFollow, setAutoFollow] = useState(true);
  const [userScrolledAway, setUserScrolledAway] = useState(false);
  const isAutoScrolling = useRef(false);
  const snapBackOpacity = useRef(new Animated.Value(0)).current;
  const lastAutoScrollIndex = useRef(-1);

  // Find the current utterance index based on playback position
  const currentUtteranceIndex = data?.transcript.utterances.findIndex((u, i, arr) => {
    const next = arr[i + 1];
    return audioPlayer.positionMs >= u.startMs && (!next || audioPlayer.positionMs < next.startMs);
  }) ?? -1;

  // Auto-scroll to current utterance when playing
  useEffect(() => {
    if (
      !audioPlayer.isPlaying ||
      !autoFollow ||
      currentUtteranceIndex < 0 ||
      currentUtteranceIndex === lastAutoScrollIndex.current
    ) return;

    const localY = utteranceYPositions.current[currentUtteranceIndex];
    if (localY != null) {
      lastAutoScrollIndex.current = currentUtteranceIndex;
      isAutoScrolling.current = true;
      const absoluteY = transcriptSectionY.current + localY;
      scrollViewRef.current?.scrollTo({ y: absoluteY - 120, animated: true });
      setTimeout(() => { isAutoScrolling.current = false; }, 400);
    }
  }, [currentUtteranceIndex, audioPlayer.isPlaying, autoFollow]);

  // Show/hide snap-back pill
  useEffect(() => {
    Animated.timing(snapBackOpacity, {
      toValue: userScrolledAway && audioPlayer.isPlaying ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [userScrolledAway, audioPlayer.isPlaying, snapBackOpacity]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isAutoScrolling.current) return;
    // User manually scrolled while playing — disable auto-follow
    if (audioPlayer.isPlaying && autoFollow) {
      setAutoFollow(false);
      setUserScrolledAway(true);
    }
  }, [audioPlayer.isPlaying, autoFollow]);

  const handleSnapBack = useCallback(() => {
    setAutoFollow(true);
    setUserScrolledAway(false);
    const localY = utteranceYPositions.current[currentUtteranceIndex];
    if (localY != null) {
      isAutoScrolling.current = true;
      const absoluteY = transcriptSectionY.current + localY;
      scrollViewRef.current?.scrollTo({ y: absoluteY - 120, animated: true });
      setTimeout(() => { isAutoScrolling.current = false; }, 400);
    }
  }, [currentUtteranceIndex]);

  // Seek audio and pause auto-follow so it doesn't fight the jump
  const seekToTimestamp = useCallback(async (ms: number) => {
    setAutoFollow(false);
    setUserScrolledAway(true);
    lastAutoScrollIndex.current = -1;
    await audioPlayer.seekTo(ms);
    if (!audioPlayer.isPlaying) audioPlayer.play();
  }, [audioPlayer]);

  function fetchData() {
    setLoading(true);
    setFetchError(false);
    apiGet<CallDetail>(`/api/mobile/calls/${id}`)
      .then(setData)
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchData();
  }, [id]);

  // Sync local help requests from API data
  useEffect(() => {
    if (data?.helpRequests) setLocalHelpRequests(data.helpRequests);
  }, [data?.helpRequests]);

  // Auto-seek to timestamp and scroll to that spot in transcript
  const seekKey = `${id}-${seekMsParam}`;
  useEffect(() => {
    if (initialSeekMs != null && data?.call.audioUrl && didInitialSeek.current !== seekKey) {
      didInitialSeek.current = seekKey;

      // Step 1: Scroll to the transcript section so utterances render and populate positions
      scrollViewRef.current?.scrollTo({ y: transcriptSectionY.current, animated: false });

      // Step 2: After positions are populated, scroll to the exact utterance and start playing
      setTimeout(() => {
        audioPlayer.seekTo(initialSeekMs);
        audioPlayer.play();

        const idx = data?.transcript.utterances.findIndex(
          (u) => u.startMs >= initialSeekMs
        ) ?? -1;
        const localY = utteranceYPositions.current[idx];
        if (localY != null) {
          const absoluteY = transcriptSectionY.current + localY;
          isAutoScrolling.current = true;
          scrollViewRef.current?.scrollTo({ y: absoluteY - 120, animated: true });
          setTimeout(() => { isAutoScrolling.current = false; }, 500);
        }

        // Enable auto-follow so the transcript keeps scrolling with playback
        setAutoFollow(true);
        setUserScrolledAway(false);
      }, 800);
    }
  }, [data?.call.audioUrl, initialSeekMs, seekKey]);

  if (loading) return <SkeletonList count={6} />;

  if (fetchError || !data) {
    return <ErrorState message={fetchError ? "Failed to load call" : "Call not found"} onRetry={fetchData} />;
  }

  const { call, analysis, sections, objections, transcript, notes, helpRequests } = data;

  return (
    <>
    <ScrollView
      ref={scrollViewRef}
      style={styles.container}
      contentContainerStyle={{ paddingBottom: call.audioUrl ? 120 : 40 }}
      onScrollBeginDrag={handleScroll}
      scrollEventThrottle={16}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.customerName}>
            {call.customerName ?? "Unknown Customer"}
          </Text>
          <Text style={styles.meta}>
            {new Date(call.recordedAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        </View>
        {analysis && (
          <View style={styles.scoreCircle}>
            <Text
              style={[
                styles.scoreNumber,
                { color: GRADE_COLORS[analysis.overallGrade] ?? "#a1a1aa" },
              ]}
            >
              {analysis.overallScore}
            </Text>
            <Text
              style={[
                styles.gradeLabel,
                { color: GRADE_COLORS[analysis.overallGrade] ?? "#a1a1aa" },
              ]}
            >
              {GRADE_LABELS[analysis.overallGrade] ?? analysis.overallGrade}
            </Text>
          </View>
        )}
      </View>

      {/* Location Pin */}
      {call.latitude && call.longitude && (
        <TouchableOpacity
          style={styles.locationCard}
          onPress={() => {
            const url = Platform.select({
              ios: `maps:0,0?q=${call.latitude},${call.longitude}`,
              android: `geo:${call.latitude},${call.longitude}?q=${call.latitude},${call.longitude}`,
            });
            if (url) Linking.openURL(url);
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="location" size={18} color="#35b2ff" />
          <View style={{ flex: 1 }}>
            <Text style={styles.locationAddress} numberOfLines={1}>
              {address ?? `${call.latitude.toFixed(5)}, ${call.longitude.toFixed(5)}`}
            </Text>
            <Text style={styles.locationHint}>Tap to open in Maps</Text>
          </View>
          <Ionicons name="open-outline" size={14} color="#52525b" />
        </TouchableOpacity>
      )}

      {/* Outcome */}
      <OutcomeSelector callId={call.id} currentOutcome={(call as Record<string, unknown>).outcome as string | null} />

      {/* AI Summary */}
      {analysis && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI Summary</Text>
          <Text style={styles.summaryText}>{analysis.summary}</Text>

          <View style={styles.columnsRow}>
            <View style={styles.column}>
              <Text style={styles.columnHeader}>Strengths</Text>
              {analysis.strengths.map((s, i) => (
                <Text key={i} style={styles.bulletItem}>
                  <Text style={{ color: "#35b2ff" }}>+ </Text>
                  {s}
                </Text>
              ))}
            </View>
            <View style={styles.column}>
              <Text style={[styles.columnHeader, { color: "#f59e0b" }]}>
                To Improve
              </Text>
              {analysis.improvements.map((s, i) => (
                <Text key={i} style={styles.bulletItem}>
                  <Text style={{ color: "#f59e0b" }}>- </Text>
                  {s}
                </Text>
              ))}
            </View>
          </View>

          {/* Talk ratio */}
          <Text style={styles.ratioLabel}>Talk Ratio</Text>
          <View style={styles.ratioBar}>
            <View
              style={[
                styles.ratioFillRep,
                { width: `${(analysis.talkRatioRep * 100).toFixed(0)}%` as `${number}%` },
              ]}
            />
            <View
              style={[
                styles.ratioFillCustomer,
                { width: `${(analysis.talkRatioCustomer * 100).toFixed(0)}%` as `${number}%` },
              ]}
            />
          </View>
          <View style={styles.ratioLabels}>
            <Text style={styles.ratioText}>
              Rep {(analysis.talkRatioRep * 100).toFixed(0)}%
            </Text>
            <Text style={styles.ratioText}>
              Customer {(analysis.talkRatioCustomer * 100).toFixed(0)}%
            </Text>
          </View>
        </View>
      )}

      {/* Sections */}
      {sections.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Call Sections</Text>
          {sections.map((s) => (
            <TouchableOpacity key={s.id} style={styles.sectionCard} onPress={() => seekToTimestamp(s.startMs)} activeOpacity={0.7}>
              <View style={styles.sectionCardHeader}>
                <View
                  style={[
                    styles.sectionDot,
                    { backgroundColor: GRADE_COLORS[s.grade] ?? "#71717a" },
                  ]}
                />
                <Text style={styles.sectionType}>
                  {s.sectionType.replace(/_/g, " ")}
                </Text>
                <Ionicons name="play-circle-outline" size={14} color="#52525b" style={{ marginRight: 4 }} />
                <Text
                  style={[
                    styles.sectionGrade,
                    { color: GRADE_COLORS[s.grade] ?? "#71717a" },
                  ]}
                >
                  {GRADE_LABELS[s.grade] ?? s.grade}
                </Text>
              </View>
              <Text style={styles.sectionSummary}>{s.summary}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Objections */}
      {objections.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Objections ({objections.length})
          </Text>
          {objections.map((o) => {
            // Find the transcript utterance that contains this objection text
            const matchIdx = transcript.utterances.findIndex((u) =>
              u.text.toLowerCase().includes(o.utteranceText.toLowerCase().slice(0, 30))
            );
            const seekMs = matchIdx >= 0 ? transcript.utterances[matchIdx].startMs : null;
            return (
              <TouchableOpacity key={o.id} style={styles.objectionCard} onPress={() => { if (seekMs != null) seekToTimestamp(seekMs); }} activeOpacity={seekMs != null ? 0.7 : 1}>
                <View style={styles.objectionHeader}>
                  <Text style={styles.objectionCategory}>{o.category}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    {seekMs != null && <Ionicons name="play-circle-outline" size={14} color="#52525b" />}
                    <Text
                      style={[
                        styles.objectionGrade,
                        { color: GRADE_COLORS[o.handlingGrade] ?? "#71717a" },
                      ]}
                    >
                      {GRADE_LABELS[o.handlingGrade] ?? o.handlingGrade}
                    </Text>
                  </View>
                </View>
                <Text style={styles.objectionQuote}>"{o.utteranceText}"</Text>
                <Text style={styles.objectionResponse}>
                  <Text style={{ color: "#71717a" }}>Response: </Text>
                  {o.repResponse}
                </Text>
                <View style={styles.suggestionBox}>
                  <Text style={styles.suggestionText}>
                    <Text style={{ fontWeight: "600" }}>Suggestion: </Text>
                    {o.suggestion}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Coaching Notes — includes help requests + responses + manual notes */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Coaching Notes</Text>
        <AddNoteForm callId={call.id} currentTimeMs={audioPlayer.positionMs} />

        {/* Help requests as coaching items */}
        {localHelpRequests.map((h) => (
          <View key={`help-${h.id}`} style={[styles.noteCard, { borderLeftWidth: 3, borderLeftColor: "#f59e0b" }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="hand-left" size={12} color="#f59e0b" />
                <Text style={[styles.noteAuthor, { color: "#f59e0b" }]}>Help Request</Text>
              </View>
              <Text style={{ color: "#52525b", fontSize: 11 }}>@ {formatMs(h.startMs)}</Text>
            </View>
            <Text style={styles.noteContent} numberOfLines={2}>"{h.transcriptExcerpt}"</Text>
            {h.message && <Text style={{ color: "#d4d4d8", fontSize: 13, marginTop: 2 }}>{h.message}</Text>}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
              <View style={[styles.statusBadge, { backgroundColor: h.status === "responded" ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)" }]}>
                <Text style={{ color: h.status === "responded" ? "#22c55e" : "#f59e0b", fontSize: 11, fontWeight: "500", textTransform: "capitalize" }}>{h.status}</Text>
              </View>
              <TouchableOpacity onPress={() => seekToTimestamp(h.startMs)}>
                <Text style={{ color: "#35b2ff", fontSize: 12 }}>Jump to spot</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* Regular coaching notes */}
        {notes.map((n) => (
          <View key={n.id} style={styles.noteCard}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.noteAuthor}>{n.authorName}</Text>
              {n.timestampMs != null && <Text style={{ color: "#35b2ff", fontSize: 11, fontFamily: "monospace" }}>@ {formatMs(n.timestampMs)}</Text>}
            </View>
            <Text style={styles.noteContent}>{n.content}</Text>
          </View>
        ))}
      </View>

      {/* Transcript — long-press any line to ask manager for help */}
      {transcript.utterances.length > 0 && (
        <View style={styles.section} onLayout={(e) => { transcriptSectionY.current = e.nativeEvent.layout.y; }}>
          <Text style={styles.sectionTitle}>Transcript</Text>
          <Text style={styles.transcriptHint}>Long-press any line to ask your manager for help</Text>
          {transcript.utterances.map((u, i) => {
            const matchingHelp = localHelpRequests.find(
              (h) => u.startMs >= h.startMs && u.startMs <= h.endMs
            );
            const isHelpStart = matchingHelp && (!transcript.utterances[i - 1] || transcript.utterances[i - 1].startMs < matchingHelp.startMs);
            return (
              <View key={i}>
                {isHelpStart && matchingHelp && (
                  <View style={styles.helpRequestBanner}>
                    <View style={styles.helpRequestHeader}>
                      <Ionicons name="hand-left" size={14} color="#f59e0b" />
                      <Text style={styles.helpRequestLabel}>Help Requested</Text>
                      <Text style={styles.helpRequestStatus}>{matchingHelp.status}</Text>
                    </View>
                    {matchingHelp.message && (
                      <Text style={styles.helpRequestMessage}>
                        <Text style={{ fontWeight: "600", color: "#a1a1aa" }}>{matchingHelp.repName}: </Text>
                        {matchingHelp.message}
                      </Text>
                    )}
                    {/* Reply input */}
                    {replyingTo === matchingHelp.id ? (
                      <View style={styles.replyContainer}>
                        <TextInput
                          style={styles.replyInput}
                          value={replyText}
                          onChangeText={setReplyText}
                          placeholder="Type your coaching response..."
                          placeholderTextColor="#71717a"
                          multiline
                          autoFocus
                        />
                        <VoiceNoteRecorder
                          storagePath={`help-responses/${matchingHelp.id}`}
                          onRecorded={async (audioUrl) => {
                            setSendingReply(true);
                            try {
                              await apiPost(`/api/mobile/help-requests/${matchingHelp.id}/respond`, {
                                content: replyText.trim() || "Voice note",
                                audioUrl,
                              });
                              setReplyingTo(null);
                              setReplyText("");
                              setLocalHelpRequests((prev) =>
                                prev.map((h) => h.id === matchingHelp.id ? { ...h, status: "responded" } : h)
                              );
                              haptic.success();
                            } catch {
                              Alert.alert("Error", "Failed to send response");
                            }
                            setSendingReply(false);
                          }}
                        />
                        <View style={styles.replyActions}>
                          <TouchableOpacity onPress={() => { setReplyingTo(null); setReplyText(""); }}>
                            <Text style={{ color: "#71717a", fontSize: 13 }}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.replySendBtn, (sendingReply || !replyText.trim()) && { opacity: 0.5 }]}
                            disabled={sendingReply || !replyText.trim()}
                            onPress={async () => {
                              setSendingReply(true);
                              try {
                                await apiPost(`/api/mobile/help-requests/${matchingHelp.id}/respond`, {
                                  content: replyText.trim(),
                                });
                                setReplyingTo(null);
                                setReplyText("");
                                setLocalHelpRequests((prev) =>
                                  prev.map((h) => h.id === matchingHelp.id ? { ...h, status: "responded" } : h)
                                );
                                haptic.success();
                              } catch {
                                Alert.alert("Error", "Failed to send response");
                              }
                              setSendingReply(false);
                            }}
                          >
                            <Ionicons name="send" size={14} color="#000" />
                            <Text style={styles.replySendText}>{sendingReply ? "Sending..." : "Send Text"}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.replyButton}
                        onPress={() => setReplyingTo(matchingHelp.id)}
                      >
                        <Ionicons name="chatbubble-outline" size={14} color="#35b2ff" />
                        <Text style={styles.replyButtonText}>
                          {matchingHelp.status === "responded" ? "Add Another Response" : "Respond"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                <Pressable
                  onPress={() => seekToTimestamp(u.startMs)}
                  onLongPress={() => setHelpModal({ text: u.text, startMs: u.startMs, endMs: u.endMs })}
                  onLayout={(e) => {
                    utteranceYPositions.current[i] = e.nativeEvent.layout.y;
                  }}
                  style={({ pressed }) => [
                    styles.utterance,
                    pressed && styles.utterancePressed,
                    i === currentUtteranceIndex && audioPlayer.isPlaying && styles.utteranceActive,
                    matchingHelp != null && styles.utteranceHelpHighlight,
                  ]}
                >
                  <View
                    style={[
                      styles.speakerBadge,
                      {
                        backgroundColor:
                          u.speaker === "rep"
                            ? "rgba(53,178,255,0.1)"
                            : "rgba(139,92,246,0.1)",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.speakerLabel,
                        { color: u.speaker === "rep" ? "#35b2ff" : "#a78bfa" },
                      ]}
                    >
                      {u.speaker === "rep" ? "R" : "C"}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.speakerName,
                        { color: u.speaker === "rep" ? "#35b2ff" : "#a78bfa" },
                      ]}
                    >
                      {u.speaker === "rep" ? "Rep" : "Customer"}
                    </Text>
                    <Text style={styles.utteranceText}>{u.text}</Text>
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>

    {/* Snap back to conversation pill */}
    {audioPlayer.isPlaying && (
      <Animated.View style={[styles.snapBackContainer, { opacity: snapBackOpacity }]} pointerEvents={userScrolledAway ? "auto" : "none"}>
        <TouchableOpacity style={styles.snapBackPill} onPress={handleSnapBack} activeOpacity={0.8}>
          <Ionicons name="arrow-down" size={14} color="#fff" />
          <Text style={styles.snapBackText}>Snap back to conversation</Text>
        </TouchableOpacity>
      </Animated.View>
    )}

    {/* Sticky bottom audio player */}
    {call.audioUrl && (
      <View style={styles.stickyPlayer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: audioPlayer.durationMs > 0 ? `${(audioPlayer.positionMs / audioPlayer.durationMs * 100).toFixed(0)}%` as `${number}%` : "0%" }]} />
        </View>
        <View style={styles.stickyPlayerInner}>
          <View style={styles.playerControls}>
            <TouchableOpacity onPress={() => audioPlayer.skip(-10)} hitSlop={8}>
              <Ionicons name="play-back" size={18} color="#71717a" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.playButton} onPress={audioPlayer.togglePlay}>
              <Ionicons name={audioPlayer.isPlaying ? "pause" : "play"} size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => audioPlayer.skip(10)} hitSlop={8}>
              <Ionicons name="play-forward" size={18} color="#71717a" />
            </TouchableOpacity>
          </View>
          <View style={styles.stickyTimeInfo}>
            <Text style={styles.timeText}>{formatMs(audioPlayer.positionMs)}</Text>
            <Text style={styles.timeSep}>/</Text>
            <Text style={styles.timeText}>{formatMs(audioPlayer.durationMs)}</Text>
          </View>
          <TouchableOpacity onPress={audioPlayer.cycleRate} style={styles.rateButton}>
            <Text style={styles.rateText}>{audioPlayer.rate}x</Text>
          </TouchableOpacity>
        </View>
      </View>
    )}

    {/* Help Request Modal */}
    <Modal visible={!!helpModal} transparent animationType="slide">
      <KeyboardAvoidingView
        style={styles.helpModalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.helpModalBackdrop} onPress={() => { setHelpModal(null); setHelpMessage(""); }} />
        <View style={styles.helpModalContent}>
          <Text style={styles.helpModalTitle}>Ask for Help</Text>
          <View style={styles.helpExcerptBox}>
            <Text style={styles.helpExcerptText}>"{helpModal?.text}"</Text>
          </View>
          <TextInput
            style={styles.helpInput}
            value={helpMessage}
            onChangeText={setHelpMessage}
            placeholder="What do you need help with?"
            placeholderTextColor="#71717a"
            multiline
            numberOfLines={3}
            autoFocus
          />
          <View style={styles.helpActions}>
            <TouchableOpacity
              style={styles.helpCancel}
              onPress={() => { setHelpModal(null); setHelpMessage(""); }}
            >
              <Text style={styles.helpCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.helpSend, sendingHelp && { opacity: 0.5 }]}
              disabled={sendingHelp}
              onPress={async () => {
                if (!helpModal || !id) return;
                setSendingHelp(true);
                try {
                  const result = await apiPost<{ id: string }>("/api/mobile/help-requests", {
                    callId: id,
                    startMs: helpModal.startMs,
                    endMs: helpModal.endMs,
                    transcriptExcerpt: helpModal.text,
                    message: helpMessage || null,
                  });
                  // Add to local state immediately so it shows in transcript
                  setLocalHelpRequests((prev) => [...prev, {
                    id: result.id,
                    startMs: helpModal.startMs,
                    endMs: helpModal.endMs,
                    transcriptExcerpt: helpModal.text,
                    message: helpMessage || null,
                    status: "pending",
                    repName: "You",
                    createdAt: new Date().toISOString(),
                  }]);
                  setHelpModal(null);
                  setHelpMessage("");
                  haptic.success();
                } catch (err: unknown) {
                  Alert.alert("Error", err instanceof Error ? err.message : "Failed to send");
                } finally {
                  setSendingHelp(false);
                }
              }}
            >
              <Ionicons name="send" size={16} color="#fff" />
              <Text style={styles.helpSendText}>{sendingHelp ? "Sending..." : "Send to Manager"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    {/* AI Chat FAB */}
    <CallAIChat callId={call.id} />
    </>
  );
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#09090b" },
  errorText: { color: "#f87171", fontSize: 16 },
  header: { flexDirection: "row", padding: 16, alignItems: "flex-start" },
  customerName: { color: "#fff", fontSize: 22, fontWeight: "700" },
  meta: { color: "#71717a", fontSize: 14, marginTop: 4 },
  scoreCircle: { alignItems: "center" },
  scoreNumber: { fontSize: 36, fontWeight: "700" },
  gradeLabel: { fontSize: 12, fontWeight: "500" },
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 4,
    backgroundColor: "#18181b",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 12,
  },
  locationAddress: { color: "#d4d4d8", fontSize: 13, fontWeight: "500" },
  locationHint: { color: "#52525b", fontSize: 11, marginTop: 1 },
  // Sticky bottom player
  stickyPlayer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#18181b",
    borderTopWidth: 1,
    borderTopColor: "#27272a",
  },
  stickyPlayerInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingBottom: Platform.OS === "ios" ? 28 : 10,
  },
  playerControls: { flexDirection: "row", alignItems: "center", gap: 14 },
  playButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#35b2ff", justifyContent: "center", alignItems: "center" },
  stickyTimeInfo: { flexDirection: "row", alignItems: "center", gap: 2 },
  timeSep: { color: "#52525b", fontSize: 11, fontFamily: "monospace" },
  rateButton: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#27272a" },
  rateText: { color: "#a1a1aa", fontSize: 12, fontWeight: "600", fontFamily: "monospace" },
  progressBar: { height: 3, backgroundColor: "#27272a", overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#35b2ff" },
  timeText: { color: "#52525b", fontSize: 11, fontFamily: "monospace" },
  // Snap back pill
  snapBackContainer: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 100 : 80,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  snapBackPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(53,178,255,0.9)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  snapBackText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  section: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 16,
  },
  sectionTitle: { color: "#fff", fontSize: 17, fontWeight: "600", marginBottom: 12 },
  summaryText: { color: "#d4d4d8", fontSize: 14, lineHeight: 22 },
  columnsRow: { flexDirection: "row", marginTop: 12, gap: 12 },
  column: { flex: 1 },
  columnHeader: { color: "#35b2ff", fontSize: 13, fontWeight: "600", marginBottom: 6 },
  bulletItem: { color: "#d4d4d8", fontSize: 13, lineHeight: 20, marginBottom: 4 },
  ratioLabel: { color: "#71717a", fontSize: 12, marginTop: 12, marginBottom: 4 },
  ratioBar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "#27272a" },
  ratioFillRep: { backgroundColor: "#35b2ff" },
  ratioFillCustomer: { backgroundColor: "#6366f1" },
  ratioLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  ratioText: { color: "#71717a", fontSize: 11 },
  sectionCard: {
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  sectionCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionType: { color: "#d4d4d8", fontSize: 14, fontWeight: "500", flex: 1, textTransform: "capitalize" },
  sectionGrade: { fontSize: 12, fontWeight: "500" },
  sectionSummary: { color: "#a1a1aa", fontSize: 13, lineHeight: 18 },
  objectionCard: {
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  objectionHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  objectionCategory: { color: "#a1a1aa", fontSize: 12, fontWeight: "500", textTransform: "capitalize" },
  objectionGrade: { fontSize: 12, fontWeight: "500" },
  objectionQuote: { color: "#d4d4d8", fontSize: 14, fontStyle: "italic", marginBottom: 6 },
  objectionResponse: { color: "#a1a1aa", fontSize: 13, marginBottom: 8 },
  suggestionBox: {
    backgroundColor: "rgba(245,158,11,0.05)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.1)",
    borderRadius: 6,
    padding: 8,
  },
  suggestionText: { color: "#f59e0b", fontSize: 12 },
  noteCard: {
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  noteAuthor: { color: "#71717a", fontSize: 12, marginBottom: 4 },
  noteContent: { color: "#d4d4d8", fontSize: 14 },
  utterance: { flexDirection: "row", gap: 10, marginBottom: 8 },
  speakerBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 2,
  },
  speakerLabel: { fontSize: 12, fontWeight: "600" },
  speakerName: { fontSize: 12, fontWeight: "500", marginBottom: 2 },
  utteranceText: { color: "#d4d4d8", fontSize: 14, lineHeight: 20 },
  utterancePressed: { backgroundColor: "rgba(53,178,255,0.08)", borderRadius: 8 },
  utteranceActive: { backgroundColor: "rgba(53,178,255,0.06)", borderRadius: 8, borderLeftWidth: 2, borderLeftColor: "#35b2ff", paddingLeft: 8 },
  utteranceHelpHighlight: { backgroundColor: "rgba(245,158,11,0.06)", borderLeftWidth: 2, borderLeftColor: "#f59e0b", borderRadius: 8, paddingLeft: 8 },
  helpRequestBanner: { backgroundColor: "rgba(245,158,11,0.08)", borderWidth: 1, borderColor: "rgba(245,158,11,0.2)", borderRadius: 10, padding: 12, marginBottom: 6, gap: 6 },
  helpRequestHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  helpRequestLabel: { color: "#f59e0b", fontSize: 12, fontWeight: "600" as const },
  helpRequestStatus: { color: "#71717a", fontSize: 11, textTransform: "capitalize" as const, marginLeft: "auto" as unknown as number },
  helpRequestMessage: { color: "#d4d4d8", fontSize: 13, lineHeight: 18 },
  replyButton: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingTop: 4 },
  replyButtonText: { color: "#35b2ff", fontSize: 13, fontWeight: "500" as const },
  replyContainer: { gap: 8, paddingTop: 4 },
  replyInput: { backgroundColor: "rgba(39,39,42,0.5)", borderWidth: 1, borderColor: "#3f3f46", borderRadius: 10, padding: 10, color: "#fff", fontSize: 14, minHeight: 60, textAlignVertical: "top" as const },
  replyActions: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
  replySendBtn: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, backgroundColor: "#35b2ff", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  replySendText: { color: "#000", fontSize: 13, fontWeight: "600" as const },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  transcriptHint: { color: "#52525b", fontSize: 12, marginBottom: 8, fontStyle: "italic" },
  // Help request modal
  helpModalOverlay: { flex: 1 },
  helpModalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)" },
  helpModalContent: {
    backgroundColor: "#18181b", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  helpModalTitle: { color: "#fff", fontSize: 20, fontWeight: "700", marginBottom: 12 },
  helpExcerptBox: {
    backgroundColor: "rgba(53,178,255,0.05)", borderWidth: 1, borderColor: "rgba(53,178,255,0.15)",
    borderRadius: 10, padding: 12, marginBottom: 16,
  },
  helpExcerptText: { color: "#d4d4d8", fontSize: 14, fontStyle: "italic", lineHeight: 20 },
  helpInput: {
    backgroundColor: "rgba(39,39,42,0.5)", borderWidth: 1, borderColor: "#3f3f46",
    borderRadius: 12, padding: 14, color: "#fff", fontSize: 15, minHeight: 80,
    textAlignVertical: "top", marginBottom: 16,
  },
  helpActions: { flexDirection: "row", gap: 12 },
  helpCancel: {
    flex: 1, borderWidth: 1, borderColor: "#3f3f46", borderRadius: 12,
    padding: 14, alignItems: "center",
  },
  helpCancelText: { color: "#d4d4d8", fontSize: 15, fontWeight: "500" },
  helpSend: {
    flex: 1, backgroundColor: "#35b2ff", borderRadius: 12, padding: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  helpSendText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
