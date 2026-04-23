"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

const ACCEPTED_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a",
  "audio/wav", "audio/wave", "audio/ogg", "audio/webm", "audio/aac",
  "audio/flac", "audio/x-flac", "video/mp4",
];
const MAX_BYTES = 500 * 1024 * 1024;

function isAudioFile(file: File) {
  return (
    file.type.startsWith("audio/") ||
    ACCEPTED_TYPES.includes(file.type) ||
    /\.(m4a|mp3|mp4|wav|ogg|webm|aac|flac)$/i.test(file.name)
  );
}

interface FileEntry {
  id: string;
  file: File;
  customerName: string;
  customerAddress: string;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
}

async function uploadOne(
  entry: FileEntry,
  onProgress: (p: number) => void,
): Promise<void> {
  const urlRes = await fetch("/api/process/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: entry.file.name,
      contentType: entry.file.type || "audio/mp4",
      customerName: entry.customerName || "Unknown Customer",
      customerAddress: entry.customerAddress || undefined,
      recordedAt: new Date().toISOString(),
    }),
  });

  const urlData = await urlRes.json();
  if (!urlRes.ok) throw new Error(urlData.error || "Failed to prepare upload");

  const { signedUrl, callId, contentType } = urlData as {
    signedUrl: string;
    callId: string;
    contentType: string;
  };

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.addEventListener("progress", (ev) => {
      if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 90));
    });
    xhr.addEventListener("load", () => {
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage upload failed (${xhr.status})`));
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.send(entry.file);
  });

  onProgress(95);

  const triggerRes = await fetch("/api/process/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callId }),
  });

  if (!triggerRes.ok) {
    const d = await triggerRes.json();
    throw new Error(d.error || "Failed to start analysis");
  }

  onProgress(100);
}

export function UploadCall() {
  const [isOpen, setIsOpen] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleClose() {
    if (uploading) return;
    setIsOpen(false);
    setEntries([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function addFiles(files: FileList | File[]) {
    const valid: FileEntry[] = [];
    for (const file of Array.from(files)) {
      if (!isAudioFile(file)) continue;
      if (file.size > MAX_BYTES) continue;
      valid.push({
        id: `${Date.now()}-${Math.random()}`,
        file,
        customerName: "",
        customerAddress: "",
        status: "pending",
        progress: 0,
      });
    }
    setEntries((prev) => [...prev, ...valid]);
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function updateEntry(id: string, patch: Partial<Pick<FileEntry, "customerName" | "customerAddress">>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function updateStatus(id: string, patch: Partial<Pick<FileEntry, "status" | "progress" | "error">>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  const handleDrop = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    setDragOver(false);
    if (ev.dataTransfer.files.length) addFiles(ev.dataTransfer.files);
  }, []);

  async function handleUploadAll(e: React.FormEvent) {
    e.preventDefault();
    if (!entries.length) return;

    setUploading(true);

    // Upload all files concurrently.
    await Promise.all(
      entries.map((entry) => {
        updateStatus(entry.id, { status: "uploading", progress: 0 });
        return uploadOne(entry, (p) => updateStatus(entry.id, { progress: p }))
          .then(() => updateStatus(entry.id, { status: "done", progress: 100 }))
          .catch((err: unknown) =>
            updateStatus(entry.id, {
              status: "error",
              error: err instanceof Error ? err.message : "Upload failed",
            })
          );
      })
    );

    setUploading(false);
    router.refresh();

    // Auto-close only if everything succeeded.
    setEntries((prev) => {
      if (prev.every((e) => e.status === "done")) {
        setTimeout(() => {
          setIsOpen(false);
          setEntries([]);
        }, 800);
      }
      return prev;
    });
  }

  const doneCount = entries.filter((e) => e.status === "done").length;
  const errorCount = entries.filter((e) => e.status === "error").length;
  const allDone = entries.length > 0 && doneCount + errorCount === entries.length;

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Upload Conversation
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 flex flex-col max-h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="text-lg font-semibold text-white">Upload Conversations</h2>
          <button
            onClick={handleClose}
            disabled={uploading}
            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleUploadAll} className="flex flex-col min-h-0 flex-1">
          {/* Drop zone */}
          <div className="px-6 pb-4 shrink-0">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-6 cursor-pointer transition-colors ${
                dragOver
                  ? "border-sky-500 bg-sky-500/10"
                  : "border-zinc-700 hover:border-zinc-500 bg-zinc-800/30"
              }`}
            >
              <svg className="w-8 h-8 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-sm text-zinc-400">
                <span className="text-sky-400 font-medium">Click to choose files</span> or drag and drop
              </p>
              <p className="text-xs text-zinc-500">M4A, MP3, WAV, AAC, FLAC — up to 500 MB each</p>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.m4a,.mp3,.wav,.aac,.flac,.ogg,.webm"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); }}
              />
            </div>
          </div>

          {/* File list */}
          {entries.length > 0 && (
            <div className="flex-1 overflow-y-auto px-6 pb-2 space-y-3 min-h-0">
              {entries.map((entry, i) => (
                <div
                  key={entry.id}
                  className={`rounded-lg border p-4 space-y-3 transition-colors ${
                    entry.status === "done"
                      ? "border-emerald-700/50 bg-emerald-500/5"
                      : entry.status === "error"
                      ? "border-red-700/50 bg-red-500/5"
                      : "border-zinc-700 bg-zinc-800/40"
                  }`}
                >
                  {/* File row */}
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-200 truncate">{entry.file.name}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {(entry.file.size / (1024 * 1024)).toFixed(1)} MB
                      </p>
                    </div>
                    {entry.status === "pending" && !uploading && (
                      <button
                        type="button"
                        onClick={() => removeEntry(entry.id)}
                        className="shrink-0 text-zinc-600 hover:text-zinc-400 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                    {entry.status === "done" && (
                      <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                    {entry.status === "error" && (
                      <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                      </svg>
                    )}
                  </div>

                  {/* Name + address — hide once uploading */}
                  {entry.status === "pending" && (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={entry.customerName}
                        onChange={(e) => updateEntry(entry.id, { customerName: e.target.value })}
                        placeholder={`Customer name #${i + 1}`}
                        className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                      <input
                        type="text"
                        value={entry.customerAddress}
                        onChange={(e) => updateEntry(entry.id, { customerAddress: e.target.value })}
                        placeholder="Address (optional)"
                        className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                  )}

                  {/* Progress bar */}
                  {(entry.status === "uploading" || entry.status === "done") && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-zinc-400">
                        <span>
                          {entry.status === "done"
                            ? "Done — analyzing…"
                            : entry.progress < 95
                            ? "Uploading…"
                            : "Starting analysis…"}
                        </span>
                        <span>{entry.progress}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-zinc-700 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${entry.status === "done" ? "bg-emerald-500" : "bg-sky-500"}`}
                          style={{ width: `${entry.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {entry.status === "error" && (
                    <p className="text-xs text-red-400">{entry.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="px-6 py-4 shrink-0 space-y-3">
            {allDone && errorCount === 0 && (
              <p className="text-center text-sm text-emerald-400">
                All {doneCount} {doneCount === 1 ? "file" : "files"} uploaded — AI analysis is running in the background.
              </p>
            )}
            {allDone && errorCount > 0 && (
              <p className="text-center text-sm text-zinc-400">
                {doneCount} uploaded, <span className="text-red-400">{errorCount} failed</span>
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={uploading}
                className="flex-1 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {allDone ? "Close" : "Cancel"}
              </button>
              {!allDone && (
                <button
                  type="submit"
                  disabled={uploading || entries.length === 0}
                  className="flex-1 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {uploading
                    ? `Uploading ${doneCount + errorCount + 1} of ${entries.length}…`
                    : `Upload & Analyze${entries.length > 1 ? ` All ${entries.length}` : ""}`}
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-500 text-center">
              Audio will be transcribed and analyzed by AI automatically
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
