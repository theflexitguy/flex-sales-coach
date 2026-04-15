-- Deal outcomes: track what happened after each call

CREATE TYPE call_outcome AS ENUM (
  'sale',
  'no_sale',
  'callback',
  'not_home',
  'not_interested',
  'already_has_service',
  'pending'
);

ALTER TABLE calls ADD COLUMN outcome call_outcome DEFAULT 'pending';
ALTER TABLE calls ADD COLUMN outcome_notes TEXT;

CREATE INDEX idx_calls_outcome ON calls(outcome);

-- Team invite codes for onboarding
CREATE TABLE team_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  max_uses    INTEGER DEFAULT 10,
  uses        INTEGER DEFAULT 0,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY invites_select ON team_invites
  FOR SELECT USING (
    team_id IN (SELECT get_managed_team_ids())
    OR team_id = get_user_team_id()
  );

CREATE POLICY invites_manage ON team_invites
  FOR ALL USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Notifications table
CREATE TYPE notification_type AS ENUM (
  'help_request_new',
  'help_request_response',
  'call_analyzed',
  'coaching_note',
  'session_complete',
  'badge_earned'
);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  data        JSONB DEFAULT '{}',
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read = false;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (user_id = auth.uid());
