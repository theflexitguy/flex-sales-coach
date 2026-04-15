

# Flex Sales Coach -- System Architecture Blueprint

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENTS                                       │
│                                                                         │
│  ┌──────────────────────┐          ┌──────────────────────────────┐     │
│  │  React Native / Expo │          │  Next.js Dashboard           │     │
│  │  (iOS + Android)     │          │  (Vercel, App Router)        │     │
│  │                      │          │                              │     │
│  │  - Audio recording   │          │  - Manager views             │     │
│  │  - Upload queue      │          │  - Rep drill-down            │     │
│  │  - Rep self-review   │          │  - AI analysis display       │     │
│  └──────────┬───────────┘          │  - Audio playback + notes    │     │
│             │                      └──────────────┬───────────────┘     │
└─────────────┼─────────────────────────────────────┼─────────────────────┘
              │                                     │
              │  Supabase JS Client                 │  Supabase JS Client
              │  (Auth + REST + Realtime)            │  (Auth + REST + Realtime)
              ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         SUPABASE PLATFORM                               │
│                                                                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────┐   │
│  │   Auth      │  │  Postgres  │  │  Storage   │  │  Edge          │   │
│  │  (GoTrue)   │  │  (RLS)     │  │  (S3-compat│  │  Functions     │   │
│  │             │  │            │  │   buckets)  │  │                │   │
│  │  - JWT      │  │  - Tables  │  │            │  │  - webhook     │   │
│  │  - Roles    │  │  - Views   │  │  - audio/  │  │    receiver    │   │
│  │  - OAuth    │  │  - Indexes │  │  - exports/│  │  - process     │   │
│  └────────────┘  └────────────┘  └────────────┘  │    trigger     │   │
│                                                    └───────┬────────┘   │
└────────────────────────────────────────────────────────────┼────────────┘
                                                             │
                              ┌───────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     PROCESSING PIPELINE                                 │
│                                                                         │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  Vercel Serverless│    │  Deepgram API    │    │  Claude API      │  │
│  │  Functions        │───▶│                  │───▶│  (Haiku)         │  │
│  │                   │    │  - Transcription │    │                  │  │
│  │  - /api/process/* │    │  - Diarization   │    │  - Objections    │  │
│  │  - Orchestrator   │    │  - Timestamps    │    │  - Scoring       │  │
│  │  - Retry logic    │    │                  │    │  - Sections      │  │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Domain Models (TypeScript Interfaces)

```typescript
// ============================================================
// domain/types/user.ts
// ============================================================

type UserRole = 'rep' | 'manager' | 'admin';

interface UserProfile {
  readonly id: string;               // UUID, matches auth.users.id
  readonly email: string;
  readonly fullName: string;
  readonly role: UserRole;
  readonly teamId: string;           // FK → teams.id
  readonly avatarUrl: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;        // ISO 8601
  readonly updatedAt: string;
}

// ============================================================
// domain/types/team.ts
// ============================================================

interface Team {
  readonly id: string;
  readonly name: string;
  readonly managerId: string;        // FK → profiles.id
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ============================================================
// domain/types/call.ts
// ============================================================

type CallStatus =
  | 'uploading'
  | 'uploaded'
  | 'transcribing'
  | 'transcribed'
  | 'analyzing'
  | 'completed'
  | 'failed';

interface Call {
  readonly id: string;
  readonly repId: string;            // FK → profiles.id
  readonly teamId: string;           // FK → teams.id
  readonly audioStoragePath: string;  // Supabase Storage key
  readonly durationSeconds: number;
  readonly status: CallStatus;
  readonly errorMessage: string | null;
  readonly customerName: string | null;
  readonly customerAddress: string | null;
  readonly recordedAt: string;       // when rep pressed record
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ============================================================
// domain/types/transcript.ts
// ============================================================

type Speaker = 'rep' | 'customer' | 'unknown';

interface TranscriptUtterance {
  readonly speaker: Speaker;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly confidence: number;
}

interface Transcript {
  readonly id: string;
  readonly callId: string;           // FK → calls.id
  readonly fullText: string;         // concatenated plain text
  readonly utterances: TranscriptUtterance[];
  readonly languageCode: string;     // e.g. 'en-US'
  readonly deepgramRequestId: string;
  readonly createdAt: string;
}

// ============================================================
// domain/types/analysis.ts
// ============================================================

type SectionType =
  | 'introduction'
  | 'rapport_building'
  | 'pitch'
  | 'objection_handling'
  | 'closing'
  | 'other';

type ObjectionCategory =
  | 'price'
  | 'timing'
  | 'need'
  | 'trust'
  | 'competition'
  | 'authority'
  | 'other';

type Grade = 'excellent' | 'good' | 'acceptable' | 'needs_improvement' | 'poor';

interface DetectedObjection {
  readonly startMs: number;
  readonly endMs: number;
  readonly utteranceText: string;
  readonly category: ObjectionCategory;
  readonly repResponse: string;
  readonly handlingGrade: Grade;
  readonly suggestion: string;       // AI coaching tip
}

interface CallSection {
  readonly type: SectionType;
  readonly startMs: number;
  readonly endMs: number;
  readonly summary: string;
  readonly grade: Grade;
}

interface CallAnalysis {
  readonly id: string;
  readonly callId: string;           // FK → calls.id
  readonly overallScore: number;     // 0-100
  readonly overallGrade: Grade;
  readonly summary: string;          // 2-3 sentence summary
  readonly strengths: string[];
  readonly improvements: string[];
  readonly sections: CallSection[];
  readonly objections: DetectedObjection[];
  readonly talkRatioRep: number;     // 0-1, percentage of talk time
  readonly talkRatioCustomer: number;
  readonly modelId: string;          // e.g. 'claude-3-5-haiku-20241022'
  readonly promptVersion: string;    // semver for prompt tracking
  readonly createdAt: string;
}

// ============================================================
// domain/types/coaching.ts
// ============================================================

interface CoachingNote {
  readonly id: string;
  readonly callId: string;           // FK → calls.id
  readonly authorId: string;         // FK → profiles.id (manager)
  readonly timestampMs: number | null; // optional anchor point in audio
  readonly content: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface CallTag {
  readonly id: string;
  readonly callId: string;
  readonly tag: string;              // e.g. 'great-close', 'training-example'
  readonly createdBy: string;
  readonly createdAt: string;
}
```

---

## 3. Database Schema

```sql
-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for text search on transcripts

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role     AS ENUM ('rep', 'manager', 'admin');
CREATE TYPE call_status   AS ENUM ('uploading', 'uploaded', 'transcribing',
                                   'transcribed', 'analyzing', 'completed', 'failed');
CREATE TYPE speaker_type  AS ENUM ('rep', 'customer', 'unknown');
CREATE TYPE section_type  AS ENUM ('introduction', 'rapport_building', 'pitch',
                                   'objection_handling', 'closing', 'other');
CREATE TYPE objection_cat AS ENUM ('price', 'timing', 'need', 'trust',
                                   'competition', 'authority', 'other');
CREATE TYPE grade_type    AS ENUM ('excellent', 'good', 'acceptable',
                                   'needs_improvement', 'poor');

-- ============================================================
-- TABLES
-- ============================================================

-- Teams
CREATE TABLE teams (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  manager_id  UUID,  -- set after profiles exist; FK added below
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User profiles (extends auth.users)
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT NOT NULL,
  role        user_role NOT NULL DEFAULT 'rep',
  team_id     UUID REFERENCES teams(id) ON DELETE SET NULL,
  avatar_url  TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Now add the FK from teams.manager_id → profiles.id
ALTER TABLE teams
  ADD CONSTRAINT fk_teams_manager
  FOREIGN KEY (manager_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- Calls (one per recorded conversation)
CREATE TABLE calls (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rep_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id             UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  audio_storage_path  TEXT NOT NULL,
  duration_seconds    INTEGER NOT NULL DEFAULT 0,
  status              call_status NOT NULL DEFAULT 'uploading',
  error_message       TEXT,
  customer_name       TEXT,
  customer_address    TEXT,
  recorded_at         TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transcripts (one per call)
CREATE TABLE transcripts (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id            UUID NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  full_text          TEXT NOT NULL,
  utterances         JSONB NOT NULL DEFAULT '[]',  -- TranscriptUtterance[]
  language_code      TEXT NOT NULL DEFAULT 'en-US',
  deepgram_request_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI analysis results (one per call)
CREATE TABLE call_analyses (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id             UUID NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  overall_score       SMALLINT NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  overall_grade       grade_type NOT NULL,
  summary             TEXT NOT NULL,
  strengths           JSONB NOT NULL DEFAULT '[]',      -- string[]
  improvements        JSONB NOT NULL DEFAULT '[]',      -- string[]
  sections            JSONB NOT NULL DEFAULT '[]',      -- CallSection[]
  objections          JSONB NOT NULL DEFAULT '[]',      -- DetectedObjection[]
  talk_ratio_rep      NUMERIC(3,2) NOT NULL DEFAULT 0,
  talk_ratio_customer NUMERIC(3,2) NOT NULL DEFAULT 0,
  model_id            TEXT NOT NULL,
  prompt_version      TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Manager coaching notes (many per call)
CREATE TABLE coaching_notes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id       UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  timestamp_ms  INTEGER,              -- nullable anchor in audio
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tags on calls (many per call)
CREATE TABLE call_tags (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id     UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(call_id, tag)
);

-- Processing job queue (tracks pipeline state)
CREATE TABLE processing_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id         UUID NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  step            TEXT NOT NULL DEFAULT 'transcription',  -- 'transcription' | 'analysis'
  attempts        SMALLINT NOT NULL DEFAULT 0,
  max_attempts    SMALLINT NOT NULL DEFAULT 3,
  last_error      TEXT,
  next_retry_at   TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_profiles_team       ON profiles(team_id);
CREATE INDEX idx_profiles_role       ON profiles(role);

CREATE INDEX idx_calls_rep           ON calls(rep_id);
CREATE INDEX idx_calls_team          ON calls(team_id);
CREATE INDEX idx_calls_status        ON calls(status);
CREATE INDEX idx_calls_recorded_at   ON calls(recorded_at DESC);
CREATE INDEX idx_calls_team_recorded ON calls(team_id, recorded_at DESC);

CREATE INDEX idx_analyses_score      ON call_analyses(overall_score);
CREATE INDEX idx_analyses_grade      ON call_analyses(overall_grade);

CREATE INDEX idx_coaching_notes_call ON coaching_notes(call_id);
CREATE INDEX idx_call_tags_call      ON call_tags(call_id);
CREATE INDEX idx_call_tags_tag       ON call_tags(tag);

CREATE INDEX idx_processing_jobs_retry
  ON processing_jobs(next_retry_at)
  WHERE completed_at IS NULL;

CREATE INDEX idx_transcripts_fulltext
  ON transcripts USING gin(full_text gin_trgm_ops);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated    BEFORE UPDATE ON profiles         FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_teams_updated       BEFORE UPDATE ON teams            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_calls_updated       BEFORE UPDATE ON calls            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_coaching_updated    BEFORE UPDATE ON coaching_notes   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_jobs_updated        BEFORE UPDATE ON processing_jobs  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls           ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_analyses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching_notes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_tags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's team_id
CREATE OR REPLACE FUNCTION auth.team_id()
RETURNS UUID AS $$
  SELECT team_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if current user is manager
CREATE OR REPLACE FUNCTION auth.is_manager()
RETURNS BOOLEAN AS $$
  SELECT role = 'manager' FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- PROFILES: users see own profile + teammates
CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  team_id = auth.team_id() OR id = auth.uid()
);
CREATE POLICY profiles_update_own ON profiles FOR UPDATE USING (
  id = auth.uid()
) WITH CHECK (
  id = auth.uid()
);

-- TEAMS: members see own team
CREATE POLICY teams_select ON teams FOR SELECT USING (
  id = auth.team_id()
);
CREATE POLICY teams_update_manager ON teams FOR UPDATE USING (
  manager_id = auth.uid()
);

-- CALLS: reps see own calls; managers see team calls
CREATE POLICY calls_select ON calls FOR SELECT USING (
  rep_id = auth.uid() OR team_id = auth.team_id()
);
CREATE POLICY calls_insert_rep ON calls FOR INSERT WITH CHECK (
  rep_id = auth.uid()
);
CREATE POLICY calls_update ON calls FOR UPDATE USING (
  rep_id = auth.uid() OR auth.is_manager()
);

-- TRANSCRIPTS: follow call visibility
CREATE POLICY transcripts_select ON transcripts FOR SELECT USING (
  EXISTS (SELECT 1 FROM calls WHERE calls.id = transcripts.call_id
          AND (calls.rep_id = auth.uid() OR calls.team_id = auth.team_id()))
);

-- ANALYSES: follow call visibility
CREATE POLICY analyses_select ON call_analyses FOR SELECT USING (
  EXISTS (SELECT 1 FROM calls WHERE calls.id = call_analyses.call_id
          AND (calls.rep_id = auth.uid() OR calls.team_id = auth.team_id()))
);

-- COACHING NOTES: reps see notes on own calls; managers full access on team
CREATE POLICY notes_select ON coaching_notes FOR SELECT USING (
  EXISTS (SELECT 1 FROM calls WHERE calls.id = coaching_notes.call_id
          AND (calls.rep_id = auth.uid() OR calls.team_id = auth.team_id()))
);
CREATE POLICY notes_insert ON coaching_notes FOR INSERT WITH CHECK (
  author_id = auth.uid() AND auth.is_manager()
);
CREATE POLICY notes_update ON coaching_notes FOR UPDATE USING (
  author_id = auth.uid()
);
CREATE POLICY notes_delete ON coaching_notes FOR DELETE USING (
  author_id = auth.uid()
);

-- TAGS: same visibility as calls; managers can create
CREATE POLICY tags_select ON call_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM calls WHERE calls.id = call_tags.call_id
          AND (calls.rep_id = auth.uid() OR calls.team_id = auth.team_id()))
);
CREATE POLICY tags_insert ON call_tags FOR INSERT WITH CHECK (
  auth.is_manager()
);
CREATE POLICY tags_delete ON call_tags FOR DELETE USING (
  created_by = auth.uid()
);

-- PROCESSING JOBS: service role only (not accessed from client)
-- No user-facing policies; accessed via service_role key in Edge Functions
CREATE POLICY jobs_service_only ON processing_jobs FOR ALL USING (false);
```

---

## 4. Auth Flow

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Client     │         │  Supabase    │         │  Database     │
│  (App/Web)   │         │  Auth        │         │  (profiles)   │
└──────┬───────┘         └──────┬───────┘         └──────┬───────┘
       │                        │                        │
       │  1. signUp/signIn      │                        │
       │  (email + password)    │                        │
       ├───────────────────────▶│                        │
       │                        │                        │
       │  2. JWT returned       │                        │
       │  (contains user.id)    │                        │
       │◀───────────────────────┤                        │
       │                        │                        │
       │                        │  3. DB trigger:        │
       │                        │  on auth.users INSERT  │
       │                        │  → create profiles row │
       │                        │  (role = 'rep' default)│
       │                        ├───────────────────────▶│
       │                        │                        │
       │  4. Manager sets role  │                        │
       │  via dashboard         │                        │
       │  (UPDATE profiles      │                        │
       │   SET role='manager')  │                        │
       ├────────────────────────┼───────────────────────▶│
       │                        │                        │
```

**Key decisions:**

- **No custom auth server.** Supabase GoTrue handles signup, login, password reset, JWT issuance. The JWT carries the user ID; the `profiles` table carries the role.
- **Role lives in the database, not the JWT.** This avoids JWT refresh race conditions. RLS policies call `auth.is_manager()` which reads from `profiles` at query time. Slight performance cost on every query, but the `profiles` table is tiny (50 rows max at scale target) and the primary key lookup is sub-millisecond.
- **DB trigger on signup** creates the profile row automatically:

```sql
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    'rep'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

- **Team assignment** is a manual step. Manager invites reps by email; on signup (or via a "join team" flow), the rep's `team_id` is set. For MVP, the manager updates this directly.

---

## 5. Processing Pipeline

```
 MOBILE APP                SUPABASE                   VERCEL FUNCTIONS              EXTERNAL APIs
 ──────────               ─────────                  ─────────────────             ──────────────

 ┌─────────┐
 │ Record  │
 │ audio   │
 └────┬────┘
      │
      │ 1. Upload .m4a to
      │    Supabase Storage
      │    bucket: "call-audio"
      │    path: {team_id}/{rep_id}/{call_id}.m4a
      ▼
 ┌─────────┐     ┌────────────────┐
 │ INSERT  │────▶│ calls table    │
 │ call    │     │ status:        │
 │ record  │     │ 'uploaded'     │
 └─────────┘     └───────┬────────┘
                         │
                         │ 2. DB webhook fires
                         │    (Supabase webhook on
                         │     calls INSERT)
                         ▼
                 ┌───────────────────┐
                 │ POST /api/process │
                 │ /trigger          │
                 │                   │
                 │ Validates webhook │
                 │ signature         │
                 └───────┬───────────┘
                         │
                         │ 3. Download audio from
                         │    Storage (signed URL)
                         ▼
                 ┌───────────────────┐     ┌─────────────────┐
                 │ Transcription     │────▶│ Deepgram API    │
                 │ step              │     │                 │
                 │                   │     │ - Nova-2 model  │
                 │ UPDATE calls SET  │     │ - diarize=true  │
                 │ status=           │     │ - punctuate     │
                 │ 'transcribing'    │     │ - utterances    │
                 └───────────────────┘     └────────┬────────┘
                                                    │
                         ┌──────────────────────────┘
                         │ 4. Transcript response
                         ▼
                 ┌───────────────────┐
                 │ Map Deepgram      │
                 │ speakers to       │
                 │ rep/customer      │
                 │                   │
                 │ INSERT transcript │
                 │ UPDATE calls SET  │
                 │ status=           │
                 │ 'transcribed'     │
                 └───────┬───────────┘
                         │
                         │ 5. Send transcript
                         │    to Claude
                         ▼
                 ┌───────────────────┐     ┌─────────────────┐
                 │ Analysis step     │────▶│ Claude API      │
                 │                   │     │ (Haiku)         │
                 │ UPDATE calls SET  │     │                 │
                 │ status=           │     │ Structured JSON │
                 │ 'analyzing'       │     │ output via      │
                 │                   │     │ tool_use schema │
                 └───────────────────┘     └────────┬────────┘
                                                    │
                         ┌──────────────────────────┘
                         │ 6. Parsed analysis
                         ▼
                 ┌───────────────────┐
                 │ INSERT analysis   │
                 │ UPDATE calls SET  │
                 │ status=           │
                 │ 'completed'       │
                 │                   │
                 │ UPDATE job SET    │
                 │ completed_at=now()│
                 └───────────────────┘
```

### Pipeline Implementation Details

**Webhook trigger vs polling:** A Supabase database webhook fires on `INSERT INTO calls` and hits the Vercel function. This is simpler and cheaper than polling. The webhook payload contains the call ID; the function fetches the full record with the service role key.

**Retry strategy:** The `processing_jobs` table tracks attempts. On failure:
1. Increment `attempts`
2. Set `next_retry_at` to exponential backoff (30s, 2min, 10min)
3. Set `calls.status` to `'failed'` only after `max_attempts` exhausted
4. A scheduled Vercel cron (`/api/process/retry`, runs every 5 min) picks up jobs where `next_retry_at < now()` and `completed_at IS NULL`

**Speaker mapping heuristic:** Deepgram returns `speaker_0`, `speaker_1`, etc. The pipeline identifies the rep as the speaker with more total talk time in the first 30 seconds (reps lead the intro). This heuristic works for door-to-door where the rep initiates. If confidence is low (close to 50/50), both labels are stored and the rep can correct in-app.

**Claude structured output:** Use the Anthropic `tool_use` pattern to force structured JSON:

```typescript
// Simplified — see full prompt in /lib/prompts/analyze-call.ts
const analysisSchema = {
  name: 'record_call_analysis',
  input_schema: {
    type: 'object',
    properties: {
      overall_score:  { type: 'number', minimum: 0, maximum: 100 },
      overall_grade:  { type: 'string', enum: ['excellent','good','acceptable','needs_improvement','poor'] },
      summary:        { type: 'string' },
      strengths:      { type: 'array', items: { type: 'string' } },
      improvements:   { type: 'array', items: { type: 'string' } },
      sections:       { type: 'array', items: { /* CallSection schema */ } },
      objections:     { type: 'array', items: { /* DetectedObjection schema */ } },
      talk_ratio_rep: { type: 'number' },
      talk_ratio_customer: { type: 'number' },
    },
    required: [
      'overall_score','overall_grade','summary','strengths',
      'improvements','sections','objections','talk_ratio_rep','talk_ratio_customer'
    ],
  },
};
```

**Cost estimation at scale:**
- Deepgram Nova-2: $0.0043/min. A 10-min call = ~$0.04
- Claude Haiku input: $0.25/M tokens. A 10-min transcript is ~3K tokens = ~$0.001
- Claude Haiku output: $1.25/M tokens. Analysis ~1K tokens = ~$0.001
- **Per call total: ~$0.04** (Deepgram dominates)
- 50 reps x 10 calls/day x 22 days/month = 11,000 calls = ~$440/month

---

## 6. API Design

All routes use the Supabase client directly from the Next.js dashboard or mobile app for CRUD operations. The Vercel API routes handle only processing pipeline orchestration and any operations requiring the service role key.

### 6a. Supabase Direct (Client SDK)

These are not REST endpoints you build -- they are Supabase client calls. Documenting them here for completeness.

```
CRUD via supabase-js:

calls
  .select('*, transcript:transcripts(*), analysis:call_analyses(*)')
  .eq('team_id', teamId)
  .order('recorded_at', { ascending: false })
  .range(offset, offset + limit - 1)

profiles
  .select('*')
  .eq('team_id', teamId)

coaching_notes
  .insert({ call_id, author_id, content, timestamp_ms })
  .select()

call_tags
  .insert({ call_id, tag, created_by })
  .select()
```

### 6b. Vercel API Routes (Next.js Route Handlers)

```
POST /api/process/trigger
  ── Webhook receiver for new call uploads
  ── Headers: x-supabase-webhook-secret
  ── Body: { type: 'INSERT', table: 'calls', record: Call }
  ── Response: 200 { queued: true }
  ── Side effects: creates processing_job, starts pipeline

POST /api/process/retry
  ── Cron job (Vercel cron, every 5 min)
  ── No body
  ── Picks up failed jobs with next_retry_at < now()
  ── Response: 200 { retried: number }

GET /api/calls/[callId]/audio-url
  ── Returns a time-limited signed URL for audio playback
  ── Auth: JWT required, RLS ensures team membership
  ── Response: 200 { url: string, expiresAt: string }

GET /api/analytics/team/[teamId]
  ── Aggregated team stats (avg score, call volume, trends)
  ── Auth: manager role required
  ── Query: ?period=7d|30d|90d
  ── Response: 200 {
       avgScore: number,
       totalCalls: number,
       callsByRep: { repId: string, count: number, avgScore: number }[],
       scoreOverTime: { date: string, avgScore: number }[],
       topObjectionCategories: { category: string, count: number }[],
     }

GET /api/analytics/rep/[repId]
  ── Individual rep performance over time
  ── Auth: rep sees own, manager sees team
  ── Query: ?period=7d|30d|90d
  ── Response: 200 {
       avgScore: number,
       totalCalls: number,
       scoreOverTime: { date: string, avgScore: number }[],
       gradeDistribution: Record<Grade, number>,
       commonObjections: { category: string, avgHandlingScore: number }[],
     }
```

### 6c. Supabase Edge Function

```
process-call (Deno Edge Function)
  ── Called by /api/process/trigger
  ── Runs the full transcription → analysis pipeline
  ── Uses service_role key for DB writes
  ── Has 150s execution limit (sufficient for Deepgram + Claude)
```

**Why an Edge Function instead of a Vercel serverless function for the heavy lifting?** Vercel serverless functions on the free tier have a 10-second timeout (60s on Pro). Deepgram transcription of a 10-minute file can take 15-30 seconds. Supabase Edge Functions have a 150-second limit on the free tier. The Vercel route handler at `/api/process/trigger` validates the webhook and then invokes the Supabase Edge Function asynchronously (fire-and-forget with the call ID). This keeps the webhook response fast and moves the long-running work to a platform that supports it.

---

## 7. File/Folder Structure

### 7a. Next.js Dashboard (`/apps/dashboard`)

```
apps/dashboard/
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout, providers
│   │   ├── page.tsx                      # Redirect to /dashboard
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   │   └── page.tsx
│   │   │   ├── signup/
│   │   │   │   └── page.tsx
│   │   │   └── layout.tsx                # Minimal auth layout
│   │   ├── (app)/
│   │   │   ├── layout.tsx                # Sidebar + nav, auth guard
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx              # Team overview (manager) / my stats (rep)
│   │   │   ├── calls/
│   │   │   │   ├── page.tsx              # Call list with filters
│   │   │   │   └── [callId]/
│   │   │   │       ├── page.tsx          # Call detail: audio + transcript + analysis
│   │   │   │       └── loading.tsx
│   │   │   ├── team/
│   │   │   │   ├── page.tsx              # Team roster + invite
│   │   │   │   └── [repId]/
│   │   │   │       └── page.tsx          # Rep profile + performance
│   │   │   └── settings/
│   │   │       └── page.tsx
│   │   ├── api/
│   │   │   ├── process/
│   │   │   │   ├── trigger/
│   │   │   │   │   └── route.ts
│   │   │   │   └── retry/
│   │   │   │       └── route.ts
│   │   │   ├── calls/
│   │   │   │   └── [callId]/
│   │   │   │       └── audio-url/
│   │   │   │           └── route.ts
│   │   │   └── analytics/
│   │   │       ├── team/
│   │   │       │   └── [teamId]/
│   │   │       │       └── route.ts
│   │   │       └── rep/
│   │   │           └── [repId]/
│   │   │               └── route.ts
│   │   └── global-error.tsx
│   ├── components/
│   │   ├── audio-player/
│   │   │   ├── AudioPlayer.tsx           # Waveform + playback controls
│   │   │   ├── PlaybackSpeed.tsx
│   │   │   └── TimestampMarker.tsx
│   │   ├── call-detail/
│   │   │   ├── CallHeader.tsx
│   │   │   ├── TranscriptView.tsx        # Scrollable, speaker-colored
│   │   │   ├── AnalysisPanel.tsx
│   │   │   ├── ObjectionCard.tsx
│   │   │   ├── SectionTimeline.tsx       # Visual timeline of call sections
│   │   │   ├── CoachingNotes.tsx
│   │   │   └── TagManager.tsx
│   │   ├── call-list/
│   │   │   ├── CallListTable.tsx
│   │   │   ├── CallListFilters.tsx
│   │   │   └── CallStatusBadge.tsx
│   │   ├── dashboard/
│   │   │   ├── TeamOverview.tsx
│   │   │   ├── ScoreChart.tsx
│   │   │   ├── RepLeaderboard.tsx
│   │   │   └── ObjectionBreakdown.tsx
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TopBar.tsx
│   │   │   └── RoleGate.tsx              # Conditionally render by role
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Badge.tsx
│   │       ├── Skeleton.tsx
│   │       └── ScoreRing.tsx             # Circular score indicator
│   ├── hooks/
│   │   ├── useSupabase.ts                # Supabase client singleton
│   │   ├── useAuth.ts
│   │   ├── useProfile.ts
│   │   ├── useCalls.ts                   # TanStack Query wrapper
│   │   ├── useCallDetail.ts
│   │   ├── useTeamAnalytics.ts
│   │   └── useRealtimeCall.ts            # Supabase realtime subscription
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts                 # Browser client
│   │   │   ├── server.ts                 # Server component client
│   │   │   └── service.ts                # Service role client (API routes only)
│   │   ├── deepgram/
│   │   │   ├── client.ts
│   │   │   └── mapSpeakers.ts
│   │   ├── claude/
│   │   │   ├── client.ts
│   │   │   └── schemas.ts               # Zod schemas for structured output
│   │   ├── prompts/
│   │   │   ├── analyze-call.ts           # System prompt + user prompt builder
│   │   │   └── PROMPT_VERSION.ts         # Export const PROMPT_VERSION = '1.0.0'
│   │   ├── pipeline/
│   │   │   ├── orchestrator.ts           # transcribe() → analyze() → store()
│   │   │   ├── transcribe.ts
│   │   │   ├── analyze.ts
│   │   │   └── retry.ts
│   │   └── utils/
│   │       ├── duration.ts
│   │       ├── grades.ts                 # Grade → color, label mappings
│   │       └── dates.ts
│   ├── types/
│   │   ├── user.ts
│   │   ├── call.ts
│   │   ├── transcript.ts
│   │   ├── analysis.ts
│   │   └── coaching.ts
│   └── styles/
│       ├── globals.css
│       └── tokens.css
├── public/
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── vercel.json                           # Cron config for /api/process/retry
```

### 7b. React Native Mobile App (`/apps/mobile`)

```
apps/mobile/
├── app/                                  # Expo Router (file-based routing)
│   ├── _layout.tsx                       # Root layout, auth provider
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   └── signup.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx                   # Bottom tab navigator
│   │   ├── index.tsx                     # Home / recent calls
│   │   ├── record.tsx                    # Recording screen
│   │   ├── calls/
│   │   │   ├── index.tsx                 # Call history
│   │   │   └── [callId].tsx              # Call detail
│   │   └── profile.tsx                   # Rep profile + settings
│   └── +not-found.tsx
├── components/
│   ├── recording/
│   │   ├── RecordButton.tsx              # Large pulsing record button
│   │   ├── RecordingIndicator.tsx        # Background recording status
│   │   ├── RecordingTimer.tsx
│   │   └── UploadProgress.tsx
│   ├── call-card/
│   │   ├── CallCard.tsx
│   │   ├── CallStatusIndicator.tsx
│   │   └── ScoreBadge.tsx
│   ├── call-detail/
│   │   ├── MobileTranscript.tsx
│   │   ├── MobileAnalysis.tsx
│   │   └── QuickStats.tsx
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       └── LoadingSpinner.tsx
├── hooks/
│   ├── useAudioRecorder.ts              # expo-av recording logic
│   ├── useUploadQueue.ts                # Queue + retry uploads
│   ├── useAuth.ts
│   ├── useCalls.ts
│   └── useBackgroundRecording.ts        # Keep recording with screen off
├── lib/
│   ├── supabase.ts                      # Supabase client for RN
│   ├── storage.ts                       # MMKV or AsyncStorage wrapper
│   └── upload.ts                        # Chunked upload with resume
├── types/                               # Shared types (symlink or copy from shared package)
├── app.json
├── tsconfig.json
└── package.json
```

### 7c. Shared Package (`/packages/shared`)

```
packages/shared/
├── src/
│   ├── types/                           # All domain interfaces
│   │   ├── index.ts
│   │   ├── user.ts
│   │   ├── call.ts
│   │   ├── transcript.ts
│   │   ├── analysis.ts
│   │   └── coaching.ts
│   ├── constants/
│   │   ├── grades.ts
│   │   ├── call-status.ts
│   │   └── objection-categories.ts
│   └── validators/
│       ├── call.ts                      # Zod schemas
│       └── analysis.ts
├── tsconfig.json
└── package.json
```

### 7d. Monorepo Root

```
flex-sales-coach/
├── apps/
│   ├── dashboard/
│   └── mobile/
├── packages/
│   └── shared/
├── supabase/
│   ├── migrations/                      # SQL migration files
│   │   ├── 001_initial_schema.sql
│   │   └── 002_rls_policies.sql
│   ├── functions/
│   │   └── process-call/
│   │       └── index.ts                 # Supabase Edge Function
│   └── config.toml
├── turbo.json                           # Turborepo config
├── package.json
├── pnpm-workspace.yaml
└── .env.example
```

---

## 8. Key Architectural Decisions (ADRs)

### ADR-001: Supabase as Unified Backend

**Context:** Need auth, database, file storage, and realtime capabilities. Team is small, budget is tight.

**Decision:** Use Supabase for auth (GoTrue), Postgres, Storage, Edge Functions, and Realtime subscriptions.

**Pros:**
- Single platform reduces operational overhead
- Generous free tier (500MB DB, 1GB storage, 50K monthly active users)
- Built-in RLS eliminates custom authorization middleware
- Realtime subscriptions for live status updates at no extra cost
- Supabase JS client works in both Next.js and React Native

**Cons:**
- Vendor lock-in on auth and storage APIs
- Edge Functions are Deno-based (different runtime from Node.js)
- RLS policies can become complex and hard to test

**Alternatives considered:**
- *Firebase:* Firestore's document model is a poor fit for relational call/analysis data. No native Postgres.
- *Custom Express/Fastify API:* More control, but 10x more infrastructure to build and maintain for a team this size.
- *PlanetScale + Clerk + S3:* Best-of-breed stack but three vendors to manage, higher cost floor.

---

### ADR-002: Processing Pipeline via Webhook + Edge Function (not Queue)

**Context:** Audio processing requires calling two external APIs sequentially (Deepgram then Claude). Need reliability without a dedicated queue service.

**Decision:** Supabase database webhook triggers a Vercel route handler, which invokes a Supabase Edge Function for the long-running work. The `processing_jobs` table acts as a lightweight job queue with retry logic.

**Pros:**
- No additional infrastructure (no Redis, no SQS, no BullMQ)
- DB-backed job tracking is durable and queryable
- Supabase Edge Functions have 150s timeout (sufficient)
- Retry logic via Vercel cron is simple and auditable

**Cons:**
- Not a true queue -- no backpressure, no priority, no dead-letter queue
- Supabase Edge Functions have cold start latency (~500ms)
- Concurrent processing limited by Supabase Edge Function concurrency

**Scaling trigger:** When call volume exceeds ~100 calls/day, migrate to a proper queue (Inngest, Trigger.dev, or BullMQ with Upstash Redis). The `processing_jobs` table and orchestrator abstraction make this a targeted swap, not a rewrite.

---

### ADR-003: Turborepo Monorepo with Shared Types Package

**Context:** Two apps (dashboard + mobile) share domain types, constants, and validation schemas. Need to avoid drift.

**Decision:** Turborepo monorepo with `packages/shared` consumed by both apps.

**Pros:**
- Single source of truth for TypeScript interfaces
- Atomic changes across dashboard and mobile
- Turborepo caching speeds up CI
- pnpm workspaces for efficient dependency management

**Cons:**
- Monorepo tooling has a learning curve
- Expo and Next.js have different bundler requirements
- Shared package must be pure TypeScript (no React Native or Next.js imports)

**Alternatives considered:**
- *Separate repos with npm package:* Publishing cycle slows iteration at this stage.
- *Copy-paste types:* Drift is inevitable within weeks.

---

### ADR-004: RLS for Authorization (not Middleware)

**Context:** Need to enforce that reps see only their own calls and managers see their team's calls.

**Decision:** Row Level Security policies in Postgres, enforced at the database layer. No application-level authorization middleware.

**Pros:**
- Authorization is enforced regardless of how data is accessed (client SDK, direct SQL, Edge Functions)
- Impossible to forget an auth check on a new query
- Policies are colocated with the schema, version-controlled in migrations

**Cons:**
- Policies are SQL, not TypeScript -- harder to unit test
- Complex policies can cause subtle performance issues (subqueries in policies)
- Debugging "why can't I see this row" requires understanding RLS

**Mitigation:** Keep policies simple (team membership checks). Use `EXPLAIN ANALYZE` to verify policy performance on key queries.

---

### ADR-005: TanStack Query for Server State on Dashboard

**Context:** Dashboard needs to fetch, cache, and refresh call lists, analysis data, and team stats.

**Decision:** Use TanStack Query (React Query) for all server state management.

**Pros:**
- Built-in caching, deduplication, background refetching
- Stale-while-revalidate out of the box
- Optimistic updates for coaching notes
- Integrates cleanly with Supabase client calls

**Cons:**
- Another dependency
- Learning curve for cache invalidation patterns

**Alternative considered:**
- *SWR:* Simpler but less powerful for cache invalidation and mutations.
- *Server Components only:* Would work for initial loads but not for interactive features (adding notes, tags, filtering).

---

### ADR-006: Prompt Versioning

**Context:** The Claude analysis prompt will evolve as we learn what scoring is useful. Need to track which prompt version produced each analysis.

**Decision:** Store `prompt_version` (semver string) in `call_analyses`. The prompt lives in `/lib/prompts/analyze-call.ts` with an exported `PROMPT_VERSION` constant.

**Pros:**
- Can compare analysis quality across prompt versions
- Can re-run analysis on old calls with new prompts
- Enables A/B testing of prompts

**Cons:**
- Minor storage overhead (one TEXT column per analysis)

---

## 9. Data Flow Diagrams

### 9a. Rep Records and Uploads a Call

```
REP'S PHONE                           SUPABASE                    EDGE FUNCTION
────────────                          ─────────                   ─────────────

[Press Record]
     │
     ▼
expo-av starts
background recording
(.m4a, AAC codec)
     │
     │ ... 5-30 minutes ...
     │
[Stop Recording]
     │
     ├──▶ Upload .m4a to Storage ────▶ call-audio/{team}/{rep}/{id}.m4a
     │     (chunked, resumable)
     │
     ├──▶ INSERT INTO calls ─────────▶ calls table (status: 'uploaded')
     │     { rep_id, team_id,              │
     │       audio_storage_path,           │ DB webhook fires
     │       recorded_at,                  │
     │       duration_seconds }            ▼
     │                              POST /api/process/trigger
     │                                     │
     │                                     ▼
     │                              invoke Edge Function
     │                              (fire-and-forget)
     │                                     │
     ▼                                     ▼
[See "Processing"              [Pipeline runs: transcribe → analyze]
 status in app]                        │
     │                                 │ Realtime subscription
     │◀────────────────────────────────┘ (calls.status changes)
     │
     ▼
[See "Completed"
 with score badge]
```

### 9b. Manager Reviews a Call

```
MANAGER BROWSER                NEXT.JS SERVER              SUPABASE
───────────────               ──────────────              ─────────

Navigate to /calls
     │
     ▼
Server Component renders
     │
     ├──▶ supabase.from('calls')
     │    .select('*, analysis:call_analyses(*)')
     │    .eq('team_id', teamId)
     │    .order('recorded_at', { ascending: false })
     │    ────────────────────────────────────────▶ Postgres (RLS filtered)
     │                                              │
     │◀─────────────────────────────────────────────┘
     │    Call[] with embedded analysis
     ▼
Render call list table
     │
[Click on call]
     │
Navigate to /calls/[callId]
     │
     ▼
Server Component renders
     │
     ├──▶ Parallel fetch:
     │    Promise.all([
     │      supabase.from('calls').select('*').eq('id', callId),
     │      supabase.from('transcripts').select('*').eq('call_id', callId),
     │      supabase.from('call_analyses').select('*').eq('call_id', callId),
     │      supabase.from('coaching_notes').select('*').eq('call_id', callId),
     │      supabase.from('call_tags').select('*').eq('call_id', callId),
     │      fetch('/api/calls/{callId}/audio-url'),
     │    ])
     │    ────────────────────────────────────────▶ Postgres (5 queries)
     │                                              + Storage (signed URL)
     │◀─────────────────────────────────────────────┘
     ▼
Render:
  ┌─────────────────────────────────────────────────┐
  │ Call Header: customer, date, score ring          │
  ├─────────────┬───────────────────────────────────┤
  │ Audio       │ Analysis Panel                     │
  │ Player      │  - Overall score + grade           │
  │ (waveform)  │  - Section timeline                │
  │             │  - Objections with grades           │
  ├─────────────┤  - Strengths / improvements        │
  │ Transcript  │                                    │
  │ (speaker-   ├───────────────────────────────────┤
  │  colored,   │ Coaching Notes                     │
  │  synced     │  - Existing notes                  │
  │  with audio)│  - Add new note (with timestamp)   │
  │             │  - Tags                            │
  └─────────────┴───────────────────────────────────┘
```

### 9c. Complete System Data Flow

```
                    ┌─────────────────────────┐
                    │       MOBILE APP        │
                    │     (Rep's Phone)       │
                    └────────┬────────────────┘
                             │
                    1. Record audio
                    2. Upload .m4a + metadata
                             │
                             ▼
              ┌──────────────────────────────┐
              │         SUPABASE             │
              │                              │
              │  Storage ◄── .m4a files      │
              │  Postgres ◄── calls row      │
              │       │                      │
              │       │ webhook on INSERT    │
              │       ▼                      │
              │  Edge Function               │
              │       │                      │
              └───────┼──────────────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
         ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Deepgram │ │  Claude  │ │ Supabase │
   │   API    │ │  (Haiku) │ │ Postgres │
   │          │ │          │ │          │
   │ audio →  │ │ text →   │ │ results  │
   │ text     │ │ analysis │ │ stored   │
   └──────────┘ └──────────┘ └──────────┘
                                   │
                      Realtime subscription
                          (status updates)
                                   │
                    ┌──────────────┼──────────┐
                    │              │           │
                    ▼              ▼           │
              ┌──────────┐  ┌──────────┐      │
              │  Mobile  │  │Dashboard │      │
              │  (Rep    │  │(Manager  │      │
              │  sees    │  │ reviews, │      │
              │  score)  │  │ coaches) │      │
              └──────────┘  └──────────┘      │
```

---

## 10. Environment Variables

```bash
# .env.example

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # Server-side only, never exposed to client

# Deepgram
DEEPGRAM_API_KEY=xxx

# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx

# Webhook
SUPABASE_WEBHOOK_SECRET=whsec_xxx         # Verify webhook signatures

# Vercel Cron
CRON_SECRET=xxx                           # Protect cron endpoints
```

---

## 11. Scaling Roadmap

| Users | Bottleneck | Mitigation |
|-------|-----------|------------|
| 5 (now) | None | Current architecture is sufficient |
| 20 | Concurrent pipeline runs | Supabase Edge Function concurrency handles ~25 concurrent invocations on free tier |
| 50 | Storage costs, DB size | Move to Supabase Pro ($25/mo), 8GB DB, 100GB storage |
| 100+ | Pipeline throughput | Replace webhook+Edge Function with Inngest or Trigger.dev for proper job queuing |
| 200+ | Supabase Postgres limits | Add read replica for dashboard queries; keep writes on primary |
| 500+ | Full replatform consideration | Dedicated queue (BullMQ + Redis), dedicated storage (S3), consider dedicated transcription service |

The architecture is designed so that each scaling step is a targeted replacement, not a rewrite. The `processing_jobs` table, the orchestrator abstraction in `/lib/pipeline/orchestrator.ts`, and the typed interfaces in `packages/shared` all serve as stable contracts that survive infrastructure swaps beneath them.

---

## 12. What Is NOT in This Architecture (and Why)

- **No WebSocket server for audio streaming.** Reps record locally and upload completed files. Streaming adds latency sensitivity, codec complexity, and network-drop handling that is unnecessary when reps are in the field with variable connectivity. Upload-after-recording is more reliable.
- **No custom auth service.** Supabase GoTrue handles everything needed. Rolling custom auth is a security liability for a small team.
- **No GraphQL.** The data access patterns are simple enough that Supabase's PostgREST (auto-generated REST from Postgres) with RLS is sufficient. GraphQL would add complexity without proportional benefit at this scale.
- **No separate microservices.** One monorepo, one database, one Edge Function for processing. Microservice boundaries should emerge from real pain, not speculation.
- **No Redis cache.** At 50 users, Postgres handles all query loads. Caching would add infrastructure cost and cache invalidation complexity for negligible latency gain.
