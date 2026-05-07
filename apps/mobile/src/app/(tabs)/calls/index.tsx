import { useState, useRef, useEffect } from "react";
import {
  ScrollView,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Swipeable } from "react-native-gesture-handler";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../services/api";
import { invalidateCachePrefix, useCachedFetch } from "../../../hooks/useCachedFetch";
import { useAuthStore } from "../../../stores/auth-store";

interface CallItem {
  id: string;
  customerName: string | null;
  repName: string | null;
  repId: string;
  durationSeconds: number;
  status: string;
  recordedAt: string;
  folderId: string | null;
  folderName: string | null;
  overallScore: number | null;
  overallGrade: string | null;
  summary: string | null;
}

const GRADE_COLORS: Record<string, string> = {
  excellent: "#22c55e",
  good: "#35b2ff",
  acceptable: "#eab308",
  needs_improvement: "#f97316",
  poor: "#ef4444",
};

type CallsFilter = "mine" | "team" | "shared";

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface TeamMember {
  id: string;
  fullName: string;
  role: string;
}

interface CallFolder {
  id: string;
  name: string;
  color: string;
  callCount: number;
  createdAt: string;
}

export default function CallsListScreen() {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const isManager = profile?.role === "manager";
  const [filter, setFilter] = useState<CallsFilter>("mine");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
  const [folders, setFolders] = useState<CallFolder[]>([]);
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [moveCall, setMoveCall] = useState<CallItem | null>(null);
  const [movingCall, setMovingCall] = useState(false);
  const [renameCall, setRenameCall] = useState<CallItem | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renamingCall, setRenamingCall] = useState(false);
  const [deletingCallId, setDeletingCallId] = useState<string | null>(null);

  // Load team members when switching to team view
  const teamLoaded = useRef(false);
  useEffect(() => {
    if (filter === "team" && isManager && !teamLoaded.current) {
      teamLoaded.current = true;
      apiGet<{ members: TeamMember[] }>("/api/mobile/team-members").then((res) => {
        setTeamMembers(res.members.filter((m) => m.role === "rep"));
      }).catch(() => {});
    }
  }, [filter, isManager]);

  async function loadFolders() {
    try {
      const res = await apiGet<{ folders: CallFolder[] }>("/api/mobile/call-folders");
      setFolders(res.folders);
    } catch {
      // Folder organization is optional; don't block the call list.
    }
  }

  useEffect(() => {
    if (filter === "mine") {
      loadFolders();
    } else {
      setFolderFilter("all");
    }
  }, [filter]);

  const folderQuery = filter === "mine" && folderFilter !== "all"
    ? `&folderId=${encodeURIComponent(folderFilter)}`
    : "";
  const { data, loading, refreshing, refresh } = useCachedFetch(
    `calls-list-${filter}-${folderFilter}`,
    () => apiGet<{ calls: CallItem[] }>(`/api/mobile/calls?limit=50&filter=${filter}${folderQuery}`)
  );

  // Self-heal: on mount, ask the server to re-run split on any of this
  // rep's sessions stuck in 'processing' or with a dead heartbeat. No-op
  // when nothing's stuck. If anything was recovered, refresh the list so
  // the newly-created calls show up without the rep having to pull.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiPost<{ recovered: string[] }>(
          "/api/sessions/ensure-split",
          {}
        );
        if (!cancelled && res.recovered.length > 0) refresh();
      } catch {
        // best-effort — don't block the UI if the recovery sweep fails
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply client-side rep filter when in team view
  const allCalls = data?.calls ?? [];
  const calls = filter === "team" && selectedRepId
    ? allCalls.filter((c) => c.repId === selectedRepId)
    : allCalls;

  async function createFolder() {
    const name = folderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    try {
      const res = await apiPost<{ folder: CallFolder }>("/api/mobile/call-folders", { name });
      setFolders((prev) => [...prev, res.folder]);
      setFolderName("");
      setFolderModalVisible(false);
      setFolderFilter(res.folder.id);
      invalidateCachePrefix("calls-list-mine");
      refresh();
    } catch (err: unknown) {
      Alert.alert("Folder not created", err instanceof Error ? err.message : "Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  }

  function startRenameCall(call: CallItem) {
    setRenameCall(call);
    setRenameName(call.customerName ?? "");
  }

  async function renameSelectedCall() {
    if (!renameCall) return;
    const customerName = renameName.trim();
    if (!customerName) return;
    setRenamingCall(true);
    try {
      await apiPatch(`/api/mobile/calls/${renameCall.id}`, { customerName });
      setRenameCall(null);
      setRenameName("");
      invalidateCachePrefix("calls-list-");
      refresh();
    } catch (err: unknown) {
      Alert.alert("Could not rename conversation", err instanceof Error ? err.message : "Failed to rename conversation");
    } finally {
      setRenamingCall(false);
    }
  }

  function confirmDeleteCall(call: CallItem) {
    if (!isManager) return;
    Alert.alert(
      "Delete conversation?",
      `Delete "${call.customerName ?? "Unknown Customer"}"? This removes the recording, transcript, analysis, and coaching notes for everyone on the team.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingCallId(call.id);
            try {
              await apiDelete(`/api/mobile/calls/${call.id}`);
              invalidateCachePrefix("calls-list-");
              await Promise.all([loadFolders(), refresh()]);
            } catch (err: unknown) {
              Alert.alert("Could not delete conversation", err instanceof Error ? err.message : "Failed to delete conversation");
            } finally {
              setDeletingCallId(null);
            }
          },
        },
      ]
    );
  }

  async function moveCallToFolder(folderId: string | null) {
    if (!moveCall) return;
    setMovingCall(true);
    try {
      await apiPatch(`/api/mobile/calls/${moveCall.id}/folder`, { folderId });
      setMoveCall(null);
      invalidateCachePrefix("calls-list-");
      await Promise.all([loadFolders(), refresh()]);
    } catch (err: unknown) {
      Alert.alert("Could not move conversation", err instanceof Error ? err.message : "Failed to move conversation");
    } finally {
      setMovingCall(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#35b2ff" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={calls.length === 0 ? styles.emptyContainer : undefined}
      data={calls}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor="#35b2ff"
        />
      }
      ListHeaderComponent={
        <View>
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleButton, filter === "mine" && styles.toggleActive]}
              onPress={() => { setFilter("mine"); setSelectedRepId(null); }}
            >
              <Ionicons name="person" size={16} color={filter === "mine" ? "#35b2ff" : "#71717a"} />
              <Text style={[styles.toggleText, filter === "mine" && styles.toggleTextActive]}>My Calls</Text>
            </TouchableOpacity>
            {isManager ? (
              <TouchableOpacity
                style={[styles.toggleButton, filter === "team" && styles.toggleActive]}
                onPress={() => setFilter("team")}
              >
                <Ionicons name="people" size={16} color={filter === "team" ? "#35b2ff" : "#71717a"} />
                <Text style={[styles.toggleText, filter === "team" && styles.toggleTextActive]}>Team</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.toggleButton, filter === "shared" && styles.toggleActive]}
                onPress={() => setFilter("shared")}
              >
                <Ionicons name="share-social" size={16} color={filter === "shared" ? "#35b2ff" : "#71717a"} />
                <Text style={[styles.toggleText, filter === "shared" && styles.toggleTextActive]}>Shared</Text>
              </TouchableOpacity>
            )}
          </View>
          {isManager && filter === "team" && teamMembers.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.repFilterRow} contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}>
                <TouchableOpacity
                  style={[styles.repChip, !selectedRepId && styles.repChipActive]}
                  onPress={() => setSelectedRepId(null)}
                >
                  <Text style={[styles.repChipText, !selectedRepId && styles.repChipTextActive]}>All Reps</Text>
                </TouchableOpacity>
                {teamMembers.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.repChip, selectedRepId === m.id && styles.repChipActive]}
                    onPress={() => setSelectedRepId(selectedRepId === m.id ? null : m.id)}
                  >
                    <Text style={[styles.repChipText, selectedRepId === m.id && styles.repChipTextActive]}>{m.fullName}</Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>
          )}
          {filter === "mine" && (
            <View style={styles.folderSection}>
              <View style={styles.folderHeader}>
                <Text style={styles.folderTitle}>Folders</Text>
                <TouchableOpacity
                  style={styles.folderCreateButton}
                  onPress={() => setFolderModalVisible(true)}
                >
                  <Ionicons name="add" size={14} color="#35b2ff" />
                  <Text style={styles.folderCreateText}>New</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.folderChips}
              >
                <TouchableOpacity
                  style={[styles.folderChip, folderFilter === "all" && styles.folderChipActive]}
                  onPress={() => setFolderFilter("all")}
                >
                  <Ionicons name="albums-outline" size={14} color={folderFilter === "all" ? "#35b2ff" : "#71717a"} />
                  <Text style={[styles.folderChipText, folderFilter === "all" && styles.folderChipTextActive]}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.folderChip, folderFilter === "unfiled" && styles.folderChipActive]}
                  onPress={() => setFolderFilter("unfiled")}
                >
                  <Ionicons name="file-tray-outline" size={14} color={folderFilter === "unfiled" ? "#35b2ff" : "#71717a"} />
                  <Text style={[styles.folderChipText, folderFilter === "unfiled" && styles.folderChipTextActive]}>Unfiled</Text>
                </TouchableOpacity>
                {folders.map((folder) => {
                  const active = folderFilter === folder.id;
                  return (
                    <TouchableOpacity
                      key={folder.id}
                      style={[styles.folderChip, active && styles.folderChipActive]}
                      onPress={() => setFolderFilter(folder.id)}
                    >
                      <View style={[styles.folderDot, { backgroundColor: folder.color }]} />
                      <Text style={[styles.folderChipText, active && styles.folderChipTextActive]} numberOfLines={1}>
                        {folder.name}
                      </Text>
                      <Text style={styles.folderCount}>{folder.callCount}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="mic-off-outline" size={48} color="#3f3f46" />
          <Text style={styles.emptyTitle}>
            {filter === "team"
              ? "No team conversations"
              : filter === "shared"
              ? "Nothing shared with you yet"
              : "No conversations yet"}
          </Text>
          <Text style={styles.emptySubtitle}>
            {filter === "team"
              ? "Your reps' conversations will appear here"
              : filter === "shared"
              ? "Conversations your manager shares will appear here"
              : "Record a conversation to see it here"}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <CallListRow
          item={item}
          filter={filter}
          isManager={isManager}
          canOrganize={filter === "mine" && item.repId === profile?.id}
          canRename={item.repId === profile?.id || isManager}
          deleting={deletingCallId === item.id}
          onOpen={() => router.push(`/(tabs)/calls/${item.id}`)}
          onMove={() => setMoveCall(item)}
          onRename={() => startRenameCall(item)}
          onDelete={() => confirmDeleteCall(item)}
        />
      )}
      ListFooterComponent={
        <>
          <CreateFolderModal
            visible={folderModalVisible}
            name={folderName}
            saving={creatingFolder}
            onNameChange={setFolderName}
            onCancel={() => {
              setFolderModalVisible(false);
              setFolderName("");
            }}
            onCreate={createFolder}
          />
          <MoveCallModal
            call={moveCall}
            folders={folders}
            moving={movingCall}
            onClose={() => setMoveCall(null)}
            onMove={moveCallToFolder}
            onCreateFolder={() => {
              setMoveCall(null);
              setFolderModalVisible(true);
            }}
          />
          <RenameCallModal
            call={renameCall}
            name={renameName}
            saving={renamingCall}
            onNameChange={setRenameName}
            onCancel={() => {
              setRenameCall(null);
              setRenameName("");
            }}
            onSave={renameSelectedCall}
          />
        </>
      }
    />
  );
}

function CallListRow({
  item,
  filter,
  isManager,
  canOrganize,
  canRename,
  deleting,
  onOpen,
  onMove,
  onRename,
  onDelete,
}: {
  item: CallItem;
  filter: CallsFilter;
  isManager: boolean;
  canOrganize: boolean;
  canRename: boolean;
  deleting: boolean;
  onOpen: () => void;
  onMove: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const swipeableRef = useRef<Swipeable>(null);

  return (
    <Swipeable
      ref={swipeableRef}
      leftThreshold={72}
      rightThreshold={72}
      overshootLeft={false}
      overshootRight={false}
      enabled={canOrganize || isManager}
      renderLeftActions={
        canOrganize
          ? () => (
              <View style={[styles.swipeAction, styles.swipeFolderAction]}>
                <Ionicons name="folder-open-outline" size={22} color="#fff" />
                <Text style={styles.swipeActionText}>Folder</Text>
              </View>
            )
          : undefined
      }
      renderRightActions={
        isManager
          ? () => (
              <View style={[styles.swipeAction, styles.swipeDeleteAction]}>
                <Ionicons name="trash-outline" size={22} color="#fff" />
                <Text style={styles.swipeActionText}>Delete</Text>
              </View>
            )
          : undefined
      }
      onSwipeableOpen={(direction) => {
        swipeableRef.current?.close();
        if (direction === "left" && canOrganize) {
          onMove();
        } else if (direction === "right" && isManager) {
          onDelete();
        }
      }}
    >
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.82}
        delayLongPress={350}
        disabled={deleting}
        onPress={onOpen}
        onLongPress={canRename ? onRename : undefined}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.customerName}>
              {item.customerName ?? "Unknown Customer"}
            </Text>
            <Text style={styles.meta}>
              {filter === "team" && item.repName ? `${item.repName} · ` : ""}
              {formatDate(item.recordedAt)} · {formatDuration(item.durationSeconds)}
            </Text>
            {filter === "mine" && item.folderName && (
              <View style={styles.callFolderBadge}>
                <Ionicons name="folder-outline" size={12} color="#35b2ff" />
                <Text style={styles.callFolderBadgeText}>{item.folderName}</Text>
              </View>
            )}
          </View>
          <View style={styles.cardActions}>
            {canOrganize && (
              <TouchableOpacity
                style={styles.cardIconButton}
                onPress={(event) => {
                  event.stopPropagation();
                  onMove();
                }}
              >
                <Ionicons name="folder-open-outline" size={18} color="#a1a1aa" />
              </TouchableOpacity>
            )}
            {deleting ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : item.overallScore != null ? (
              <View style={styles.scoreBadge}>
                <Text
                  style={[
                    styles.scoreText,
                    { color: GRADE_COLORS[item.overallGrade ?? ""] ?? "#a1a1aa" },
                  ]}
                >
                  {item.overallScore}
                </Text>
              </View>
            ) : (
              <StatusBadge status={item.status} />
            )}
          </View>
        </View>
        {item.summary && (
          <Text style={styles.summary} numberOfLines={2}>
            {item.summary}
          </Text>
        )}
      </TouchableOpacity>
    </Swipeable>
  );
}

function CreateFolderModal({
  visible,
  name,
  saving,
  onNameChange,
  onCancel,
  onCreate,
}: {
  visible: boolean;
  name: string;
  saving: boolean;
  onNameChange: (value: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.modalBackdrop} onPress={onCancel} />
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>New Folder</Text>
          <TextInput
            style={styles.modalInput}
            value={name}
            onChangeText={onNameChange}
            placeholder="Folder name"
            placeholderTextColor="#71717a"
            autoFocus
            maxLength={80}
            returnKeyType="done"
            onSubmitEditing={onCreate}
          />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancelButton} onPress={onCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalPrimaryButton, (saving || !name.trim()) && { opacity: 0.5 }]}
              disabled={saving || !name.trim()}
              onPress={onCreate}
            >
              <Text style={styles.modalPrimaryText}>{saving ? "Creating..." : "Create"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function MoveCallModal({
  call,
  folders,
  moving,
  onClose,
  onMove,
  onCreateFolder,
}: {
  call: CallItem | null;
  folders: CallFolder[];
  moving: boolean;
  onClose: () => void;
  onMove: (folderId: string | null) => void;
  onCreateFolder: () => void;
}) {
  return (
    <Modal visible={!!call} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Move Conversation</Text>
          <Text style={styles.modalSubtitle} numberOfLines={1}>
            {call?.customerName ?? "Unknown Customer"}
          </Text>

          <TouchableOpacity
            style={styles.folderOption}
            disabled={moving}
            onPress={() => onMove(null)}
          >
            <Ionicons name="file-tray-outline" size={18} color="#a1a1aa" />
            <Text style={styles.folderOptionText}>Unfiled</Text>
            {!call?.folderId && <Ionicons name="checkmark" size={18} color="#35b2ff" />}
          </TouchableOpacity>

          {folders.map((folder) => (
            <TouchableOpacity
              key={folder.id}
              style={styles.folderOption}
              disabled={moving}
              onPress={() => onMove(folder.id)}
            >
              <View style={[styles.folderDot, { backgroundColor: folder.color }]} />
              <Text style={styles.folderOptionText}>{folder.name}</Text>
              {call?.folderId === folder.id && <Ionicons name="checkmark" size={18} color="#35b2ff" />}
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[styles.folderOption, styles.folderOptionCreate]}
            disabled={moving}
            onPress={onCreateFolder}
          >
            <Ionicons name="add-circle-outline" size={18} color="#35b2ff" />
            <Text style={[styles.folderOptionText, { color: "#35b2ff" }]}>Create new folder</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.modalFullCancel} onPress={onClose}>
            <Text style={styles.modalCancelText}>{moving ? "Moving..." : "Cancel"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function RenameCallModal({
  call,
  name,
  saving,
  onNameChange,
  onCancel,
  onSave,
}: {
  call: CallItem | null;
  name: string;
  saving: boolean;
  onNameChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Modal visible={!!call} transparent animationType="slide">
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.modalBackdrop} onPress={onCancel} />
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Rename Conversation</Text>
          <Text style={styles.modalSubtitle} numberOfLines={1}>
            {call?.customerName ?? "Unknown Customer"}
          </Text>
          <TextInput
            style={styles.modalInput}
            value={name}
            onChangeText={onNameChange}
            placeholder="Conversation name"
            placeholderTextColor="#71717a"
            autoFocus
            maxLength={80}
            returnKeyType="done"
            onSubmitEditing={onSave}
          />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancelButton} onPress={onCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalPrimaryButton, (saving || !name.trim()) && { opacity: 0.5 }]}
              disabled={saving || !name.trim()}
              onPress={onSave}
            >
              <Text style={styles.modalPrimaryText}>{saving ? "Saving..." : "Save"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; label: string }> = {
    completed: { bg: "rgba(53,178,255,0.1)", color: "#35b2ff", label: "Analyzed" },
    failed: { bg: "rgba(239,68,68,0.1)", color: "#f87171", label: "Failed" },
    uploading: { bg: "rgba(234,179,8,0.1)", color: "#eab308", label: "Uploading" },
    uploaded: { bg: "rgba(53,178,255,0.1)", color: "#35b2ff", label: "Uploaded" },
    transcribing: { bg: "rgba(53,178,255,0.1)", color: "#35b2ff", label: "Transcribing" },
    analyzing: { bg: "rgba(139,92,246,0.1)", color: "#a78bfa", label: "Analyzing" },
  };
  const c = config[status] ?? { bg: "rgba(113,113,122,0.1)", color: "#71717a", label: status };

  return (
    <View style={[styles.statusBadge, { backgroundColor: c.bg }]}>
      <Text style={[styles.statusText, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#09090b" },
  emptyContainer: { flex: 1 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8 },
  emptyTitle: { color: "#a1a1aa", fontSize: 16, fontWeight: "500" },
  emptySubtitle: { color: "#52525b", fontSize: 14 },
  toggleRow: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  toggleButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "transparent",
  },
  toggleActive: {
    backgroundColor: "rgba(53,178,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(53,178,255,0.2)",
  },
  toggleText: { color: "#71717a", fontSize: 14, fontWeight: "500" },
  toggleTextActive: { color: "#35b2ff" },
  repFilterRow: { paddingBottom: 4 },
  repChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#27272a",
    backgroundColor: "transparent",
  },
  repChipActive: {
    backgroundColor: "rgba(53,178,255,0.1)",
    borderColor: "rgba(53,178,255,0.3)",
  },
  repChipText: { color: "#71717a", fontSize: 13, fontWeight: "500" },
  repChipTextActive: { color: "#35b2ff" },
  folderSection: { paddingTop: 6, paddingBottom: 2 },
  folderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  folderTitle: { color: "#a1a1aa", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  folderCreateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: "rgba(53,178,255,0.08)",
  },
  folderCreateText: { color: "#35b2ff", fontSize: 12, fontWeight: "600" },
  folderChips: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  folderChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 180,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#27272a",
    backgroundColor: "#111113",
  },
  folderChipActive: {
    backgroundColor: "rgba(53,178,255,0.1)",
    borderColor: "rgba(53,178,255,0.35)",
  },
  folderChipText: { color: "#a1a1aa", fontSize: 13, fontWeight: "500", maxWidth: 110 },
  folderChipTextActive: { color: "#35b2ff" },
  folderDot: { width: 8, height: 8, borderRadius: 4 },
  folderCount: { color: "#52525b", fontSize: 11, fontWeight: "600" },
  swipeAction: {
    width: 104,
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  swipeFolderAction: {
    marginLeft: 16,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    backgroundColor: "#0284c7",
  },
  swipeDeleteAction: {
    marginRight: 16,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    backgroundColor: "#dc2626",
  },
  swipeActionText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 16,
  },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#27272a",
  },
  customerName: { color: "#fff", fontSize: 16, fontWeight: "600" },
  meta: { color: "#71717a", fontSize: 13, marginTop: 2 },
  callFolderBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "rgba(53,178,255,0.08)",
  },
  callFolderBadgeText: { color: "#35b2ff", fontSize: 11, fontWeight: "600" },
  scoreBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(53,178,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  scoreText: { fontSize: 18, fontWeight: "700" },
  statusBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: "600" },
  summary: { color: "#a1a1aa", fontSize: 13, lineHeight: 18, marginTop: 8 },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.7)" },
  modalContent: {
    backgroundColor: "#18181b",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 20,
    gap: 10,
  },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  modalSubtitle: { color: "#71717a", fontSize: 13, marginBottom: 4 },
  modalInput: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3f3f46",
    backgroundColor: "#09090b",
    color: "#fff",
    paddingHorizontal: 14,
    fontSize: 16,
  },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  modalCancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  modalPrimaryButton: {
    flex: 1,
    backgroundColor: "#35b2ff",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  modalCancelText: { color: "#d4d4d8", fontSize: 15, fontWeight: "600" },
  modalPrimaryText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  modalFullCancel: {
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  folderOption: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    backgroundColor: "#111113",
    paddingHorizontal: 14,
  },
  folderOptionCreate: {
    borderColor: "rgba(53,178,255,0.22)",
    backgroundColor: "rgba(53,178,255,0.06)",
  },
  folderOptionText: { color: "#e4e4e7", fontSize: 15, fontWeight: "600", flex: 1 },
});
