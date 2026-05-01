import {
  NativeEventEmitter,
  NativeModules,
  Platform,
} from "react-native";

// Typed wrapper for the native FlexBackgroundUploader module.
//
// The native module hands off chunk uploads to
// URLSessionConfiguration.background on iOS so they continue even if
// the app is suspended or killed. JavaScript listens for completion
// events and reconciles them with the pending chunk queue.

interface FlexBackgroundUploaderModule {
  enqueueUpload(
    localFilePath: string,
    uploadUrl: string,
    headers: Record<string, string>,
    metadata: Record<string, unknown>
  ): Promise<{ taskId: number }>;
  cancelAll(): Promise<number>;
  getPendingCount(): Promise<number>;
  getActiveTaskIds(): Promise<number[]>;
  drainEvents(): Promise<Array<(UploadCompletedEvent | UploadFailedEvent) & { eventName?: string }>>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export interface UploadCompletedEvent {
  taskId: number;
  status: number;
  metadata: Record<string, unknown>;
}

export interface UploadFailedEvent {
  taskId: number;
  status: number;
  metadata: Record<string, unknown>;
  error: string;
}

const nativeModule: FlexBackgroundUploaderModule | undefined = (
  NativeModules as {
    FlexBackgroundUploader?: FlexBackgroundUploaderModule;
  }
).FlexBackgroundUploader;

const emitter =
  nativeModule != null
    ? new NativeEventEmitter(nativeModule as never)
    : null;

export const nativeBackgroundUploader = {
  isAvailable(): boolean {
    return Platform.OS === "ios" && nativeModule != null;
  },

  async enqueueUpload(
    localFilePath: string,
    uploadUrl: string,
    headers: Record<string, string>,
    metadata: Record<string, unknown>
  ): Promise<{ taskId: number }> {
    if (!nativeModule) {
      throw new Error("FlexBackgroundUploader native module not available");
    }
    return nativeModule.enqueueUpload(localFilePath, uploadUrl, headers, metadata);
  },

  async cancelAll(): Promise<number> {
    if (!nativeModule) return 0;
    return nativeModule.cancelAll();
  },

  async getPendingCount(): Promise<number> {
    if (!nativeModule) return 0;
    return nativeModule.getPendingCount();
  },

  async getActiveTaskIds(): Promise<number[]> {
    if (!nativeModule) return [];
    return nativeModule.getActiveTaskIds();
  },

  async drainEvents(): Promise<Array<(UploadCompletedEvent | UploadFailedEvent) & { eventName?: string }>> {
    if (!nativeModule) return [];
    return nativeModule.drainEvents();
  },

  onCompleted(listener: (event: UploadCompletedEvent) => void): { remove: () => void } {
    if (!emitter) return { remove: () => {} };
    const sub = emitter.addListener("uploadCompleted", listener);
    return { remove: () => sub.remove() };
  },

  onFailed(listener: (event: UploadFailedEvent) => void): { remove: () => void } {
    if (!emitter) return { remove: () => {} };
    const sub = emitter.addListener("uploadFailed", listener);
    return { remove: () => sub.remove() };
  },
};
