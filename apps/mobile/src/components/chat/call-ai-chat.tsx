import { useState, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiGet } from "../../services/api";
import { API_BASE_URL } from "../../constants/recording";
import { supabase } from "../../lib/supabase";
import { haptic } from "../../lib/haptics";

interface ChatMessage { id: string; role: "user" | "assistant"; content: string }

/** Render markdown-ish AI text into styled Text elements */
function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      elements.push(<View key={`sp-${i}`} style={{ height: 8 }} />);
      continue;
    }

    // Headings
    const h1 = trimmed.match(/^#\s+(.+)/);
    if (h1) {
      elements.push(<Text key={i} style={mdStyles.h1}>{h1[1]}</Text>);
      continue;
    }
    const h2 = trimmed.match(/^##\s+(.+)/);
    if (h2) {
      elements.push(<Text key={i} style={mdStyles.h2}>{h2[1]}</Text>);
      continue;
    }

    // Bullet or numbered list
    const listMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)/);
    const content = listMatch ? listMatch[1] : trimmed;
    const isListItem = !!listMatch;

    elements.push(
      <View key={i} style={isListItem ? mdStyles.listItem : undefined}>
        {isListItem && <Text style={mdStyles.bullet}>{trimmed.match(/^\d+\./) ? trimmed.match(/^\d+/)![0] + "." : "\u2022"} </Text>}
        <Text style={mdStyles.body}>{renderInline(content)}</Text>
      </View>
    );
  }

  return <View style={{ gap: 2 }}>{elements}</View>;
}

/** Handle bold / italic inline formatting */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      parts.push(<Text key={match.index} style={{ fontWeight: "700", fontStyle: "italic", color: "#e4e4e7" }}>{match[1]}</Text>);
    } else if (match[2]) {
      parts.push(<Text key={match.index} style={{ fontWeight: "700", color: "#e4e4e7" }}>{match[2]}</Text>);
    } else if (match[3]) {
      parts.push(<Text key={match.index} style={{ fontStyle: "italic", color: "#a1a1aa" }}>{match[3]}</Text>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

const mdStyles = StyleSheet.create({
  h1: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 4, marginTop: 2 },
  h2: { color: "#e4e4e7", fontSize: 15, fontWeight: "600", marginBottom: 2, marginTop: 4 },
  body: { color: "#d4d4d8", fontSize: 14, lineHeight: 21 },
  listItem: { flexDirection: "row", paddingLeft: 4 },
  bullet: { color: "#71717a", fontSize: 14, lineHeight: 21, width: 20 },
});

export function CallAIChat({ callId }: { callId: string }) {
  const [visible, setVisible] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible && messages.length === 0) {
      apiGet<{ messages: ChatMessage[] }>(`/api/calls/${callId}/chat`)
        .then((d) => setMessages(d.messages ?? []))
        .catch(() => {});
    }
  }, [visible]);

  async function send() {
    if (!input.trim() || streaming) return;
    const msg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { id: Date.now().toString(), role: "user", content: msg }]);
    setStreaming(true);
    setStreamText("Thinking...");
    haptic.light();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE_URL}/api/calls/${callId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ message: msg }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      // React Native fetch doesn't support ReadableStream — read full response as text
      const full = await res.text();

      setStreamText("");
      if (full.trim()) {
        setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: full }]);
        haptic.success();
      } else {
        setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: "Sorry, I couldn't generate a response. Please try again." }]);
      }
    } catch (err: unknown) {
      setStreamText("");
      const errMsg = err instanceof Error ? err.message : "Something went wrong";
      setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: `Error: ${errMsg}` }]);
    }
    setStreaming(false);
  }

  if (!visible) {
    return (
      <TouchableOpacity style={styles.fab} onPress={() => { setVisible(true); haptic.light(); }}>
        <Ionicons name="sparkles" size={20} color="#fff" />
        <Text style={styles.fabText}>Ask AI</Text>
      </TouchableOpacity>
    );
  }

  const allMessages = [...messages, ...(streamText ? [{ id: "stream", role: "assistant" as const, content: streamText }] : [])];

  return (
    <Modal visible transparent animationType="slide">
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableOpacity style={styles.backdrop} onPress={() => setVisible(false)} />
        <View style={styles.chatContainer}>
          <View style={styles.chatHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="sparkles" size={16} color="#35b2ff" />
              <Text style={styles.chatTitle}>AI Coach</Text>
            </View>
            <TouchableOpacity onPress={() => setVisible(false)}><Ionicons name="close" size={20} color="#71717a" /></TouchableOpacity>
          </View>

          <FlatList
            ref={listRef}
            data={allMessages}
            keyExtractor={(item) => item.id}
            style={styles.messageList}
            contentContainerStyle={{ padding: 12, gap: 8 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd()}
            ListEmptyComponent={
              <View style={{ paddingVertical: 24, alignItems: "center", gap: 8 }}>
                <Text style={{ color: "#71717a", fontSize: 14 }}>Ask anything about this call</Text>
                {["What could they say better?", "How to handle the price objection?"].map((q) => (
                  <TouchableOpacity key={q} onPress={() => setInput(q)} style={{ paddingVertical: 4 }}>
                    <Text style={{ color: "#35b2ff", fontSize: 13 }}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            }
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.aiBubble]}>
                {item.role === "user"
                  ? <Text style={[styles.bubbleText, { color: "#d4edff" }]}>{item.content}</Text>
                  : <MarkdownText text={item.content} />
                }
              </View>
            )}
          />

          <View style={styles.inputRow}>
            <TextInput style={styles.chatInput} value={input} onChangeText={setInput}
              placeholder="Ask about this call..." placeholderTextColor="#52525b"
              onSubmitEditing={send} returnKeyType="send" editable={!streaming} />
            <TouchableOpacity style={styles.sendBtn} onPress={send} disabled={!input.trim() || streaming}>
              <Ionicons name="send" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fab: { position: "absolute", bottom: 20, right: 20, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#35b2ff", borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
  fabText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  overlay: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  chatContainer: { backgroundColor: "#09090b", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "70%" },
  chatHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#1a1a1e" },
  chatTitle: { color: "#fff", fontSize: 15, fontWeight: "600" },
  messageList: { maxHeight: 400 },
  bubble: { maxWidth: "85%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "rgba(53,178,255,0.15)" },
  aiBubble: { alignSelf: "flex-start", backgroundColor: "#18181b" },
  bubbleText: { color: "#d4d4d8", fontSize: 14, lineHeight: 20 },
  inputRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#1a1a1e" },
  chatInput: { flex: 1, backgroundColor: "#18181b", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: "#fff", fontSize: 14 },
  sendBtn: { backgroundColor: "#35b2ff", borderRadius: 10, padding: 10, justifyContent: "center" },
});
