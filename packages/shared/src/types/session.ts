export type SessionStatus =
  | "recording"
  | "uploading"
  | "processing"
  | "completed"
  | "failed";

export interface RecordingSession {
  readonly id: string;
  readonly repId: string;
  readonly teamId: string;
  readonly status: SessionStatus;
  readonly label: string | null;
  readonly chunkCount: number;
  readonly totalDurationSeconds: number;
  readonly conversationsFound: number | null;
  readonly startedAt: string;
  readonly stoppedAt: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SessionChunk {
  readonly id: string;
  readonly sessionId: string;
  readonly chunkIndex: number;
  readonly storagePath: string;
  readonly durationSeconds: number;
  readonly uploadedAt: string;
}
