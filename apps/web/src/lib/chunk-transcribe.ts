import { createAdmin } from "@flex/supabase/admin";

// Per-chunk Deepgram transcription. Runs once per chunk as soon as the
// chunk lands in Supabase Storage. Result is cached on session_chunks
// so the split route can stitch without re-transcribing multi-hour
// audio inside its execution budget.

export interface ChunkWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
  punctuated_word?: string;
}

export interface ChunkUtterance {
  speaker: number;
  start: number;
  end: number;
  transcript: string;
  confidence: number;
}

export interface ChunkTranscript {
  words: ChunkWord[];
  utterances: ChunkUtterance[];
  request_id: string | null;
}

interface DgUtteranceRaw {
  speaker: number;
  start: number;
  end: number;
  transcript: string;
  confidence: number;
  words?: ChunkWord[];
}

interface DgResult {
  metadata?: { request_id?: string };
  results?: {
    utterances?: DgUtteranceRaw[];
    channels?: Array<{ alternatives?: Array<{ words?: ChunkWord[] }> }>;
  };
}

async function fetchAudio(storagePath: string): Promise<Buffer> {
  const admin = createAdmin();
  const { data, error } = await admin.storage
    .from("recording-chunks")
    .download(storagePath);
  if (error || !data) {
    throw new Error(`download failed: ${error?.message ?? "no data"}`);
  }
  const buf = await data.arrayBuffer();
  return Buffer.from(buf);
}

async function callDeepgram(audio: Buffer): Promise<ChunkTranscript> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY missing");

  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-3&diarize=true&punctuate=true&utterances=true&smart_format=true" +
    "&keyterm=pest%20control:5&keyterm=mosquito:5&keyterm=termite:5&keyterm=rodent:5" +
    "&keyterm=cockroach:5&keyterm=bedbug:5&keyterm=spider:5&keyterm=Sentricon:10" +
    "&keyterm=Terminix:5&keyterm=Orkin:5&keyterm=quarterly:3&keyterm=inspection:3" +
    "&keyterm=infestation:3&keyterm=treatment:3&keyterm=exterminator:3",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": "audio/mp4",
      },
      body: new Uint8Array(audio),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Deepgram ${res.status}: ${body.slice(0, 300)}`);
  }

  const json: DgResult = await res.json();
  const requestId = json.metadata?.request_id ?? null;
  const rawUtterances = json.results?.utterances ?? [];

  const words: ChunkWord[] = [];
  for (const u of rawUtterances) {
    if (!u.words) continue;
    for (const w of u.words) {
      words.push({ ...w, speaker: w.speaker ?? u.speaker });
    }
  }
  if (words.length === 0) {
    const ch = json.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
    words.push(...ch);
  }
  words.sort((a, b) => a.start - b.start);

  const utterances: ChunkUtterance[] = rawUtterances.map((u) => ({
    speaker: u.speaker,
    start: u.start,
    end: u.end,
    transcript: u.transcript,
    confidence: u.confidence,
  }));

  return { words, utterances, request_id: requestId };
}

/**
 * Transcribe a single chunk and cache the result on session_chunks.
 * Idempotent — returns cached transcript if already present.
 */
export async function transcribeChunk(
  sessionId: string,
  chunkIndex: number,
  storagePath: string
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdmin();

  const { data: existing } = await admin
    .from("session_chunks")
    .select("transcript_json")
    .eq("session_id", sessionId)
    .eq("chunk_index", chunkIndex)
    .single();

  if (existing?.transcript_json) {
    return { ok: true };
  }

  try {
    const audio = await fetchAudio(storagePath);
    const transcript = await callDeepgram(audio);

    await admin
      .from("session_chunks")
      .update({
        transcript_json: transcript,
        transcribed_at: new Date().toISOString(),
        transcribe_error: null,
      })
      .eq("session_id", sessionId)
      .eq("chunk_index", chunkIndex);

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    await admin
      .from("session_chunks")
      .update({ transcribe_error: message.slice(0, 500) })
      .eq("session_id", sessionId)
      .eq("chunk_index", chunkIndex);
    return { ok: false, error: message };
  }
}
