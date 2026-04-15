export type HelpRequestStatus = "pending" | "responded" | "resolved";

export interface HelpRequest {
  readonly id: string;
  readonly callId: string;
  readonly repId: string;
  readonly managerId: string;
  readonly teamId: string;
  readonly status: HelpRequestStatus;
  readonly transcriptExcerpt: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly message: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HelpRequestResponse {
  readonly id: string;
  readonly requestId: string;
  readonly authorId: string;
  readonly content: string;
  readonly audioUrl: string | null;
  readonly audioDurationS: number | null;
  readonly linkedCallId: string | null;
  readonly linkedStartMs: number | null;
  readonly createdAt: string;
}
