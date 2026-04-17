import { AppState, AppStateStatus } from "react-native";
import { setAudioModeAsync } from "expo-audio";
import { recordingEngine } from "./RecordingEngine";
import { uploadQueue } from "./UploadQueue";
import { locationTracker } from "./LocationTracker";
import { CHUNK_DURATION_MS } from "../../constants/recording";
import { getCurrentLocation } from "../location";

/**
 * Watchdog interval — checks if recording was paused (e.g. by a phone call,
 * Siri, or audio-session takeover) and auto-resumes by rotating to a new
 * chunk. Runs on a consistent tick so recovery keeps retrying if a single
 * startRecording call fails (e.g. the audio session is briefly still held
 * by the interrupting process).
 */
const WATCHDOG_INTERVAL_MS = 2000;

const AUDIO_MODE = {
  allowsRecording: true,
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: "doNotMix" as const,
};

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

    // Watchdog: while a session is active, if the native recorder is not
    // running, keep trying to recover. Previously this was gated on
    // recordingEngine.getIsRecording() — once a recovery failed, that flag
    // would be false and the watchdog would go dormant, silently killing
    // the rest of the session.
    this.watchdog = setInterval(async () => {
      if (!this.sessionId || this.isRotating) return;
      if (!recordingEngine.isActuallyRecording()) {
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
    if (!this.sessionId) return;
    this.isRotating = true;
    const activeSessionId = this.sessionId;
    try {
      // If the engine still thinks it's recording, finalize the interrupted
      // chunk (it has whatever audio was captured up to the interruption).
      // If we're already past that (prior recovery failed and we're retrying),
      // skip straight to restarting.
      if (recordingEngine.getIsRecording()) {
        uploadQueue.recordRecorderEvent(
          activeSessionId,
          this.chunkIndex,
          "interruption detected — finalizing current chunk"
        );
        await this.finalizeCurrentChunk();
      }
      // Re-establish the audio session before starting a new recorder. An
      // OS-level interruption (call, Siri, screen lock) can invalidate the
      // previous allowsRecording grant, which would otherwise cause every
      // subsequent startRecording() to fail.
      await setAudioModeAsync(AUDIO_MODE);
      await recordingEngine.startRecording();
      uploadQueue.recordRecorderEvent(
        activeSessionId,
        this.chunkIndex,
        "recovery succeeded — recording resumed"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error("Recovery from interruption failed:", err);
      uploadQueue.recordRecorderEvent(
        activeSessionId,
        this.chunkIndex,
        `recovery attempt failed (will retry): ${msg}`
      );
      // Do not retry synchronously — the watchdog will call us again on its
      // next tick. Retrying synchronously here just burns the same failure
      // back-to-back.
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
      // Re-assert audio mode before starting next chunk, same reason as
      // recovery — defends against an undetected audio-session takeover.
      await setAudioModeAsync(AUDIO_MODE);
      await recordingEngine.startRecording();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown error";
      console.error("Chunk rotation error:", error);
      if (this.sessionId) {
        uploadQueue.recordRecorderEvent(
          this.sessionId,
          this.chunkIndex,
          `rotation restart failed (watchdog will retry): ${msg}`
        );
      }
      // Watchdog will retry startRecording on its next tick.
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
