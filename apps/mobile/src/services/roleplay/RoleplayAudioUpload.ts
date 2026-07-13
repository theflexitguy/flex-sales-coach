import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { apiPatch, apiPost } from "../api";

const PENDING_ROLEPLAY_AUDIO_KEY = "@koachr/pending-roleplay-audio-v1";

type UploadPreparation = {
  readonly signedUrl: string;
  readonly storagePath: string;
};

type PendingRoleplayAudio = {
  readonly sessionId: string;
  readonly uri: string;
};

async function readPending(): Promise<PendingRoleplayAudio[]> {
  const stored = await AsyncStorage.getItem(PENDING_ROLEPLAY_AUDIO_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingRoleplayAudio => (
      item != null
      && typeof item === "object"
      && typeof (item as PendingRoleplayAudio).sessionId === "string"
      && typeof (item as PendingRoleplayAudio).uri === "string"
    ));
  } catch {
    return [];
  }
}

async function writePending(pending: readonly PendingRoleplayAudio[]): Promise<void> {
  if (pending.length === 0) {
    await AsyncStorage.removeItem(PENDING_ROLEPLAY_AUDIO_KEY);
    return;
  }
  await AsyncStorage.setItem(PENDING_ROLEPLAY_AUDIO_KEY, JSON.stringify(pending));
}

async function queuePending(item: PendingRoleplayAudio): Promise<void> {
  const pending = await readPending();
  await writePending([...pending.filter((queued) => queued.sessionId !== item.sessionId), item]);
}

async function removePending(sessionId: string): Promise<void> {
  const pending = await readPending();
  await writePending(pending.filter((item) => item.sessionId !== sessionId));
}

async function uploadPendingAudio(item: PendingRoleplayAudio): Promise<void> {
  const file = await FileSystem.getInfoAsync(item.uri);
  if (!file.exists) {
    await removePending(item.sessionId);
    return;
  }

  const prepared = await apiPost<UploadPreparation>(
    `/api/roleplay/sessions/${item.sessionId}/audio`,
    { contentType: "audio/mp4" }
  );

  const upload = await FileSystem.uploadAsync(prepared.signedUrl, item.uri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": "audio/mp4" },
  });
  if (upload.status < 200 || upload.status >= 300) {
    throw new Error(`Roleplay audio upload failed (${upload.status}): ${upload.body?.slice(0, 200) ?? ""}`);
  }

  await apiPatch(`/api/roleplay/sessions/${item.sessionId}/audio`, {
    storagePath: prepared.storagePath,
  });
  await FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => {});
  await removePending(item.sessionId);
}

export async function uploadRoleplayAudio(sessionId: string, uri: string): Promise<void> {
  const pending = { sessionId, uri };
  await queuePending(pending);
  await uploadPendingAudio(pending);
}

export async function drainPendingRoleplayAudio(): Promise<void> {
  const pending = await readPending();
  for (const item of pending) {
    try {
      await uploadPendingAudio(item);
    } catch (error) {
      console.error("pending roleplay audio upload failed", error);
    }
  }
}
