import { AppState, AppStateStatus } from "react-native";
import { recordingEngine } from "./RecordingEngine";
import { uploadQueue } from "./UploadQueue";
import { locationTracker } from "./LocationTracker";
import { CHUNK_DURATION_MS } from "../../constants/recording";
import { getCurrentLocation } from "../location";

/**
 * Watchdog interval — checks if recording was paused (e.g. by a phone call)
 * and auto-resumes by rotating to a new chunk.
 */
const WATCHDOG_INTERVAL_MS = 2000;

export class ChunkManager {
  private chunkIndex = 0;
  private sessionId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private onChunkComplete?: (index: number) => void;
  private isRotating = false;

  setOnChunkComplete(callback: (index: number) => void) {
    this.onChunkComplete = callback;
  }

  async startSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.chunkIndex = 0;

    await recordingEngine.startRecording();
    locationTracker.start(sessionId);

    // Rotate chunks every CHUNK_DURATION_MS
    this.timer = setInterval(async () => {
      await this.rotateChunk();
    }, CHUNK_DURATION_MS);

    // Watchdog: detect OS-level recording pauses (phone calls, etc.)
    this.watchdog = setInterval(async () => {
      if (!this.sessionId || this.isRotating) return;
      if (!recordingEngine.isActuallyRecording() && recordingEngine.getIsRecording()) {
        // Native recorder was paused by OS — recover by rotating to a new chunk
        await this.recoverFromInterruption();
      }
    }, WATCHDOG_INTERVAL_MS);

    // Also recover when app returns to foreground after an interruption
    this.appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active" && this.sessionId && !this.isRotating) {
        if (!recordingEngine.isActuallyRecording()) {
          this.recoverFromInterruption().catch(() => {});
        }
      }
    });
  }

  private async recoverFromInterruption(): Promise<void> {
    if (this.isRotating) return;
    this.isRotating = true;
    try {
      // Finalize the interrupted chunk (it has whatever audio was captured up to the interruption)
      await this.finalizeCurrentChunk();
      // Start a fresh chunk
      await recordingEngine.startRecording();
    } catch (err) {
      console.error("Recovery from interruption failed:", err);
      try {
        await recordingEngine.startRecording();
      } catch { /* unrecoverable — will retry on next watchdog tick */ }
    } finally {
      this.isRotating = false;
    }
  }

  private async finalizeCurrentChunk(): Promise<void> {
    if (!this.sessionId) return;
    if (!recordingEngine.getIsRecording()) return;

    let uri = "";
    let durationMs = 0;
    try {
      const result = await recordingEngine.stopRecording();
      uri = result.uri;
      durationMs = result.durationMs;
    } catch {
      return;
    }

    const completedIndex = this.chunkIndex;
    this.chunkIndex += 1;

    if (!uri) return;

    const coords = await getCurrentLocation();
    uploadQueue.enqueue({
      sessionId: this.sessionId,
      chunkIndex: completedIndex,
      uri,
      durationSeconds: Math.round(durationMs / 1000),
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
    });
    this.onChunkComplete?.(completedIndex);
  }

  async rotateChunk(): Promise<void> {
    if (!this.sessionId || this.isRotating) return;
    this.isRotating = true;

    try {
      await this.finalizeCurrentChunk();
      await recordingEngine.startRecording();
    } catch (error) {
      console.error("Chunk rotation error:", error);
      try {
        await recordingEngine.startRecording();
      } catch { /* fatal — next watchdog tick will retry */ }
    } finally {
      this.isRotating = false;
    }
  }

  async stopSession(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
    if (this.appStateSub) { this.appStateSub.remove(); this.appStateSub = null; }
    await locationTracker.stop();

    if (recordingEngine.getIsRecording()) {
      try {
        const { uri, durationMs } = await recordingEngine.stopRecording();
        if (this.sessionId && uri) {
          const coords = await getCurrentLocation();
          uploadQueue.enqueue({
            sessionId: this.sessionId,
            chunkIndex: this.chunkIndex,
            uri,
            durationSeconds: Math.round(durationMs / 1000),
            latitude: coords?.latitude ?? null,
            longitude: coords?.longitude ?? null,
          });
        }
      } catch { /* ignore */ }
    }

    this.sessionId = null;
  }

  getChunkIndex(): number {
    return this.chunkIndex;
  }
}

export const chunkManager = new ChunkManager();
