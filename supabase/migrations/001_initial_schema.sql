-- Flex Sales Coach: Initial Database Schema
-- Creates all core tables, enums, RLS policies, and triggers.

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role AS ENUM ('rep', 'manager');
CREATE TYPE call_status AS ENUM (
  'uploading', 'uploaded', 'transcribing',
  'transcribed', 'analyzing', 'completed', 'failed'
);
CREATE TYPE speaker_type AS ENUM ('rep', 'customer', 'unknown');
CREATE TYPE section_type AS ENUM (
  'introduction', 'rapport_building', 'pitch',
  'objection_handling', 'closing', 'other'
);
CREATE TYPE objection_category AS ENUM (
  'price', 'timing', 'need', 'trust',
  'competition', 'authority', 'other'
);
CREATE TYPE grade_type AS ENUM (
  'excellent', 'good', 'acceptable',
  'needs_improvement', 'poor'
);

-- ============================================================
-- TABLES
-- ============================================================

-- Teams
CREATE TABLE teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  manager_id  UUID,
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

-- FK from teams.manager_id -> profiles.id (deferred to avoid circular dep)
ALTER TABLE teams
  ADD CONSTRAINT fk_teams_manager
  FOREIGN KEY (manager_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- Calls (one per recorded conversation)
CREATE TABLE calls (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id             UUID NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  full_text           TEXT NOT NULL,
  utterances          JSONB NOT NULL DEFAULT '[]',
  language_code       TEXT NOT NULL DEFAULT 'en-US',
  deepgram_request_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI analysis results (one per call)
CREATE TABLE call_analyses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id               UUID NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  overall_score         SMALLINT NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  overall_grade         grade_type NOT NULL,
  summary               TEXT NOT NULL,
  strengths             JSONB NOT NULL DEFAULT '[]',
  improvements          JSONB NOT NULL DEFAULT '[]',
  talk_ratio_rep        REAL NOT NULL DEFAULT 0,
  talk_ratio_customer   REAL NOT NULL DEFAULT 0,
  model_id              TEXT NOT NULL DEFAULT 'claude-haiku-4.5',
  prompt_version        TEXT NOT NULL DEFAULT '1.0.0',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Call sections (multiple per analysis)
CREATE TABLE call_sections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id       UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  analysis_id   UUID NOT NULL REFERENCES call_analyses(id) ON DELETE CASCADE,
  section_type  section_type NOT NULL,
  start_ms      INTEGER NOT NULL,
  end_ms        INTEGER NOT NULL,
  summary       TEXT NOT NULL,
  grade         grade_type NOT NULL,
  order_index   SMALLINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Detected objections (multiple per analysis)
CREATE TABLE objections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id         UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  analysis_id     UUID NOT NULL REFERENCES call_analyses(id) ON DELETE CASCADE,
  start_ms        INTEGER NOT NULL,
  end_ms          INTEGER NOT NULL,
  utterance_text  TEXT NOT NULL,
  category        objection_category NOT NULL,
  rep_response    TEXT NOT NULL,
  handling_grade  grade_type NOT NULL,
  suggestion      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Coaching notes (manager leaves for rep)
CREATE TABLE coaching_notes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id                 UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  author_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  timestamp_ms            INTEGER,
  content                 TEXT NOT NULL,
  audio_url               TEXT,
  audio_duration_seconds  INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tags
CREATE TABLE tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#3b82f6',
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, team_id)
);

-- Call-tag junction
CREATE TABLE call_tags (
  call_id     UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (call_id, tag_id)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_profiles_team      ON profiles(team_id);
CREATE INDEX idx_profiles_role      ON profiles(role);
CREATE INDEX idx_calls_rep          ON calls(rep_id);
CREATE INDEX idx_calls_team         ON calls(team_id);
CREATE INDEX idx_calls_status       ON calls(status);
CREATE INDEX idx_calls_recorded_at  ON calls(recorded_at DESC);
CREATE INDEX idx_transcripts_call   ON transcripts(call_id);
CREATE INDEX idx_analyses_call      ON call_analyses(call_id);
CREATE INDEX idx_sections_call      ON call_sections(call_id);
CREATE INDEX idx_sections_analysis  ON call_sections(analysis_id);
CREATE INDEX idx_objections_call    ON objections(call_id);
CREATE INDEX idx_objections_cat     ON objections(category);
CREATE INDEX idx_notes_call         ON coaching_notes(call_id);
CREATE INDEX idx_tags_team          ON tags(team_id);
CREATE INDEX idx_call_tags_tag      ON call_tags(tag_id);
CREATE INDEX idx_transcripts_search ON transcripts USING gin(full_text extensions.gin_trgm_ops);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE objections ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_tags ENABLE ROW LEVEL SECURITY;

-- Profiles: users see own, managers see their team
CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (
    id = auth.uid()
    OR team_id IN (
      SELECT t.id FROM teams t WHERE t.manager_id = auth.uid()
    )
  );

CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Teams: members can read their team, managers can manage
CREATE POLICY teams_select ON teams
  FOR SELECT USING (
    id IN (SELECT p.team_id FROM profiles p WHERE p.id = auth.uid())
    OR manager_id = auth.uid()
  );

CREATE POLICY teams_manage ON teams
  FOR ALL USING (manager_id = auth.uid())
  WITH CHECK (manager_id = auth.uid());

-- Calls: reps see own, managers see team
CREATE POLICY calls_select ON calls
  FOR SELECT USING (
    rep_id = auth.uid()
    OR team_id IN (
      SELECT t.id FROM teams t WHERE t.manager_id = auth.uid()
    )
  );

CREATE POLICY calls_insert ON calls
  FOR INSERT WITH CHECK (rep_id = auth.uid());

CREATE POLICY calls_update ON calls
  FOR UPDATE USING (
    rep_id = auth.uid()
    OR team_id IN (
      SELECT t.id FROM teams t WHERE t.manager_id = auth.uid()
    )
  );

-- Transcripts: follow call access
CREATE POLICY transcripts_select ON transcripts
  FOR SELECT USING (
    call_id IN (SELECT c.id FROM calls c WHERE c.rep_id = auth.uid())
    OR call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
  );

-- Analyses: follow call access
CREATE POLICY analyses_select ON call_analyses
  FOR SELECT USING (
    call_id IN (SELECT c.id FROM calls c WHERE c.rep_id = auth.uid())
    OR call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
  );

-- Sections: follow call access
CREATE POLICY sections_select ON call_sections
  FOR SELECT USING (
    call_id IN (SELECT c.id FROM calls c WHERE c.rep_id = auth.uid())
    OR call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
  );

-- Objections: follow call access
CREATE POLICY objections_select ON objections
  FOR SELECT USING (
    call_id IN (SELECT c.id FROM calls c WHERE c.rep_id = auth.uid())
    OR call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
  );

-- Coaching notes: managers create, both sides read
CREATE POLICY notes_select ON coaching_notes
  FOR SELECT USING (
    call_id IN (SELECT c.id FROM calls c WHERE c.rep_id = auth.uid())
    OR author_id = auth.uid()
    OR call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
  );

CREATE POLICY notes_insert ON coaching_notes
  FOR INSERT WITH CHECK (author_id = auth.uid());

CREATE POLICY notes_update ON coaching_notes
  FOR UPDATE USING (author_id = auth.uid());

CREATE POLICY notes_delete ON coaching_notes
  FOR DELETE USING (author_id = auth.uid());

-- Tags: team-scoped
CREATE POLICY tags_select ON tags
  FOR SELECT USING (
    team_id IN (SELECT p.team_id FROM profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY tags_manage ON tags
  FOR ALL USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Call tags: follow call + tag access
CREATE POLICY call_tags_select ON call_tags
  FOR SELECT USING (
    call_id IN (SELECT c.id FROM calls c WHERE c.rep_id = auth.uid())
    OR call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
  );

CREATE POLICY call_tags_manage ON call_tags
  FOR ALL USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_teams_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_calls_updated_at BEFORE UPDATE ON calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_notes_updated_at BEFORE UPDATE ON coaching_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on auth.users insert
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'rep')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- STORAGE BUCKETS (run via Supabase dashboard or CLI)
-- ============================================================
-- These are created via supabase storage API, not SQL.
-- Bucket: call-recordings (private)
-- Bucket: audio-notes (private)
