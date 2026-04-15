-- Rep daily stats: aggregated performance per rep per day

CREATE TABLE rep_daily_stats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id           UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  stat_date         DATE NOT NULL,
  calls_count       INTEGER NOT NULL DEFAULT 0,
  avg_score         REAL,
  total_objections  INTEGER NOT NULL DEFAULT 0,
  handled_well      INTEGER NOT NULL DEFAULT 0,
  recording_seconds INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rep_id, stat_date)
);

CREATE INDEX idx_rep_daily_stats_rep ON rep_daily_stats(rep_id);
CREATE INDEX idx_rep_daily_stats_date ON rep_daily_stats(stat_date DESC);
CREATE INDEX idx_rep_daily_stats_team ON rep_daily_stats(team_id);

ALTER TABLE rep_daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY rep_stats_select ON rep_daily_stats
  FOR SELECT USING (
    rep_id = auth.uid()
    OR team_id IN (SELECT get_managed_team_ids())
  );

CREATE TRIGGER trg_rep_daily_stats_updated_at BEFORE UPDATE ON rep_daily_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-refresh stats when a call completes
CREATE OR REPLACE FUNCTION refresh_rep_daily_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    INSERT INTO rep_daily_stats (rep_id, team_id, stat_date, calls_count, avg_score, total_objections, handled_well, recording_seconds)
    SELECT
      NEW.rep_id,
      NEW.team_id,
      DATE(NEW.recorded_at),
      COUNT(*),
      AVG(ca.overall_score),
      COUNT(DISTINCT o.id),
      COUNT(DISTINCT o.id) FILTER (WHERE o.handling_grade IN ('excellent', 'good')),
      SUM(c.duration_seconds)
    FROM calls c
    LEFT JOIN call_analyses ca ON ca.call_id = c.id
    LEFT JOIN objections o ON o.call_id = c.id
    WHERE c.rep_id = NEW.rep_id AND DATE(c.recorded_at) = DATE(NEW.recorded_at) AND c.status = 'completed'
    GROUP BY 1, 2, 3
    ON CONFLICT (rep_id, stat_date) DO UPDATE SET
      calls_count = EXCLUDED.calls_count,
      avg_score = EXCLUDED.avg_score,
      total_objections = EXCLUDED.total_objections,
      handled_well = EXCLUDED.handled_well,
      recording_seconds = EXCLUDED.recording_seconds,
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_refresh_rep_stats
  AFTER UPDATE ON calls
  FOR EACH ROW EXECUTE FUNCTION refresh_rep_daily_stats();
