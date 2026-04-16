import { create } from "zustand";
import { chunkManager } from "../services/recording/ChunkManager";
import { uploadQueue } from "../services/recording/UploadQueue";
import { apiPost } from "../services/api";
import { requestLocationPermission, getCurrentLocation } from "../services/location";

interface RecordingState {
  isRecording: boolean;
  sessionId: string | null;
  startedAt: Date | null;
  elapsedMs: number;
  chunkCount: number;
  uploadedChunks: number;
  totalChunks: number;
  error: string | null;

  startDay: () => Promise<void>;
  stopAndName: (label: string) => Promise<void>;
  updateElapsed: () => void;
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  isRecording: false,
  sessionId: null,
  startedAt: null,
  elapsedMs: 0,
  chunkCount: 0,
  uploadedChunks: 0,
  totalChunks: 0,
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

      // Set up upload status callback
      uploadQueue.resetCounts();
      uploadQueue.setOnStatusChange((uploaded, total) => {
        set({ uploadedChunks: uploaded, totalChunks: total });
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
}));
