import { NextResponse } from "next/server";
import { createAdmin } from "@flex/supabase/admin";
import { isInternalCall } from "@/lib/api-auth-server";

export async function POST(request: Request) {
  if (!isInternalCall(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { callId } = await request.json();

  if (!callId) {
    return NextResponse.json({ error: "callId required" }, { status: 400 });
  }

  const supabase = createAdmin();

  // Update status
  await supabase
    .from("calls")
    .update({ status: "transcribing" })
    .eq("id", callId);

  try {
    // Get audio URL
    const { data: call } = await supabase
      .from("calls")
      .select("audio_storage_path")
      .eq("id", callId)
      .single();

    if (!call) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }

    // Get signed URL for audio
    const { data: signedUrl } = await supabase.storage
      .from("call-recordings")
      .createSignedUrl(call.audio_storage_path, 3600);

    if (!signedUrl?.signedUrl) {
      throw new Error("Failed to generate signed URL for audio");
    }

    // Send to Deepgram for transcription with diarization
    const dgResponse = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&punctuate=true&utterances=true&smart_format=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: signedUrl.signedUrl }),
      }
    );

    if (!dgResponse.ok) {
      const errText = await dgResponse.text();
      throw new Error(`Deepgram error: ${dgResponse.status} ${errText}`);
    }

    const dgResult = await dgResponse.json();
    const utterances = dgResult.results?.utterances ?? [];
    const requestId = dgResult.metadata?.request_id ?? null;

    // Map Deepgram speakers to rep/customer
    // Heuristic: speaker 0 is whoever talks first (usually the rep knocking on the door)
    const speakerMap: Record<number, "rep" | "customer"> = { 0: "rep", 1: "customer" };

    const mappedUtterances = utterances.map(
      (u: { speaker: number; start: number; end: number; transcript: string; confidence: number }) => ({
        speaker: speakerMap[u.speaker] ?? "unknown",
        startMs: Math.round(u.start * 1000),
        endMs: Math.round(u.end * 1000),
        text: u.transcript,
        confidence: u.confidence,
      })
    );

    const fullText = mappedUtterances
      .map((u: { speaker: string; text: string }) => `[${u.speaker}] ${u.text}`)
      .join("\n");

    // Save transcript
    await supabase.from("transcripts").insert({
      call_id: callId,
      full_text: fullText,
      utterances: mappedUtterances,
      deepgram_request_id: requestId,
    });

    // Update call status
    await supabase
      .from("calls")
      .update({ status: "transcribed" })
      .eq("id", callId);

    return NextResponse.json({ success: true, callId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Transcription failed";

    await supabase
      .from("calls")
      .update({ status: "failed", error_message: message })
      .eq("id", callId);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
