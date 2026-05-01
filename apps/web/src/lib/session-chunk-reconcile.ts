import { createAdmin } from "@flex/supabase/admin";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { execFileSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

type AdminClient = ReturnType<typeof createAdmin>;

interface ExistingChunk {
  chunk_index: number;
  duration_seconds: number | null;
}

function chunkIndexFromName(name: string): number | null {
  const match = name.match(/^(\d+)\.m4a$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

async function probeDurationSeconds(
  admin: AdminClient,
  storagePath: string,
  workDir: string
): Promise<number> {
  const { data, error } = await admin.storage
    .from("recording-chunks")
    .download(storagePath);
  if (error || !data) return 0;

  const localPath = join(workDir, storagePath.replace(/\//g, "_"));
  writeFileSync(localPath, Buffer.from(await data.arrayBuffer()));
  try {
    const output = execFileSync(
      ffprobeInstaller.path,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        localPath,
      ],
      { encoding: "utf8", timeout: 30000 }
    ).trim();
    const duration = Number(output);
    return Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 0;
  } catch {
    return 0;
  }
}

export async function reconcileSessionChunks(
  admin: AdminClient,
  sessionId: string
): Promise<{ recovered: number; totalChunks: number; totalDuration: number }> {
  const [{ data: existing }, { data: files, error: listError }] = await Promise.all([
    admin
      .from("session_chunks")
      .select("chunk_index, duration_seconds")
      .eq("session_id", sessionId),
    admin.storage.from("recording-chunks").list(sessionId, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    }),
  ]);

  if (listError) {
    throw new Error(`Failed to list recording chunks: ${listError.message}`);
  }

  const existingByIndex = new Map<number, ExistingChunk>();
  for (const chunk of (existing ?? []) as ExistingChunk[]) {
    existingByIndex.set(chunk.chunk_index, chunk);
  }

  const storageChunks = (files ?? [])
    .map((file) => {
      const chunkIndex = chunkIndexFromName(file.name);
      return chunkIndex == null
        ? null
        : {
            chunkIndex,
            storagePath: `${sessionId}/${file.name}`,
          };
    })
    .filter(
      (chunk): chunk is { chunkIndex: number; storagePath: string } =>
        chunk != null
    );

  const missing = storageChunks.filter(
    (chunk) => !existingByIndex.has(chunk.chunkIndex)
  );

  let recovered = 0;
  if (missing.length > 0) {
    const workDir = join(tmpdir(), `flex-reconcile-${randomUUID()}`);
    mkdirSync(workDir, { recursive: true });
    try {
      const rows = [];
      for (const chunk of missing) {
        const durationSeconds = await probeDurationSeconds(
          admin,
          chunk.storagePath,
          workDir
        );
        rows.push({
          session_id: sessionId,
          chunk_index: chunk.chunkIndex,
          storage_path: chunk.storagePath,
          duration_seconds: durationSeconds,
          latitude: null,
          longitude: null,
        });
      }
      const { error } = await admin
        .from("session_chunks")
        .upsert(rows, { onConflict: "session_id,chunk_index" });
      if (error) {
        throw new Error(`Failed to recover chunk metadata: ${error.message}`);
      }
      recovered = rows.length;
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  const { data: finalChunks, error: chunksError } = await admin
    .from("session_chunks")
    .select("duration_seconds")
    .eq("session_id", sessionId);
  if (chunksError) {
    throw new Error(`Failed to read recovered chunk counters: ${chunksError.message}`);
  }

  const totalChunks = finalChunks?.length ?? 0;
  const totalDuration = (finalChunks ?? []).reduce(
    (sum, chunk) => sum + (chunk.duration_seconds ?? 0),
    0
  );

  const { error: updateError } = await admin
    .from("recording_sessions")
    .update({
      chunk_count: totalChunks,
      total_duration_s: totalDuration,
    })
    .eq("id", sessionId);
  if (updateError) {
    throw new Error(`Failed to update recovered session counters: ${updateError.message}`);
  }

  return { recovered, totalChunks, totalDuration };
}
