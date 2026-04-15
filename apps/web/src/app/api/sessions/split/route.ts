import { NextResponse } from "next/server";
import { createAdmin } from "@flex/supabase/admin";
import { isInternalCall } from "@/lib/api-auth-server";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const SILENCE_THRESHOLD_DB = -25; // -25dB accounts for ambient outdoor/bag noise
const SILENCE_DURATION_S = 12;   // 12 seconds of silence = conversation boundary
const MIN_CONVERSATION_S = 5;    // ignore segments shorter than 5 seconds
const EDGE_SILENCE_TRIM_S = 1;   // trim 1s of silence from edges

export const maxDuration = 300; // 5 min timeout for Vercel Pro

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
    // Get session
    const { data: session } = await admin
      .from("recording_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Get chunks in order
    const { data: chunks } = await admin
      .from("session_chunks")
      .select("*")
      .eq("session_id", sessionId)
      .order("chunk_index");

    if (!chunks || chunks.length === 0) {
      throw new Error("No chunks found for session");
    }

    // Create temp working directory
    const workDir = join(tmpdir(), `flex-split-${randomUUID()}`);
    mkdirSync(workDir, { recursive: true });

    try {
      // Download all chunks
      const chunkPaths: string[] = [];
      for (const chunk of chunks) {
        const { data: fileData, error: dlError } = await admin.storage
          .from("recording-chunks")
          .download(chunk.storage_path);

        if (dlError || !fileData) {
          throw new Error(`Failed to download chunk ${chunk.chunk_index}: ${dlError?.message}`);
        }

        const chunkPath = join(workDir, `chunk_${chunk.chunk_index}.m4a`);
        const buffer = Buffer.from(await fileData.arrayBuffer());
        writeFileSync(chunkPath, buffer);
        chunkPaths.push(chunkPath);
      }

      // Create concat file list for FFmpeg
      const concatListPath = join(workDir, "concat.txt");
      const concatContent = chunkPaths
        .map((p) => `file '${p}'`)
        .join("\n");
      writeFileSync(concatListPath, concatContent);

      // Concatenate all chunks
      const concatPath = join(workDir, "full_recording.m4a");
      execSync(
        `ffmpeg -f concat -safe 0 -i "${concatListPath}" -c copy "${concatPath}" -y 2>/dev/null`,
        { timeout: 120000 }
      );

      // Detect silences
      let silenceOutput: string;
      try {
        execSync(
          `ffmpeg -i "${concatPath}" -af silencedetect=noise=${SILENCE_THRESHOLD_DB}dB:d=${SILENCE_DURATION_S} -f null - 2>&1`,
          { timeout: 120000, encoding: "utf-8" }
        );
        silenceOutput = "";
      } catch (e: unknown) {
        // FFmpeg outputs to stderr which causes execSync to "fail" — but the output is in the error
        silenceOutput = (e as { stderr?: string; stdout?: string }).stderr ?? (e as Error).message ?? "";
      }

      // Parse silence boundaries
      const silenceEnds: number[] = [];
      const silenceStarts: number[] = [];
      const lines = silenceOutput.split("\n");
      for (const line of lines) {
        const startMatch = line.match(/silence_start:\s*([\d.]+)/);
        const endMatch = line.match(/silence_end:\s*([\d.]+)/);
        if (startMatch) silenceStarts.push(parseFloat(startMatch[1]));
        if (endMatch) silenceEnds.push(parseFloat(endMatch[1]));
      }

      // Get total duration
      const durationOutput = execSync(
        `ffprobe -v error -show_entries format=duration -of csv=p=0 "${concatPath}"`,
        { encoding: "utf-8", timeout: 10000 }
      ).trim();
      const totalDuration = parseFloat(durationOutput) || 0;

      // Build split points (midpoint of each silence region)
      const splitPoints: number[] = [];
      for (let i = 0; i < Math.min(silenceStarts.length, silenceEnds.length); i++) {
        const midpoint = (silenceStarts[i] + silenceEnds[i]) / 2;
        splitPoints.push(midpoint);
      }

      // Create segments from split points
      const segmentBoundaries: Array<{ start: number; end: number }> = [];
      let segStart = 0;
      for (const sp of splitPoints) {
        if (sp - segStart >= MIN_CONVERSATION_S) {
          segmentBoundaries.push({ start: segStart, end: sp });
        }
        segStart = sp;
      }
      // Last segment
      if (totalDuration - segStart >= MIN_CONVERSATION_S) {
        segmentBoundaries.push({ start: segStart, end: totalDuration });
      }

      // If no silences found, treat entire recording as one conversation
      if (segmentBoundaries.length === 0) {
        segmentBoundaries.push({ start: 0, end: totalDuration });
      }

      // Split and trim each segment
      const segmentPaths: Array<{ path: string; start: number; end: number; duration: number }> = [];
      for (let i = 0; i < segmentBoundaries.length; i++) {
        const seg = segmentBoundaries[i];
        const trimmedStart = Math.min(seg.start + EDGE_SILENCE_TRIM_S, seg.end);
        const trimmedEnd = Math.max(seg.end - EDGE_SILENCE_TRIM_S, trimmedStart);
        const duration = trimmedEnd - trimmedStart;

        if (duration < MIN_CONVERSATION_S) continue;

        const segPath = join(workDir, `segment_${i}.m4a`);
        execSync(
          `ffmpeg -i "${concatPath}" -ss ${trimmedStart} -to ${trimmedEnd} -c copy "${segPath}" -y 2>/dev/null`,
          { timeout: 30000 }
        );

        segmentPaths.push({
          path: segPath,
          start: trimmedStart,
          end: trimmedEnd,
          duration,
        });
      }

      // Upload each segment as a call
      const origin = new URL(request.url).origin;
      const conversationCount = segmentPaths.length;

      for (let i = 0; i < segmentPaths.length; i++) {
        const seg = segmentPaths[i];
        const isLast = i === segmentPaths.length - 1;
        // Last conversation gets the rep's label; others get placeholder until AI names them
        const placeholderName = isLast
          ? session.label
          : `Conversation ${i + 1}`;

        // Upload to call-recordings
        const timestamp = Date.now();
        const storagePath = `${session.rep_id}/${timestamp}_session_${i}.m4a`;
        const fileBuffer = readFileSync(seg.path);

        await admin.storage
          .from("call-recordings")
          .upload(storagePath, fileBuffer, {
            contentType: "audio/mp4",
            upsert: false,
          });

        // Find the chunk whose time range overlaps this segment's midpoint
        // Each chunk covers [chunkIndex * chunkDuration, (chunkIndex+1) * chunkDuration]
        const chunkDuration = chunks.length > 1
          ? (chunks.reduce((sum, c) => sum + (c.duration_seconds ?? 0), 0) / chunks.length)
          : (chunks[0]?.duration_seconds ?? 300);
        const segMidpoint = (seg.start + seg.end) / 2;
        const closestChunk = chunks.reduce((best, c) => {
          const chunkMid = (c.chunk_index + 0.5) * chunkDuration;
          return Math.abs(chunkMid - segMidpoint) < Math.abs((best.chunk_index + 0.5) * chunkDuration - segMidpoint) ? c : best;
        }, chunks[0]);
        const segLatitude = closestChunk?.latitude ?? session.latitude ?? null;
        const segLongitude = closestChunk?.longitude ?? session.longitude ?? null;

        // Create call record
        const { data: call } = await admin
          .from("calls")
          .insert({
            rep_id: session.rep_id,
            team_id: session.team_id,
            audio_storage_path: storagePath,
            duration_seconds: Math.round(seg.duration),
            status: "uploaded",
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

        // Trigger transcribe → analyze pipeline
        const internalHeaders = {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET || "flex-internal-2024",
        };
        try {
          const transcribeRes = await fetch(`${origin}/api/process/transcribe`, {
            method: "POST",
            headers: internalHeaders,
            body: JSON.stringify({ callId: call.id }),
          });

          if (transcribeRes.ok) {
            // AI-name non-labeled conversations from their transcript
            if (!isLast) {
              try {
                const { data: transcript } = await admin
                  .from("transcripts")
                  .select("full_text")
                  .eq("call_id", call.id)
                  .single();

                if (transcript?.full_text) {
                  const { text: aiName } = await generateText({
                    model: anthropic("claude-haiku-4-5-20251001"),
                    prompt: `Based on this door-to-door sales conversation transcript, generate a short name (max 40 chars). Use the customer's name if mentioned, otherwise a brief description like "Price Objection - Interested" or "Not Home - Left Info". Return ONLY the name, nothing else.\n\n${transcript.full_text.slice(0, 2000)}`,
                    maxOutputTokens: 50,
                  });

                  const cleanName = aiName.trim().replace(/^["']|["']$/g, "");
                  if (cleanName.length > 0 && cleanName.length <= 100) {
                    await admin
                      .from("calls")
                      .update({ customer_name: cleanName })
                      .eq("id", call.id);
                  }
                }
              } catch {
                // Keep placeholder name if AI naming fails
              }
            }

            await fetch(`${origin}/api/process/analyze`, {
              method: "POST",
              headers: internalHeaders,
              body: JSON.stringify({ callId: call.id }),
            });
          }
        } catch {
          // Processing errors captured in call record
        }
      }

      // Update session as completed
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
      });
    } finally {
      // Clean up temp directory
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
