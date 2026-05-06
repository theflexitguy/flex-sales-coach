-- Fix ambiguous references between claim_team_invite return columns and team_invites columns.

CREATE OR REPLACE FUNCTION public.claim_team_invite(p_user_id UUID, p_code TEXT)
RETURNS TABLE (
  team_id UUID,
  uses INTEGER,
  max_uses INTEGER,
  current_reps INTEGER,
  included_reps INTEGER,
  overage_reps INTEGER,
  estimated_monthly_cents INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_invite public.team_invites%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_current_reps INTEGER;
  v_next_uses INTEGER;
BEGIN
  SELECT *
  INTO v_invite
  FROM public.team_invites AS invite
  WHERE invite.code = upper(trim(p_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_INVITE' USING ERRCODE = 'P0001';
  END IF;

  IF v_invite.max_uses IS NOT NULL
    AND COALESCE(v_invite.uses, 0) >= v_invite.max_uses THEN
    RAISE EXCEPTION 'INVITE_FULL' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_team
  FROM public.teams AS team
  WHERE team.id = v_invite.team_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_profile.role <> 'rep'::public.user_role THEN
    RAISE EXCEPTION 'ONLY_REPS_CAN_JOIN' USING ERRCODE = 'P0001';
  END IF;

  IF v_profile.team_id IS NOT NULL AND v_profile.team_id <> v_invite.team_id THEN
    RAISE EXCEPTION 'USER_ALREADY_ON_TEAM' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles AS profile
  SET team_id = v_invite.team_id,
      updated_at = now()
  WHERE profile.id = p_user_id;

  IF v_profile.team_id IS DISTINCT FROM v_invite.team_id THEN
    UPDATE public.team_invites AS invite
    SET uses = COALESCE(invite.uses, 0) + 1
    WHERE invite.id = v_invite.id
    RETURNING invite.uses INTO v_next_uses;
  ELSE
    v_next_uses = COALESCE(v_invite.uses, 0);
  END IF;

  SELECT count(*)::INTEGER
  INTO v_current_reps
  FROM public.profiles AS profile
  WHERE profile.team_id = v_invite.team_id
    AND profile.role = 'rep'::public.user_role
    AND profile.is_active = true;

  RETURN QUERY
  SELECT
    v_invite.team_id,
    v_next_uses,
    v_invite.max_uses,
    v_current_reps,
    COALESCE(v_team.included_reps, 10),
    greatest(0, v_current_reps - COALESCE(v_team.included_reps, 10)),
    (
      least(v_current_reps, COALESCE(v_team.included_reps, 10))
      * COALESCE(v_team.included_rep_price_cents, 0)
    ) + (
      greatest(0, v_current_reps - COALESCE(v_team.included_reps, 10))
      * COALESCE(v_team.extra_rep_price_cents, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_team_invite(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_team_invite(UUID, TEXT) TO service_role;
