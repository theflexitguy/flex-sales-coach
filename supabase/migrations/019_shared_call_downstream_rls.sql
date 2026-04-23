-- Migration 012 granted shared users SELECT access to the `calls` row, but
-- the downstream tables (transcripts, analyses, sections, objections, notes,
-- call_tags, help_requests) still only check rep_id or the manager's team.
-- Result: a shared user sees the call row but gets no transcript, analysis,
-- notes, or help requests — so the detail screen renders empty.
--
-- This migration adds the call_shares path to each downstream SELECT policy.

DROP POLICY IF EXISTS transcripts_select ON transcripts;
CREATE POLICY transcripts_select ON transcripts
  FOR SELECT USING (
    call_id IN (SELECT c.id FROM calls c WHERE c.rep_id = auth.uid())
    OR call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
    OR call_id IN (SELECT cs.call_id FROM call_shares cs WHERE cs.user_id = auth.uid())
  );

DROP POLICY IF EXISTS analyses_select ON call_analyses;
CREATE POLICY analyses_select ON call_analyses
  FOR SELECT USING (
    call_id IN (SELECT c.id FROM calls c WHERE c.rep_id = auth.uid())
    OR call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
    OR call_id IN (SELECT cs.call_id FROM call_shares cs WHERE cs.user_id = auth.uid())
  );

DROP POLICY IF EXISTS sections_select ON call_sections;
CREATE POLICY sections_select ON call_sections
  FOR SELECT USING (
    call_id IN (SELECT c.id FROM calls c WHERE c.rep_id = auth.uid())
    OR call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
    OR call_id IN (SELECT cs.call_id FROM call_shares cs WHERE cs.user_id = auth.uid())
  );

DROP POLICY IF EXISTS objections_select ON objections;
CREATE POLICY objections_select ON objections
  FOR SELECT USING (
    call_id IN (SELECT c.id FROM calls c WHERE c.rep_id = auth.uid())
    OR call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
    OR call_id IN (SELECT cs.call_id FROM call_shares cs WHERE cs.user_id = auth.uid())
  );

DROP POLICY IF EXISTS notes_select ON coaching_notes;
CREATE POLICY notes_select ON coaching_notes
  FOR SELECT USING (
    call_id IN (SELECT c.id FROM calls c WHERE c.rep_id = auth.uid())
    OR author_id = auth.uid()
    OR call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
    OR call_id IN (SELECT cs.call_id FROM call_shares cs WHERE cs.user_id = auth.uid())
  );

DROP POLICY IF EXISTS call_tags_select ON call_tags;
CREATE POLICY call_tags_select ON call_tags
  FOR SELECT USING (
    call_id IN (SELECT c.id FROM calls c WHERE c.rep_id = auth.uid())
    OR call_id IN (
      SELECT c.id FROM calls c
      WHERE c.team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
    OR call_id IN (SELECT cs.call_id FROM call_shares cs WHERE cs.user_id = auth.uid())
  );

DROP POLICY IF EXISTS help_requests_select ON help_requests;
CREATE POLICY help_requests_select ON help_requests
  FOR SELECT USING (
    rep_id = auth.uid()
    OR team_id IN (SELECT get_managed_team_ids())
    OR call_id IN (SELECT cs.call_id FROM call_shares cs WHERE cs.user_id = auth.uid())
  );
