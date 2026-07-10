#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const webRequire = createRequire(`${ROOT}/apps/web/package.json`);
const { createClient } = webRequire("@supabase/supabase-js");
const DEFAULT_ENV_FILES = [
  `${ROOT}/apps/web/.env.local`,
  `${ROOT}/apps/web/.env.production.local`,
];

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

for (const file of DEFAULT_ENV_FILES) {
  loadEnvFile(file);
}

function argValue(name, fallback = null) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function parseNumberArg(name, fallback) {
  const raw = argValue(name);
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return parsed;
}

function usage() {
  console.log(`Usage:
  node scripts/recover-recording-sessions.mjs [--execute] [--limit=N] [--session=UUID] [--origin=https://...]

Default mode is a dry run. It scans Supabase Storage bucket recording-chunks,
matches folders to recording_sessions, and reports recoverable sessions.

Options:
  --execute            Call /api/sessions/split for each recoverable session.
  --limit=N            Process at most N recoverable sessions.
  --session=UUID       Only inspect one recording session.
  --origin=URL         Web app origin. Defaults to RECOVERY_WEB_ORIGIN or production.
  --include-completed  Include completed sessions in the report. They are skipped by split unless reset manually.
  --force-completed    With --execute, reset completed sessions to processing before splitting.
`);
}

if (hasArg("--help") || hasArg("-h")) {
  usage();
  process.exit(0);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local"
  );
}

const execute = hasArg("--execute");
const includeCompleted = hasArg("--include-completed") || hasArg("--force-completed");
const forceCompleted = hasArg("--force-completed");
const limit = parseNumberArg("--limit", Infinity);
const oneSession = argValue("--session");
const origin =
  argValue("--origin") ||
  process.env.RECOVERY_WEB_ORIGIN ||
  "https://flex-sales-coach-web.vercel.app";
const internalSecret = process.env.INTERNAL_API_SECRET;

if (execute && (!internalSecret || internalSecret.length < 16)) {
  throw new Error(
    "Missing INTERNAL_API_SECRET. Pull production env or add it to apps/web/.env.local before --execute."
  );
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHUNK_RE = /^(\d+)\.m4a$/i;

async function listStorageSessionIds() {
  if (oneSession) return [oneSession];

  const ids = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.storage
      .from("recording-chunks")
      .list("", {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
    if (error) throw new Error(`Failed to list recording-chunks root: ${error.message}`);
    for (const item of data ?? []) {
      if (UUID_RE.test(item.name)) ids.push(item.name);
    }
    if (!data || data.length < pageSize) break;
  }
  return [...new Set(ids)];
}

async function listChunkFiles(sessionId) {
  const files = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.storage
      .from("recording-chunks")
      .list(sessionId, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
    if (error) throw new Error(`Failed to list chunks for ${sessionId}: ${error.message}`);
    for (const item of data ?? []) {
      const match = item.name.match(CHUNK_RE);
      if (!match) continue;
      files.push({
        name: item.name,
        index: Number(match[1]),
        updatedAt: item.updated_at ?? item.created_at ?? null,
        size: item.metadata?.size ?? null,
      });
    }
    if (!data || data.length < pageSize) break;
  }
  files.sort((a, b) => a.index - b.index);
  return files;
}

async function fetchSessions(ids) {
  const byId = new Map();
  const batchSize = 100;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const { data, error } = await admin
      .from("recording_sessions")
      .select(
        "id, rep_id, team_id, status, started_at, stopped_at, label, chunk_count, total_duration_s, conversations_found, error_message"
      )
      .in("id", batch);
    if (error) throw new Error(`Failed to fetch recording_sessions: ${error.message}`);
    for (const session of data ?? []) byId.set(session.id, session);
  }
  return byId;
}

async function countMetadataRows(sessionId) {
  const { count, error } = await admin
    .from("session_chunks")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (error) throw new Error(`Failed to count session_chunks for ${sessionId}: ${error.message}`);
  return count ?? 0;
}

async function resetCompletedSession(sessionId) {
  const { error } = await admin
    .from("recording_sessions")
    .update({
      status: "processing",
      stopped_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", sessionId);
  if (error) throw new Error(`Failed to reset completed session ${sessionId}: ${error.message}`);
}

async function splitSession(sessionId) {
  const res = await fetch(`${origin.replace(/\/$/, "")}/api/sessions/split`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": internalSecret,
    },
    body: JSON.stringify({ sessionId }),
  });
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep text
  }
  if (!res.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`split ${res.status}: ${detail.slice(0, 800)}`);
  }
  return body;
}

const startedAt = Date.now();
console.log(
  JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    origin,
    includeCompleted,
    forceCompleted,
    limit: Number.isFinite(limit) ? limit : null,
    session: oneSession ?? null,
  })
);

const sessionIds = await listStorageSessionIds();
console.log(`storage session folders: ${sessionIds.length}`);

const sessionsById = await fetchSessions(sessionIds);
const rows = [];
let orphanStorageFolders = 0;

for (const sessionId of sessionIds) {
  const chunkFiles = await listChunkFiles(sessionId);
  if (chunkFiles.length === 0) continue;
  const session = sessionsById.get(sessionId);
  if (!session) {
    orphanStorageFolders += 1;
    rows.push({
      sessionId,
      status: "missing_recording_session",
      storageChunks: chunkFiles.length,
      dbChunks: 0,
      recoverable: false,
      reason: "no recording_sessions row",
    });
    continue;
  }

  const dbChunks = await countMetadataRows(sessionId);
  const completed = session.status === "completed";
  const recoverable = !completed || includeCompleted;
  rows.push({
    sessionId,
    repId: session.rep_id,
    teamId: session.team_id,
    status: session.status,
    startedAt: session.started_at,
    label: session.label,
    storageChunks: chunkFiles.length,
    dbChunks,
    recordedChunkCount: session.chunk_count ?? 0,
    totalDurationS: session.total_duration_s ?? 0,
    conversationsFound: session.conversations_found ?? 0,
    recoverable,
    reason: recoverable ? "has storage audio" : "completed session skipped",
  });
}

const recoverableRows = rows
  .filter((row) => row.recoverable && row.status !== "missing_recording_session")
  .slice(0, limit);

const summary = {
  scannedStorageFolders: sessionIds.length,
  foldersWithAudio: rows.length,
  orphanStorageFolders,
  recoverable: recoverableRows.length,
  skippedCompleted: rows.filter((row) => row.reason === "completed session skipped").length,
  missingMetadata: rows.filter((row) => row.storageChunks > row.dbChunks).length,
};

console.log(JSON.stringify(summary, null, 2));

for (const row of recoverableRows) {
  console.log(
    [
      execute ? "RECOVER" : "DRY",
      row.sessionId,
      row.status,
      `storage=${row.storageChunks}`,
      `db=${row.dbChunks}`,
      row.startedAt ?? "",
      row.label ? `label=${row.label}` : "",
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (!execute) continue;

  try {
    if (row.status === "completed" && forceCompleted) {
      await resetCompletedSession(row.sessionId);
    }
    const result = await splitSession(row.sessionId);
    console.log(`OK ${row.sessionId} ${JSON.stringify(result)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`FAIL ${row.sessionId} ${message}`);
  }
}

console.log(`done in ${Math.round((Date.now() - startedAt) / 1000)}s`);
