import { Alert } from "react-native";
import { create } from "zustand";
import { chunkManager, type RecordingHealth } from "../services/recording/ChunkManager";
import { uploadQueue } from "../services/recording/UploadQueue";
import { recordingEngine } from "../services/recording/RecordingEngine";
import { apiGet, apiPost } from "../services/api";
import { requestLocationPermission, getCurrentLocation } from "../services/location";

interface OrphanedSession {
  id: string;
  status: string;
  started_at: string;
  chunk_count: number;
  label: string | null;
}

interface RecordingState {
  isRecording: boolean;
  sessionId: string | null;
  startedAt: Date | null;
  elapsedMs: number;
  chunkCount: number;
  uploadedChunks: number;
  totalChunks: number;
  meteringDb: number; // Current audio input level in dB (-160 silent, 0 max)
  health: RecordingHealth;
  error: string | null;

  startDay: () => Promise<void>;
  stopAndName: (label: string) => Promise<void>;
  updateElapsed: () => void;
  updateMetering: () => Promise<void>;
  recoverOrphanedSessions: () => Promise<void>;
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  isRecording: false,
  sessionId: null,
  startedAt: null,
  elapsedMs: 0,
  chunkCount: 0,
  uploadedChunks: 0,
  totalChunks: 0,
  meteringDb: -160,
  health: "stopped",
  error: null,

  startDay: async () => {
    // Guard: prevent double-start
    if (get().isRecording) return;

    try {
      set({ error: null });

      // Request location permission and capture GPS
      await requestLocationPermission();
      const coords = await getCurrentLocation();

      // Create session on server (server also guards against duplicates)
      const { sessionId } = await apiPost<{ sessionId: string }>(
        "/api/sessions/start",
        {
          startedAt: new Date().toISOString(),
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
        }
      );

      // Set up chunk completion callback
      chunkManager.setOnChunkComplete((index) => {
        set({ chunkCount: index + 1 });
      });

      // Mirror recorder health into store so the Home screen can render
      // an explicit "RECORDING / PAUSED / DEAD" indicator.
      chunkManager.setOnHealthChange((health) => {
        set({ health });
      });

      // Set up upload status callback
      uploadQueue.resetCounts();
      uploadQueue.setOnStatusChange((uploaded, total) => {
        set({ uploadedChunks: uploaded, totalChunks: total });
      });
      uploadQueue.setOnError((msg) => {
        set({ error: `Upload: ${msg}` });
      });
      uploadQueue.setOnFirstError((record) => {
        Alert.alert(
          "Upload Problem",
          `Chunk ${record.chunkIndex} failed at ${record.stage}: ${record.message}\n\nWe'll keep retrying. Open Profile → Diagnostics for details.`
        );
      });

      // Start recording
      await chunkManager.startSession(sessionId);

      set({
        isRecording: true,
        sessionId,
        startedAt: new Date(),
        elapsedMs: 0,
        chunkCount: 0,
      });
    } catch (error: unknown) {
      set({
        error: error instanceof Error ? error.message : "Failed to start recording",
      });
    }
  },

  stopAndName: async (label: string) => {
    const { sessionId } = get();
    if (!sessionId) return;

    try {
      // Stop recording and queue final chunk — this is fast
      await chunkManager.stopSession();

      // Register the session for auto-complete once uploads finish
      // This does NOT block — uploads continue in the background
      uploadQueue.registerSessionComplete(sessionId, label);

      // Immediately free the UI so the user can start a new recording
      set({
        isRecording: false,
        sessionId: null,
        startedAt: null,
        elapsedMs: 0,
      });
    } catch (error: unknown) {
      set({
        error: error instanceof Error ? error.message : "Failed to stop recording",
      });
    }
  },

  updateElapsed: () => {
    const { startedAt } = get();
    if (startedAt) {
      set({ elapsedMs: Date.now() - startedAt.getTime() });
    }
  },

  updateMetering: async () => {
    if (!get().isRecording) return;
    const status = await recordingEngine.getStatus();
    if (status) set({ meteringDb: status.metering });
  },

  recoverOrphanedSessions: async () => {
    // Don't recover if we're actively recording in memory — that's the current session
    if (get().isRecording) return;

    try {
      const res = await apiGet<{ sessions: OrphanedSession[] }>("/api/sessions/recover");
      const orphaned = res.sessions ?? [];
      if (orphaned.length === 0) return;

      // Finalize each orphaned session — server decides whether to process or mark failed
      await Promise.all(
        orphaned.map((s) =>
          apiPost("/api/sessions/recover", {
            sessionId: s.id,
            label: s.label ?? "Recovered session",
          }).catch(() => {})
        )
      );
    } catch {
      // Recovery is best-effort — ignore errors
    }
  },
}));
