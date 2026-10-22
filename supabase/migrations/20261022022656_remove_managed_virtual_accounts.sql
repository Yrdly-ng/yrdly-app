-- Remove the unused managed-account feature and only its registered identities.
-- Shared definitions below are restored from the pre-installation schema snapshot.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public, pg_catalog;

-- Serialize with job execution and prevent fresh activity during removal.
LOCK TABLE public.managed_virtual_config IN ACCESS EXCLUSIVE MODE;
UPDATE public.managed_virtual_config SET enabled=false, posting_enabled=false,
 commenting_enabled=false, liking_enabled=false, generation=generation+1;
LOCK TABLE public.managed_virtual_accounts IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE removal_managed_ids ON COMMIT DROP AS
 SELECT slot,user_id FROM public.managed_virtual_accounts;
ALTER TABLE removal_managed_ids ADD PRIMARY KEY(user_id);
SELECT 1 FROM public.users WHERE id IN (SELECT user_id FROM removal_managed_ids) FOR UPDATE;
SELECT 1 FROM auth.users WHERE id IN (SELECT user_id FROM removal_managed_ids) FOR UPDATE;

DO $guard$
DECLARE r record; referenced boolean; expected integer;
BEGIN
 SELECT count(*) INTO expected FROM removal_managed_ids;
 IF expected > 50 THEN RAISE EXCEPTION 'Unexpected managed identity count'; END IF;
 IF (SELECT count(*) FROM removal_managed_ids m JOIN public.users u ON u.id=m.user_id
   JOIN auth.users a ON a.id=m.user_id
   WHERE u.account_kind='managed_virtual' AND NOT coalesce(u.is_admin,false)
    AND a.raw_app_meta_data->>'account_kind'='managed_virtual'
    AND a.raw_app_meta_data->>'managed_virtual_slot'=m.slot::text
    AND a.email='yrdly-virtual-'||lpad(m.slot::text,2,'0')||'@virtual.yrdly.ng'
    AND a.banned_until>now()) <> expected THEN
  RAISE EXCEPTION 'Managed identity metadata mismatch; no accounts removed';
 END IF;
 IF EXISTS(SELECT 1 FROM public.users u WHERE u.account_kind='managed_virtual'
   AND NOT EXISTS(SELECT 1 FROM removal_managed_ids m WHERE m.user_id=u.id))
 OR EXISTS(SELECT 1 FROM auth.users a WHERE a.raw_app_meta_data->>'account_kind'='managed_virtual'
   AND NOT EXISTS(SELECT 1 FROM removal_managed_ids m WHERE m.user_id=a.id)) THEN
  RAISE EXCEPTION 'Unregistered managed identity requires explicit review';
 END IF;
 IF EXISTS(SELECT 1 FROM public.posts WHERE activity_origin<>'organic'
   OR synthetic_like_count<>0 OR synthetic_comment_count<>0)
 OR EXISTS(SELECT 1 FROM public.comments WHERE activity_origin<>'organic')
 OR EXISTS(SELECT 1 FROM public.managed_virtual_likes)
 OR EXISTS(SELECT 1 FROM public.managed_virtual_jobs WHERE status IN ('running','done')) THEN
  RAISE EXCEPTION 'Unexpected synthetic activity; removal aborted to protect content';
 END IF;
 -- Reject all dependencies except each identity's own Auth credentials and profile,
 -- and feature-owned drafts. This also prevents implicit FK cascades into real data.
 FOR r IN SELECT n.nspname,c.relname,a.attname FROM pg_constraint f
  JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=ANY(f.conkey)
  WHERE f.contype='f' AND f.confrelid IN ('public.users'::regclass,'auth.users'::regclass)
   AND NOT(n.nspname='public' AND c.relname IN ('users','managed_virtual_accounts','managed_virtual_drafts','managed_virtual_likes'))
   AND NOT(n.nspname='auth' AND c.relname='identities') LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I r JOIN pg_temp.removal_managed_ids m ON r.%I=m.user_id)',r.nspname,r.relname,r.attname) INTO referenced;
  IF referenced THEN RAISE EXCEPTION 'Managed identity referenced by %.% column %; removal aborted',r.nspname,r.relname,r.attname; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.users u JOIN removal_managed_ids m ON m.user_id=ANY(u.friends))
 OR EXISTS(SELECT 1 FROM public.posts p JOIN removal_managed_ids m ON m.user_id=ANY(p.liked_by)) THEN
  RAISE EXCEPTION 'Unexpected friendship or organic reaction dependency';
 END IF;
END $guard$;

DO $cron$
BEGIN
 IF to_regnamespace('cron') IS NOT NULL THEN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='process-managed-virtual-jobs';
 END IF;
END $cron$;

-- Only triggers installed by this feature are removed.
DO $triggers$
DECLARE r record;
BEGIN
 FOR r IN SELECT n.nspname,c.relname,t.tgname FROM pg_trigger t
 JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND t.tgfoid IN (
  'private.guard_managed_identity()'::regprocedure,
  'private.guard_managed_feed()'::regprocedure,
  'private.guard_managed_like()'::regprocedure,
  'private.sync_managed_likes()'::regprocedure,
  'private.guard_managed_unrelated()'::regprocedure,
  'private.suppress_managed_notifications()'::regprocedure
 ) LOOP
  EXECUTE format('DROP TRIGGER %I ON %I.%I',r.tgname,r.nspname,r.relname);
 END LOOP;
END $triggers$;

-- The original shared function, trigger and view definitions follow.
CREATE OR REPLACE FUNCTION public.is_current_session_active()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS (
   SELECT 1 FROM private.active_account_sessions a JOIN auth.sessions s ON s.id=a.session_id AND s.user_id=a.user_id
   WHERE a.user_id=auth.uid() AND a.session_id::text=auth.jwt()->>'session_id'
     AND (s.not_after IS NULL OR s.not_after > now())
 );
$function$
;
CREATE OR REPLACE FUNCTION public.tr_update_post_comment_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  target_post_id UUID;
  actual_count INT;
BEGIN
  target_post_id := COALESCE(NEW.post_id, OLD.post_id);
  IF target_post_id IS NOT NULL THEN
    SELECT COUNT(*) INTO actual_count FROM public.comments WHERE post_id = target_post_id;
    UPDATE public.posts SET comment_count = actual_count WHERE id = target_post_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;
DROP TRIGGER tr_auto_join_ward_community ON public.users;
CREATE TRIGGER tr_auto_join_ward_community AFTER INSERT OR UPDATE OF home_ward, home_lga, home_state ON public.users FOR EACH ROW EXECUTE FUNCTION fn_auto_join_ward_community();
DROP TRIGGER tr_update_post_comment_count ON public.comments;
CREATE TRIGGER tr_update_post_comment_count AFTER INSERT OR DELETE OR UPDATE OF post_id ON public.comments FOR EACH ROW EXECUTE FUNCTION tr_update_post_comment_count();
DROP VIEW public.public_profiles;
CREATE VIEW public.public_profiles WITH (security_invoker=false) AS
 SELECT id,
    name,
    username,
    avatar_url,
    bio,
    interests,
    created_at,
    updated_at,
    home_state,
    home_lga,
    verified_seller,
    phone_verified,
    rating,
    review_count,
    discoverable,
    is_online,
    last_seen,
    jsonb_build_object('state', home_state, 'lga', home_lga) AS location,
    COALESCE(cardinality(friends), 0) AS friend_count
   FROM users;
REVOKE ALL ON public.public_profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.public_profiles TO anon,authenticated,service_role;

DROP FUNCTION public.managed_virtual_admin(text,jsonb);
DROP FUNCTION public.managed_virtual_register(integer,uuid,jsonb);
DROP FUNCTION public.claim_managed_virtual_jobs(integer);
DROP FUNCTION public.execute_managed_virtual_job(uuid,uuid);
DROP FUNCTION private.guard_managed_identity();
DROP FUNCTION private.guard_managed_feed();
DROP FUNCTION private.guard_managed_like();
DROP FUNCTION private.sync_managed_likes();
DROP FUNCTION private.guard_managed_unrelated();
DROP FUNCTION private.suppress_managed_notifications();
DROP FUNCTION private.managed_virtual_permitted(uuid,text,uuid);
DROP FUNCTION private.is_managed_virtual(uuid);
DROP FUNCTION private.managed_text_words(text);
DROP TABLE public.managed_virtual_jobs;
DROP TABLE public.managed_virtual_drafts;
DROP TABLE public.managed_virtual_likes;
DROP TABLE public.managed_virtual_audit;
DROP TABLE public.managed_virtual_accounts;
DROP TABLE public.managed_virtual_config;
DROP TABLE private.managed_virtual_permits;

-- Profiles and Auth identities have passed the metadata and dependency checks above.
DELETE FROM public.users WHERE id IN (SELECT user_id FROM removal_managed_ids);
DELETE FROM auth.users WHERE id IN (SELECT user_id FROM removal_managed_ids);
DO $deleted$
BEGIN
 IF EXISTS(SELECT 1 FROM public.users WHERE id IN (SELECT user_id FROM removal_managed_ids))
 OR EXISTS(SELECT 1 FROM auth.users WHERE id IN (SELECT user_id FROM removal_managed_ids)) THEN
  RAISE EXCEPTION 'Managed identity deletion incomplete';
 END IF;
END $deleted$;
ALTER TABLE public.users DROP COLUMN account_kind;
ALTER TABLE public.posts DROP COLUMN activity_origin,
 DROP COLUMN synthetic_like_count, DROP COLUMN synthetic_comment_count;
ALTER TABLE public.comments DROP COLUMN activity_origin;
NOTIFY pgrst,'reload schema';
COMMIT;
