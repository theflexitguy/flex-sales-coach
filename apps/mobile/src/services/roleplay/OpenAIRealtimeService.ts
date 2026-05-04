/**
 * OpenAIRealtimeService manages an OpenAI Realtime WebRTC voice session.
 *
 * WebRTC handles live microphone transport, remote audio playback, and barge-in
 * behavior. The data channel is used only for lifecycle and transcript events.
 */
import { setAudioModeAsync } from "expo-audio";
import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
  RTCSessionDescription,
  registerGlobals,
} from "react-native-webrtc";

export type VoiceProvider = "openai-realtime" | "grok-realtime";
export type StreamStatus = "idle" | "connecting" | "connected" | "error" | "closed";

export interface RoleplayTranscriptLine {
  readonly role: "rep" | "customer";
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

interface OpenAIRealtimeCallbacks {
  onStatusChange: (status: StreamStatus) => void;
  onAgentSpeaking: (isSpeaking: boolean) => void;
  onTranscript: (line: RoleplayTranscriptLine) => void;
  onError: (error: string) => void;
}

interface ConnectOptions {
  readonly clientSecret: string;
  readonly model: string;
}

type DataChannel = ReturnType<RTCPeerConnection["createDataChannel"]>;

type RealtimeEvent = {
  readonly type?: string;
  readonly transcript?: string;
  readonly delta?: string;
  readonly response_id?: string;
  readonly item_id?: string;
  readonly item?: {
    readonly role?: string;
    readonly content?: ReadonlyArray<{
      readonly transcript?: string;
      readonly text?: string;
    }>;
  };
  readonly error?: {
    readonly message?: string;
  };
};

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

function addWebRTCListener(
  target: unknown,
  type: string,
  listener: (event: { readonly data?: unknown }) => void
): void {
  const eventTarget = target as {
    addEventListener?: (eventType: string, callback: (event: { readonly data?: unknown }) => void) => void;
  };
  eventTarget.addEventListener?.(type, listener);
}

export class OpenAIRealtimeService {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: DataChannel | null = null;
  private localStream: MediaStream | null = null;
  private status: StreamStatus = "idle";
  private readonly callbacks: OpenAIRealtimeCallbacks;
  private readonly startedAt = Date.now();
  private readonly assistantTranscriptBuffers = new Map<string, string>();
  private lastTranscriptKey = "";

  constructor(callbacks: OpenAIRealtimeCallbacks) {
    this.callbacks = callbacks;
    registerGlobals();
  }

  async connect(options: ConnectOptions): Promise<void> {
    this.setStatus("connecting");

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        shouldPlayInBackground: false,
        interruptionMode: "duckOthers",
      });

      const pc = new RTCPeerConnection();
      this.peerConnection = pc;

      addWebRTCListener(pc, "connectionstatechange", () => {
        if (pc.connectionState === "connected") {
          this.setStatus("connected");
        } else if (pc.connectionState === "failed") {
          this.callbacks.onError("Realtime voice connection failed");
          this.setStatus("error");
        } else if (pc.connectionState === "closed") {
          this.setStatus("closed");
        }
      });

      addWebRTCListener(pc, "track", () => {
        this.callbacks.onAgentSpeaking(true);
      });

      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      this.localStream = stream;
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      const dc = pc.createDataChannel("oai-events");
      this.dataChannel = dc;

      addWebRTCListener(dc, "open", () => {
        this.sendEvent({
          type: "response.create",
          response: {
            modalities: ["audio"],
            instructions:
              "Start the roleplay now with one brief in-character homeowner opening line. Do not explain the exercise.",
          },
        });
      });

      addWebRTCListener(dc, "message", (event) => {
        if (typeof event.data !== "string") return;
        this.handleServerEvent(event.data);
      });

      addWebRTCListener(dc, "error", () => {
        this.callbacks.onError("Realtime event channel failed");
        this.setStatus("error");
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdp = offer.sdp;
      if (typeof sdp !== "string" || sdp.length === 0) {
        throw new Error("Failed to create Realtime SDP offer");
      }

      const answerRes = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: sdp,
      });

      if (!answerRes.ok) {
        const body = await answerRes.text().catch(() => "");
        throw new Error(`OpenAI Realtime connection failed (${answerRes.status}): ${body.slice(0, 240)}`);
      }

      const answerSdp = await answerRes.text();
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answerSdp }));
    } catch (error: unknown) {
      await this.disconnect();
      const message = error instanceof Error ? error.message : "Realtime voice connection failed";
      this.callbacks.onError(message);
      this.setStatus("error");
    }
  }

  getStatus(): StreamStatus {
    return this.status;
  }

  async disconnect(): Promise<void> {
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {
        // already closed
      }
      this.dataChannel = null;
    }

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false });
    this.callbacks.onAgentSpeaking(false);
    this.setStatus("closed");
  }

  private handleServerEvent(raw: string): void {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(raw) as RealtimeEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case "error":
        this.callbacks.onError(event.error?.message ?? "Realtime voice error");
        this.setStatus("error");
        return;
      case "response.created":
      case "response.audio.delta":
        this.callbacks.onAgentSpeaking(true);
        return;
      case "response.audio.done":
      case "response.done":
      case "output_audio_buffer.stopped":
        this.callbacks.onAgentSpeaking(false);
        this.flushAssistantTranscript(event.response_id ?? event.item_id ?? "latest");
        return;
      case "conversation.item.input_audio_transcription.completed":
        this.emitTranscript("rep", event.transcript);
        return;
      case "response.audio_transcript.delta":
        this.appendAssistantTranscript(event.response_id ?? event.item_id ?? "latest", event.delta);
        return;
      case "response.audio_transcript.done":
        this.appendAssistantTranscript(event.response_id ?? event.item_id ?? "latest", event.transcript);
        this.flushAssistantTranscript(event.response_id ?? event.item_id ?? "latest");
        return;
      case "conversation.item.created":
        this.handleConversationItem(event);
        return;
      default:
        return;
    }
  }

  private handleConversationItem(event: RealtimeEvent): void {
    const role = event.item?.role;
    if (role !== "assistant" && role !== "user") return;

    const text = event.item?.content
      ?.map((content) => content.transcript ?? content.text ?? "")
      .join(" ")
      .trim();

    if (text) {
      this.emitTranscript(role === "assistant" ? "customer" : "rep", text);
    }
  }

  private appendAssistantTranscript(key: string, chunk?: string): void {
    if (!chunk) return;
    const current = this.assistantTranscriptBuffers.get(key) ?? "";
    this.assistantTranscriptBuffers.set(key, `${current}${chunk}`);
  }

  private flushAssistantTranscript(key: string): void {
    const text = this.assistantTranscriptBuffers.get(key)?.trim();
    if (!text) return;
    this.assistantTranscriptBuffers.delete(key);
    this.emitTranscript("customer", text);
  }

  private emitTranscript(role: "rep" | "customer", text?: string): void {
    const normalized = text?.trim();
    if (!normalized) return;

    const key = `${role}:${normalized}`;
    if (key === this.lastTranscriptKey) return;
    this.lastTranscriptKey = key;

    const endMs = Date.now() - this.startedAt;
    this.callbacks.onTranscript({
      role,
      text: normalized,
      startMs: Math.max(0, endMs - 3000),
      endMs,
    });
  }

  private sendEvent(event: unknown): void {
    if (this.dataChannel?.readyState === "open") {
      this.dataChannel.send(JSON.stringify(event));
    }
  }

  private setStatus(status: StreamStatus): void {
    this.status = status;
    this.callbacks.onStatusChange(status);
  }
}
