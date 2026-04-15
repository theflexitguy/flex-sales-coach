-- Help Requests: rep-to-manager coaching requests anchored to transcript

CREATE TYPE help_request_status AS ENUM ('pending', 'responded', 'resolved');

CREATE TABLE help_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id            UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  rep_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  manager_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id            UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  status             help_request_status NOT NULL DEFAULT 'pending',
  transcript_excerpt TEXT NOT NULL,
  start_ms           INTEGER NOT NULL,
  end_ms             INTEGER NOT NULL,
  message            TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE help_request_responses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       UUID NOT NULL REFERENCES help_requests(id) ON DELETE CASCADE,
  author_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content          TEXT NOT NULL,
  audio_url        TEXT,
  audio_duration_s INTEGER,
  linked_call_id   UUID REFERENCES calls(id) ON DELETE SET NULL,
  linked_start_ms  INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_help_requests_rep ON help_requests(rep_id);
CREATE INDEX idx_help_requests_manager ON help_requests(manager_id);
CREATE INDEX idx_help_requests_team ON help_requests(team_id);
CREATE INDEX idx_help_requests_status ON help_requests(status);
CREATE INDEX idx_help_responses_request ON help_request_responses(request_id);

ALTER TABLE help_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE help_request_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY help_requests_select ON help_requests
  FOR SELECT USING (
    rep_id = auth.uid()
    OR team_id IN (SELECT get_managed_team_ids())
  );

CREATE POLICY help_requests_insert ON help_requests
  FOR INSERT WITH CHECK (rep_id = auth.uid());

CREATE POLICY help_requests_update ON help_requests
  FOR UPDATE USING (
    rep_id = auth.uid()
    OR team_id IN (SELECT get_managed_team_ids())
  );

CREATE POLICY help_responses_select ON help_request_responses
  FOR SELECT USING (
    request_id IN (SELECT id FROM help_requests)
  );

CREATE POLICY help_responses_insert ON help_request_responses
  FOR INSERT WITH CHECK (author_id = auth.uid());

CREATE TRIGGER trg_help_requests_updated_at BEFORE UPDATE ON help_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
