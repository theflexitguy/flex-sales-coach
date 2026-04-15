export type CallStatus =
  | "uploading"
  | "uploaded"
  | "transcribing"
  | "transcribed"
  | "analyzing"
  | "completed"
  | "failed";

export interface Call {
  readonly id: string;
  readonly repId: string;
  readonly teamId: string;
  readonly audioStoragePath: string;
  readonly durationSeconds: number;
  readonly status: CallStatus;
  readonly errorMessage: string | null;
  readonly customerName: string | null;
  readonly customerAddress: string | null;
  readonly recordedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
