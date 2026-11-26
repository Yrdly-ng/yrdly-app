BEGIN;
CREATE TABLE IF NOT EXISTS private.account_visibility_snapshots (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 discoverable boolean NOT NULL,
 post_statuses jsonb NOT NULL DEFAULT '{}'::jsonb,
 comment_hidden jsonb NOT NULL DEFAULT '{}'::jsonb,
 captured_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.account_visibility_snapshots FROM PUBLIC,anon,authenticated,service_role;

DROP POLICY IF EXISTS public_profile_data_read ON public.public_profile_data;
CREATE POLICY public_profile_data_read ON public.public_profile_data FOR SELECT TO anon,authenticated
USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id=public_profile_data.id
 AND NOT coalesce(u.is_suspended,false) AND NOT coalesce(u.is_banned,false)
 AND coalesce(u.status,'') NOT IN ('suspended','banned')));

DROP POLICY IF EXISTS posts_visible ON public.posts;
CREATE POLICY posts_visible ON public.posts FOR SELECT TO anon,authenticated
USING ((SELECT public.audit_is_admin()) OR (
 EXISTS (SELECT 1 FROM public.users author WHERE author.id=posts.user_id
  AND NOT coalesce(author.is_suspended,false) AND NOT coalesce(author.is_banned,false)
  AND coalesce(author.status,'') NOT IN ('suspended','banned'))
 AND (user_id=(SELECT auth.uid()) OR (moderation_status='approved' AND (
  COALESCE(visibility,'public') ILIKE 'public' OR (visibility ILIKE 'friends'
  AND EXISTS (SELECT 1 FROM public.followers f WHERE f.follower_id=auth.uid() AND f.following_id=posts.user_id)
  AND EXISTS (SELECT 1 FROM public.followers f WHERE f.follower_id=posts.user_id AND f.following_id=auth.uid()))))
));

DROP POLICY IF EXISTS "Comments are readable by everyone" ON public.comments;
DROP POLICY IF EXISTS comments_moderation_visibility ON public.comments;
DROP POLICY IF EXISTS comments_moderation_visibility_anon ON public.comments;
CREATE POLICY comments_moderation_visibility ON public.comments FOR SELECT TO authenticated
USING ((SELECT public.audit_is_admin()) OR (NOT coalesce(moderation_hidden,false)
 AND EXISTS (SELECT 1 FROM public.users author WHERE author.id=comments.user_id
  AND NOT coalesce(author.is_suspended,false) AND NOT coalesce(author.is_banned,false)
  AND coalesce(author.status,'') NOT IN ('suspended','banned'))));
CREATE POLICY comments_moderation_visibility_anon ON public.comments FOR SELECT TO anon
USING (NOT coalesce(moderation_hidden,false) AND EXISTS (SELECT 1 FROM public.users author
 WHERE author.id=comments.user_id AND NOT coalesce(author.is_suspended,false)
 AND NOT coalesce(author.is_banned,false) AND coalesce(author.status,'') NOT IN ('suspended','banned')));

CREATE OR REPLACE FUNCTION public.admin_set_account_moderation(
 p_actor_user_id uuid,p_target_user_id uuid,p_action text,p_reason text,p_report_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_action_id uuid; v_was_restricted boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_actor_user_id=p_target_user_id THEN
  RAISE EXCEPTION 'A different actor and target account are required' USING ERRCODE='22023'; END IF;
 IF p_action NOT IN ('suspend','ban','unsuspend') THEN RAISE EXCEPTION 'Unsupported account action' USING ERRCODE='22023'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'A reason of 1 to 500 characters is required' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor_user_id AND (coalesce(is_admin,false) OR role='admin')) THEN
  RAISE EXCEPTION 'Admin privileges required' USING ERRCODE='42501'; END IF;
 IF p_report_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.reports WHERE id=p_report_id
  AND reported_user_id=p_target_user_id AND category='Child safety' AND status='open') THEN
  RAISE EXCEPTION 'Open child-safety report does not match target account' USING ERRCODE='22023'; END IF;
 SELECT (coalesce(is_suspended,false) OR coalesce(is_banned,false) OR status IN ('suspended','banned'))
 INTO v_was_restricted FROM public.users WHERE id=p_target_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Target account not found' USING ERRCODE='P0002'; END IF;
 IF p_action IN ('suspend','ban') THEN
  IF NOT v_was_restricted THEN
   INSERT INTO private.account_visibility_snapshots(user_id,discoverable,post_statuses,comment_hidden)
   SELECT p_target_user_id,coalesce(u.discoverable,true),
    coalesce((SELECT jsonb_object_agg(p.id::text,p.moderation_status) FROM public.posts p WHERE p.user_id=p_target_user_id),'{}'::jsonb),
    coalesce((SELECT jsonb_object_agg(c.id::text,coalesce(c.moderation_hidden,false)) FROM public.comments c WHERE c.user_id=p_target_user_id),'{}'::jsonb)
   FROM public.users u WHERE u.id=p_target_user_id ON CONFLICT(user_id) DO NOTHING;
  END IF;
  UPDATE public.users SET is_suspended=true,is_banned=(p_action='ban'),status=CASE WHEN p_action='ban' THEN 'banned' ELSE 'suspended' END,
   suspension_reason=btrim(p_reason),suspended_at=now(),discoverable=false WHERE id=p_target_user_id;
  UPDATE public.public_profile_data SET discoverable=false WHERE id=p_target_user_id;
  UPDATE public.posts SET moderation_status='rejected' WHERE user_id=p_target_user_id;
  UPDATE public.comments SET moderation_hidden=true WHERE user_id=p_target_user_id;
  DELETE FROM private.active_account_sessions WHERE user_id=p_target_user_id;
  DELETE FROM auth.sessions WHERE user_id=p_target_user_id;
 ELSE
  UPDATE public.users SET is_suspended=false,is_banned=false,status='active',suspension_reason=NULL,suspended_at=NULL WHERE id=p_target_user_id;
  UPDATE public.users u SET discoverable=s.discoverable FROM private.account_visibility_snapshots s WHERE u.id=p_target_user_id AND s.user_id=u.id;
  UPDATE public.public_profile_data pp SET discoverable=s.discoverable FROM private.account_visibility_snapshots s WHERE pp.id=p_target_user_id AND s.user_id=pp.id;
  UPDATE public.posts p SET moderation_status=s.post_statuses->>p.id::text FROM private.account_visibility_snapshots s
   WHERE p.user_id=p_target_user_id AND s.user_id=p_target_user_id AND s.post_statuses ? p.id::text;
  UPDATE public.comments c SET moderation_hidden=(s.comment_hidden->>c.id::text)::boolean FROM private.account_visibility_snapshots s
   WHERE c.user_id=p_target_user_id AND s.user_id=p_target_user_id AND s.comment_hidden ? c.id::text;
  DELETE FROM private.account_visibility_snapshots WHERE user_id=p_target_user_id;
 END IF;
 INSERT INTO public.account_moderation_actions(actor_user_id,target_user_id,action,reason,report_id)
 VALUES(p_actor_user_id,p_target_user_id,p_action,btrim(p_reason),p_report_id) RETURNING id INTO v_action_id;
 RETURN v_action_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_account_moderation(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_account_moderation(uuid,uuid,text,text,uuid) TO service_role;

-- Backfill already restricted accounts, preserving what can be restored on a future appeal.
INSERT INTO private.account_visibility_snapshots(user_id,discoverable,post_statuses,comment_hidden)
SELECT u.id,coalesce(u.discoverable,true),
 coalesce((SELECT jsonb_object_agg(p.id::text,p.moderation_status) FROM public.posts p WHERE p.user_id=u.id),'{}'::jsonb),
 coalesce((SELECT jsonb_object_agg(c.id::text,coalesce(c.moderation_hidden,false)) FROM public.comments c WHERE c.user_id=u.id),'{}'::jsonb)
FROM public.users u WHERE coalesce(u.is_suspended,false) OR coalesce(u.is_banned,false) OR u.status IN ('suspended','banned')
ON CONFLICT(user_id) DO NOTHING;
UPDATE public.users SET discoverable=false WHERE coalesce(is_suspended,false) OR coalesce(is_banned,false) OR status IN ('suspended','banned');
UPDATE public.public_profile_data pp SET discoverable=false FROM public.users u WHERE u.id=pp.id
 AND (coalesce(u.is_suspended,false) OR coalesce(u.is_banned,false) OR u.status IN ('suspended','banned'));
UPDATE public.posts p SET moderation_status='rejected' FROM public.users u WHERE u.id=p.user_id
 AND (coalesce(u.is_suspended,false) OR coalesce(u.is_banned,false) OR u.status IN ('suspended','banned'));
UPDATE public.comments c SET moderation_hidden=true FROM public.users u WHERE u.id=c.user_id
 AND (coalesce(u.is_suspended,false) OR coalesce(u.is_banned,false) OR u.status IN ('suspended','banned'));
DELETE FROM private.active_account_sessions a USING public.users u WHERE a.user_id=u.id
 AND (coalesce(u.is_suspended,false) OR coalesce(u.is_banned,false) OR u.status IN ('suspended','banned'));
DELETE FROM auth.sessions s USING public.users u WHERE s.user_id=u.id
 AND (coalesce(u.is_suspended,false) OR coalesce(u.is_banned,false) OR u.status IN ('suspended','banned'));
COMMIT;
NOTIFY pgrst,'reload schema';
