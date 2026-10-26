-- Apply account-level moderation at the same database gate used by RLS,
-- security-definer write guards, and authenticated server/Edge handlers.
-- The API already rejects suspended accounts; this also closes direct Data API
-- access through a previously issued but still-current session.
CREATE OR REPLACE FUNCTION public.is_current_session_active()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS (
   SELECT 1
   FROM private.active_account_sessions a
   JOIN auth.sessions s ON s.id = a.session_id AND s.user_id = a.user_id
   JOIN public.users u ON u.id = a.user_id
   WHERE a.user_id = auth.uid()
     AND a.session_id::text = auth.jwt()->>'session_id'
     AND (s.not_after IS NULL OR s.not_after > now())
     AND NOT coalesce(u.is_suspended, false)
     AND NOT coalesce(u.is_banned, false)
     AND coalesce(u.status, '') NOT IN ('suspended', 'banned')
 );
$function$;
