"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

const ACCEPTED_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a",
  "audio/wav", "audio/wave", "audio/ogg", "audio/webm", "audio/aac",
  "audio/flac", "audio/x-flac", "video/mp4",
];
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB

export function UploadCall() {
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleClose() {
    if (uploading) return;
    setIsOpen(false);
    setError(null);
    setProgress(0);
    setCustomerName("");
    setCustomerAddress("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Select an audio file");
      return;
    }

    // Client-side validation
    const isAudio =
      file.type.startsWith("audio/") ||
      ACCEPTED_TYPES.includes(file.type) ||
      /\.(m4a|mp3|mp4|wav|ogg|webm|aac|flac)$/i.test(file.name);

    if (!isAudio) {
      setError("Please select an audio file (M4A, MP3, WAV, AAC, etc.)");
      return;
    }

    if (file.size > MAX_BYTES) {
      setError("File is too large (max 500 MB)");
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      // Step 1: Get a signed upload URL and create the call record.
      const urlRes = await fetch("/api/process/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "audio/mp4",
          customerName: customerName || "Unknown Customer",
          customerAddress: customerAddress || undefined,
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

      // Step 2: Upload directly to Supabase Storage via XHR so we get progress.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signedUrl);
        xhr.setRequestHeader("Content-Type", contentType);
        xhr.upload.addEventListener("progress", (ev) => {
          if (ev.lengthComputable) {
            setProgress(Math.round((ev.loaded / ev.total) * 90));
          }
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Storage upload failed (${xhr.status})`));
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
        xhr.send(file);
      });

      setProgress(92);

      // Step 3: Trigger transcription + analysis pipeline.
      const triggerRes = await fetch("/api/process/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId }),
      });

      if (!triggerRes.ok) {
        const d = await triggerRes.json();
        throw new Error(d.error || "Failed to start analysis");
      }

      setProgress(100);
      handleClose();
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Upload Conversation</h2>
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

        <form onSubmit={handleUpload} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-300">
              Audio File
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,.m4a,.mp3,.wav,.aac,.flac,.ogg,.webm"
              required
              disabled={uploading}
              className="w-full text-sm text-zinc-400 file:mr-4 file:rounded-lg file:border-0 file:bg-sky-500/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-sky-400 hover:file:bg-sky-500/20 file:cursor-pointer file:transition-colors disabled:opacity-50"
            />
            <p className="text-xs text-zinc-500">M4A, MP3, WAV, AAC, FLAC, OGG, WebM — up to 500 MB</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-300">
              Customer Name
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              disabled={uploading}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-colors text-sm disabled:opacity-50"
              placeholder="e.g. John Smith"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-300">
              Address
            </label>
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              disabled={uploading}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-colors text-sm disabled:opacity-50"
              placeholder="e.g. 123 Main St"
            />
          </div>

          {uploading && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-zinc-400">
                <span>{progress < 92 ? "Uploading…" : progress < 100 ? "Starting analysis…" : "Done"}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-sky-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={uploading}
              className="flex-1 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="flex-1 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uploading ? "Uploading…" : "Upload & Analyze"}
            </button>
          </div>
        </form>

        <p className="text-xs text-zinc-500 text-center">
          Audio will be transcribed and analyzed by AI automatically
        </p>
      </div>
    </div>
  );
}
