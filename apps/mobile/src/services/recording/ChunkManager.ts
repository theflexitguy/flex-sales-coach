import {
  AppState,
  AppStateStatus,
  NativeEventEmitter,
  NativeModules,
} from "react-native";
import { setAudioModeAsync } from "expo-audio";
import { recordingEngine } from "./RecordingEngine";
import { uploadQueue } from "./UploadQueue";
import { locationTracker } from "./LocationTracker";
import {
  nativeChunkRecorder,
  type ChunkFinalizedEvent,
  type RecorderStatusEvent,
} from "./NativeChunkRecorder";
import { CHUNK_DURATION_MS, API_BASE_URL } from "../../constants/recording";
import { getCurrentLocation } from "../location";
import { supabase } from "../../lib/supabase";

// Native bridge — observes AVAudioSession interruptions / route changes
// at iOS level (see plugins/ios-recording-monitor/FlexRecordingMonitor.m).
// We listen here so the chunk manager can respond to an interruption
// end the moment JS gets CPU again, without waiting for the 2-s
// watchdog tick that iOS may have throttled.
interface FlexRecordingMonitorModule {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}
const FlexRecordingMonitor = (NativeModules as {
  FlexRecordingMonitor?: FlexRecordingMonitorModule;
}).FlexRecordingMonitor;
// NativeEventEmitter accepts the ObjC bridge as a "module" argument —
// it's loosely typed on the TS side, so cast here is safe.
const flexMonitorEmitter =
  FlexRecordingMonitor != null
    ? new NativeEventEmitter(FlexRecordingMonitor as never)
    : null;

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
// If the native recorder has been going for more than this much real
// wall-clock time, force a rotation even though the JS setInterval
// didn't fire. iOS throttles JS timers aggressively when the app is
// deep-backgrounded — a 4-hour recording with a 5-minute chunk
// interval should produce ~48 chunks, but without this guard we can
// end up with one giant chunk that split/upload can't handle.
// 2x the interval gives iOS room to re-schedule a single late tick
// without us over-rotating.
const MAX_CHUNK_DURATION_MS = CHUNK_DURATION_MS * 2;

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
  private nativeSubs: Array<{ remove: () => void }> = [];
  private onChunkComplete?: (index: number) => void;
  private onHealthChange?: (health: RecordingHealth) => void;
  private isRotating = false;
  private lastRecordingStartAt = 0;
  private consecutiveMissedChecks = 0;
  private health: RecordingHealth = "stopped";
  private usingNativeRecorder = false;

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

    if (nativeChunkRecorder.isAvailable()) {
      // Native path: AVAudioRecorder + DispatchSourceTimer own chunk
      // rotation. JS just listens for chunkFinalized events and
      // enqueues uploads. Skip the watchdog + JS rotation entirely —
      // they're obsolete when native runs the show.
      await this.startNativeSession(sessionId);
      locationTracker.start(sessionId);
      this.sendHeartbeat(sessionId);
      this.heartbeat = setInterval(() => {
        if (this.sessionId) this.sendHeartbeat(this.sessionId);
      }, HEARTBEAT_INTERVAL_MS);
      return;
    }

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

        // Overdue chunk guard: if the rotation setInterval got throttled
        // by iOS in deep background, force a rotation so we don't
        // accumulate a monster chunk. Acts as a safety net — normal
        // rotation still runs on the setInterval cadence.
        const elapsed = Date.now() - this.lastRecordingStartAt;
        if (elapsed >= MAX_CHUNK_DURATION_MS) {
          uploadQueue.recordRecorderEvent(
            this.sessionId,
            this.chunkIndex,
            `overdue chunk (${Math.round(elapsed / 1000)}s) — forcing rotation`
          );
          await this.rotateChunk();
        }
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

    // Subscribe to native AVAudioSession events. This is the critical
    // background-resilience path — iOS delivers these notifications even
    // while JS timers are throttled, and the native side has already
    // re-activated the audio session by the time we get here, so the
    // recorder can immediately resume.
    if (flexMonitorEmitter) {
      this.nativeSubs.push(
        flexMonitorEmitter.addListener("interruptionBegan", () => {
          if (!this.sessionId) return;
          uploadQueue.recordRecorderEvent(
            this.sessionId,
            this.chunkIndex,
            "native: interruption began (call/Siri/route change)"
          );
          this.setHealth("paused");
        })
      );
      this.nativeSubs.push(
        flexMonitorEmitter.addListener(
          "interruptionEnded",
          (evt: { shouldResume?: boolean; reactivated?: boolean }) => {
            if (!this.sessionId) return;
            uploadQueue.recordRecorderEvent(
              this.sessionId,
              this.chunkIndex,
              `native: interruption ended (shouldResume=${evt?.shouldResume}, sessionReactivated=${evt?.reactivated}) — recovering`
            );
            // Fire recovery immediately on whatever CPU iOS grants.
            // This races the 2-s watchdog tick by seconds, which matters
            // because if we're backgrounded the watchdog might not fire
            // for minutes.
            this.recoverFromInterruption().catch(() => {});
          }
        )
      );
      this.nativeSubs.push(
        flexMonitorEmitter.addListener(
          "routeChanged",
          (evt: { reason?: number }) => {
            if (!this.sessionId) return;
            // Any route change can silently drop the recorder —
            // headphones unplugged, BT device switched, CarPlay
            // connected. Treat as potential interruption and verify.
            uploadQueue.recordRecorderEvent(
              this.sessionId,
              this.chunkIndex,
              `native: route changed (reason=${evt?.reason ?? 0}) — verifying recorder`
            );
            if (!recordingEngine.isActuallyRecording()) {
              this.recoverFromInterruption().catch(() => {});
            }
          }
        )
      );
      this.nativeSubs.push(
        flexMonitorEmitter.addListener("mediaServicesReset", () => {
          if (!this.sessionId) return;
          uploadQueue.recordRecorderEvent(
            this.sessionId,
            this.chunkIndex,
            "native: media services reset — rebuilding recorder"
          );
          this.recoverFromInterruption().catch(() => {});
        })
      );
    }
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
    for (const sub of this.nativeSubs) {
      try { sub.remove(); } catch { /* ignore */ }
    }
    this.nativeSubs = [];
    this.setHealth("stopped");
    await locationTracker.stop();

    if (this.usingNativeRecorder) {
      try {
        await nativeChunkRecorder.stopSession();
      } catch (err) {
        console.error("native stopSession failed:", err);
      }
      this.usingNativeRecorder = false;
      this.sessionId = null;
      return;
    }

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

  /**
   * Native-path wiring. Subscribes to chunkFinalized + recorderStatus
   * from the native module and turns them into upload-queue entries
   * and health updates. The native module is already handling chunk
   * rotation and interruption recovery internally; JS is just an
   * observer that feeds the upload pipeline.
   */
  private async startNativeSession(sessionId: string): Promise<void> {
    this.usingNativeRecorder = true;

    this.nativeSubs.push(
      nativeChunkRecorder.onChunkFinalized(async (evt: ChunkFinalizedEvent) => {
        if (this.sessionId !== evt.sessionId) return;
        const coords = await getCurrentLocation();
        uploadQueue.enqueue({
          sessionId: evt.sessionId,
          chunkIndex: evt.chunkIndex,
          uri: `file://${evt.filePath}`,
          durationSeconds: Math.round(evt.durationSeconds),
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
        });
        this.chunkIndex = evt.chunkIndex + 1;
        this.onChunkComplete?.(evt.chunkIndex);
      })
    );

    this.nativeSubs.push(
      nativeChunkRecorder.onRecorderStatus((evt: RecorderStatusEvent) => {
        if (!this.sessionId) return;
        if (evt.state === "paused") {
          this.setHealth("paused");
        } else if (evt.state === "recording") {
          this.setHealth("recording");
        }
      })
    );

    this.nativeSubs.push(
      nativeChunkRecorder.onRecorderError((evt) => {
        if (!this.sessionId) return;
        uploadQueue.recordRecorderEvent(
          this.sessionId,
          this.chunkIndex,
          `native recorder error [${evt.phase}]: ${evt.message}`
        );
      })
    );

    await nativeChunkRecorder.startSession(
      sessionId,
      Math.round(CHUNK_DURATION_MS / 1000)
    );
  }

  getChunkIndex(): number {
    return this.chunkIndex;
  }
}

export const chunkManager = new ChunkManager();
