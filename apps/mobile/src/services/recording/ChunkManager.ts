import { recordingEngine } from "./RecordingEngine";
import { uploadQueue } from "./UploadQueue";
import { CHUNK_DURATION_MS } from "../../constants/recording";
import { getCurrentLocation } from "../location";

export class ChunkManager {
  private chunkIndex = 0;
  private sessionId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onChunkComplete?: (index: number) => void;

  setOnChunkComplete(callback: (index: number) => void) {
    this.onChunkComplete = callback;
  }

  async startSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.chunkIndex = 0;

    await recordingEngine.startRecording();

    // Rotate chunks every CHUNK_DURATION_MS
    this.timer = setInterval(async () => {
      await this.rotateChunk();
    }, CHUNK_DURATION_MS);
  }

  async rotateChunk(): Promise<void> {
    if (!this.sessionId) return;

    try {
      // Stop current recording
      const { uri, durationMs } = await recordingEngine.stopRecording();

      const completedIndex = this.chunkIndex;
      this.chunkIndex += 1;

      // Capture location for this chunk
      const coords = await getCurrentLocation();

      // Queue upload of completed chunk
      uploadQueue.enqueue({
        sessionId: this.sessionId,
        chunkIndex: completedIndex,
        uri,
        durationSeconds: Math.round(durationMs / 1000),
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
      });

      this.onChunkComplete?.(completedIndex);

      // Start next chunk immediately
      await recordingEngine.startRecording();
    } catch (error) {
      console.error("Chunk rotation error:", error);
      // Try to restart recording
      try {
        await recordingEngine.startRecording();
      } catch {
        // Fatal — recording lost
      }
    }
  }

  async stopSession(): Promise<void> {
    // Clear the rotation timer
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Stop the final recording
    if (recordingEngine.getIsRecording()) {
      const { uri, durationMs } = await recordingEngine.stopRecording();

      // Always queue the final chunk — even if duration is reported as 0
      // The file exists and has audio data regardless of what the status reports
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
    }

    this.sessionId = null;
  }

  getChunkIndex(): number {
    return this.chunkIndex;
  }
}

export const chunkManager = new ChunkManager();
