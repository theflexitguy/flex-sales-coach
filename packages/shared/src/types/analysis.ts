export type SectionType =
  | "introduction"
  | "rapport_building"
  | "pitch"
  | "objection_handling"
  | "closing"
  | "other";

export type ObjectionCategory =
  | "price"
  | "timing"
  | "need"
  | "trust"
  | "competition"
  | "authority"
  | "other";

export type Grade =
  | "excellent"
  | "good"
  | "acceptable"
  | "needs_improvement"
  | "poor";

export interface DetectedObjection {
  readonly id: string;
  readonly callId: string;
  readonly analysisId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly utteranceText: string;
  readonly category: ObjectionCategory;
  readonly repResponse: string;
  readonly handlingGrade: Grade;
  readonly suggestion: string;
  readonly createdAt: string;
}

export interface CallSection {
  readonly id: string;
  readonly callId: string;
  readonly analysisId: string;
  readonly type: SectionType;
  readonly startMs: number;
  readonly endMs: number;
  readonly summary: string;
  readonly grade: Grade;
  readonly orderIndex: number;
}

export interface CallAnalysis {
  readonly id: string;
  readonly callId: string;
  readonly overallScore: number;
  readonly overallGrade: Grade;
  readonly summary: string;
  readonly strengths: readonly string[];
  readonly improvements: readonly string[];
  readonly talkRatioRep: number;
  readonly talkRatioCustomer: number;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly createdAt: string;
}
