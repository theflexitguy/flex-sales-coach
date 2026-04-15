-- Objection Library: denormalize rep_id, add search index, team-scoped access

ALTER TABLE objections ADD COLUMN IF NOT EXISTS rep_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Backfill rep_id from calls
UPDATE objections o SET rep_id = c.rep_id FROM calls c WHERE o.call_id = c.id AND o.rep_id IS NULL;

-- Auto-set rep_id on insert
CREATE OR REPLACE FUNCTION set_objection_rep_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rep_id IS NULL THEN
    SELECT rep_id INTO NEW.rep_id FROM calls WHERE id = NEW.call_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_objection_rep_id
  BEFORE INSERT ON objections
  FOR EACH ROW EXECUTE FUNCTION set_objection_rep_id();

CREATE INDEX IF NOT EXISTS idx_objections_text_search
  ON objections USING gin(utterance_text extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_objections_rep ON objections(rep_id);
CREATE INDEX IF NOT EXISTS idx_objections_grade ON objections(handling_grade);

-- Team-scoped read for library (reps can see all team objections)
CREATE POLICY objections_team_select ON objections
  FOR SELECT USING (
    call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id = get_user_team_id()
         OR c.team_id IN (SELECT get_managed_team_ids())
    )
  );
