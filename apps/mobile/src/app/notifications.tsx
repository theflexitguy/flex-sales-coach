import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useNotifications } from "../hooks/useNotifications";

const TYPE_ICONS: Record<string, string> = {
  help_request_new: "chatbubbles",
  help_request_response: "chatbubble-ellipses",
  call_analyzed: "checkmark-circle",
  coaching_note: "document-text",
  session_complete: "mic-circle",
  badge_earned: "trophy",
};

export default function NotificationsScreen() {
  const { notifications, unreadCount, refresh, markAllRead, clearAll } = useNotifications();
  const router = useRouter();

  return (
    <>
      {notifications.length > 0 && (
        <View style={styles.headerActions}>
          {unreadCount > 0 && (
            <TouchableOpacity style={styles.headerButton} onPress={markAllRead}>
              <Ionicons name="checkmark-done" size={16} color="#35b2ff" />
              <Text style={styles.headerButtonText}>Mark all read</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => {
              Alert.alert("Clear All", "Remove all notifications?", [
                { text: "Cancel", style: "cancel" },
                { text: "Clear", style: "destructive", onPress: clearAll },
              ]);
            }}
          >
            <Ionicons name="trash-outline" size={16} color="#71717a" />
            <Text style={[styles.headerButtonText, { color: "#71717a" }]}>Clear all</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        style={styles.container}
        data={notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={notifications.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={48} color="#3f3f46" />
            <Text style={styles.emptyTitle}>No notifications</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.read && styles.cardUnread]}
            onPress={() => {
              const data = item.data as Record<string, string>;
              if (data.callId) router.push(`/(tabs)/calls/${data.callId}`);
              else if (data.requestId) router.push("/(tabs)/coaching");
            }}
          >
            <View style={[styles.iconCircle, !item.read && styles.iconCircleUnread]}>
              <Ionicons name={(TYPE_ICONS[item.type] ?? "notifications") as keyof typeof Ionicons.glyphMap} size={18} color={item.read ? "#71717a" : "#35b2ff"} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, !item.read && styles.titleUnread]}>{item.title}</Text>
              {item.body && <Text style={styles.body}>{item.body}</Text>}
              <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
            </View>
            {!item.read && <View style={styles.unreadDot} />}
          </TouchableOpacity>
        )}
      />
    </>
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
  emptyContainer: { flex: 1 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8 },
  emptyTitle: { color: "#a1a1aa", fontSize: 16 },
  headerActions: { flexDirection: "row", justifyContent: "flex-end", gap: 16, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#09090b", borderBottomWidth: 1, borderBottomColor: "#1a1a1e" },
  headerButton: { flexDirection: "row", alignItems: "center", gap: 4 },
  headerButtonText: { color: "#35b2ff", fontSize: 13, fontWeight: "500" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1a1a1e" },
  cardUnread: { backgroundColor: "rgba(53,178,255,0.03)" },
  iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#18181b", justifyContent: "center", alignItems: "center" },
  iconCircleUnread: { backgroundColor: "rgba(53,178,255,0.1)" },
  title: { color: "#a1a1aa", fontSize: 14, fontWeight: "500" },
  titleUnread: { color: "#fff" },
  body: { color: "#71717a", fontSize: 13, marginTop: 2 },
  time: { color: "#52525b", fontSize: 12, marginTop: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#35b2ff" },
});
