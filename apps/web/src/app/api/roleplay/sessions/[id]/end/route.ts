import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdmin();

  // Get the session
  const { data: session } = await admin
    .from("roleplay_sessions")
    .select("id, elevenlabs_conversation_id, started_at, rep_id")
    .eq("id", id)
    .single();

  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.rep_id !== auth.user.id) {
    return NextResponse.json({ error: "Not your session" }, { status: 403 });
  }

  const durationSeconds = Math.round(
    (Date.now() - new Date(session.started_at).getTime()) / 1000
  );

  // Get conversation data from ElevenLabs
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  let transcriptText: string | null = null;
  let transcriptUtterances: Array<{ speaker: string; text: string; startMs: number; endMs: number }> | null = null;

  if (elevenLabsKey && session.elevenlabs_conversation_id) {
    try {
      const convRes = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/${session.elevenlabs_conversation_id}`,
        { headers: { "xi-api-key": elevenLabsKey } }
      );

      if (convRes.ok) {
        const convData = await convRes.json();
        const transcript = convData.transcript ?? [];

        transcriptUtterances = transcript.map((t: { role: string; message: string; time_in_call_secs: number }) => ({
          speaker: t.role === "agent" ? "customer" : "rep",
          text: t.message,
          startMs: Math.round((t.time_in_call_secs ?? 0) * 1000),
          endMs: Math.round(((t.time_in_call_secs ?? 0) + 3) * 1000), // Approximate
        }));

        transcriptText = transcript
          .map((t: { role: string; message: string }) =>
            `[${t.role === "agent" ? "customer" : "rep"}] ${t.message}`
          )
          .join("\n");
      }
    } catch {
      // Non-critical — we can still end the session
    }
  }

  // Update session
  const { error } = await admin
    .from("roleplay_sessions")
    .update({
      status: "completed",
      duration_seconds: durationSeconds,
      transcript_text: transcriptText,
      transcript_utterances: transcriptUtterances,
      ended_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Trigger analysis in the background
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ? request.url.split("/api/")[0] : "";
  fetch(`${baseUrl}/api/roleplay/sessions/${id}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    },
  }).catch(() => {});

  return NextResponse.json({
    sessionId: id,
    durationSeconds,
    hasTranscript: !!transcriptText,
  });
}
