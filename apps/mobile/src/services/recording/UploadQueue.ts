import AsyncStorage from "@react-native-async-storage/async-storage";
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

const STORAGE_KEY = "flex_upload_queue";
const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1000;

class UploadQueue {
  private queue: ChunkUploadJob[] = [];
  private processing = false;
  private onStatusChange?: (uploaded: number, total: number) => void;
  private uploadedCount = 0;
  private drainResolvers: Array<() => void> = [];

  setOnStatusChange(callback: (uploaded: number, total: number) => void) {
    this.onStatusChange = callback;
  }

  async restore(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
        if (this.queue.length > 0) {
          this.processNext();
        }
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
   * Wait for all queued uploads to finish.
   * Call this before signaling session complete to the server.
   */
  async waitForDrain(): Promise<void> {
    if (this.queue.length === 0 && !this.processing) return;
    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  private checkDrain(): void {
    if (this.queue.length === 0 && !this.processing) {
      const resolvers = this.drainResolvers.splice(0);
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      this.checkDrain();
      return;
    }
    this.processing = true;

    const job = this.queue[0];

    try {
      await this.uploadChunk(job);
      this.queue.shift();
      this.uploadedCount += 1;
      this.persist();
      this.emitStatus();
    } catch (error) {
      console.error(`Upload failed for chunk ${job.chunkIndex}:`, error);

      if (job.retries >= MAX_RETRIES) {
        this.queue.shift();
        this.persist();
      } else {
        job.retries += 1;
        this.persist();
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, job.retries), 60000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    this.processing = false;

    if (this.queue.length > 0) {
      this.processNext();
    } else {
      this.checkDrain();
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
