import { useState, useCallback, useRef, useEffect } from "react";
import { apiPost } from "../services/api";
import { AudioStreamService } from "../services/roleplay/AudioStreamService";
import type { StreamStatus } from "../services/roleplay/AudioStreamService";

export type RoleplayPhase = "idle" | "connecting" | "active" | "ending" | "completed" | "error";

interface TranscriptLine {
  readonly role: "rep" | "customer";
  readonly text: string;
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

  const streamRef = useRef<AudioStreamService | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

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
        conversationId: string;
        signedUrl: string;
        personaName: string;
      }>("/api/roleplay/sessions/start", {
        scenarioId: scenarioId ?? undefined,
        personaId: personaId ?? undefined,
      });

      setSessionId(data.sessionId);
      setPersonaName(data.personaName);

      // Create audio stream
      const stream = new AudioStreamService({
        onStatusChange: (status: StreamStatus) => {
          if (status === "connected") setPhase("active");
          if (status === "error") setPhase("error");
        },
        onAgentSpeaking: setAgentSpeaking,
        onTranscript: (role, text) => {
          setTranscript((prev) => [...prev, { role, text }]);
        },
        onError: (err) => {
          setErrorMessage(err);
          setPhase("error");
        },
      });

      streamRef.current = stream;
      await stream.connect(data.signedUrl);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to start session");
      setPhase("error");
    }
  }, []);

  const endSession = useCallback(async () => {
    if (!sessionId) return;
    setPhase("ending");

    // Disconnect audio
    if (streamRef.current) {
      await streamRef.current.disconnect();
      streamRef.current = null;
    }

    try {
      const data = await apiPost<SessionResult>(
        `/api/roleplay/sessions/${sessionId}/end`
      );
      setResult(data);
      setPhase("completed");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to end session");
      setPhase("error");
    }
  }, [sessionId]);

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
