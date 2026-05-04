import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as FileSystem from "expo-file-system/legacy";
import {
  API_BASE_URL,
  API_BASE_URL_STATUS,
  apiUrl,
} from "../../constants/recording";
import { supabase } from "../../lib/supabase";
import {
  nativeBackgroundUploader,
  type UploadCompletedEvent,
  type UploadFailedEvent,
} from "./NativeBackgroundUploader";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

interface ChunkUploadJob {
  sessionId: string;
  chunkIndex: number;
  uri: string;
  durationSeconds: number;
  latitude: number | null;
  longitude: number | null;
  retries: number;
  // When set, this job has been handed to the native URLSession.background
  // uploader and is awaiting a completion event. Do not re-upload.
  nativeTaskId?: number;
  storagePath?: string;
}

export interface PendingComplete {
  sessionId: string;
  label: string;
  attempts?: number;
  firstAttemptAt?: number;
  nextAttemptAt?: number;
  lastStatus?: number;
  lastError?: string;
  failedAt?: number;
}

export interface UploadErrorRecord {
  at: number;
  sessionId: string;
  chunkIndex: number;
  retries: number;
  stage:
    | "auth"
    | "storage"
    | "metadata"
    | "recorder"
    | "complete"
    | "config"
    | "unknown";
  message: string;
}

export interface UploadDiagnostics {
  apiBaseUrl: string;
  apiBaseUrlValid: boolean;
  apiBaseUrlError: string | null;
  queueSize: number;
  uploadedCount: number;
  localSpoolFiles: number;
  localSpoolBytes: number;
  nativePendingUploads: number | null;
  pendingCompletes: PendingComplete[];
  isOnline: boolean;
  processing: boolean;
  lastError: string | null;
  errors: UploadErrorRecord[];
  tokenExpiry: number | null;
  tokenValid: boolean;
  userId: string | null;
}

const STORAGE_KEY = "flex_upload_queue";
const COMPLETE_KEY = "flex_pending_completes";
const ERRORS_KEY = "flex_upload_errors";
const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1000;
const ERROR_RING_SIZE = 20;
// Poll interval for stuck /complete posts. If the last chunk drained but
// the /api/sessions/complete fetch failed (expired token, flaky network),
// nothing else in the queue will trigger another attempt — this timer
// does.
const COMPLETE_RETRY_MS = 15000;
const COMPLETE_MAX_RETRY_WINDOW_MS = 6 * 60 * 60 * 1000;
const LOCAL_SPOOL_DIR = `${FileSystem.documentDirectory ?? ""}flex-chunks`;

interface LocalSpoolStats {
  files: number;
  bytes: number;
}

function ensureFileUri(pathOrUri: string): string {
  return pathOrUri.startsWith("file://") ? pathOrUri : `file://${pathOrUri}`;
}

function withoutFileScheme(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}

async function getLocalSpoolStats(): Promise<LocalSpoolStats> {
  if (!FileSystem.documentDirectory) return { files: 0, bytes: 0 };

  async function walk(dir: string): Promise<LocalSpoolStats> {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return { files: 0, bytes: 0 };

    const entries = await FileSystem.readDirectoryAsync(dir).catch(() => []);
    let files = 0;
    let bytes = 0;

    for (const entry of entries) {
      const child = `${dir.replace(/\/+$/, "")}/${entry}`;
      const childInfo = await FileSystem.getInfoAsync(child);
      if (!childInfo.exists) continue;

      if ("isDirectory" in childInfo && childInfo.isDirectory) {
        const nested = await walk(child);
        files += nested.files;
        bytes += nested.bytes;
      } else {
        files += 1;
        bytes += "size" in childInfo && typeof childInfo.size === "number"
          ? childInfo.size
          : 0;
      }
    }

    return { files, bytes };
  }

  return walk(LOCAL_SPOOL_DIR);
}

class UploadQueue {
  private queue: ChunkUploadJob[] = [];
  private processing = false;
  private isOnline = true;
  private onStatusChange?: (uploaded: number, total: number) => void;
  private onError?: (msg: string) => void;
  private onFirstError?: (record: UploadErrorRecord) => void;
  private uploadedCount = 0;
  private pendingCompletes: PendingComplete[] = [];
  private lastError: string | null = null;
  private errors: UploadErrorRecord[] = [];
  private alertedForSessions = new Set<string>();
  private completeRetryTimer: ReturnType<typeof setInterval> | null = null;
  private completeCheckInFlight = false;

  constructor() {
    // Listen for network changes
    NetInfo.addEventListener((state) => {
      const wasOffline = !this.isOnline;
      this.isOnline = state.isConnected ?? true;
      // Resume processing when coming back online
      if (wasOffline && this.isOnline) {
        if (this.queue.length > 0) this.processNext();
        if (this.pendingCompletes.length > 0) this.checkSessionCompletes();
      }
    });

    // Wire native URLSession.background completion events into the JS
    // queue. On iOS these events arrive even if the app was relaunched
    // in the background to deliver them — the native module persists
    // metadata across restarts so the event payload always carries the
    // session/chunk info we need.
    if (nativeBackgroundUploader.isAvailable()) {
      nativeBackgroundUploader.onCompleted((evt) => {
        this.handleNativeCompleted(evt).catch((err) => {
          console.error("native-uploader onCompleted handler error", err);
        });
      });
      nativeBackgroundUploader.onFailed((evt) => {
        this.handleNativeFailed(evt).catch((err) => {
          console.error("native-uploader onFailed handler error", err);
        });
      });
    }
  }

  setOnStatusChange(callback: (uploaded: number, total: number) => void) {
    this.onStatusChange = callback;
  }

  setOnError(callback: (msg: string) => void) {
    this.onError = callback;
  }

  setOnFirstError(callback: (record: UploadErrorRecord) => void) {
    this.onFirstError = callback;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getErrors(): UploadErrorRecord[] {
    return [...this.errors];
  }

  async getDiagnostics(): Promise<UploadDiagnostics> {
    let tokenExpiry: number | null = null;
    let tokenValid = false;
    let userId: string | null = null;
    let nativePendingUploads: number | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        tokenExpiry = data.session.expires_at ?? null;
        tokenValid = tokenExpiry ? tokenExpiry * 1000 > Date.now() : false;
        userId = data.session.user?.id ?? null;
      }
    } catch {
      // ignore
    }
    if (nativeBackgroundUploader.isAvailable()) {
      nativePendingUploads = await nativeBackgroundUploader.getPendingCount().catch(() => null);
    }
    const spool = await getLocalSpoolStats().catch(() => ({ files: 0, bytes: 0 }));
    return {
      apiBaseUrl: API_BASE_URL,
      apiBaseUrlValid: API_BASE_URL_STATUS.valid,
      apiBaseUrlError: API_BASE_URL_STATUS.error,
      queueSize: this.queue.length,
      uploadedCount: this.uploadedCount,
      localSpoolFiles: spool.files,
      localSpoolBytes: spool.bytes,
      nativePendingUploads,
      pendingCompletes: [...this.pendingCompletes],
      isOnline: this.isOnline,
      processing: this.processing,
      lastError: this.lastError,
      errors: [...this.errors],
      tokenExpiry,
      tokenValid,
      userId,
    };
  }

  /**
   * Record a non-upload event (e.g. recorder interruption, watchdog action).
   * Surfaces on the Diagnostics screen so we can see what's happening inside
   * the recording pipeline without an attached debugger.
   */
  recordRecorderEvent(sessionId: string, chunkIndex: number, message: string): void {
    const record: UploadErrorRecord = {
      at: Date.now(),
      sessionId,
      chunkIndex,
      retries: 0,
      stage: "recorder",
      message,
    };
    this.errors.unshift(record);
    if (this.errors.length > ERROR_RING_SIZE) {
      this.errors.length = ERROR_RING_SIZE;
    }
    this.persistErrors().catch(() => {
      // best-effort — diagnostics persistence isn't critical
    });
  }

  async clearErrors(): Promise<void> {
    this.errors = [];
    this.alertedForSessions.clear();
    try {
      await AsyncStorage.removeItem(ERRORS_KEY);
    } catch {
      // ignore
    }
  }

  async restore(): Promise<void> {
    try {
      const [stored, completes, errors] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(COMPLETE_KEY),
        AsyncStorage.getItem(ERRORS_KEY),
      ]);
      if (stored) {
        this.queue = JSON.parse(stored);
      }
      if (completes) {
        this.pendingCompletes = JSON.parse(completes);
      }
      if (errors) {
        this.errors = JSON.parse(errors);
      }

      await this.syncNativeUploaderState();

      // Drop jobs whose underlying files no longer exist. Native chunks
      // live in Documents/flex-chunks and should remain until cleanup,
      // so this usually means the file was already deleted after a
      // successful upload or the OS/user removed app data.
      if (this.queue.length > 0) {
        const survivors: ChunkUploadJob[] = [];
        const dropped: ChunkUploadJob[] = [];
        for (const job of this.queue) {
          const info = await FileSystem.getInfoAsync(job.uri);
          if (info.exists) {
            survivors.push(job);
          } else {
            dropped.push(job);
          }
        }
        if (dropped.length > 0) {
          this.queue = survivors;
          await this.persist();
          for (const job of dropped) {
            const record: UploadErrorRecord = {
              at: Date.now(),
              sessionId: job.sessionId,
              chunkIndex: job.chunkIndex,
              retries: job.retries,
              stage: "storage",
              message: `dropped on restore — file missing: ${job.uri}`,
            };
            this.errors.unshift(record);
          }
          if (this.errors.length > ERROR_RING_SIZE) {
            this.errors.length = ERROR_RING_SIZE;
          }
          await this.persistErrors();
        }
      }

      if (this.queue.length > 0) {
        this.processNext();
      } else {
        // Any pending completes may now be unblocked since we dropped dead chunks
        this.checkSessionCompletes();
      }
      // Start the standalone retry timer if we restored unfinished completes.
      this.updateCompleteRetryTimer();
    } catch {
      // ignore
    }
  }

  enqueue(job: Omit<ChunkUploadJob, "retries">): void {
    const existing = this.queue.find(
      (j) => j.sessionId === job.sessionId && j.chunkIndex === job.chunkIndex
    );
    if (existing) {
      existing.uri = job.uri;
      existing.durationSeconds = job.durationSeconds;
      existing.latitude = job.latitude;
      existing.longitude = job.longitude;
      existing.storagePath = job.storagePath ?? existing.storagePath;
      this.persist();
      this.emitStatus();
      this.processNext();
      return;
    }
    this.queue.push({ ...job, retries: 0 });
    this.persist();
    this.emitStatus();
    this.processNext();
  }

  /**
   * Register a session to be completed once all its chunks are uploaded.
   * This replaces the old waitForDrain() approach — the UI is never blocked.
   */
  registerSessionComplete(sessionId: string, label: string): void {
    const existing = this.pendingCompletes.find((p) => p.sessionId === sessionId);
    if (existing) {
      existing.label = label;
      existing.failedAt = undefined;
      existing.lastError = undefined;
      existing.lastStatus = undefined;
      existing.nextAttemptAt = undefined;
      existing.firstAttemptAt = undefined;
      existing.attempts = 0;
    } else {
      this.pendingCompletes.push({ sessionId, label });
    }
    this.persistCompletes();
    this.updateCompleteRetryTimer();
    // Check immediately in case queue is already drained for this session
    this.checkSessionCompletes();
  }

  private async checkSessionCompletes(): Promise<void> {
    if (this.completeCheckInFlight || !this.isOnline) return;
    this.completeCheckInFlight = true;

    try {
      await this.checkSessionCompletesOnce();
    } finally {
      this.completeCheckInFlight = false;
    }
  }

  private async checkSessionCompletesOnce(): Promise<void> {
    const remaining = [...this.pendingCompletes];
    const fulfilled: PendingComplete[] = [];
    const now = Date.now();

    for (const pc of remaining) {
      const hasChunks = this.queue.some((j) => j.sessionId === pc.sessionId);
      const retryReady = !pc.nextAttemptAt || pc.nextAttemptAt <= now;
      if (!hasChunks && retryReady && !pc.failedAt) {
        fulfilled.push(pc);
      }
    }

    for (const pc of fulfilled) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          await this.scheduleCompleteRetry(pc, "No auth session", null);
          continue;
        }

        const res = await fetch(apiUrl("/api/sessions/complete"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ sessionId: pc.sessionId, label: pc.label }),
        });

        if (res.ok) {
          this.pendingCompletes = this.pendingCompletes.filter(
            (p) => p.sessionId !== pc.sessionId
          );
          await this.persistCompletes();
        } else {
          const text = await res.text().catch(() => "");
          await this.scheduleCompleteRetry(
            pc,
            `complete POST ${res.status}: ${text.slice(0, 240) || res.statusText}`,
            res.status
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        await this.scheduleCompleteRetry(
          pc,
          `complete POST exception: ${message}`,
          null
        );
      }
    }

    await this.persistCompletes();
    this.updateCompleteRetryTimer();
  }

  private async scheduleCompleteRetry(
    pc: PendingComplete,
    message: string,
    status: number | null
  ): Promise<void> {
    const now = Date.now();
    pc.firstAttemptAt ??= now;
    pc.attempts = (pc.attempts ?? 0) + 1;
    pc.lastStatus = status ?? undefined;
    pc.lastError = message;

    if (now - pc.firstAttemptAt >= COMPLETE_MAX_RETRY_WINDOW_MS) {
      pc.failedAt = now;
      pc.nextAttemptAt = undefined;
      this.recordUploadEvent({
        at: now,
        sessionId: pc.sessionId,
        chunkIndex: -1,
        retries: pc.attempts,
        stage: "complete",
        message: `${message}; giving up after ${Math.round(
          COMPLETE_MAX_RETRY_WINDOW_MS / 60000
        )} minutes`,
      });
      await this.persistCompletes();
      return;
    }

    const delay = Math.min(
      BASE_DELAY_MS * Math.pow(2, pc.attempts),
      5 * 60 * 1000
    );
    pc.nextAttemptAt = now + delay;
    this.recordUploadEvent({
      at: now,
      sessionId: pc.sessionId,
      chunkIndex: -1,
      retries: pc.attempts,
      stage: API_BASE_URL_STATUS.valid ? "complete" : "config",
      message: `${message}; will retry`,
    });
    await this.persistCompletes();
  }

  private recordUploadEvent(record: UploadErrorRecord): void {
    this.lastError = record.message;
    this.errors.unshift(record);
    if (this.errors.length > ERROR_RING_SIZE) {
      this.errors.length = ERROR_RING_SIZE;
    }
    this.persistErrors().catch(() => {
      // best-effort — diagnostics persistence isn't critical
    });
  }

  private async deleteLocalChunkFile(
    uriOrPath: string | null | undefined,
    sessionId: string,
    chunkIndex: number
  ): Promise<void> {
    if (!uriOrPath) return;

    const uri = ensureFileUri(uriOrPath);
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) return;
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      this.recordUploadEvent({
        at: Date.now(),
        sessionId,
        chunkIndex,
        retries: 0,
        stage: "storage",
        message: `uploaded but failed to delete local spool file ${uri}: ${message}`,
      });
    }
  }

  private updateCompleteRetryTimer(): void {
    const shouldRun = this.pendingCompletes.some((pc) => !pc.failedAt);
    if (shouldRun && !this.completeRetryTimer) {
      this.completeRetryTimer = setInterval(() => {
        this.checkSessionCompletes().catch(() => {
          // swallow; next tick retries
        });
      }, COMPLETE_RETRY_MS);
    } else if (!shouldRun && this.completeRetryTimer) {
      clearInterval(this.completeRetryTimer);
      this.completeRetryTimer = null;
    }
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    if (!this.isOnline) return;

    this.processing = true;

    try {
      if (nativeBackgroundUploader.isAvailable()) {
        // Native path: hand off every idle job to URLSession.background
        // in a tight loop. iOS will run them in parallel with its own
        // scheduler; we just keep JS out of the critical path. Uploads
        // continue even if the app is suspended or killed.
        for (const job of this.queue) {
          if (job.nativeTaskId != null) continue;
          try {
            await this.handoffToNative(job);
          } catch (err) {
            await this.handleUploadError(job, err, "handoff");
          }
        }
      } else {
        // JS fallback path — used on Android and dev builds without the
        // native plugin. Serial upload, same behaviour as before the
        // native path existed.
        const job = this.queue[0];
        try {
          await this.uploadChunk(job);
          await this.deleteLocalChunkFile(job.uri, job.sessionId, job.chunkIndex);
          this.queue.shift();
          this.uploadedCount += 1;
          await this.persist();
          this.emitStatus();
        } catch (error) {
          await this.handleUploadError(job, error, "js-upload");
        }
      }
    } finally {
      this.processing = false;
    }

    if (this.queue.some((j) => j.nativeTaskId == null) && this.isOnline) {
      this.processNext();
    } else if (this.queue.length === 0) {
      this.checkSessionCompletes();
    }
  }

  private async syncNativeUploaderState(): Promise<void> {
    if (!nativeBackgroundUploader.isAvailable()) return;

    try {
      const events = await nativeBackgroundUploader.drainEvents();
      for (const event of events) {
        if (event.eventName === "uploadCompleted") {
          await this.handleNativeCompleted(event as UploadCompletedEvent);
        } else {
          await this.handleNativeFailed(event as UploadFailedEvent);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      this.recordRecorderEvent(
        "unknown",
        -1,
        `native uploader drain failed: ${message}`
      );
    }

    try {
      const activeIds = new Set(await nativeBackgroundUploader.getActiveTaskIds());
      let changed = false;
      for (const job of this.queue) {
        if (job.nativeTaskId != null && !activeIds.has(job.nativeTaskId)) {
          this.recordRecorderEvent(
            job.sessionId,
            job.chunkIndex,
            `native upload task ${job.nativeTaskId} missing; retrying with fresh signed URL`
          );
          job.nativeTaskId = undefined;
          changed = true;
        }
      }
      if (changed) {
        await this.persist();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      this.recordRecorderEvent(
        "unknown",
        -1,
        `native uploader task reconciliation failed: ${message}`
      );
    }
  }

  private async handleUploadError(
    job: ChunkUploadJob,
    error: unknown,
    _source: string
  ): Promise<void> {
    const msg = error instanceof Error ? error.message : "Unknown error";
    const stage: UploadErrorRecord["stage"] =
      error instanceof UploadStageError ? error.stage : "unknown";
    const unrecoverable =
      error instanceof UploadStageError && error.unrecoverable === true;
    console.error(`Upload failed for chunk ${job.chunkIndex} [${stage}]: ${msg}`);
    this.lastError = `Chunk ${job.chunkIndex} [${stage}]: ${msg}`;
    if (!unrecoverable) {
      this.onError?.(this.lastError);
    }

    const record: UploadErrorRecord = {
      at: Date.now(),
      sessionId: job.sessionId,
      chunkIndex: job.chunkIndex,
      retries: job.retries,
      stage,
      message: msg,
    };
    this.errors.unshift(record);
    if (this.errors.length > ERROR_RING_SIZE) {
      this.errors.length = ERROR_RING_SIZE;
    }
    await this.persistErrors();

    if (!unrecoverable && !this.alertedForSessions.has(job.sessionId)) {
      this.alertedForSessions.add(job.sessionId);
      this.onFirstError?.(record);
    }

    if (unrecoverable || job.retries >= MAX_RETRIES) {
      this.queue = this.queue.filter((j) => j !== job);
      await this.persist();
    } else {
      job.retries += 1;
      job.nativeTaskId = undefined;
      await this.persist();
      const delay = Math.min(BASE_DELAY_MS * Math.pow(2, job.retries), 60000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  /**
   * Request a signed upload URL from the server and hand the file off
   * to the native URLSession.background uploader. Resolves once the
   * task has been enqueued by iOS; actual upload completion arrives
   * via the native event listeners.
   */
  private async handoffToNative(job: ChunkUploadJob): Promise<void> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new UploadStageError("auth", "No auth session");
    }

    const info = await FileSystem.getInfoAsync(job.uri);
    if (!info.exists) {
      throw new UploadStageError("storage", `chunk file missing: ${job.uri}`, true);
    }
    const fileSizeBytes =
      "size" in info && typeof info.size === "number" ? info.size : null;

    const urlRes = await fetch(apiUrl("/api/sessions/chunk/upload-url"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: job.sessionId,
        chunkIndex: job.chunkIndex,
      }),
    });

    if (!urlRes.ok) {
      const text = await urlRes.text().catch(() => "");
      throw new UploadStageError(
        "auth",
        `signed-url ${urlRes.status}: ${text.slice(0, 200)}`
      );
    }

    const { signedUrl, storagePath }: { signedUrl: string; storagePath: string } =
      await urlRes.json();

    // Strip file:// prefix if present — URLSession.uploadTaskWithRequest:fromFile
    // wants a plain filesystem path.
    const localPath = withoutFileScheme(job.uri);

    const { taskId } = await nativeBackgroundUploader.enqueueUpload(
      localPath,
      signedUrl,
      { "Content-Type": "audio/mp4" },
      {
        sessionId: job.sessionId,
        chunkIndex: job.chunkIndex,
        durationSeconds: job.durationSeconds,
        latitude: job.latitude,
        longitude: job.longitude,
        storagePath,
        localUri: job.uri,
        localFilePath: localPath,
        fileSizeBytes,
      }
    );

    job.nativeTaskId = taskId;
    job.storagePath = storagePath;
    await this.persist();
    this.emitStatus();
  }

  private findJobByTaskId(taskId: number): ChunkUploadJob | undefined {
    return this.queue.find((j) => j.nativeTaskId === taskId);
  }

  private async handleNativeCompleted(
    event: UploadCompletedEvent
  ): Promise<void> {
    const job = this.findJobByTaskId(event.taskId);
    // Use native metadata as fallback if we don't have a JS-side job
    // (e.g. completion arrived after app was killed + relaunched and
    // the queue wasn't fully restored yet).
    const meta = event.metadata ?? {};
    const sessionId = (job?.sessionId ?? (meta.sessionId as string | undefined)) ?? null;
    const chunkIndex =
      job?.chunkIndex ?? (meta.chunkIndex as number | undefined) ?? null;
    const storagePath =
      job?.storagePath ?? (meta.storagePath as string | undefined) ?? null;
    const durationSeconds =
      job?.durationSeconds ?? (meta.durationSeconds as number | undefined) ?? 0;
    const latitude =
      job?.latitude ?? ((meta.latitude as number | null | undefined) ?? null);
    const longitude =
      job?.longitude ?? ((meta.longitude as number | null | undefined) ?? null);
    const localUri =
      job?.uri ??
      (meta.localUri as string | undefined) ??
      (typeof meta.localFilePath === "string"
        ? ensureFileUri(meta.localFilePath)
        : null);

    if (sessionId == null || chunkIndex == null || storagePath == null) {
      // Can't register — log and drop. Session ensure-split sweep will
      // still recover audio that actually landed in storage.
      this.recordRecorderEvent(
        sessionId ?? "unknown",
        chunkIndex ?? -1,
        `native upload completed but missing metadata; taskId=${event.taskId}`
      );
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        throw new UploadStageError("auth", "No auth session at register-time");
      }

      const res = await fetch(apiUrl("/api/sessions/chunk"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          chunkIndex,
          storagePath,
          durationSeconds,
          latitude,
          longitude,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new UploadStageError(
          "metadata",
          `register ${res.status}: ${text.slice(0, 200)}`
        );
      }

      if (job) {
        this.queue = this.queue.filter((j) => j !== job);
      }
      await this.deleteLocalChunkFile(localUri, sessionId, chunkIndex);
      this.uploadedCount += 1;
      await this.persist();
      this.emitStatus();
      this.checkSessionCompletes();
    } catch (err) {
      if (job) {
        await this.handleUploadError(job, err, "register-after-native");
      } else {
        const message = err instanceof Error ? err.message : "unknown";
        this.recordRecorderEvent(
          sessionId,
          chunkIndex,
          `post-native register failed: ${message}`
        );
      }
    }
  }

  private async handleNativeFailed(event: UploadFailedEvent): Promise<void> {
    const job = this.findJobByTaskId(event.taskId);
    if (!job) {
      // Unknown task — nothing we can do. Likely from a previous app
      // install or an already-removed job.
      return;
    }
    await this.handleUploadError(
      job,
      new UploadStageError("storage", event.error || `HTTP ${event.status}`),
      "native-upload"
    );
    // Kick the queue so the retry (after backoff) actually dispatches.
    // handleUploadError only sleeps; it does not itself schedule retry.
    this.processNext();
  }

  private async uploadChunk(job: ChunkUploadJob): Promise<void> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new UploadStageError("auth", "No auth session");
    }

    if (!SUPABASE_URL) {
      throw new UploadStageError("auth", "EXPO_PUBLIC_SUPABASE_URL missing");
    }

    // Verify the chunk file still exists on disk before upload. If the OS
    // evicted it (rare but possible), this is an unrecoverable error — skip it.
    const info = await FileSystem.getInfoAsync(job.uri);
    if (!info.exists) {
      throw new UploadStageError("storage", `chunk file missing: ${job.uri}`, true);
    }

    // Upload directly to Supabase Storage REST via native URLSession (iOS) /
    // OkHttp (Android). This bypasses JS fetch, FormData, and any Hermes
    // bundling quirks — the cause of past TestFlight-only upload failures.
    const storagePath = `${job.sessionId}/${job.chunkIndex}.m4a`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/recording-chunks/${storagePath}`;

    const uploadRes = await FileSystem.uploadAsync(uploadUrl, job.uri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "audio/mp4",
        "x-upsert": "true",
        apikey: session.access_token,
      },
    });

    if (uploadRes.status < 200 || uploadRes.status >= 300) {
      // Surface the Supabase error body so the Diagnostics screen shows the real reason
      const body = uploadRes.body?.slice(0, 400) ?? "";
      throw new UploadStageError(
        "storage",
        `HTTP ${uploadRes.status}: ${body || "no body"}`
      );
    }

    // Refresh session before metadata POST — step 1 may have taken 30s+ on slow networks,
    // and the server verifies the bearer token against auth.users.
    const {
      data: { session: freshSession },
    } = await supabase.auth.getSession();
    const token = freshSession?.access_token ?? session.access_token;

    // Step 2: Register the chunk metadata via lightweight API call (no file body)
    const res = await fetch(apiUrl("/api/sessions/chunk"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: job.sessionId,
        chunkIndex: job.chunkIndex,
        storagePath,
        durationSeconds: job.durationSeconds,
        latitude: job.latitude,
        longitude: job.longitude,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let errMsg = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(text);
        errMsg = parsed.error ?? errMsg;
      } catch {
        errMsg = text.slice(0, 200) || errMsg;
      }
      throw new UploadStageError("metadata", `${res.status}: ${errMsg}`);
    }
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch {
      // ignore
    }
  }

  private async persistCompletes(): Promise<void> {
    try {
      await AsyncStorage.setItem(COMPLETE_KEY, JSON.stringify(this.pendingCompletes));
    } catch {
      // ignore
    }
  }

  private async persistErrors(): Promise<void> {
    try {
      await AsyncStorage.setItem(ERRORS_KEY, JSON.stringify(this.errors));
    } catch {
      // ignore
    }
  }

  private emitStatus(): void {
    this.onStatusChange?.(this.uploadedCount, this.uploadedCount + this.queue.length);
  }

  getPendingCount(): number {
    return this.queue.length;
  }

  getUploadedCount(): number {
    return this.uploadedCount;
  }

  resetCounts(): void {
    this.uploadedCount = 0;
  }
}

class UploadStageError extends Error {
  constructor(
    readonly stage: UploadErrorRecord["stage"],
    message: string,
    readonly unrecoverable: boolean = false
  ) {
    super(message);
    this.name = "UploadStageError";
  }
}

export const uploadQueue = new UploadQueue();
