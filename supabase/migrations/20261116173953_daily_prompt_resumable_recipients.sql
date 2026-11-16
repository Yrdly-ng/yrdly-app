-- Select only remaining eligible recipients so retrying a bounded campaign
-- progresses beyond previously reserved users rather than rescanning page one.
CREATE OR REPLACE FUNCTION public.daily_prompt_reminder_candidates(
  p_prompt_id uuid, p_after uuid DEFAULT NULL,
  p_limit integer DEFAULT 50, p_testers uuid[] DEFAULT NULL
) RETURNS TABLE(id uuid, notification_settings jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.notification_settings
  FROM public.users u
  WHERE u.notification_settings @> '{"dailyPrompts":true}'::jsonb
    AND (p_after IS NULL OR u.id > p_after)
    AND (p_testers IS NULL OR u.id = ANY(p_testers))
    AND EXISTS (SELECT 1 FROM public.daily_prompts q
      WHERE q.id=p_prompt_id AND q.status='approved'
        AND q.prompt_date=(now() AT TIME ZONE 'Africa/Lagos')::date)
    AND NOT EXISTS (SELECT 1 FROM public.daily_prompt_reminders r
      WHERE r.prompt_id=p_prompt_id AND r.user_id=u.id)
    AND NOT EXISTS (SELECT 1 FROM public.posts p
      WHERE p.daily_prompt_id=p_prompt_id AND p.user_id=u.id)
    AND (EXISTS (SELECT 1 FROM public.user_push_tokens t WHERE t.user_id=u.id)
      OR EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id=u.id))
  ORDER BY u.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),100);
$$;
REVOKE ALL ON FUNCTION public.daily_prompt_reminder_candidates(uuid,uuid,integer,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_prompt_reminder_candidates(uuid,uuid,integer,uuid[]) TO service_role;
