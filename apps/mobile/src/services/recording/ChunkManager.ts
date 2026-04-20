import { AppState, AppStateStatus } from "react-native";
import { setAudioModeAsync } from "expo-audio";
import { recordingEngine } from "./RecordingEngine";
import { uploadQueue } from "./UploadQueue";
import { locationTracker } from "./LocationTracker";
import { CHUNK_DURATION_MS, API_BASE_URL } from "../../constants/recording";
import { getCurrentLocation } from "../location";
import { supabase } from "../../lib/supabase";

/**
 * Recording-health state exposed to the UI so reps can see at a glance
 * whether their session is actively capturing audio or quietly stuck.
 *
 *   recording : everything's fine — audio is being captured.
 *   paused    : interruption detected (phone call, Siri, etc). The
 *               watchdog is actively trying to resume.
 *   stopped   : no active session.
 */
export type RecordingHealth = "recording" | "paused" | "stopped";

/**
 * Watchdog interval — checks if recording was paused (e.g. by a phone call,
 * Siri, or audio-session takeover) and auto-resumes by rotating to a new
 * chunk. Runs on a consistent tick so recovery keeps retrying if a single
 * startRecording call fails (e.g. the audio session is briefly still held
 * by the interrupting process).
 */
const WATCHDOG_INTERVAL_MS = 2000;
// Don't rotate for a few seconds after a fresh start — native getStatus()
// can briefly report isRecording=false while the recorder warms up.
const STARTUP_GRACE_MS = 5000;
// Require two consecutive "not recording" readings before rotating, to
// filter out one-off flaky status reads.
const CONSECUTIVE_MISSES_TO_RECOVER = 2;

// mixWithOthers so incidental sounds (notification chimes, Spotify from
// another app, navigation voice) don't kill our recording. Real phone
// calls still interrupt regardless — iOS enforces that — but this
// dramatically reduces false-interruption loss in a rep's day.
const AUDIO_MODE = {
  allowsRecording: true,
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: "mixWithOthers" as const,
};

// Mobile → server heartbeat cadence. Server flags a session with a
// stale heartbeat as "app died" and auto-recovers it on next list load.
const HEARTBEAT_INTERVAL_MS = 60_000;

export class ChunkManager {
  private chunkIndex = 0;
  private sessionId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private onChunkComplete?: (index: number) => void;
  private onHealthChange?: (health: RecordingHealth) => void;
  private isRotating = false;
  private lastRecordingStartAt = 0;
  private consecutiveMissedChecks = 0;
  private health: RecordingHealth = "stopped";

  setOnChunkComplete(callback: (index: number) => void) {
    this.onChunkComplete = callback;
  }

  setOnHealthChange(callback: (health: RecordingHealth) => void) {
    this.onHealthChange = callback;
    // Fire once so subscribers see current state.
    callback(this.health);
  }

  getHealth(): RecordingHealth {
    return this.health;
  }

  private setHealth(next: RecordingHealth): void {
    if (this.health === next) return;
    this.health = next;
    this.onHealthChange?.(next);
  }

  /**
   * Fire-and-forget heartbeat so the server can tell whether a session
   * has gone silently dead. Failures are swallowed — this is a best-
   * effort signal and shouldn't crash or block recording if the server
   * is unreachable.
   */
  private async sendHeartbeat(sessionId: string): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      await fetch(`${API_BASE_URL}/api/sessions/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      // Network hiccup — ignore. The server-side ensure-split sweep
      // will pick up genuinely dead sessions.
    }
  }

  async startSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.chunkIndex = 0;
    this.consecutiveMissedChecks = 0;
    this.setHealth("recording");

    await recordingEngine.startRecording();
    this.lastRecordingStartAt = Date.now();
    locationTracker.start(sessionId);

    // First heartbeat immediately so the server knows we're alive, then
    // on interval while the session is active.
    this.sendHeartbeat(sessionId);
    this.heartbeat = setInterval(() => {
      if (this.sessionId) this.sendHeartbeat(this.sessionId);
    }, HEARTBEAT_INTERVAL_MS);

    // Rotate chunks every CHUNK_DURATION_MS
    this.timer = setInterval(async () => {
      await this.rotateChunk();
    }, CHUNK_DURATION_MS);

    // Watchdog: while a session is active, if the native recorder stays
    // not-running, trigger recovery. Two guards prevent false rotation:
    //   (1) a startup grace period after each fresh start — native
    //       getStatus() can briefly return isRecording=false while warming;
    //   (2) two consecutive missed checks are required before we act,
    //       filtering out one-off flaky reads.
    // Driven off sessionId rather than the engine flag so failed
    // recoveries keep retrying every tick instead of going dormant.
    this.watchdog = setInterval(async () => {
      if (!this.sessionId || this.isRotating) return;
      if (Date.now() - this.lastRecordingStartAt < STARTUP_GRACE_MS) {
        this.consecutiveMissedChecks = 0;
        this.setHealth("recording");
        return;
      }
      if (recordingEngine.isActuallyRecording()) {
        this.consecutiveMissedChecks = 0;
        this.setHealth("recording");
        return;
      }
      // First miss: mark paused so the UI can warn the rep.
      this.setHealth("paused");
      this.consecutiveMissedChecks += 1;
      if (this.consecutiveMissedChecks >= CONSECUTIVE_MISSES_TO_RECOVER) {
        this.consecutiveMissedChecks = 0;
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
      this.lastRecordingStartAt = Date.now();
      this.consecutiveMissedChecks = 0;
      this.setHealth("recording");
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
      this.lastRecordingStartAt = Date.now();
      this.consecutiveMissedChecks = 0;
      this.setHealth("recording");
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
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    if (this.appStateSub) { this.appStateSub.remove(); this.appStateSub = null; }
    this.setHealth("stopped");
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
