import { useState, useCallback, useRef, useEffect } from "react";
import { AppState } from "react-native";
import { apiPost } from "../services/api";
import {
  OpenAIRealtimeService,
  type RoleplayTranscriptLine,
  type StreamStatus,
  type VoiceProvider,
} from "../services/roleplay/OpenAIRealtimeService";

export type RoleplayPhase = "idle" | "connecting" | "active" | "ending" | "completed" | "error";

interface TranscriptLine {
  readonly role: "rep" | "customer";
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

interface SessionResult {
  readonly sessionId: string;
  readonly durationSeconds: number;
  readonly hasTranscript: boolean;
}

export function useRoleplaySession() {
  const [phase, setPhase] = useState<RoleplayPhase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [personaName, setPersonaName] = useState<string>("");
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<readonly TranscriptLine[]>([]);
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const streamRef = useRef<OpenAIRealtimeService | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const phaseRef = useRef<RoleplayPhase>("idle");
  const sessionIdRef = useRef<string | null>(null);
  const transcriptRef = useRef<readonly TranscriptLine[]>([]);
  const durationRef = useRef(0);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // Duration timer
  useEffect(() => {
    if (phase === "active") {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  const startSession = useCallback(async (scenarioId?: string, personaId?: string) => {
    setPhase("connecting");
    setTranscript([]);
    setDuration(0);
    setResult(null);
    setErrorMessage(null);

    try {
      const data = await apiPost<{
        sessionId: string;
        provider: VoiceProvider;
        model: string;
        voice: string;
        personaName: string;
        clientSecret: string;
        expiresAt: number;
      }>("/api/roleplay/sessions/start", {
        scenarioId: scenarioId ?? undefined,
        personaId: personaId ?? undefined,
      });

      if (data.provider !== "openai-realtime") {
        throw new Error(`Unsupported roleplay voice provider: ${data.provider}`);
      }

      setSessionId(data.sessionId);
      setPersonaName(data.personaName);

      // Create audio stream
      const stream = new OpenAIRealtimeService({
        onStatusChange: (status: StreamStatus) => {
          if (status === "connected") setPhase("active");
          if (status === "error") setPhase("error");
        },
        onAgentSpeaking: setAgentSpeaking,
        onTranscript: (line: RoleplayTranscriptLine) => {
          setTranscript((prev) => [...prev, line]);
        },
        onError: (err) => {
          setErrorMessage(err);
          setPhase("error");
        },
      });

      streamRef.current = stream;
      await stream.connect({
        clientSecret: data.clientSecret,
        model: data.model,
      });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to start session");
      setPhase("error");
    }
  }, []);

  const endSession = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) return;
    setPhase("ending");

    // Disconnect audio
    if (streamRef.current) {
      await streamRef.current.disconnect();
      streamRef.current = null;
    }

    try {
      const data = await apiPost<SessionResult>(
        `/api/roleplay/sessions/${activeSessionId}/end`,
        {
          transcript: transcriptRef.current,
          durationSeconds: durationRef.current,
        }
      );
      setResult(data);
      setPhase("completed");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to end session");
      setPhase("error");
    }
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setSessionId(null);
    setPersonaName("");
    setAgentSpeaking(false);
    setTranscript([]);
    setDuration(0);
    setResult(null);
    setErrorMessage(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.disconnect();
      }
    };
  }, []);

  // Do not keep an invisible live voice session running after lock/background.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" && phaseRef.current === "active") {
        void endSession();
      }
    });
    return () => sub.remove();
  }, [endSession]);

  return {
    phase,
    sessionId,
    personaName,
    agentSpeaking,
    transcript,
    duration,
    result,
    errorMessage,
    startSession,
    endSession,
    reset,
  };
}
