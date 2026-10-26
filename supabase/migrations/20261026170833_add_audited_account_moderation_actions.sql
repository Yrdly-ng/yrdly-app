BEGIN;

CREATE TABLE public.account_moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('suspend', 'ban', 'unsuspend')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  report_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_moderation_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_moderation_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.account_moderation_actions TO service_role;

CREATE FUNCTION public.admin_set_account_moderation(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_reason text,
  p_report_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_action_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_actor_user_id = p_target_user_id THEN
    RAISE EXCEPTION 'A different actor and target account are required' USING ERRCODE = '22023';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('suspend', 'ban', 'unsuspend') THEN
    RAISE EXCEPTION 'Unsupported account action' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'A reason of 1 to 500 characters is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_user_id AND (coalesce(u.is_admin, false) OR u.role = 'admin')
  ) THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;
  IF p_report_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.reports r
    WHERE r.id = p_report_id
      AND r.reported_user_id = p_target_user_id
      AND r.category = 'Child safety'
      AND r.status = 'open'
  ) THEN
    RAISE EXCEPTION 'Open child-safety report does not match the target account' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users
  SET is_suspended = p_action <> 'unsuspend',
      is_banned = p_action = 'ban',
      status = CASE p_action WHEN 'ban' THEN 'banned' WHEN 'suspend' THEN 'suspended' ELSE 'active' END,
      suspension_reason = CASE WHEN p_action = 'unsuspend' THEN NULL ELSE btrim(p_reason) END,
      suspended_at = CASE WHEN p_action = 'unsuspend' THEN NULL ELSE now() END
  WHERE id = p_target_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target account not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.account_moderation_actions(actor_user_id, target_user_id, action, reason, report_id)
  VALUES (p_actor_user_id, p_target_user_id, p_action, btrim(p_reason), p_report_id)
  RETURNING id INTO v_action_id;
  RETURN v_action_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_account_moderation(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_account_moderation(uuid, uuid, text, text, uuid) TO service_role;

COMMIT;
