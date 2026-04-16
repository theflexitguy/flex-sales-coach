/**
 * AudioStreamService — manages the WebSocket connection to ElevenLabs
 * Conversational AI for real-time voice roleplay.
 *
 * Handles: mic capture → WebSocket → agent transcript, plus interruption.
 */
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from "expo-audio";

export type StreamStatus = "idle" | "connecting" | "connected" | "error" | "closed";

interface AudioStreamCallbacks {
  onStatusChange: (status: StreamStatus) => void;
  onAgentSpeaking: (isSpeaking: boolean) => void;
  onTranscript: (role: "rep" | "customer", text: string) => void;
  onError: (error: string) => void;
}

export class AudioStreamService {
  private ws: WebSocket | null = null;
  private recorder: InstanceType<typeof AudioModule.AudioRecorder> | null = null;
  private status: StreamStatus = "idle";
  private callbacks: AudioStreamCallbacks;

  constructor(callbacks: AudioStreamCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(signedUrl: string): Promise<void> {
    this.setStatus("connecting");

    try {
      // Configure audio session for voice chat
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        shouldPlayInBackground: true,
        interruptionMode: "duckOthers",
      });

      // Open WebSocket to ElevenLabs
      this.ws = new WebSocket(signedUrl);

      this.ws.onopen = () => {
        this.setStatus("connected");
        this.startMicCapture();
      };

      this.ws.onmessage = (event: WebSocketMessageEvent) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "audio") {
            this.callbacks.onAgentSpeaking(true);
          } else if (data.type === "agent_response") {
            this.callbacks.onTranscript("customer", data.text ?? "");
          } else if (data.type === "user_transcript") {
            this.callbacks.onTranscript("rep", data.text ?? "");
          } else if (data.type === "audio_end") {
            this.callbacks.onAgentSpeaking(false);
          }
        } catch {
          // Binary frame — ignore for now
        }
      };

      this.ws.onerror = () => {
        this.callbacks.onError("WebSocket connection failed");
        this.setStatus("error");
      };

      this.ws.onclose = () => {
        if (this.status !== "error") {
          this.setStatus("closed");
        }
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Connection failed";
      this.callbacks.onError(msg);
      this.setStatus("error");
    }
  }

  private async startMicCapture(): Promise<void> {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        this.callbacks.onError("Microphone permission denied");
        this.setStatus("error");
        return;
      }

      this.recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
      await this.recorder.prepareToRecordAsync();
      this.recorder.record();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Mic capture failed";
      this.callbacks.onError(msg);
      this.setStatus("error");
    }
  }

  private setStatus(status: StreamStatus): void {
    this.status = status;
    this.callbacks.onStatusChange(status);
  }

  getStatus(): StreamStatus {
    return this.status;
  }

  async disconnect(): Promise<void> {
    // Stop mic
    if (this.recorder) {
      try {
        await this.recorder.stop();
        this.recorder.release();
      } catch { /* already stopped */ }
      this.recorder = null;
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    await setAudioModeAsync({ allowsRecording: false });
    this.setStatus("closed");
  }
}
