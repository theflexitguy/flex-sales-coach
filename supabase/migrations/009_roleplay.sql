-- Roleplay Training: AI voice practice with customer personas from real call data

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE scenario_type AS ENUM (
  'objection_drill', 'full_pitch', 'cold_open', 'callback', 'custom'
);
CREATE TYPE difficulty_level AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE roleplay_session_status AS ENUM ('active', 'completed', 'abandoned');

-- ============================================================
-- TABLES
-- ============================================================

-- Customer personas generated from real call data
CREATE TABLE roleplay_personas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id               UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT NOT NULL,
  personality           JSONB NOT NULL DEFAULT '{}',
  voice_id              TEXT NOT NULL,
  source_call_ids       UUID[] NOT NULL DEFAULT '{}',
  objection_categories  objection_category[] NOT NULL DEFAULT '{}',
  system_prompt         TEXT NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scenario templates (combines persona + situation)
CREATE TABLE roleplay_scenarios (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  persona_id           UUID NOT NULL REFERENCES roleplay_personas(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL,
  scenario_type        scenario_type NOT NULL DEFAULT 'full_pitch',
  difficulty           difficulty_level NOT NULL DEFAULT 'intermediate',
  target_objections    objection_category[] NOT NULL DEFAULT '{}',
  context_prompt       TEXT NOT NULL DEFAULT '',
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_by           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual roleplay sessions
CREATE TABLE roleplay_sessions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id                    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id                   UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  scenario_id               UUID REFERENCES roleplay_scenarios(id) ON DELETE SET NULL,
  persona_id                UUID NOT NULL REFERENCES roleplay_personas(id) ON DELETE CASCADE,
  status                    roleplay_session_status NOT NULL DEFAULT 'active',
  duration_seconds          INTEGER NOT NULL DEFAULT 0,
  elevenlabs_conversation_id TEXT,
  transcript_text           TEXT,
  transcript_utterances     JSONB,
  audio_storage_path        TEXT,
  started_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                  TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Roleplay session analysis (mirrors call_analyses)
CREATE TABLE roleplay_analyses (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                UUID NOT NULL UNIQUE REFERENCES roleplay_sessions(id) ON DELETE CASCADE,
  overall_score             SMALLINT NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  overall_grade             grade_type NOT NULL,
  summary                   TEXT NOT NULL,
  strengths                 JSONB NOT NULL DEFAULT '[]',
  improvements              JSONB NOT NULL DEFAULT '[]',
  objection_handling_scores JSONB NOT NULL DEFAULT '[]',
  compared_to_real          JSONB,
  model_id                  TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  prompt_version            TEXT NOT NULL DEFAULT '1.0.0',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_personas_team ON roleplay_personas(team_id);
CREATE INDEX idx_scenarios_team ON roleplay_scenarios(team_id);
CREATE INDEX idx_scenarios_persona ON roleplay_scenarios(persona_id);
CREATE INDEX idx_rp_sessions_rep ON roleplay_sessions(rep_id);
CREATE INDEX idx_rp_sessions_team ON roleplay_sessions(team_id);
CREATE INDEX idx_rp_sessions_status ON roleplay_sessions(status);
CREATE INDEX idx_rp_analyses_session ON roleplay_analyses(session_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE roleplay_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE roleplay_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE roleplay_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE roleplay_analyses ENABLE ROW LEVEL SECURITY;

-- Helper: get team IDs managed by current user (reused from earlier migrations)
-- Personas & scenarios: team-scoped read, managers manage
CREATE POLICY personas_select ON roleplay_personas
  FOR SELECT USING (
    team_id IN (SELECT p.team_id FROM profiles p WHERE p.id = auth.uid())
    OR team_id IN (SELECT get_managed_team_ids())
  );

CREATE POLICY personas_manage ON roleplay_personas
  FOR ALL USING (
    team_id IN (SELECT get_managed_team_ids())
  ) WITH CHECK (
    team_id IN (SELECT get_managed_team_ids())
  );

CREATE POLICY scenarios_select ON roleplay_scenarios
  FOR SELECT USING (
    team_id IN (SELECT p.team_id FROM profiles p WHERE p.id = auth.uid())
    OR team_id IN (SELECT get_managed_team_ids())
  );

CREATE POLICY scenarios_manage ON roleplay_scenarios
  FOR ALL USING (
    team_id IN (SELECT get_managed_team_ids())
  ) WITH CHECK (
    team_id IN (SELECT get_managed_team_ids())
  );

-- Sessions: reps see own, managers see team
CREATE POLICY rp_sessions_select ON roleplay_sessions
  FOR SELECT USING (
    rep_id = auth.uid()
    OR team_id IN (SELECT get_managed_team_ids())
  );

CREATE POLICY rp_sessions_insert ON roleplay_sessions
  FOR INSERT WITH CHECK (rep_id = auth.uid());

CREATE POLICY rp_sessions_update ON roleplay_sessions
  FOR UPDATE USING (
    rep_id = auth.uid()
    OR team_id IN (SELECT get_managed_team_ids())
  );

-- Analyses: follow session access
CREATE POLICY rp_analyses_select ON roleplay_analyses
  FOR SELECT USING (
    session_id IN (SELECT id FROM roleplay_sessions)
  );

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE TRIGGER trg_personas_updated_at BEFORE UPDATE ON roleplay_personas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_scenarios_updated_at BEFORE UPDATE ON roleplay_scenarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
