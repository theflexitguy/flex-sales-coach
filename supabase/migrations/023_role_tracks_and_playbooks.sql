-- Role tracks let one customer team use different playbooks per rep function.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS playbook_role TEXT NOT NULL DEFAULT 'door_to_door_sales';

ALTER TABLE public.playbooks
  ADD COLUMN IF NOT EXISTS target_role TEXT NOT NULL DEFAULT 'door_to_door_sales';

UPDATE public.profiles
SET playbook_role = 'door_to_door_sales'
WHERE playbook_role IS NULL OR trim(playbook_role) = '';

UPDATE public.playbooks
SET target_role = 'door_to_door_sales'
WHERE target_role IS NULL OR trim(target_role) = '';

CREATE INDEX IF NOT EXISTS idx_profiles_team_playbook_role
  ON public.profiles(team_id, playbook_role);

CREATE INDEX IF NOT EXISTS idx_playbooks_team_target_role_active
  ON public.playbooks(team_id, target_role, is_active);
