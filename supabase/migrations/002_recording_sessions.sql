-- Recording Sessions: continuous recording with server-side splitting

CREATE TYPE session_status AS ENUM (
  'recording',
  'uploading',
  'processing',
  'completed',
  'failed'
);

-- Recording sessions (one per "Start Day" → "Stop & Name" cycle)
CREATE TABLE recording_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id             UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  status              session_status NOT NULL DEFAULT 'recording',
  label               TEXT,
  chunk_count         INTEGER NOT NULL DEFAULT 0,
  total_duration_s    INTEGER NOT NULL DEFAULT 0,
  conversations_found INTEGER,
  started_at          TIMESTAMPTZ NOT NULL,
  stopped_at          TIMESTAMPTZ,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual audio chunks within a session
CREATE TABLE session_chunks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE,
  chunk_index      INTEGER NOT NULL,
  storage_path     TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, chunk_index)
);

-- Link calls back to their originating session
ALTER TABLE calls ADD COLUMN session_id UUID REFERENCES recording_sessions(id) ON DELETE SET NULL;
ALTER TABLE calls ADD COLUMN session_order INTEGER;

-- Indexes
CREATE INDEX idx_sessions_rep ON recording_sessions(rep_id);
CREATE INDEX idx_sessions_status ON recording_sessions(status);
CREATE INDEX idx_sessions_started ON recording_sessions(started_at DESC);
CREATE INDEX idx_chunks_session ON session_chunks(session_id);
CREATE INDEX idx_calls_session ON calls(session_id);

-- RLS
ALTER TABLE recording_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY sessions_select ON recording_sessions
  FOR SELECT USING (
    rep_id = auth.uid()
    OR team_id IN (SELECT get_managed_team_ids())
  );

CREATE POLICY sessions_insert ON recording_sessions
  FOR INSERT WITH CHECK (rep_id = auth.uid());

CREATE POLICY sessions_update ON recording_sessions
  FOR UPDATE USING (
    rep_id = auth.uid()
    OR team_id IN (SELECT get_managed_team_ids())
  );

CREATE POLICY chunks_select ON session_chunks
  FOR SELECT USING (
    session_id IN (SELECT id FROM recording_sessions)
  );

CREATE POLICY chunks_insert ON session_chunks
  FOR INSERT WITH CHECK (
    session_id IN (SELECT id FROM recording_sessions WHERE rep_id = auth.uid())
  );

-- Updated_at trigger
CREATE TRIGGER trg_sessions_updated_at BEFORE UPDATE ON recording_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
