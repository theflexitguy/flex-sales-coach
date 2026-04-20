import { useState, useCallback, useRef, useEffect } from "react";
import { useConversation } from "@elevenlabs/react-native";
import { apiPost } from "../services/api";

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

interface StartSessionResponse {
  readonly sessionId: string;
  readonly agentId: string;
  readonly signedUrl: string;
  readonly personaName: string;
  readonly overridePrompt: string;
}

/**
 * Door-to-door roleplay session hook.
 *
 * Wires Flex session lifecycle (DB row creation, analysis, summary fetching)
 * to the ElevenLabs Conversational AI SDK for real-time voice.
 *
 * The ElevenLabs SDK handles mic capture, WebRTC streaming, and audio
 * playback natively via LiveKit; we just pass it the signed URL and scenario
 * prompt override we got from our own /api/roleplay/sessions/start route.
 */
export function useRoleplaySession() {
  const [phase, setPhase] = useState<RoleplayPhase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [personaName, setPersonaName] = useState<string>("");
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<readonly TranscriptLine[]>([]);
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const conversation = useConversation({
    onConnect: () => {
      setPhase("active");
    },
    onDisconnect: () => {
      // Only bump to completed if we initiated the end. Unexpected disconnect
      // during connecting/active is an error state; endSession() will take
      // care of the happy path.
      setAgentSpeaking(false);
    },
    onError: (message: string) => {
      setErrorMessage(message);
      setPhase("error");
    },
    onMessage: ({ source, message }: { source: "user" | "ai"; message: string }) => {
      // ElevenLabs reports finalized turn messages via onMessage. "user" is
      // the rep's speech; "ai" is the agent persona's response.
      const role: TranscriptLine["role"] = source === "user" ? "rep" : "customer";
      setTranscript((prev) => [...prev, { role, text: message }]);
    },
    onModeChange: ({ mode }: { mode: "speaking" | "listening" }) => {
      setAgentSpeaking(mode === "speaking");
    },
  });

  // Duration timer — runs while the conversation is active.
  useEffect(() => {
    if (phase === "active") {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  const startSession = useCallback(
    async (scenarioId?: string, personaId?: string) => {
      setPhase("connecting");
      setTranscript([]);
      setDuration(0);
      setResult(null);
      setErrorMessage(null);

      try {
        const data = await apiPost<StartSessionResponse>(
          "/api/roleplay/sessions/start",
          {
            scenarioId: scenarioId ?? undefined,
            personaId: personaId ?? undefined,
          }
        );

        setSessionId(data.sessionId);
        setPersonaName(data.personaName);

        // Hand the signed URL + scenario-specific prompt override to the SDK.
        // The SDK opens its WebRTC connection and streams audio both ways.
        await conversation.startSession({
          signedUrl: data.signedUrl,
          overrides: {
            agent: {
              prompt: {
                prompt: data.overridePrompt,
              },
            },
          },
        });
      } catch (err: unknown) {
        setErrorMessage(err instanceof Error ? err.message : "Failed to start session");
        setPhase("error");
      }
    },
    [conversation]
  );

  const endSession = useCallback(async () => {
    if (!sessionId) return;
    setPhase("ending");

    try {
      await conversation.endSession();
    } catch {
      // Already disconnected — carry on.
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
  }, [conversation, sessionId]);

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

  // Defensive cleanup if the hook unmounts mid-conversation.
  useEffect(() => {
    return () => {
      try {
        conversation.endSession();
      } catch {
        // already disconnected
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
