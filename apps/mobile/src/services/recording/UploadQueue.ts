import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { API_BASE_URL } from "../../constants/recording";
import { supabase } from "../../lib/supabase";

interface ChunkUploadJob {
  sessionId: string;
  chunkIndex: number;
  uri: string;
  durationSeconds: number;
  latitude: number | null;
  longitude: number | null;
  retries: number;
}

interface PendingComplete {
  sessionId: string;
  label: string;
}

const STORAGE_KEY = "flex_upload_queue";
const COMPLETE_KEY = "flex_pending_completes";
const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1000;

class UploadQueue {
  private queue: ChunkUploadJob[] = [];
  private processing = false;
  private isOnline = true;
  private onStatusChange?: (uploaded: number, total: number) => void;
  private uploadedCount = 0;
  private pendingCompletes: PendingComplete[] = [];

  constructor() {
    // Listen for network changes
    NetInfo.addEventListener((state) => {
      const wasOffline = !this.isOnline;
      this.isOnline = state.isConnected ?? true;
      // Resume processing when coming back online
      if (wasOffline && this.isOnline && this.queue.length > 0) {
        this.processNext();
      }
    });
  }

  setOnStatusChange(callback: (uploaded: number, total: number) => void) {
    this.onStatusChange = callback;
  }

  async restore(): Promise<void> {
    try {
      const [stored, completes] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(COMPLETE_KEY),
      ]);
      if (stored) {
        this.queue = JSON.parse(stored);
      }
      if (completes) {
        this.pendingCompletes = JSON.parse(completes);
      }
      if (this.queue.length > 0) {
        this.processNext();
      }
    } catch {
      // ignore
    }
  }

  enqueue(job: Omit<ChunkUploadJob, "retries">): void {
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
    this.pendingCompletes.push({ sessionId, label });
    this.persistCompletes();
    // Check immediately in case queue is already drained for this session
    this.checkSessionCompletes();
  }

  private async checkSessionCompletes(): Promise<void> {
    const remaining = [...this.pendingCompletes];
    const fulfilled: PendingComplete[] = [];

    for (const pc of remaining) {
      const hasChunks = this.queue.some((j) => j.sessionId === pc.sessionId);
      if (!hasChunks && !this.processing) {
        fulfilled.push(pc);
      }
    }

    for (const pc of fulfilled) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          await fetch(`${API_BASE_URL}/api/sessions/complete`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ sessionId: pc.sessionId, label: pc.label }),
          });
        }
      } catch {
        // Will retry on next drain check
        continue;
      }
      this.pendingCompletes = this.pendingCompletes.filter(
        (p) => p.sessionId !== pc.sessionId
      );
    }

    this.persistCompletes();
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    if (!this.isOnline) return;

    this.processing = true;

    const job = this.queue[0];

    try {
      await this.uploadChunk(job);
      this.queue.shift();
      this.uploadedCount += 1;
      await this.persist();
      this.emitStatus();
    } catch (error) {
      console.error(`Upload failed for chunk ${job.chunkIndex}:`, error);

      if (job.retries >= MAX_RETRIES) {
        this.queue.shift();
        await this.persist();
      } else {
        job.retries += 1;
        await this.persist();
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, job.retries), 60000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    this.processing = false;

    if (this.queue.length > 0) {
      this.processNext();
    } else {
      // All uploads done — check if any sessions are ready to complete
      this.checkSessionCompletes();
    }
  }

  private async uploadChunk(job: ChunkUploadJob): Promise<void> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("No auth session");
    }

    const formData = new FormData();
    formData.append("sessionId", job.sessionId);
    formData.append("chunkIndex", String(job.chunkIndex));
    formData.append("durationSeconds", String(job.durationSeconds));
    if (job.latitude != null) formData.append("latitude", String(job.latitude));
    if (job.longitude != null) formData.append("longitude", String(job.longitude));
    formData.append("audio", {
      uri: job.uri,
      name: `chunk_${job.chunkIndex}.m4a`,
      type: "audio/mp4",
    } as unknown as Blob);

    const res = await fetch(`${API_BASE_URL}/api/sessions/chunk`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(err.error ?? "Upload failed");
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

export const uploadQueue = new UploadQueue();
