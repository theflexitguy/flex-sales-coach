-- Keep one durable rep invite code per team. Regenerating rotates this row.

WITH ranked_invites AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY team_id
      ORDER BY created_at DESC, id DESC
    ) AS invite_rank
  FROM public.team_invites
)
DELETE FROM public.team_invites AS invite
USING ranked_invites AS ranked
WHERE invite.id = ranked.id
  AND ranked.invite_rank > 1;

UPDATE public.team_invites
SET expires_at = NULL,
    max_uses = NULL
WHERE expires_at IS NOT NULL
   OR max_uses IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_invites_one_per_team
  ON public.team_invites(team_id);
