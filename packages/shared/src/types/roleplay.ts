export type ScenarioType = "objection_drill" | "full_pitch" | "cold_open" | "callback" | "custom";
export type Difficulty = "beginner" | "intermediate" | "advanced";
export type RoleplaySessionStatus = "active" | "completed" | "abandoned";
export type VoiceProvider = "openai-realtime" | "grok-realtime";

export interface PersonaPersonality {
  readonly tone: string;
  readonly objectionStyle: string;
  readonly patienceLevel: string;
  readonly buyingSignals: string;
}

export interface RoleplayPersona {
  readonly id: string;
  readonly teamId: string;
  readonly name: string;
  readonly description: string;
  readonly personality: PersonaPersonality;
  readonly voiceId: string;
  readonly sourceCallIds: readonly string[];
  readonly objectionCategories: readonly string[];
  readonly systemPrompt: string;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RoleplayScenario {
  readonly id: string;
  readonly teamId: string;
  readonly personaId: string;
  readonly title: string;
  readonly description: string;
  readonly scenarioType: ScenarioType;
  readonly difficulty: Difficulty;
  readonly targetObjections: readonly string[];
  readonly contextPrompt: string;
  readonly isActive: boolean;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RoleplaySession {
  readonly id: string;
  readonly repId: string;
  readonly teamId: string;
  readonly scenarioId: string | null;
  readonly personaId: string;
  readonly status: RoleplaySessionStatus;
  readonly durationSeconds: number;
  readonly elevenlabsConversationId: string | null;
  readonly transcriptText: string | null;
  readonly transcriptUtterances: readonly { speaker: string; text: string; startMs: number; endMs: number }[] | null;
  readonly audioStoragePath: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly createdAt: string;
}

export interface ObjectionHandlingScore {
  readonly category: string;
  readonly grade: string;
  readonly feedback: string;
}

export interface RoleplayAnalysis {
  readonly id: string;
  readonly sessionId: string;
  readonly overallScore: number;
  readonly overallGrade: string;
  readonly summary: string;
  readonly strengths: readonly string[];
  readonly improvements: readonly string[];
  readonly objectionHandlingScores: readonly ObjectionHandlingScore[];
  readonly comparedToReal: { readonly avgRealScore: number; readonly delta: number } | null;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly createdAt: string;
}
