import {
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  AudioModule,
  IOSOutputFormat,
  AudioQuality,
  type RecordingOptions,
} from "expo-audio";

type AudioRecorder = InstanceType<typeof AudioModule.AudioRecorder>;

// Explicit AAC config — the HIGH_QUALITY preset sometimes falls back to LPCM
// on iOS, producing files 20x larger (170KB/s raw PCM vs 8KB/s AAC) that
// FFmpeg can't concat because the codec params get reset between chunks.
const RECORDING_OPTIONS: RecordingOptions = {
  isMeteringEnabled: true,
  extension: ".m4a",
  sampleRate: 44100,
  numberOfChannels: 1, // Mono — halves the file size with no loss for speech
  bitRate: 64000,      // 64 kbps — plenty for speech, keeps files small
  android: {
    outputFormat: "mpeg4",
    audioEncoder: "aac",
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/mp4",
    bitsPerSecond: 64000,
  },
};

export class RecordingEngine {
  private recorder: AudioRecorder | null = null;
  private isRecordingFlag = false;
  private recordingStartTime = 0;

  async startRecording(): Promise<string> {
    if (this.isRecordingFlag) {
      throw new Error("Already recording");
    }

    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      throw new Error("Microphone permission denied");
    }

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    });

    const recorder = new AudioModule.AudioRecorder(RECORDING_OPTIONS);

    await recorder.prepareToRecordAsync();
    recorder.record();

    this.recorder = recorder;
    this.isRecordingFlag = true;
    this.recordingStartTime = Date.now();

    return recorder.uri ?? "";
  }

  async stopRecording(): Promise<{ uri: string; durationMs: number }> {
    if (!this.recorder || !this.isRecordingFlag) {
      throw new Error("Not recording");
    }

    const durationMs = Date.now() - this.recordingStartTime;

    try {
      await this.recorder.stop();
    } catch {
      // may already be stopped
    }

    const uri = this.recorder.uri ?? "";

    try {
      this.recorder.release();
    } catch {
      // ignore
    }

    this.recorder = null;
    this.isRecordingFlag = false;

    await setAudioModeAsync({
      allowsRecording: false,
    });

    return { uri, durationMs };
  }

  getIsRecording(): boolean {
    return this.isRecordingFlag;
  }

  /**
   * Check if the native recorder is still actively recording.
   * Returns false if the OS paused it (e.g., phone call interruption).
   */
  isActuallyRecording(): boolean {
    if (!this.isRecordingFlag || !this.recorder) return false;
    try {
      const status = this.recorder.getStatus?.();
      if (status && typeof status === "object") {
        const s = status as { isRecording?: boolean; canRecord?: boolean };
        if (typeof s.isRecording === "boolean") return s.isRecording;
      }
    } catch { /* native status not available */ }
    return this.isRecordingFlag;
  }

  async getStatus(): Promise<{ durationMs: number; metering: number } | null> {
    if (!this.recorder || !this.isRecordingFlag) return null;
    let metering = -160;
    try {
      const status = this.recorder.getStatus?.() as { metering?: number } | undefined;
      if (status?.metering != null && isFinite(status.metering)) {
        metering = status.metering;
      }
    } catch { /* fallback */ }
    return {
      durationMs: Date.now() - this.recordingStartTime,
      metering,
    };
  }
}

export const recordingEngine = new RecordingEngine();
