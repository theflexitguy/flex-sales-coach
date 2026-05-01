import {
  NativeEventEmitter,
  NativeModules,
  Platform,
} from "react-native";

// Typed wrapper for the native FlexChunkRecorder module. When this
// module is present, chunk rotation and AVAudioRecorder lifecycle run
// in native code — JS just observes `chunkFinalized` events to enqueue
// uploads. That's the difference that makes multi-hour backgrounded
// recording reliable: native DispatchSourceTimer survives iOS's
// JS-runtime throttling.

interface FlexChunkRecorderModule {
  startSession(
    sessionId: string,
    chunkDurationSeconds: number,
    startChunkIndex: number
  ): Promise<{ ok: boolean }>;
  stopSession(): Promise<{ finalIndex?: number }>;
  getStatus(): Promise<{
    isRecording: boolean;
    metering?: number;
    chunkElapsedMs?: number;
    chunkIndex?: number;
  }>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  drainFinalizedChunks(): Promise<ChunkFinalizedEvent[]>;
}

export interface ChunkFinalizedEvent {
  sessionId: string;
  chunkIndex: number;
  filePath: string;
  durationSeconds: number;
  final?: boolean;
  rotationAttempts?: number;
  rotationSuccesses?: number;
}

export interface RecorderStatusEvent {
  state: "recording" | "paused";
  reason?: string;
}

export interface RecorderErrorEvent {
  phase: string;
  message: string;
  attempt?: number;
  rotationAttempts?: number;
  rotationSuccesses?: number;
}

const nativeModule: FlexChunkRecorderModule | undefined = (
  NativeModules as { FlexChunkRecorder?: FlexChunkRecorderModule }
).FlexChunkRecorder;

const emitter =
  nativeModule != null ? new NativeEventEmitter(nativeModule as never) : null;

export const nativeChunkRecorder = {
  isAvailable(): boolean {
    return Platform.OS === "ios" && nativeModule != null;
  },

  async startSession(
    sessionId: string,
    chunkDurationSeconds: number,
    startChunkIndex = 0
  ): Promise<void> {
    if (!nativeModule) {
      throw new Error("FlexChunkRecorder native module not available");
    }
    await nativeModule.startSession(sessionId, chunkDurationSeconds, startChunkIndex);
  },

  async stopSession(): Promise<{ finalIndex?: number }> {
    if (!nativeModule) return {};
    return nativeModule.stopSession();
  },

  async getStatus(): Promise<{
    isRecording: boolean;
    metering?: number;
    chunkElapsedMs?: number;
    chunkIndex?: number;
  }> {
    if (!nativeModule) return { isRecording: false };
    return nativeModule.getStatus();
  },

  async drainFinalizedChunks(): Promise<ChunkFinalizedEvent[]> {
    if (!nativeModule) return [];
    return nativeModule.drainFinalizedChunks();
  },

  onChunkFinalized(
    listener: (event: ChunkFinalizedEvent) => void
  ): { remove: () => void } {
    if (!emitter) return { remove: () => {} };
    const sub = emitter.addListener("chunkFinalized", listener);
    return { remove: () => sub.remove() };
  },

  onRecorderStatus(
    listener: (event: RecorderStatusEvent) => void
  ): { remove: () => void } {
    if (!emitter) return { remove: () => {} };
    const sub = emitter.addListener("recorderStatus", listener);
    return { remove: () => sub.remove() };
  },

  onRecorderError(
    listener: (event: RecorderErrorEvent) => void
  ): { remove: () => void } {
    if (!emitter) return { remove: () => {} };
    const sub = emitter.addListener("recorderError", listener);
    return { remove: () => sub.remove() };
  },
};
