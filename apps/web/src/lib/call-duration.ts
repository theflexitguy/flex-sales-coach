import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { extname, join } from "path";
import { randomUUID } from "crypto";

const FFPROBE = ffprobeInstaller.path;

type TranscriptUtterance = {
  end?: unknown;
  endMs?: unknown;
  end_ms?: unknown;
};

function numeric(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function durationFromTranscriptUtterances(
  utterances: unknown
): number | null {
  if (!Array.isArray(utterances)) return null;

  let maxMs = 0;
  for (const raw of utterances) {
    const u = raw as TranscriptUtterance;
    const endMs = numeric(u.endMs) ?? numeric(u.end_ms);
    if (endMs != null) {
      maxMs = Math.max(maxMs, endMs);
      continue;
    }

    const endSeconds = numeric(u.end);
    if (endSeconds != null) {
      maxMs = Math.max(maxMs, endSeconds * 1000);
    }
  }

  return maxMs > 0 ? Math.ceil(maxMs / 1000) : null;
}

export function probeAudioDurationSeconds(
  buffer: Buffer,
  fileName = "audio.m4a"
): number | null {
  const dir = mkdtempSync(join(tmpdir(), "call-duration-"));
  const ext = extname(fileName) || ".m4a";
  const filePath = join(dir, `${randomUUID()}${ext}`);

  try {
    writeFileSync(filePath, buffer);
    const out = execFileSync(
      FFPROBE,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { encoding: "utf8", timeout: 15000 }
    ).trim();
    const seconds = Number(out);
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
