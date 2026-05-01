import {
  NativeEventEmitter,
  NativeModules,
  Platform,
} from "react-native";

export interface NativeLocationPoint {
  id?: string;
  sessionId: string;
  elapsedS: number;
  latitude: number;
  longitude: number;
  capturedAt: string;
}

interface FlexBackgroundLocationModule {
  startSession(
    sessionId: string,
    startedAtMs: number
  ): Promise<{ ok: boolean }>;
  stopSession(): Promise<NativeLocationPoint[]>;
  drainPoints(): Promise<NativeLocationPoint[]>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const nativeModule: FlexBackgroundLocationModule | undefined = (
  NativeModules as {
    FlexBackgroundLocation?: FlexBackgroundLocationModule;
  }
).FlexBackgroundLocation;

const emitter =
  nativeModule != null
    ? new NativeEventEmitter(nativeModule as never)
    : null;

export const nativeBackgroundLocation = {
  isAvailable(): boolean {
    return Platform.OS === "ios" && nativeModule != null;
  },

  async startSession(sessionId: string, startedAtMs: number): Promise<void> {
    if (!nativeModule) {
      throw new Error("FlexBackgroundLocation native module not available");
    }
    await nativeModule.startSession(sessionId, startedAtMs);
  },

  async stopSession(): Promise<NativeLocationPoint[]> {
    if (!nativeModule) return [];
    return nativeModule.stopSession();
  },

  async drainPoints(): Promise<NativeLocationPoint[]> {
    if (!nativeModule) return [];
    return nativeModule.drainPoints();
  },

  onLocationPoint(
    listener: (point: NativeLocationPoint) => void
  ): { remove: () => void } {
    if (!emitter) return { remove: () => {} };
    const sub = emitter.addListener("locationPoint", listener);
    return { remove: () => sub.remove() };
  },
};
