import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { getInternalSecret } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";

interface ClientTranscriptLine {
  readonly role?: unknown;
  readonly text?: unknown;
  readonly startMs?: unknown;
  readonly endMs?: unknown;
}

function sanitizeTranscript(value: unknown): Array<{ speaker: string; text: string; startMs: number; endMs: number }> {
  if (!Array.isArray(value)) return [];

  const lines: Array<{ speaker: string; text: string; startMs: number; endMs: number }> = [];
  let lastKey = "";

  for (const raw of value as ClientTranscriptLine[]) {
    const role = raw.role === "customer" ? "customer" : raw.role === "rep" ? "rep" : null;
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!role || !text) continue;

    const key = `${role}:${text}`;
    if (key === lastKey) continue;
    lastKey = key;

    const startMs = typeof raw.startMs === "number" && Number.isFinite(raw.startMs)
      ? Math.max(0, Math.round(raw.startMs))
      : Math.max(0, lines.at(-1)?.endMs ?? 0);
    const endMs = typeof raw.endMs === "number" && Number.isFinite(raw.endMs)
      ? Math.max(startMs, Math.round(raw.endMs))
      : startMs + 3000;

    lines.push({ speaker: role, text, startMs, endMs });
  }

  return lines;
}

function sanitizeDuration(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(7200, Math.round(value)));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();
  const body = await request.json().catch(() => ({})) as {
    transcript?: unknown;
    durationSeconds?: unknown;
  };

  // Get the session
  const { data: session } = await admin
    .from("roleplay_sessions")
    .select("id, started_at, rep_id")
    .eq("id", id)
    .single();

  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.rep_id !== auth.user.id) {
    return NextResponse.json({ error: "Not your session" }, { status: 403 });
  }

  const fallbackDurationSeconds = Math.round(
    (Date.now() - new Date(session.started_at).getTime()) / 1000
  );
  const transcriptUtterances = sanitizeTranscript(body.transcript);
  const transcriptText = transcriptUtterances.length
    ? transcriptUtterances.map((t) => `[${t.speaker}] ${t.text}`).join("\n")
    : null;
  const durationSeconds = sanitizeDuration(body.durationSeconds, fallbackDurationSeconds);

  // Update session
  const { error } = await admin
    .from("roleplay_sessions")
    .update({
      status: "completed",
      duration_seconds: durationSeconds,
      transcript_text: transcriptText,
      transcript_utterances: transcriptUtterances.length ? transcriptUtterances : null,
      ended_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Trigger analysis in the background
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ? request.url.split("/api/")[0] : "";
  if (transcriptText) {
    try {
      const internalSecret = getInternalSecret();
      fetch(`${baseUrl}/api/roleplay/sessions/${id}/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": internalSecret,
        },
      }).catch(() => {});
    } catch {
      // Ending the session should not fail just because async analysis is not configured.
    }
  }

  return NextResponse.json({
    sessionId: id,
    durationSeconds,
    hasTranscript: !!transcriptText,
  });
}
