export const CALL_STATUSES = [
  "uploading",
  "uploaded",
  "transcribing",
  "transcribed",
  "analyzing",
  "completed",
  "failed",
] as const;

export const SECTION_TYPES = [
  "introduction",
  "rapport_building",
  "pitch",
  "objection_handling",
  "closing",
  "other",
] as const;

export const OBJECTION_CATEGORIES = [
  "price",
  "timing",
  "need",
  "trust",
  "competition",
  "authority",
  "other",
] as const;

export const GRADES = [
  "excellent",
  "good",
  "acceptable",
  "needs_improvement",
  "poor",
] as const;

export const USER_ROLES = ["rep", "manager"] as const;

export const MAX_AUDIO_DURATION_SECONDS = 3600; // 1 hour
export const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB
export const SUPPORTED_AUDIO_FORMATS = [
  "audio/wav",
  "audio/mp4",
  "audio/mpeg",
  "audio/webm",
  "audio/ogg",
  "audio/aac",
] as const;

export const TAG_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
] as const;

export const GRADE_LABELS: Record<string, string> = {
  excellent: "Excellent",
  good: "Good",
  acceptable: "Acceptable",
  needs_improvement: "Needs Improvement",
  poor: "Poor",
};

export const GRADE_COLORS: Record<string, string> = {
  excellent: "#22c55e",
  good: "#35b2ff",
  acceptable: "#eab308",
  needs_improvement: "#f97316",
  poor: "#ef4444",
};

export const HELP_REQUEST_STATUSES = [
  "pending",
  "responded",
  "resolved",
] as const;

export const CALL_OUTCOMES = [
  { value: "sale", label: "Sale", color: "#22c55e" },
  { value: "no_sale", label: "No Sale", color: "#ef4444" },
  { value: "callback", label: "Callback", color: "#35b2ff" },
  { value: "not_home", label: "Not Home", color: "#71717a" },
  { value: "not_interested", label: "Not Interested", color: "#f97316" },
  { value: "already_has_service", label: "Has Service", color: "#8b5cf6" },
  { value: "pending", label: "Pending", color: "#3f3f46" },
] as const;

export const NOTIFICATION_TYPES = [
  "help_request_new",
  "help_request_response",
  "call_analyzed",
  "coaching_note",
  "session_complete",
  "badge_earned",
] as const;

export const SCENARIO_TYPES = [
  "objection_drill",
  "full_pitch",
  "cold_open",
  "callback",
  "custom",
] as const;

export const DIFFICULTY_LEVELS = [
  "beginner",
  "intermediate",
  "advanced",
  "extreme",
] as const;

export const ROLEPLAY_DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Easy",
  intermediate: "Medium",
  advanced: "Hard",
  extreme: "Extreme",
};

export const ROLEPLAY_SESSION_STATUSES = [
  "active",
  "completed",
  "abandoned",
] as const;

/** ElevenLabs pre-made voices — diverse set for customer personas */
export const ELEVENLABS_VOICES: Record<string, { id: string; gender: string; age: string; accent: string }> = {
  "Roger":    { id: "CwhRBWXzGAHq8TQ4Fs17", gender: "male",   age: "middle-aged", accent: "American" },
  "Sarah":    { id: "EXAVITQu4vr4xnSDxMaL", gender: "female", age: "young",       accent: "American" },
  "Charlie":  { id: "IKne3meq5aSn9XLyUdCD", gender: "male",   age: "middle-aged", accent: "Australian" },
  "Laura":    { id: "FGY2WhTYpPnrIDTdsKH5", gender: "female", age: "young",       accent: "American" },
  "George":   { id: "JBFqnCBsd6RMkjVDRZzb", gender: "male",   age: "senior",      accent: "British" },
  "Lily":     { id: "pFZP5JQG7iQjIQuC4Bku", gender: "female", age: "middle-aged", accent: "British" },
  "Daniel":   { id: "onwK4e9ZLuTAKqWW03F9", gender: "male",   age: "young",       accent: "British" },
  "Jessica":  { id: "cgSgspJ2msm6clMCkdW9", gender: "female", age: "middle-aged", accent: "American" },
  "Marcus":   { id: "pqHfZKP75CvOlQylNhV4", gender: "male",   age: "young",       accent: "American" },
  "Aria":     { id: "9BWtsMINqrJLrRacOk9x", gender: "female", age: "young",       accent: "American" },
};

export const DAILY_ROLEPLAY_SESSION_LIMIT = 10;

export const BADGES = [
  { id: "first_call", label: "First Call", icon: "mic", threshold: { calls: 1 } },
  { id: "ten_calls", label: "10 Calls", icon: "flame", threshold: { calls: 10 } },
  { id: "fifty_calls", label: "50 Calls", icon: "star", threshold: { calls: 50 } },
  { id: "week_streak", label: "7-Day Streak", icon: "calendar", threshold: { streak: 7 } },
  { id: "month_streak", label: "30-Day Streak", icon: "trophy", threshold: { streak: 30 } },
  { id: "high_scorer", label: "High Scorer", icon: "trending-up", threshold: { avgScore: 80 } },
  { id: "objection_master", label: "Objection Master", icon: "shield-checkmark", threshold: { handleRate: 80 } },
] as const;
