export interface CoachingNote {
  readonly id: string;
  readonly callId: string;
  readonly authorId: string;
  readonly timestampMs: number | null;
  readonly content: string;
  readonly audioUrl: string | null;
  readonly audioDurationSeconds: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Tag {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly teamId: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface CallTag {
  readonly callId: string;
  readonly tagId: string;
  readonly createdBy: string;
  readonly createdAt: string;
}
