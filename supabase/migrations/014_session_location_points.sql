-- Fine-grained GPS tracking for recording sessions.
-- Mobile app uploads a location point every ~30 seconds during recording.
-- The split pipeline uses the closest point (by elapsed time) to geotag each conversation.

CREATE TABLE session_location_points (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  elapsed_s    INTEGER NOT NULL,
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL
);

CREATE INDEX idx_location_points_session ON session_location_points(session_id, elapsed_s);

ALTER TABLE session_location_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY location_points_select ON session_location_points
  FOR SELECT USING (
    session_id IN (
      SELECT id FROM recording_sessions
      WHERE rep_id = auth.uid()
         OR team_id IN (SELECT t.id FROM teams t WHERE t.manager_id = auth.uid())
    )
  );
