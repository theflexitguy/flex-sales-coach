import {
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  AudioModule,
  RecordingPresets,
} from "expo-audio";

type AudioRecorder = InstanceType<typeof AudioModule.AudioRecorder>;

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
      interruptionMode: "duckOthers",
    });

    const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);

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

  async getStatus(): Promise<{ durationMs: number; metering: number } | null> {
    if (!this.recorder || !this.isRecordingFlag) return null;
    return {
      durationMs: Date.now() - this.recordingStartTime,
      metering: -30,
    };
  }
}

export const recordingEngine = new RecordingEngine();
