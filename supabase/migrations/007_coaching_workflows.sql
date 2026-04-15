-- AI Chat: conversation history per call
CREATE TABLE call_chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id     UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_call ON call_chat_messages(call_id);
ALTER TABLE call_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_select ON call_chat_messages
  FOR SELECT USING (call_id IN (SELECT id FROM calls));

CREATE POLICY chat_insert ON call_chat_messages
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Coaching assignments
CREATE TYPE assignment_status AS ENUM ('assigned', 'in_progress', 'completed', 'overdue');

CREATE TABLE coaching_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id       UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  rep_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  manager_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  status        assignment_status NOT NULL DEFAULT 'assigned',
  instructions  TEXT NOT NULL,
  due_date      DATE,
  completed_at  TIMESTAMPTZ,
  rep_response  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assignments_rep ON coaching_assignments(rep_id);
CREATE INDEX idx_assignments_manager ON coaching_assignments(manager_id);
CREATE INDEX idx_assignments_status ON coaching_assignments(status);

ALTER TABLE coaching_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY assignments_select ON coaching_assignments
  FOR SELECT USING (
    rep_id = auth.uid()
    OR team_id IN (SELECT get_managed_team_ids())
  );

CREATE POLICY assignments_insert ON coaching_assignments
  FOR INSERT WITH CHECK (
    manager_id = auth.uid()
  );

CREATE POLICY assignments_update ON coaching_assignments
  FOR UPDATE USING (
    rep_id = auth.uid()
    OR manager_id = auth.uid()
  );

CREATE TRIGGER trg_assignments_updated_at BEFORE UPDATE ON coaching_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Custom playbooks
CREATE TABLE playbooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  sections    JSONB NOT NULL DEFAULT '[]',
  scoring     JSONB NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY playbooks_select ON playbooks
  FOR SELECT USING (
    team_id = get_user_team_id()
    OR team_id IN (SELECT get_managed_team_ids())
  );

CREATE POLICY playbooks_manage ON playbooks
  FOR ALL USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE TRIGGER trg_playbooks_updated_at BEFORE UPDATE ON playbooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Call comparison saves
CREATE TABLE call_comparisons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_a_id   UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  call_b_id   UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE call_comparisons ENABLE ROW LEVEL SECURITY;

CREATE POLICY comparisons_select ON call_comparisons
  FOR SELECT USING (created_by = auth.uid());

CREATE POLICY comparisons_insert ON call_comparisons
  FOR INSERT WITH CHECK (created_by = auth.uid());
