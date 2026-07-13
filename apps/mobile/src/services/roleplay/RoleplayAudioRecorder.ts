import { NativeModules, Platform } from "react-native";

type RecordingFile = {
  readonly uri: string;
  readonly path: string;
};

type NativeRoleplayRecorder = {
  start(sessionId: string): Promise<{ started: boolean }>;
  stop(): Promise<RecordingFile>;
  cancel(): void;
};

const nativeRecorder = (NativeModules as { FlexRoleplayRecorder?: NativeRoleplayRecorder })
  .FlexRoleplayRecorder;

export const roleplayAudioRecorder = {
  isAvailable(): boolean {
    return Platform.OS === "ios" && nativeRecorder != null;
  },

  async start(sessionId: string): Promise<boolean> {
    if (!nativeRecorder) return false;
    const result = await nativeRecorder.start(sessionId);
    return result.started === true;
  },

  async stop(): Promise<RecordingFile | null> {
    if (!nativeRecorder) return null;
    return nativeRecorder.stop();
  },

  cancel(): void {
    nativeRecorder?.cancel();
  },
};
