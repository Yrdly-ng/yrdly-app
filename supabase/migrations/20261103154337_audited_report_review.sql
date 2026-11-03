BEGIN;
ALTER TABLE public.comment_reports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';
UPDATE public.comment_reports SET status='open' WHERE status IS NULL;
CREATE FUNCTION public.protect_comment_moderation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' AND ((TG_OP='INSERT' AND NEW.moderation_hidden) OR (TG_OP='UPDATE' AND NEW.moderation_hidden IS DISTINCT FROM OLD.moderation_hidden)) THEN RAISE EXCEPTION 'Staff action required' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;

ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS moderation_hidden boolean NOT NULL DEFAULT false;
CREATE TRIGGER protect_comment_moderation BEFORE INSERT OR UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.protect_comment_moderation();
CREATE POLICY comments_moderation_visibility ON public.comments AS RESTRICTIVE FOR SELECT TO authenticated
USING (NOT moderation_hidden OR EXISTS (SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND (u.is_admin OR u.role='admin')));
CREATE POLICY comments_moderation_visibility_anon ON public.comments AS RESTRICTIVE FOR SELECT TO anon USING (NOT moderation_hidden);
CREATE TABLE public.report_review_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_kind text NOT NULL CHECK(report_kind IN ('general','post','comment')),
 report_id uuid NOT NULL, actor_user_id uuid NOT NULL, action text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 500), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_review_actions_case_idx ON public.report_review_actions(report_kind,report_id,created_at);
ALTER TABLE public.report_review_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_review_actions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.report_review_actions TO service_role;
CREATE FUNCTION public.admin_review_report(p_actor uuid,p_kind text,p_id uuid,p_action text,p_reason text,p_expected_status text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tbl text; r jsonb; target_post uuid; target_comment uuid; target_user uuid; result_id uuid; next_status text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor AND (is_admin OR role='admin') AND NOT coalesce(is_suspended,false) AND NOT coalesce(is_banned,false)) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Explain the action in 5 to 500 characters' USING ERRCODE='22023'; END IF;
 tbl := CASE p_kind WHEN 'general' THEN 'reports' WHEN 'post' THEN 'post_reports' WHEN 'comment' THEN 'comment_reports' END;
 IF tbl IS NULL OR p_action NOT IN ('resolve','dismiss','reopen','hide','restore','suspend','ban','unsuspend') OR p_action IS NULL THEN RAISE EXCEPTION 'Invalid report action' USING ERRCODE='22023'; END IF;
 EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1 FOR UPDATE',tbl) INTO r USING p_id;
 IF r IS NULL THEN RAISE EXCEPTION 'Report not found' USING ERRCODE='P0002'; END IF;
 IF p_expected_status IS NULL OR r->>'status' IS DISTINCT FROM p_expected_status THEN RAISE EXCEPTION 'Report changed. Refresh before acting.' USING ERRCODE='40001'; END IF;
 target_post:=coalesce(r->>'reported_post_id',r->>'post_id')::uuid;
 target_comment:=(r->>'comment_id')::uuid;
 target_user:=(r->>'reported_user_id')::uuid;
 IF target_comment IS NOT NULL THEN SELECT user_id INTO target_user FROM public.comments WHERE id=target_comment; ELSIF target_user IS NULL AND target_post IS NOT NULL THEN SELECT user_id INTO target_user FROM public.posts WHERE id=target_post; END IF;
 IF p_action IN ('resolve','dismiss','reopen') THEN
  next_status:=CASE p_action WHEN 'resolve' THEN 'resolved' WHEN 'dismiss' THEN 'dismissed' ELSE 'open' END;
  IF (p_action='reopen' AND r->>'status'='open') OR (p_action IN ('resolve','dismiss') AND r->>'status'<>'open') THEN RAISE EXCEPTION 'Report already has that status' USING ERRCODE='22023'; END IF;
  EXECUTE format('UPDATE public.%I SET status=$1 WHERE id=$2',tbl) USING next_status,p_id;
 ELSIF p_action IN ('suspend','ban','unsuspend') THEN
  IF target_user IS NULL THEN RAISE EXCEPTION 'Reported account is unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM public.admin_set_account_moderation(p_actor,target_user,p_action,p_reason,NULL);
 ELSIF target_comment IS NOT NULL THEN
  UPDATE public.comments SET moderation_hidden=(p_action='hide') WHERE id=target_comment;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comment is unavailable' USING ERRCODE='P0002'; END IF;
 ELSIF target_post IS NOT NULL THEN
  UPDATE public.posts SET moderation_status=CASE WHEN p_action='hide' THEN 'rejected' ELSE 'approved' END WHERE id=target_post;
  IF NOT FOUND THEN RAISE EXCEPTION 'Post is unavailable' USING ERRCODE='P0002'; END IF;
 ELSE RAISE EXCEPTION 'No linked content' USING ERRCODE='22023'; END IF;
 INSERT INTO public.report_review_actions(report_kind,report_id,actor_user_id,action,reason) VALUES(p_kind,p_id,p_actor,p_action,btrim(p_reason)) RETURNING id INTO result_id;
 RETURN result_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_review_report(uuid,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_report(uuid,text,uuid,text,text,text) TO service_role;
COMMIT;
