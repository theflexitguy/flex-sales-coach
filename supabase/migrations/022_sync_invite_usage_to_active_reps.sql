-- Invite usage should reflect the team's current active reps.

WITH active_rep_counts AS (
  SELECT
    teams.id AS team_id,
    count(profiles.id)::INTEGER AS active_reps
  FROM public.teams
  LEFT JOIN public.profiles
    ON profiles.team_id = teams.id
   AND profiles.role = 'rep'::public.user_role
   AND profiles.is_active = true
  GROUP BY teams.id
)
UPDATE public.team_invites AS invite
SET uses = active_rep_counts.active_reps,
    max_uses = NULL,
    expires_at = NULL
FROM active_rep_counts
WHERE invite.team_id = active_rep_counts.team_id;
