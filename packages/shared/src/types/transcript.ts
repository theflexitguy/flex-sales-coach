export type Speaker = "rep" | "customer" | "unknown";

export interface TranscriptUtterance {
  readonly speaker: Speaker;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly confidence: number;
}

export interface Transcript {
  readonly id: string;
  readonly callId: string;
  readonly fullText: string;
  readonly utterances: readonly TranscriptUtterance[];
  readonly languageCode: string;
  readonly deepgramRequestId: string | null;
  readonly createdAt: string;
}
