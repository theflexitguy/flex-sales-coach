-- Call sharing: explicit visibility grants to specific users
CREATE TABLE call_shares (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id     UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shared_by   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(call_id, user_id)
);

CREATE INDEX idx_call_shares_user ON call_shares(user_id);
CREATE INDEX idx_call_shares_call ON call_shares(call_id);

ALTER TABLE call_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY call_shares_select ON call_shares
  FOR SELECT USING (
    user_id = auth.uid()
    OR shared_by = auth.uid()
  );

CREATE POLICY call_shares_insert ON call_shares
  FOR INSERT WITH CHECK (
    shared_by = auth.uid()
  );

CREATE POLICY call_shares_delete ON call_shares
  FOR DELETE USING (
    shared_by = auth.uid()
  );

-- Coaching note mentions (@rep or @everyone)
CREATE TABLE coaching_note_mentions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     UUID NOT NULL REFERENCES coaching_notes(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE, -- NULL = @everyone
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_note_mentions_note ON coaching_note_mentions(note_id);
CREATE INDEX idx_note_mentions_user ON coaching_note_mentions(user_id);

ALTER TABLE coaching_note_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY note_mentions_select ON coaching_note_mentions
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id IS NULL
    OR note_id IN (SELECT id FROM coaching_notes WHERE author_id = auth.uid())
  );

CREATE POLICY note_mentions_insert ON coaching_note_mentions
  FOR INSERT WITH CHECK (
    note_id IN (SELECT id FROM coaching_notes WHERE author_id = auth.uid())
  );

-- Add new notification types
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'call_shared';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'coaching_note_mention';

-- Update calls RLS to include shared calls
DROP POLICY IF EXISTS calls_select ON calls;
CREATE POLICY calls_select ON calls
  FOR SELECT USING (
    rep_id = auth.uid()
    OR team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    OR id IN (SELECT cs.call_id FROM call_shares cs WHERE cs.user_id = auth.uid())
  );
