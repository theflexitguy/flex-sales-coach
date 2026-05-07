-- Personal recording folders for reps plus safer aggregate refreshes when
-- managers delete empty/noisy conversations.

CREATE TABLE IF NOT EXISTS public.call_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  color       TEXT NOT NULL DEFAULT '#35b2ff',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_call_folders_owner_lower_name
  ON public.call_folders(owner_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_call_folders_owner
  ON public.call_folders(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_folders_team
  ON public.call_folders(team_id);

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.call_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_calls_folder
  ON public.calls(folder_id);

CREATE OR REPLACE FUNCTION public.validate_call_folder_assignment()
RETURNS TRIGGER AS $$
DECLARE
  v_owner_id UUID;
  v_team_id UUID;
BEGIN
  IF NEW.folder_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT owner_id, team_id
  INTO v_owner_id, v_team_id
  FROM public.call_folders
  WHERE id = NEW.folder_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Call folder % does not exist', NEW.folder_id;
  END IF;

  IF v_owner_id <> NEW.rep_id OR v_team_id <> NEW.team_id THEN
    RAISE EXCEPTION 'Call folder must belong to the call rep and team';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_validate_call_folder_assignment ON public.calls;
CREATE TRIGGER trg_validate_call_folder_assignment
  BEFORE INSERT OR UPDATE OF folder_id, rep_id, team_id ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.validate_call_folder_assignment();

ALTER TABLE public.call_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_folders_select ON public.call_folders;
CREATE POLICY call_folders_select ON public.call_folders
  FOR SELECT USING (
    owner_id = auth.uid()
    OR team_id IN (
      SELECT p.team_id
      FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'manager'
    )
  );

DROP POLICY IF EXISTS call_folders_insert ON public.call_folders;
CREATE POLICY call_folders_insert ON public.call_folders
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()
    AND team_id IN (
      SELECT p.team_id
      FROM public.profiles p
      WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS call_folders_update ON public.call_folders;
CREATE POLICY call_folders_update ON public.call_folders
  FOR UPDATE USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND team_id IN (
      SELECT p.team_id
      FROM public.profiles p
      WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS call_folders_delete ON public.call_folders;
CREATE POLICY call_folders_delete ON public.call_folders
  FOR DELETE USING (owner_id = auth.uid());

DROP TRIGGER IF EXISTS trg_call_folders_updated_at ON public.call_folders;
CREATE TRIGGER trg_call_folders_updated_at BEFORE UPDATE ON public.call_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.recalculate_rep_daily_stats(
  p_rep_id UUID,
  p_stat_date DATE
)
RETURNS void AS $$
DECLARE
  v_has_completed_calls BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.calls c
    WHERE c.rep_id = p_rep_id
      AND DATE(c.recorded_at) = p_stat_date
      AND c.status = 'completed'
  )
  INTO v_has_completed_calls;

  IF NOT v_has_completed_calls THEN
    DELETE FROM public.rep_daily_stats
    WHERE rep_id = p_rep_id AND stat_date = p_stat_date;
    RETURN;
  END IF;

  INSERT INTO public.rep_daily_stats (
    rep_id,
    team_id,
    stat_date,
    calls_count,
    avg_score,
    total_objections,
    handled_well,
    recording_seconds
  )
  WITH day_calls AS (
    SELECT c.id, c.rep_id, c.team_id, DATE(c.recorded_at) AS stat_date, c.duration_seconds
    FROM public.calls c
    WHERE c.rep_id = p_rep_id
      AND DATE(c.recorded_at) = p_stat_date
      AND c.status = 'completed'
  ),
  objection_counts AS (
    SELECT
      dc.rep_id,
      dc.team_id,
      dc.stat_date,
      COUNT(o.id) AS total_objections,
      COUNT(o.id) FILTER (WHERE o.handling_grade IN ('excellent', 'good')) AS handled_well
    FROM day_calls dc
    LEFT JOIN public.objections o ON o.call_id = dc.id
    GROUP BY dc.rep_id, dc.team_id, dc.stat_date
  )
  SELECT
    dc.rep_id,
    dc.team_id,
    dc.stat_date,
    COUNT(dc.id),
    AVG(ca.overall_score),
    COALESCE(MAX(oc.total_objections), 0),
    COALESCE(MAX(oc.handled_well), 0),
    COALESCE(SUM(dc.duration_seconds), 0)
  FROM day_calls dc
  LEFT JOIN public.call_analyses ca ON ca.call_id = dc.id
  LEFT JOIN objection_counts oc
    ON oc.rep_id = dc.rep_id AND oc.team_id = dc.team_id AND oc.stat_date = dc.stat_date
  GROUP BY dc.rep_id, dc.team_id, dc.stat_date
  ON CONFLICT (rep_id, stat_date) DO UPDATE SET
    calls_count = EXCLUDED.calls_count,
    avg_score = EXCLUDED.avg_score,
    total_objections = EXCLUDED.total_objections,
    handled_well = EXCLUDED.handled_well,
    recording_seconds = EXCLUDED.recording_seconds,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.refresh_rep_daily_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'completed' THEN
      PERFORM public.recalculate_rep_daily_stats(OLD.rep_id, DATE(OLD.recorded_at));
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'completed' THEN
      PERFORM public.recalculate_rep_daily_stats(NEW.rep_id, DATE(NEW.recorded_at));
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'completed' THEN
      PERFORM public.recalculate_rep_daily_stats(NEW.rep_id, DATE(NEW.recorded_at));
    END IF;

    IF OLD.status = 'completed'
      AND (
        NEW.status <> 'completed'
        OR OLD.rep_id <> NEW.rep_id
        OR DATE(OLD.recorded_at) <> DATE(NEW.recorded_at)
      )
    THEN
      PERFORM public.recalculate_rep_daily_stats(OLD.rep_id, DATE(OLD.recorded_at));
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_refresh_rep_stats ON public.calls;
CREATE TRIGGER trg_refresh_rep_stats
  AFTER INSERT OR UPDATE OR DELETE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.refresh_rep_daily_stats();

NOTIFY pgrst, 'reload schema';
