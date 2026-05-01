import { NextResponse } from "next/server";
import { createAdmin } from "@flex/supabase/admin";
import { isInternalCall, getInternalSecret } from "@/lib/api-auth-server";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import {
  transcribeChunk,
  type ChunkTranscript,
  type ChunkWord,
  type ChunkUtterance,
} from "@/lib/chunk-transcribe";
import { reconcileSessionChunks } from "@/lib/session-chunk-reconcile";

// Bundled FFmpeg binaries — required because Vercel Functions don't have
// system ffmpeg installed.
const FFMPEG = ffmpegInstaller.path;
const FFPROBE = ffprobeInstaller.path;

function shq(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}

// Splitter tuning. Outdoor door-to-door environments have constant ambient
// noise (wind, traffic), so we can't rely on absolute-silence detection.
// Instead we use Deepgram's voice-activity output and confirm each candidate
// split with a corroborating signal: GPS movement or a speaker change.
const SPEECH_GAP_S = 20;                  // min silence between words to consider a split
const INTER_HOUSE_DISTANCE_M = 40;        // movement that likely means "next house"
                                          // (backyard walks are typically <30m; this threshold
                                          // keeps same-property moves from splitting)
const FORCED_SPLIT_DISTANCE_M = 50;       // movement alone triggers a split if no speech gap
const FORCED_SPLIT_WINDOW_S = 90;         // within this time window
const MIN_CONVERSATION_S = 5;             // ignore slivers
const EDGE_SILENCE_TRIM_S = 1;            // trim 1s off each segment's edges
const SPEAKER_CONTEXT_S = 30;             // window we sample speakers in for pre/post comparison

// Fallback if Deepgram returns essentially no words for the session (e.g. the
// audio is corrupt or all wind). In that case we fall back to the old
// silence-detection splitter rather than producing one giant conversation.
const FALLBACK_SILENCE_THRESHOLD_DB = -15;
const FALLBACK_SILENCE_DURATION_S = 15;

// Vercel Hobby caps maxDuration at 300. Phase 4 per-chunk transcription
// is what actually makes long recordings fit: by the time split runs,
// most chunks are already transcribed (/api/sessions/chunk does it in
// after()), so split just stitches + concats audio + cuts segments.
// That easily fits in 300s even for multi-hour sessions. If we ever
// upgrade to Pro, bump this back up as a safety net.
export const maxDuration = 300;

type DgWord = ChunkWord;

interface DgUtterance {
  speaker: number;
  start: number;
  end: number;
  transcript: string;
  confidence: number;
  words?: DgWord[];
}

// Fill in missing transcripts for this session by invoking Deepgram per-chunk
// in parallel with a small concurrency cap. Phase 4 path: by the time a
// session is stopped, the chunk route has already transcribed almost all of
// them; this just handles stragglers + old sessions migrated in flight.
async function ensureAllChunksTranscribed(
  sessionId: string,
  chunks: Array<{ chunk_index: number; storage_path: string; transcript_json: ChunkTranscript | null }>
): Promise<void> {
  const pending = chunks.filter((c) => !c.transcript_json);
  if (pending.length === 0) return;

  const CONCURRENCY = 4;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const slice = pending.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map((c) => transcribeChunk(sessionId, c.chunk_index, c.storage_path))
    );
  }
}

/**
 * Re-identify the rep speaker inside a single chunk. Speaker IDs from
 * Deepgram aren't consistent across independent invocations, so we
 * determine who the rep is per-chunk and then remap.
 */
function repSpeakerInChunk(utterances: ChunkUtterance[]): number {
  const bySpeaker = new Map<number, ChunkUtterance[]>();
  for (const u of utterances) {
    if (!bySpeaker.has(u.speaker)) bySpeaker.set(u.speaker, []);
    bySpeaker.get(u.speaker)!.push(u);
  }
  if (bySpeaker.size < 2) return 0;
  let best = -Infinity;
  let repSpeaker = 0;
  for (const [spk, utts] of bySpeaker) {
    const s = scoreAsRep(
      utts.map((u) => ({
        speaker: u.speaker,
        start: u.start,
        end: u.end,
        transcript: u.transcript,
        confidence: u.confidence,
      }))
    );
    if (s > best) {
      best = s;
      repSpeaker = spk;
    }
  }
  return repSpeaker;
}

interface StitchedResult {
  words: DgWord[];
  utterances: DgUtterance[];
  /**
   * Every non-rep speaker gets a globally-unique ID so the "new customer
   * voice" split signal still discriminates within a chunk even though
   * Deepgram speaker IDs aren't consistent across chunks.
   */
  repSpeaker: number;
  sourceRequestIds: string[];
}

/**
 * Stitch per-chunk transcripts into a single session-global transcript.
 * Times are shifted by each chunk's cumulative audio offset. Speakers
 * are remapped so:
 *   - the rep gets ID 0 across the whole session
 *   - non-rep (customer) speakers get fresh globally-unique IDs
 *     per-chunk (we can't reconcile customer identity across chunks
 *     without re-transcribing the full audio)
 */
function stitchTranscripts(
  chunks: Array<{
    chunk_index: number;
    duration_seconds: number | null;
    transcript_json: ChunkTranscript | null;
  }>
): StitchedResult {
  const sorted = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);

  const words: DgWord[] = [];
  const utterances: DgUtterance[] = [];
  const sourceRequestIds: string[] = [];

  let offset = 0;
  let nextCustomerId = 1; // 0 is reserved for the rep
  const REP_SPEAKER = 0;

  for (const chunk of sorted) {
    const t = chunk.transcript_json;
    const duration = chunk.duration_seconds ?? 0;

    if (!t) {
      offset += duration;
      continue;
    }
    if (t.request_id) sourceRequestIds.push(t.request_id);

    const localRep = repSpeakerInChunk(t.utterances);
    // Customer speakers in this chunk → fresh global IDs
    const customerRemap = new Map<number, number>();
    const remap = (localSpeaker: number): number => {
      if (localSpeaker === localRep) return REP_SPEAKER;
      let gid = customerRemap.get(localSpeaker);
      if (gid == null) {
        gid = nextCustomerId++;
        customerRemap.set(localSpeaker, gid);
      }
      return gid;
    };

    for (const w of t.words) {
      words.push({
        ...w,
        start: w.start + offset,
        end: w.end + offset,
        speaker: w.speaker != null ? remap(w.speaker) : undefined,
      });
    }

    for (const u of t.utterances) {
      utterances.push({
        speaker: remap(u.speaker),
        start: u.start + offset,
        end: u.end + offset,
        transcript: u.transcript,
        confidence: u.confidence,
      });
    }

    offset += duration;
  }

  words.sort((a, b) => a.start - b.start);
  utterances.sort((a, b) => a.start - b.start);

  return { words, utterances, repSpeaker: REP_SPEAKER, sourceRequestIds };
}

interface LocationPoint {
  elapsed_s: number;
  latitude: number;
  longitude: number;
}

interface SegmentBoundary {
  start: number;
  end: number;
}

function distanceMeters(a: LocationPoint, b: LocationPoint): number {
  const R = 6371e3;
  const phi1 = (a.latitude * Math.PI) / 180;
  const phi2 = (b.latitude * Math.PI) / 180;
  const dPhi = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLambda = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Max pairwise distance between any two location points inside [t1, t2].
 * If no points fall in the window, brackets the window with the nearest
 * before/after points to estimate movement across the gap.
 */
function maxMovementInWindow(points: LocationPoint[], t1: number, t2: number): number {
  const inWindow = points.filter((p) => p.elapsed_s >= t1 && p.elapsed_s <= t2);
  if (inWindow.length >= 2) {
    let max = 0;
    for (let i = 0; i < inWindow.length; i++) {
      for (let j = i + 1; j < inWindow.length; j++) {
        max = Math.max(max, distanceMeters(inWindow[i], inWindow[j]));
      }
    }
    return max;
  }
  const before = points.filter((p) => p.elapsed_s <= t1).slice(-1)[0];
  const after = points.filter((p) => p.elapsed_s >= t2)[0];
  if (before && after) return distanceMeters(before, after);
  if (inWindow.length === 1 && (before || after)) {
    const other = before ?? after;
    return distanceMeters(inWindow[0], other);
  }
  return 0;
}

function speakersInWindow(words: DgWord[], t1: number, t2: number): Set<number> {
  const out = new Set<number>();
  for (const w of words) {
    if (w.speaker == null) continue;
    if (w.end >= t1 && w.start <= t2) out.add(w.speaker);
  }
  return out;
}

function scoreAsRep(utts: DgUtterance[]): number {
  const text = utts.map((u) => u.transcript).join(" ").toLowerCase();
  const totalWords = text.split(/\s+/).filter(Boolean).length;
  let score = 0;
  if (/\b(my name is|i'?m (?:with|from)|this is) /i.test(text)) score += 5;
  if (/\b(pest control|mosquito|spray|service|protect|treatment|lawn|termite)\b/i.test(text)) score += 3;
  if (/\b(special|discount|promotion|offer|free estimate|quote)\b/i.test(text)) score += 2;
  if (/\b(quick question|minute of your time|real quick|got a second)\b/i.test(text)) score += 2;
  if (/\b(hey there|hi there|how'?s it going|good (?:morning|afternoon|evening))\b/i.test(text)) score += 1;
  score += Math.min(totalWords / 50, 5);
  return score;
}

function identifyRepSpeaker(utterances: DgUtterance[]): number {
  const bySpeaker = new Map<number, DgUtterance[]>();
  for (const u of utterances) {
    if (!bySpeaker.has(u.speaker)) bySpeaker.set(u.speaker, []);
    bySpeaker.get(u.speaker)!.push(u);
  }
  let repSpeaker = 0;
  if (bySpeaker.size >= 2) {
    let best = -Infinity;
    for (const [spk, utts] of bySpeaker) {
      const s = scoreAsRep(utts);
      if (s > best) {
        best = s;
        repSpeaker = spk;
      }
    }
  }
  return repSpeaker;
}

/**
 * Compute candidate split points using the hybrid rule:
 *   Split on a speech gap ≥ SPEECH_GAP_S **only if** corroborated by either
 *   (a) GPS movement ≥ INTER_HOUSE_DISTANCE_M during the gap, or
 *   (b) a customer speaker change across the gap.
 *   Also injects a forced split if the rep walked ≥ FORCED_SPLIT_DISTANCE_M
 *   inside a FORCED_SPLIT_WINDOW_S span with no corresponding speech gap
 *   (the "kept talking while walking to next house" case).
 */
function computeSplitPoints(
  words: DgWord[],
  points: LocationPoint[],
  repSpeaker: number,
  totalDuration: number
): number[] {
  const splits: number[] = [];

  // (1) Speech-gap candidates confirmed by GPS or new customer voice
  for (let i = 0; i < words.length - 1; i++) {
    const curr = words[i];
    const next = words[i + 1];
    const gap = next.start - curr.end;
    if (gap < SPEECH_GAP_S) continue;

    const movement = maxMovementInWindow(points, curr.end, next.start);

    const preSpeakers = speakersInWindow(
      words,
      Math.max(0, curr.end - SPEAKER_CONTEXT_S),
      curr.end
    );
    const postSpeakers = speakersInWindow(
      words,
      next.start,
      next.start + SPEAKER_CONTEXT_S
    );
    // We only care about customer-speaker changes. The rep is constant.
    const preCustomers = new Set([...preSpeakers].filter((s) => s !== repSpeaker));
    const postCustomers = new Set([...postSpeakers].filter((s) => s !== repSpeaker));
    const newCustomerVoice =
      postCustomers.size > 0 &&
      [...postCustomers].some((s) => !preCustomers.has(s));

    if (movement >= INTER_HOUSE_DISTANCE_M || newCustomerVoice) {
      splits.push((curr.end + next.start) / 2);
    }
  }

  // (2) Forced splits: any span where rep walked ≥ FORCED_SPLIT_DISTANCE_M
  //     inside FORCED_SPLIT_WINDOW_S, and no split already sits inside that
  //     span. Split at the midpoint of the walking span.
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const span = points[j].elapsed_s - points[i].elapsed_s;
      if (span > FORCED_SPLIT_WINDOW_S) break;
      const d = distanceMeters(points[i], points[j]);
      if (d < FORCED_SPLIT_DISTANCE_M) continue;
      const mid = (points[i].elapsed_s + points[j].elapsed_s) / 2;
      const alreadyCovered = splits.some(
        (s) => Math.abs(s - mid) < FORCED_SPLIT_WINDOW_S / 2
      );
      if (!alreadyCovered) splits.push(mid);
    }
  }

  // Dedup + sort + bound to session duration
  const sorted = [...new Set(splits.map((s) => Math.round(s * 100) / 100))]
    .sort((a, b) => a - b)
    .filter((s) => s > 0 && s < totalDuration);

  return sorted;
}

function buildSegmentBoundaries(
  splitPoints: number[],
  totalDuration: number
): SegmentBoundary[] {
  const boundaries: SegmentBoundary[] = [];
  let segStart = 0;
  for (const sp of splitPoints) {
    if (sp - segStart >= MIN_CONVERSATION_S) {
      boundaries.push({ start: segStart, end: sp });
    }
    segStart = sp;
  }
  if (totalDuration - segStart >= MIN_CONVERSATION_S) {
    boundaries.push({ start: segStart, end: totalDuration });
  }
  if (boundaries.length === 0) {
    boundaries.push({ start: 0, end: totalDuration });
  }
  return boundaries;
}

/**
 * Fallback splitter used when Deepgram returns essentially no words
 * (audio unusable). Runs a loose ffmpeg silencedetect on the concat.
 */
function fallbackSilenceSplit(concatPath: string, totalDuration: number): number[] {
  let silenceOutput = "";
  try {
    const out = execSync(
      `${shq(FFMPEG)} -i ${shq(concatPath)} -af silencedetect=noise=${FALLBACK_SILENCE_THRESHOLD_DB}dB:d=${FALLBACK_SILENCE_DURATION_S} -f null -`,
      { timeout: 240000, stdio: ["ignore", "pipe", "pipe"] }
    );
    silenceOutput = out.toString();
  } catch (e) {
    silenceOutput = (e as { stderr?: Buffer }).stderr?.toString() ?? "";
  }
  const silenceStarts: number[] = [];
  const silenceEnds: number[] = [];
  for (const line of silenceOutput.split("\n")) {
    const s = line.match(/silence_start:\s*([\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) silenceStarts.push(parseFloat(s[1]));
    if (e) silenceEnds.push(parseFloat(e[1]));
  }
  const points: number[] = [];
  for (let i = 0; i < Math.min(silenceStarts.length, silenceEnds.length); i++) {
    points.push((silenceStarts[i] + silenceEnds[i]) / 2);
  }
  return points.filter((p) => p > 0 && p < totalDuration);
}

export async function POST(request: Request) {
  if (!isInternalCall(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sessionId } = await request.json();

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const admin = createAdmin();

  try {
    // --- 1. Load session, chunks, location points ---
    const { data: session } = await admin
      .from("recording_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Idempotency: if this session already completed a split run, don't
    // re-run. Cron's 6-min stale threshold + Vercel retries mean split
    // can legitimately be invoked twice for the same session; without
    // this guard we'd create duplicate `calls` rows and duplicate audio
    // in storage.
    if (session.status === "completed") {
      return NextResponse.json({
        success: true,
        sessionId,
        conversationsFound: session.conversations_found ?? 0,
        skipped: "already_completed",
      });
    }

    await reconcileSessionChunks(admin, sessionId);

    const { data: chunks } = await admin
      .from("session_chunks")
      .select("*")
      .eq("session_id", sessionId)
      .order("chunk_index");

    if (!chunks || chunks.length === 0) {
      throw new Error("No chunks found for session");
    }

    const { data: locationPoints } = await admin
      .from("session_location_points")
      .select("elapsed_s, latitude, longitude")
      .eq("session_id", sessionId)
      .order("elapsed_s");

    const points: LocationPoint[] = (locationPoints ?? []).map((p) => ({
      elapsed_s: Number(p.elapsed_s),
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
    }));

    const workDir = join(tmpdir(), `flex-split-${randomUUID()}`);
    mkdirSync(workDir, { recursive: true });

    try {
      // --- 2. Ensure every chunk has a cached transcript ---
      // The /api/sessions/chunk route runs Deepgram on each chunk as it
      // uploads. Most of the work is already done — this only
      // transcribes stragglers. Phase 4 skips sending the multi-hour
      // concat to Deepgram inside this function's budget.
      await ensureAllChunksTranscribed(
        sessionId,
        chunks as Array<{
          chunk_index: number;
          storage_path: string;
          transcript_json: ChunkTranscript | null;
        }>
      );

      // Re-fetch so we pick up the transcripts we just wrote.
      const { data: chunksWithTranscripts } = await admin
        .from("session_chunks")
        .select("*")
        .eq("session_id", sessionId)
        .order("chunk_index");
      const workChunks = (chunksWithTranscripts ?? chunks) as Array<{
        chunk_index: number;
        storage_path: string;
        duration_seconds: number | null;
        transcript_json: ChunkTranscript | null;
      }>;

      // --- 3. Download chunks in parallel, then concat for segment cutting ---
      const downloads = await Promise.all(
        workChunks.map(async (chunk) => {
          const { data: fileData, error: dlError } = await admin.storage
            .from("recording-chunks")
            .download(chunk.storage_path);
          if (dlError || !fileData) {
            throw new Error(`Failed to download chunk ${chunk.chunk_index}: ${dlError?.message}`);
          }
          const chunkPath = join(workDir, `chunk_${chunk.chunk_index}.m4a`);
          writeFileSync(chunkPath, Buffer.from(await fileData.arrayBuffer()));
          return { index: chunk.chunk_index, path: chunkPath };
        })
      );
      const chunkPaths = downloads
        .sort((a, b) => a.index - b.index)
        .map((d) => d.path);

      const concatListPath = join(workDir, "concat.txt");
      const concatPath = join(workDir, "full_recording.m4a");

      // Fast path: chunks are already proper AAC/m4a (the recorder forces
      // MPEG4AAC), so concat demuxer + -c copy skips decode/encode entirely.
      // Falls back to normalize-then-reencode only if direct concat fails —
      // e.g. legacy sessions with mixed-codec chunks from before the
      // explicit AAC config was added.
      writeFileSync(concatListPath, chunkPaths.map((p) => `file '${p}'`).join("\n"));
      let concatOk = false;
      try {
        execSync(
          `${shq(FFMPEG)} -f concat -safe 0 -i ${shq(concatListPath)} -c copy ${shq(concatPath)} -y`,
          { timeout: 180000, stdio: ["ignore", "ignore", "pipe"] }
        );
        concatOk = true;
      } catch {
        concatOk = false;
      }

      if (!concatOk) {
        // Slow path: normalize each chunk to 16kHz PCM WAV then re-encode.
        // Done in small parallel batches so a 4-hour session doesn't
        // take 10 minutes of sequential ffmpeg invocations.
        const normalizedPaths: string[] = [];
        const NORMALIZE_CONCURRENCY = 4;
        for (let i = 0; i < chunkPaths.length; i += NORMALIZE_CONCURRENCY) {
          const slice = chunkPaths.slice(i, i + NORMALIZE_CONCURRENCY);
          const results = await Promise.all(
            slice.map(async (chunkPath) => {
              const normalizedPath = chunkPath.replace(/\.m4a$/, ".wav");
              try {
                execSync(
                  `${shq(FFMPEG)} -analyzeduration 100M -probesize 100M -i ${shq(chunkPath)} -ac 1 -ar 16000 -c:a pcm_s16le ${shq(normalizedPath)} -y`,
                  { timeout: 120000, stdio: ["ignore", "ignore", "pipe"] }
                );
                return normalizedPath;
              } catch (err) {
                const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
                try {
                  execSync(
                    `${shq(FFMPEG)} -f s16le -ar 44100 -ac 1 -i ${shq(chunkPath)} -ar 16000 -c:a pcm_s16le ${shq(normalizedPath)} -y`,
                    { timeout: 120000, stdio: ["ignore", "ignore", "pipe"] }
                  );
                  return normalizedPath;
                } catch (err2) {
                  const stderr2 = (err2 as { stderr?: Buffer }).stderr?.toString() ?? "";
                  throw new Error(`ffmpeg normalize failed: ${stderr.slice(-250)} | fallback: ${stderr2.slice(-250)}`);
                }
              }
            })
          );
          normalizedPaths.push(...results);
        }

        writeFileSync(concatListPath, normalizedPaths.map((p) => `file '${p}'`).join("\n"));
        try {
          execSync(
            `${shq(FFMPEG)} -f concat -safe 0 -i ${shq(concatListPath)} -c:a aac -b:a 64k ${shq(concatPath)} -y`,
            { timeout: 240000, stdio: ["ignore", "ignore", "pipe"] }
          );
        } catch (err) {
          const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
          throw new Error(`ffmpeg concat failed: ${stderr.slice(-500)}`);
        }
      }

      const durationOutput = execSync(
        `${shq(FFPROBE)} -v error -show_entries format=duration -of csv=p=0 ${shq(concatPath)}`,
        { encoding: "utf-8", timeout: 30000 }
      ).trim();
      const totalDuration = parseFloat(durationOutput) || 0;

      // --- 4. Stitch per-chunk transcripts into session-global words ---
      const stitched = stitchTranscripts(workChunks);
      let allWords: DgWord[] = stitched.words;
      let utterances: DgUtterance[] = stitched.utterances;
      let repSpeaker = stitched.repSpeaker;
      const requestId = stitched.sourceRequestIds[0] ?? null;

      // --- 5. Emergency fallback: no per-chunk transcripts at all ---
      // Should never happen in the Phase 4 flow, but if every chunk
      // failed to transcribe upstream, send the full concat to
      // Deepgram as a last resort. Old code path, preserved so no
      // session ever silently produces zero conversations.
      if (allWords.length === 0) {
        const deepgramKey = process.env.DEEPGRAM_API_KEY;
        if (!deepgramKey) {
          throw new Error("DEEPGRAM_API_KEY not configured");
        }
        const audioBuffer = readFileSync(concatPath);
        const dgResponse = await fetch(
          "https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&punctuate=true&utterances=true&smart_format=true",
          {
            method: "POST",
            headers: {
              Authorization: `Token ${deepgramKey}`,
              "Content-Type": "audio/mp4",
            },
            body: new Uint8Array(audioBuffer),
          }
        );
        if (!dgResponse.ok) {
          const text = await dgResponse.text().catch(() => "");
          throw new Error(`Deepgram fallback ${dgResponse.status}: ${text.slice(0, 400)}`);
        }
        const dgResult = await dgResponse.json();
        utterances = dgResult.results?.utterances ?? [];
        const fallbackWords: DgWord[] = [];
        for (const u of utterances) {
          if (!u.words) continue;
          for (const w of u.words) {
            fallbackWords.push({ ...w, speaker: w.speaker ?? u.speaker });
          }
        }
        if (fallbackWords.length === 0) {
          const chWords = (dgResult.results?.channels?.[0]?.alternatives?.[0]?.words ?? []) as DgWord[];
          fallbackWords.push(...chWords);
        }
        fallbackWords.sort((a, b) => a.start - b.start);
        allWords = fallbackWords;
        repSpeaker = identifyRepSpeaker(utterances);
      }

      // --- 6. Compute split boundaries ---
      let splitPoints = computeSplitPoints(allWords, points, repSpeaker, totalDuration);

      // Last-resort: Deepgram produced no usable words AND we have no splits
      // AND the session is long enough that one segment would be suspicious.
      if (allWords.length === 0 && splitPoints.length === 0 && totalDuration > SPEECH_GAP_S * 2) {
        splitPoints = fallbackSilenceSplit(concatPath, totalDuration);
      }

      const segmentBoundaries = buildSegmentBoundaries(splitPoints, totalDuration);

      // --- 7. Cut, upload, and create per-segment records ---
      const segmentPaths: Array<{ path: string; start: number; end: number; duration: number }> = [];
      for (let i = 0; i < segmentBoundaries.length; i++) {
        const seg = segmentBoundaries[i];
        const trimmedStart = Math.min(seg.start + EDGE_SILENCE_TRIM_S, seg.end);
        const trimmedEnd = Math.max(seg.end - EDGE_SILENCE_TRIM_S, trimmedStart);
        const duration = trimmedEnd - trimmedStart;
        if (duration < MIN_CONVERSATION_S) continue;

        const segPath = join(workDir, `segment_${i}.m4a`);
        execSync(
          `${shq(FFMPEG)} -i ${shq(concatPath)} -ss ${trimmedStart} -to ${trimmedEnd} -c copy ${shq(segPath)} -y`,
          { timeout: 30000 }
        );
        segmentPaths.push({ path: segPath, start: trimmedStart, end: trimmedEnd, duration });
      }

      const origin = new URL(request.url).origin;
      const internalSecret = getInternalSecret();
      const internalHeaders = {
        "Content-Type": "application/json",
        "x-internal-secret": internalSecret,
      };

      const conversationCount = segmentPaths.length;

      // Clear any prior split artifacts for this session so a re-run
      // produces exactly one set of calls + transcripts. Combined with
      // the deterministic segment storage path + the unique index on
      // calls(session_id, session_order), this makes /split fully
      // idempotent.
      const { data: existingCalls } = await admin
        .from("calls")
        .select("id")
        .eq("session_id", sessionId);
      const existingCallIds = (existingCalls ?? []).map((c) => c.id);
      if (existingCallIds.length > 0) {
        await admin.from("transcripts").delete().in("call_id", existingCallIds);
        await admin.from("calls").delete().eq("session_id", sessionId);
      }

      for (let i = 0; i < segmentPaths.length; i++) {
        const seg = segmentPaths[i];
        const isLast = i === segmentPaths.length - 1;

        const placeholderName = isLast
          ? session.label
          : `Conversation ${i + 1}`;

        // Deterministic path so a cron re-trigger overwrites the same
        // object instead of accumulating `_session_0.m4a` dupes under
        // fresh Date.now() timestamps.
        const storagePath = `${session.rep_id}/${sessionId}/segment_${i}.m4a`;
        await admin.storage
          .from("call-recordings")
          .upload(storagePath, readFileSync(seg.path), {
            contentType: "audio/mp4",
            upsert: true,
          });

        // Geotag: prefer fine-grained location points, fall back to chunk / session
        const segMidpoint = (seg.start + seg.end) / 2;
        let segLatitude: number | null = null;
        let segLongitude: number | null = null;
        if (points.length > 0) {
          const closest = points.reduce((best, p) =>
            Math.abs(p.elapsed_s - segMidpoint) < Math.abs(best.elapsed_s - segMidpoint) ? p : best
          , points[0]);
          segLatitude = closest.latitude;
          segLongitude = closest.longitude;
        } else {
          const chunkDuration = chunks.length > 1
            ? (chunks.reduce((sum, c) => sum + (c.duration_seconds ?? 0), 0) / chunks.length)
            : (chunks[0]?.duration_seconds ?? 300);
          const closestChunk = chunks.reduce((best, c) => {
            const chunkMid = (c.chunk_index + 0.5) * chunkDuration;
            return Math.abs(chunkMid - segMidpoint) < Math.abs((best.chunk_index + 0.5) * chunkDuration - segMidpoint) ? c : best;
          }, chunks[0]);
          segLatitude = closestChunk?.latitude ?? session.latitude ?? null;
          segLongitude = closestChunk?.longitude ?? session.longitude ?? null;
        }

        const { data: call } = await admin
          .from("calls")
          .insert({
            rep_id: session.rep_id,
            team_id: session.team_id,
            audio_storage_path: storagePath,
            duration_seconds: Math.round(seg.duration),
            status: "transcribed",
            customer_name: placeholderName,
            recorded_at: session.started_at,
            session_id: sessionId,
            session_order: i,
            latitude: segLatitude,
            longitude: segLongitude,
          })
          .select("id")
          .single();

        if (!call) continue;

        // --- 8. Slice transcript into segment-relative utterances ---
        const segUtterances = utterances
          .filter((u) => u.end >= seg.start && u.start <= seg.end)
          .map((u) => ({
            speaker: u.speaker === repSpeaker ? ("rep" as const) : ("customer" as const),
            startMs: Math.max(0, Math.round((u.start - seg.start) * 1000)),
            endMs: Math.max(0, Math.round((Math.min(u.end, seg.end) - seg.start) * 1000)),
            text: u.transcript,
            confidence: u.confidence,
          }));

        const fullText = segUtterances
          .map((u) => `[${u.speaker}] ${u.text}`)
          .join("\n");

        await admin.from("transcripts").insert({
          call_id: call.id,
          full_text: fullText,
          utterances: segUtterances,
          deepgram_request_id: requestId,
        });

        // AI-name non-labeled conversations
        if (!isLast && fullText.trim().length > 0) {
          try {
            const { text: aiName } = await generateText({
              model: anthropic("claude-haiku-4-5-20251001"),
              prompt: `Based on this door-to-door sales conversation transcript, generate a short name (max 40 chars). Use the customer's name if mentioned, otherwise a brief description like "Price Objection - Interested" or "Not Home - Left Info". Return ONLY the name, nothing else.\n\n${fullText.slice(0, 2000)}`,
              maxOutputTokens: 50,
            });
            const cleanName = aiName.trim().replace(/^["']|["']$/g, "");
            if (cleanName.length > 0 && cleanName.length <= 100) {
              await admin.from("calls").update({ customer_name: cleanName }).eq("id", call.id);
            }
          } catch {
            // Keep placeholder name if AI naming fails
          }
        }

        // Fire analyze (transcribe is skipped — we already have the transcript)
        try {
          await fetch(`${origin}/api/process/analyze`, {
            method: "POST",
            headers: internalHeaders,
            body: JSON.stringify({ callId: call.id }),
          });
        } catch {
          // Analyze errors surface via call.status
        }
      }

      // --- 9. Finalize session ---
      await admin
        .from("recording_sessions")
        .update({
          status: "completed",
          conversations_found: conversationCount,
        })
        .eq("id", sessionId);

      // Clean up chunks from storage
      const chunkStoragePaths = chunks.map((c) => c.storage_path);
      if (chunkStoragePaths.length > 0) {
        await admin.storage.from("recording-chunks").remove(chunkStoragePaths);
      }

      return NextResponse.json({
        success: true,
        sessionId,
        conversationsFound: conversationCount,
        totalDurationS: Math.round(totalDuration),
        wordCount: allWords.length,
        repSpeaker,
      });
    } finally {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Split failed";

    await admin
      .from("recording_sessions")
      .update({ status: "failed", error_message: message })
      .eq("id", sessionId);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
