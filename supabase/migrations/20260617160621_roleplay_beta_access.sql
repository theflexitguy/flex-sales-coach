-- Per-rep access control for the mobile Roleplay beta.
-- Managers always have access through their account role; this table lets a
-- manager invite selected reps into testing without promoting them.

CREATE TABLE IF NOT EXISTS public.roleplay_beta_access (
  user_id    UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  enabled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roleplay_beta_access_team
  ON public.roleplay_beta_access(team_id, enabled);

ALTER TABLE public.roleplay_beta_access ENABLE ROW LEVEL SECURITY;

-- Data API grants are explicit because Supabase is moving away from implicit
-- exposure for new public tables.
GRANT SELECT ON TABLE public.roleplay_beta_access TO authenticated;
GRANT ALL ON TABLE public.roleplay_beta_access TO service_role;

DROP POLICY IF EXISTS roleplay_beta_access_select ON public.roleplay_beta_access;
CREATE POLICY roleplay_beta_access_select ON public.roleplay_beta_access
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'manager'::public.user_role
        AND p.team_id = roleplay_beta_access.team_id
    )
  );

DROP TRIGGER IF EXISTS trg_roleplay_beta_access_updated_at ON public.roleplay_beta_access;
CREATE TRIGGER trg_roleplay_beta_access_updated_at
  BEFORE UPDATE ON public.roleplay_beta_access
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
