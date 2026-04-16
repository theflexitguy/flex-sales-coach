-- Manager-Rep Assignments: many-to-many junction table
-- Allows multiple reps per manager and multiple managers per rep.

CREATE TABLE manager_rep_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rep_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(manager_id, rep_id)
);

CREATE INDEX idx_mra_manager ON manager_rep_assignments(manager_id);
CREATE INDEX idx_mra_rep ON manager_rep_assignments(rep_id);
CREATE INDEX idx_mra_team ON manager_rep_assignments(team_id);

-- RLS
ALTER TABLE manager_rep_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY mra_select ON manager_rep_assignments
  FOR SELECT USING (
    auth.uid() = manager_id OR auth.uid() = rep_id
  );

CREATE POLICY mra_insert ON manager_rep_assignments
  FOR INSERT WITH CHECK (
    auth.uid() = manager_id
  );

CREATE POLICY mra_delete ON manager_rep_assignments
  FOR DELETE USING (
    auth.uid() = manager_id
  );
