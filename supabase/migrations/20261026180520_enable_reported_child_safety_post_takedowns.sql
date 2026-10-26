BEGIN;

CREATE TABLE public.content_moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  report_id uuid NOT NULL,
  target_post_id uuid NOT NULL,
  action text NOT NULL CHECK (action = 'hidden'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_moderation_actions_report_idx ON public.content_moderation_actions(report_id, created_at DESC);
CREATE INDEX content_moderation_actions_post_idx ON public.content_moderation_actions(target_post_id, created_at DESC);
ALTER TABLE public.content_moderation_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_moderation_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.content_moderation_actions TO service_role;

CREATE FUNCTION public.admin_hide_child_safety_reported_post(
  p_actor_user_id uuid,
  p_report_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_post_id uuid;
  v_status text;
  v_category text;
  v_action_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL OR p_report_id IS NULL THEN
    RAISE EXCEPTION 'Actor and report are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_user_id AND (coalesce(u.is_admin, false) OR u.role = 'admin')
  ) THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT r.reported_post_id, r.status, r.category
  INTO v_post_id, v_status, v_category
  FROM public.reports r
  WHERE r.id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'open' OR v_category <> 'Child safety' OR v_post_id IS NULL THEN
    RAISE EXCEPTION 'An open child-safety post report is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.posts SET moderation_status = 'rejected' WHERE id = v_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reported post not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.content_moderation_actions(actor_user_id, report_id, target_post_id, action, reason)
  VALUES (p_actor_user_id, p_report_id, v_post_id, 'hidden', 'Hidden under child-safety report ' || p_report_id::text)
  RETURNING id INTO v_action_id;
  RETURN v_action_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_hide_child_safety_reported_post(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hide_child_safety_reported_post(uuid, uuid) TO service_role;

COMMIT;
