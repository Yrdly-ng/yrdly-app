BEGIN;

-- The original invitation table was provisioned outside the checked-in history.
CREATE TABLE IF NOT EXISTS public.community_invites(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
 invited_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,invited_by uuid NOT NULL REFERENCES public.users(id),
 status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now(),responded_at timestamptz,UNIQUE(community_id,invited_user_id)
);
ALTER TABLE public.community_invites ENABLE ROW LEVEL SECURITY;

-- Mutation privileges are confined to checked, atomic community commands.
-- SELECT remains protected by the existing membership/session policies.
REVOKE INSERT, UPDATE, DELETE ON public.community_memberships,
  public.community_invites, public.community_join_requests FROM PUBLIC, anon, authenticated;

ALTER TABLE public.communities ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
UPDATE public.communities c SET owner_id = c.created_by
WHERE c.type = 'interest' AND c.approval_status = 'approved' AND c.owner_id IS NULL
AND EXISTS (SELECT 1 FROM public.community_memberships m WHERE m.community_id=c.id AND m.user_id=c.created_by AND m.status='active' AND m.role='admin');

ALTER TABLE public.community_memberships DROP CONSTRAINT IF EXISTS community_memberships_status_check;
ALTER TABLE public.community_memberships ADD CONSTRAINT community_memberships_status_check CHECK(status IN ('active','pending','banned','left'));
ALTER TABLE public.community_join_requests DROP CONSTRAINT IF EXISTS community_join_requests_status_check;
ALTER TABLE public.community_join_requests ADD CONSTRAINT community_join_requests_status_check CHECK(status IN ('pending','approved','rejected','withdrawn'));
ALTER TABLE public.community_invites DROP CONSTRAINT IF EXISTS community_invites_status_check;
ALTER TABLE public.community_invites ADD CONSTRAINT community_invites_status_check CHECK(status IN ('pending','accepted','declined','revoked','expired'));
ALTER TABLE public.community_invites ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days';

CREATE TABLE public.community_ownership_transfers(
  community_id uuid PRIMARY KEY REFERENCES public.communities(id) ON DELETE CASCADE,
  offered_by uuid NOT NULL REFERENCES public.users(id),
  recipient_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_ownership_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_ownership_transfers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.community_ownership_transfers TO authenticated;
CREATE POLICY ownership_visible ON public.community_ownership_transfers FOR SELECT TO authenticated
  USING(public.is_current_session_active() AND (offered_by=auth.uid() OR recipient_id=auth.uid()));

CREATE OR REPLACE FUNCTION private.community_has_invite(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.is_current_session_active() AND EXISTS(SELECT 1 FROM public.community_invites WHERE community_id=cid AND invited_user_id=auth.uid() AND status='pending' AND expires_at>now());
$$;
REVOKE ALL ON FUNCTION private.community_has_invite(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.community_has_invite(uuid) TO authenticated;
DROP POLICY IF EXISTS communities_select ON public.communities;
CREATE POLICY communities_select ON public.communities FOR SELECT TO authenticated USING(
  public.is_current_session_active() AND (
    (approval_status='approved' AND (privacy IN ('open','request') OR private.community_has_invite(id)
      OR EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=communities.id AND user_id=auth.uid() AND status='active')))
    OR created_by=auth.uid() OR EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND (is_admin OR role IN ('admin','moderator')))
  )
);
DROP POLICY IF EXISTS invites_select_visible ON public.community_invites;
CREATE POLICY invites_select_visible ON public.community_invites FOR SELECT TO authenticated USING(
  public.is_current_session_active() AND (invited_user_id=auth.uid() OR invited_by=auth.uid() OR public.is_community_mod_or_admin(community_id,auth.uid()))
);
GRANT SELECT ON public.community_invites TO authenticated;

CREATE OR REPLACE FUNCTION private.community_role(cid uuid, uid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN NOT public.is_current_session_active() OR uid IS DISTINCT FROM auth.uid() THEN NULL
    WHEN EXISTS(SELECT 1 FROM public.users WHERE id=uid AND (is_admin OR role IN ('admin','moderator'))) THEN 'staff'
    WHEN EXISTS(SELECT 1 FROM public.communities WHERE id=cid AND owner_id=uid AND approval_status='approved') THEN 'owner'
    ELSE (SELECT role FROM public.community_memberships WHERE community_id=cid AND user_id=uid AND status='active') END;
$$;
REVOKE ALL ON FUNCTION private.community_role(uuid,uuid) FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.community_role(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_community_mod_or_admin(p_community_id uuid,p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(private.community_role(p_community_id,p_user_id) IN ('staff','owner','admin','moderator'),false);
$$;

CREATE TABLE public.community_content_reviews(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('post','comment')), target_id uuid NOT NULL, author_id uuid NOT NULL REFERENCES public.users(id),
  content text NOT NULL, image_urls text[] NOT NULL DEFAULT '{}', video_urls text[] NOT NULL DEFAULT '{}',
  mentioned_user_ids uuid[] NOT NULL DEFAULT '{}', is_announcement boolean NOT NULL DEFAULT false,
  is_revision boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','superseded')),
  reason text, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, reviewed_by uuid
);
CREATE INDEX community_reviews_pending ON public.community_content_reviews(community_id,created_at) WHERE status='pending';
ALTER TABLE public.community_content_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_content_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.community_content_reviews TO authenticated;
CREATE POLICY reviews_visible ON public.community_content_reviews FOR SELECT TO authenticated USING(
  public.is_current_session_active() AND (author_id=auth.uid() OR public.is_community_mod_or_admin(community_id,auth.uid())));

CREATE TABLE public.community_reports(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.users(id), target_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('post','comment')),
  reason text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reporter_id,target_id,kind)
);
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_reports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.community_reports TO authenticated;
CREATE POLICY reports_visible ON public.community_reports FOR SELECT TO authenticated USING(
  public.is_current_session_active() AND (reporter_id=auth.uid() OR public.is_community_mod_or_admin(community_id,auth.uid())));

CREATE TABLE public.community_jobs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('moderation','notification')),payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','done','failed')),attempt_count int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),claimed_at timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_jobs_due ON public.community_jobs(next_attempt_at) WHERE status IN ('queued','processing');
ALTER TABLE public.community_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.community_jobs,public.community_content_reviews,public.community_reports,public.community_ownership_transfers TO service_role;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS is_announcement boolean NOT NULL DEFAULT false;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS mentioned_user_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.community_comments ADD COLUMN IF NOT EXISTS mentioned_user_ids uuid[] NOT NULL DEFAULT '{}';
REVOKE INSERT,UPDATE,DELETE ON public.community_posts,public.community_comments FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.community_notify(cid uuid,recipient uuid,event text,body text,post_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF recipient IS NULL OR recipient=auth.uid() THEN RETURN; END IF;
 INSERT INTO public.community_jobs(community_id,kind,payload) VALUES(cid,'notification',jsonb_build_object(
   'userId',recipient,'senderId',auth.uid(),'event',event,'message',body,'postId',post_id));
END; $$;
REVOKE ALL ON FUNCTION private.community_notify(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.resolve_community_content(rid uuid,decision text,p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.community_content_reviews; recipient uuid; parent_author uuid; was_published boolean; cid uuid;
BEGIN
 IF decision NOT IN ('approved','rejected') OR decision IS NULL THEN RAISE EXCEPTION 'Invalid decision'; END IF;
 SELECT community_id INTO cid FROM public.community_content_reviews WHERE id=rid;
 PERFORM 1 FROM public.communities WHERE id=cid FOR UPDATE;
 SELECT * INTO r FROM public.community_content_reviews WHERE id=rid FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communities WHERE id=r.community_id AND approval_status='approved') THEN RAISE EXCEPTION 'Community unavailable'; END IF;
 IF r.kind='post' THEN
   SELECT moderation_status='approved' INTO was_published FROM public.community_posts WHERE id=r.target_id AND community_id=r.community_id FOR UPDATE;
 ELSE
   SELECT moderation_status='approved' INTO was_published FROM public.community_comments WHERE id=r.target_id AND community_id=r.community_id FOR UPDATE;
 END IF;
 IF NOT FOUND THEN UPDATE public.community_content_reviews SET status='superseded' WHERE id=rid; RETURN; END IF;
 IF decision='approved' AND NOT EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=r.community_id AND user_id=r.author_id AND status='active') THEN RAISE EXCEPTION 'Author is no longer an active member'; END IF;
 IF decision='approved' AND r.kind='post' THEN
   UPDATE public.community_posts SET content=r.content,image_urls=r.image_urls,video_urls=r.video_urls,moderation_status='approved',is_edited=r.is_revision,
     is_announcement=r.is_announcement,mentioned_user_ids=r.mentioned_user_ids,updated_at=now() WHERE id=r.target_id;
 ELSIF decision='approved' THEN
   UPDATE public.community_comments SET content=r.content,moderation_status='approved',mentioned_user_ids=r.mentioned_user_ids,updated_at=now() WHERE id=r.target_id;
 ELSIF NOT r.is_revision THEN
   IF r.kind='post' THEN UPDATE public.community_posts SET moderation_status='rejected' WHERE id=r.target_id;
   ELSE UPDATE public.community_comments SET moderation_status='rejected' WHERE id=r.target_id; END IF;
 END IF;
 UPDATE public.community_content_reviews SET status=decision,reason=left(p_reason,500),reviewed_at=now(),reviewed_by=auth.uid() WHERE id=rid;
 UPDATE public.moderation_queue SET status=decision WHERE content_id=r.target_id AND table_name=CASE r.kind WHEN 'post' THEN 'community_posts' ELSE 'community_comments' END AND status='pending';
 PERFORM private.community_notify(r.community_id,r.author_id,'content_'||decision,'Your community '||r.kind||' was '||decision,CASE WHEN r.kind='post' THEN r.target_id ELSE (SELECT post_id FROM public.community_comments WHERE id=r.target_id) END);
 IF decision='approved' AND NOT r.is_revision THEN
   IF r.kind='comment' THEN
     SELECT p.author_id,p.id INTO parent_author,recipient FROM public.community_comments cm JOIN public.community_posts p ON p.id=cm.post_id WHERE cm.id=r.target_id;
     IF parent_author<>r.author_id THEN PERFORM private.community_notify(r.community_id,parent_author,'reply','New reply to your community post',recipient); END IF;
   END IF;
   FOR recipient IN SELECT m.user_id FROM public.community_memberships m WHERE m.community_id=r.community_id AND m.status='active' AND m.user_id<>r.author_id
     AND ((r.is_announcement AND r.kind='post') OR m.user_id=ANY(r.mentioned_user_ids)) LOOP
     PERFORM private.community_notify(r.community_id,recipient,CASE WHEN r.is_announcement THEN 'announcement' ELSE 'mention' END,
       CASE WHEN r.is_announcement THEN 'New community announcement' ELSE 'You were mentioned in a community post or reply' END,
       CASE WHEN r.kind='post' THEN r.target_id ELSE (SELECT post_id FROM public.community_comments WHERE id=r.target_id) END);
   END LOOP;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION private.resolve_community_content(uuid,text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.community_review_content(p_review_id uuid,p_decision text,p_reason text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.resolve_community_content(p_review_id,p_decision,p_reason) $$;
REVOKE ALL ON FUNCTION public.community_review_content(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.community_review_content(uuid,text,text),private.resolve_community_content(uuid,text,text) TO service_role;
GRANT USAGE ON SCHEMA private TO service_role;

-- Existing update guard assumes browser writes and rejects legitimate self-leave.
-- All membership mutations now pass through community_action instead.
DROP TRIGGER IF EXISTS tr_guard_community_membership_update ON public.community_memberships;

CREATE OR REPLACE FUNCTION private.run_community_action(cid uuid, action text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor uuid := auth.uid();
  c public.communities;
  mine public.community_memberships;
  target public.community_memberships;
  request public.community_join_requests;
  actor_role text;
  target_user uuid := nullif(input->>'userId','')::uuid;
  next_role text := input->>'role';
  invitation public.community_invites;
  transfer public.community_ownership_transfers;
  review public.community_content_reviews;
  target_post public.community_posts;
  target_comment public.community_comments;
  content_id uuid;
  content_kind text;
  text_value text := btrim(coalesce(input->>'content',''));
  image_values text[];
  video_values text[];
  mentions uuid[];
  announcement boolean := coalesce((input->>'announcement')::boolean,false);
  recipient uuid;
BEGIN
  IF actor IS NULL OR NOT public.is_current_session_active() THEN RAISE EXCEPTION 'Please sign in again' USING ERRCODE='28000'; END IF;
  SELECT * INTO c FROM public.communities WHERE id=cid AND approval_status='approved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Community is unavailable'; END IF;
  SELECT * INTO mine FROM public.community_memberships WHERE community_id=cid AND user_id=actor;
  actor_role := private.community_role(cid,actor);
  IF action IN ('join','request','leave','accept_invite') AND mine.status='banned' THEN RAISE EXCEPTION 'You are banned from this community'; END IF;

  IF action='join' THEN
    IF c.privacy<>'open' THEN RAISE EXCEPTION 'Membership requires approval or an invitation'; END IF;
    INSERT INTO public.community_memberships(community_id,user_id,role,status,is_auto_joined)
      VALUES(cid,actor,'member','active',false)
      ON CONFLICT(community_id,user_id) DO UPDATE SET status='active',role='member',updated_at=now()
      WHERE community_memberships.status<>'active';
  ELSIF action='leave' THEN
    IF c.owner_id=actor THEN RAISE EXCEPTION 'Transfer ownership before leaving'; END IF;
    UPDATE public.community_memberships SET status='left',role='member',updated_at=now() WHERE community_id=cid AND user_id=actor AND status='active';
  ELSIF action='mute' THEN
    IF mine.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Join this community first'; END IF;
    UPDATE public.community_memberships SET is_muted=coalesce((input->>'muted')::boolean,false),muted_at=CASE WHEN (input->>'muted')::boolean THEN now() END,updated_at=now() WHERE community_id=cid AND user_id=actor;
  ELSIF action='request' THEN
    IF c.privacy<>'request' THEN RAISE EXCEPTION 'This community does not accept join requests'; END IF;
    IF mine.status='active' THEN RAISE EXCEPTION 'You are already a member'; END IF;
    SELECT * INTO request FROM public.community_join_requests WHERE community_id=cid AND user_id=actor;
    IF request.status='pending' THEN RETURN jsonb_build_object('status','pending'); END IF;
    IF request.status='rejected' AND request.reviewed_at>now()-interval '7 days' THEN RAISE EXCEPTION 'You can reapply seven days after rejection'; END IF;
    INSERT INTO public.community_join_requests(community_id,user_id,status,message)
      VALUES(cid,actor,'pending',left(input->>'message',500))
      ON CONFLICT(community_id,user_id) DO UPDATE SET status='pending',message=excluded.message,created_at=now(),reviewed_at=NULL,reviewed_by=NULL;
  ELSIF action='withdraw' THEN
    UPDATE public.community_join_requests SET status='withdrawn' WHERE community_id=cid AND user_id=actor AND status='pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'No pending request'; END IF;
  ELSIF action='review_request' THEN
    IF actor_role IS NULL OR actor_role NOT IN ('staff','owner','admin','moderator') THEN RAISE EXCEPTION 'Not authorized'; END IF;
    IF input->>'decision' NOT IN ('approved','rejected') OR input->>'decision' IS NULL THEN RAISE EXCEPTION 'Invalid decision'; END IF;
    SELECT * INTO target FROM public.community_memberships WHERE community_id=cid AND user_id=target_user;
    IF target.status='banned' THEN RAISE EXCEPTION 'Lift the ban before approving membership'; END IF;
    UPDATE public.community_join_requests SET status=input->>'decision',reviewed_by=actor,reviewed_at=now() WHERE community_id=cid AND user_id=target_user AND status='pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'No pending request'; END IF;
    IF input->>'decision'='approved' THEN
      INSERT INTO public.community_memberships(community_id,user_id,role,status,is_auto_joined) VALUES(cid,target_user,'member','active',false)
        ON CONFLICT(community_id,user_id) DO UPDATE SET status='active',role='member',updated_at=now();
    END IF;
  ELSIF action='invite' THEN
    IF actor_role IS NULL OR actor_role NOT IN ('staff','owner','admin','moderator') THEN RAISE EXCEPTION 'Not authorized'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.followers WHERE follower_id=actor AND following_id=target_user)
      OR NOT EXISTS(SELECT 1 FROM public.followers WHERE follower_id=target_user AND following_id=actor)
      OR EXISTS(SELECT 1 FROM public.users WHERE (id=actor AND target_user=ANY(blocked_users)) OR (id=target_user AND actor=ANY(blocked_users))) THEN
      RAISE EXCEPTION 'Invitations require unblocked mutual friends';
    END IF;
    IF EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=cid AND user_id=target_user AND status IN ('active','banned')) THEN RAISE EXCEPTION 'This user is already a member or banned'; END IF;
    INSERT INTO public.community_invites(community_id,invited_user_id,invited_by,status,expires_at) VALUES(cid,target_user,actor,'pending',now()+interval '7 days')
      ON CONFLICT(community_id,invited_user_id) DO UPDATE SET invited_by=actor,status='pending',expires_at=excluded.expires_at,created_at=now(),responded_at=NULL;
  ELSIF action IN ('accept_invite','decline_invite','revoke_invite') THEN
    IF action='revoke_invite' THEN
      IF actor_role IS NULL OR actor_role NOT IN ('staff','owner','admin','moderator') THEN RAISE EXCEPTION 'Not authorized'; END IF;
    ELSE target_user:=actor; END IF;
    SELECT * INTO invitation FROM public.community_invites WHERE community_id=cid AND invited_user_id=target_user AND status='pending' FOR UPDATE;
    IF NOT FOUND OR invitation.expires_at<=now() THEN RAISE EXCEPTION 'No valid pending invitation'; END IF;
    IF action='accept_invite' THEN
      IF EXISTS(SELECT 1 FROM public.users WHERE (id=actor AND invitation.invited_by=ANY(blocked_users)) OR (id=invitation.invited_by AND actor=ANY(blocked_users))) THEN RAISE EXCEPTION 'Invitation is unavailable'; END IF;
      INSERT INTO public.community_memberships(community_id,user_id,role,status,is_auto_joined) VALUES(cid,actor,'member','active',false)
        ON CONFLICT(community_id,user_id) DO UPDATE SET status='active',role='member',updated_at=now() WHERE community_memberships.status<>'active';
    END IF;
    UPDATE public.community_invites SET status=CASE action WHEN 'accept_invite' THEN 'accepted' WHEN 'decline_invite' THEN 'declined' ELSE 'revoked' END,responded_at=now() WHERE id=invitation.id;
  ELSIF action IN ('offer_ownership','accept_ownership','decline_ownership','cancel_ownership','staff_recover') THEN
    IF c.type<>'interest' THEN RAISE EXCEPTION 'Official location communities remain under staff oversight'; END IF;
    IF action='offer_ownership' THEN
      IF actor_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Only the owner may transfer ownership'; END IF;
      IF target_user=actor OR NOT EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=cid AND user_id=target_user AND status='active') THEN RAISE EXCEPTION 'Choose another active member'; END IF;
      INSERT INTO public.community_ownership_transfers(community_id,offered_by,recipient_id) VALUES(cid,actor,target_user)
        ON CONFLICT(community_id) DO UPDATE SET offered_by=actor,recipient_id=target_user,created_at=now();
    ELSIF action='staff_recover' THEN
      IF actor_role IS DISTINCT FROM 'staff' THEN RAISE EXCEPTION 'Staff only'; END IF;
      IF c.owner_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=cid AND user_id=c.owner_id AND status='active') THEN RAISE EXCEPTION 'Community already has an active owner'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=cid AND user_id=target_user AND status='active') THEN RAISE EXCEPTION 'Choose an active member'; END IF;
      UPDATE public.communities SET owner_id=target_user,updated_at=now() WHERE id=cid;
      UPDATE public.community_memberships SET role='admin' WHERE community_id=cid AND user_id=target_user;
    ELSE
      SELECT * INTO transfer FROM public.community_ownership_transfers WHERE community_id=cid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'No ownership offer'; END IF;
      IF action='cancel_ownership' THEN
        IF actor IS DISTINCT FROM c.owner_id THEN RAISE EXCEPTION 'Only the owner may cancel'; END IF;
      ELSE
        IF transfer.recipient_id<>actor OR transfer.offered_by IS DISTINCT FROM c.owner_id OR mine.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Ownership offer is unavailable'; END IF;
        IF action='accept_ownership' THEN
          UPDATE public.communities SET owner_id=actor,updated_at=now() WHERE id=cid;
          UPDATE public.community_memberships SET role='admin',updated_at=now() WHERE community_id=cid AND user_id=actor;
        END IF;
      END IF;
      DELETE FROM public.community_ownership_transfers WHERE community_id=cid;
    END IF;
  ELSIF action='settings' THEN
    IF actor_role IS NULL OR actor_role NOT IN ('staff','owner','admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
    IF c.is_official AND actor_role<>'staff' THEN RAISE EXCEPTION 'Staff manage official community settings'; END IF;
    IF char_length(btrim(input->>'name')) NOT BETWEEN 3 AND 60 OR char_length(coalesce(input->>'description',''))>500
      OR input->>'privacy' NOT IN ('open','request','invite') OR input->>'privacy' IS NULL
      OR jsonb_typeof(input->'rules') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Check community name, description, privacy and rules'; END IF;
    IF jsonb_array_length(input->'rules')>10 OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'rules') r WHERE jsonb_typeof(r)<>'string' OR char_length(r#>>'{}')>500) THEN RAISE EXCEPTION 'Use up to 10 rules of 500 characters'; END IF;
    UPDATE public.communities SET name=btrim(input->>'name'),description=btrim(input->>'description'),privacy=input->>'privacy',rules=input->'rules',
      avatar_url=coalesce(input->>'avatarUrl',avatar_url),banner_url=coalesce(input->>'bannerUrl',banner_url),updated_at=now() WHERE id=cid;
  ELSIF action IN ('role','ban','unban','remove') THEN
    IF target_user IS NULL OR target_user=actor OR target_user=c.owner_id THEN RAISE EXCEPTION 'Cannot change your own or the owner membership'; END IF;
    SELECT * INTO target FROM public.community_memberships WHERE community_id=cid AND user_id=target_user;
    IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
    IF actor_role IS NULL OR actor_role NOT IN ('staff','owner','admin','moderator') THEN RAISE EXCEPTION 'Not authorized'; END IF;
    IF actor_role='moderator' AND (target.role<>'member' OR action='role') THEN RAISE EXCEPTION 'Moderators may manage ordinary members only'; END IF;
    IF actor_role='admin' AND (target.role='admin' OR (action='role' AND next_role='admin')) THEN RAISE EXCEPTION 'Only the owner may manage admins'; END IF;
    IF action='unban' AND target.status<>'banned' THEN RAISE EXCEPTION 'This member is not banned'; END IF;
    IF action='role' THEN
      IF next_role IS NULL OR next_role NOT IN ('member','moderator','admin') OR target.status<>'active' THEN RAISE EXCEPTION 'Invalid role or inactive member'; END IF;
      UPDATE public.community_memberships SET role=next_role,updated_at=now() WHERE id=target.id;
    ELSE
      UPDATE public.community_memberships SET status=CASE action WHEN 'ban' THEN 'banned' ELSE 'left' END,role='member',updated_at=now() WHERE id=target.id;
    END IF;
  ELSIF action IN ('submit_post','submit_comment','edit_post','edit_comment') THEN
    IF mine.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Join this community before posting'; END IF;
    content_kind:=CASE WHEN action IN ('submit_post','edit_post') THEN 'post' ELSE 'comment' END;
    IF char_length(text_value)>(CASE WHEN content_kind='post' THEN 1000 ELSE 500 END) THEN RAISE EXCEPTION 'Your message is too long'; END IF;
    SELECT coalesce(array_agg(v),'{}') INTO image_values FROM jsonb_array_elements_text(coalesce(input->'imageUrls','[]')) v;
    SELECT coalesce(array_agg(v),'{}') INTO video_values FROM jsonb_array_elements_text(coalesce(input->'videoUrls','[]')) v;
    SELECT coalesce(array_agg(v::uuid),'{}') INTO mentions FROM jsonb_array_elements_text(coalesce(input->'mentions','[]')) v;
    IF char_length(text_value)=0 AND cardinality(image_values)+cardinality(video_values)=0 THEN RAISE EXCEPTION 'Write a message or add media'; END IF;
    IF cardinality(image_values)>10 OR cardinality(video_values)>3 OR cardinality(mentions)>20 THEN RAISE EXCEPTION 'Too many attachments or mentions'; END IF;
    IF content_kind='comment' AND cardinality(image_values)+cardinality(video_values)>0 THEN RAISE EXCEPTION 'Replies support text only'; END IF;
    IF announcement AND actor_role NOT IN ('staff','owner','admin') THEN RAISE EXCEPTION 'Only owners and admins may announce'; END IF;
    IF action='edit_post' THEN
      SELECT * INTO target_post FROM public.community_posts WHERE id=(input->>'postId')::uuid AND community_id=cid AND author_id=actor FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Post unavailable or not yours'; END IF;
    END IF;
    IF EXISTS(SELECT 1 FROM unnest(image_values||video_values) v WHERE NOT (
      (v LIKE 'storage://community-media/'||cid::text||'/'||actor::text||'/%'
       AND v NOT LIKE '%..%' AND v NOT LIKE '%\\%'
       AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='community-media' AND o.name=substring(v FROM length('storage://community-media/')+1)))
      OR (action='edit_post' AND v LIKE 'https://%' AND v=ANY(coalesce(target_post.image_urls,'{}')||coalesce(target_post.video_urls,'{}')))
    )) THEN RAISE EXCEPTION 'Use community media uploaded by your account'; END IF;
    IF EXISTS(
      SELECT 1 FROM (
        SELECT v AS reference,'image/'::text AS mime_prefix,10485760::numeric AS max_size FROM unnest(image_values) v
        UNION ALL SELECT v,'video/',41943040::numeric FROM unnest(video_values) v
      ) attachment
      JOIN storage.objects o ON o.bucket_id='community-media' AND o.name=substring(attachment.reference FROM length('storage://community-media/')+1)
      WHERE attachment.reference LIKE 'storage://community-media/%' AND (
        coalesce(o.metadata->>'mimetype','') NOT LIKE attachment.mime_prefix||'%'
        OR CASE WHEN coalesce(o.metadata->>'size','') ~ '^[0-9]+$' THEN (o.metadata->>'size')::numeric NOT BETWEEN 1 AND attachment.max_size ELSE true END
      )
    ) THEN RAISE EXCEPTION 'Attachments exceed community media limits or have the wrong media type'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(mentions) uid WHERE NOT EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=cid AND user_id=uid AND status='active')) THEN RAISE EXCEPTION 'Mention active community members only'; END IF;
    IF action='submit_post' THEN
      INSERT INTO public.community_posts(community_id,author_id,author_name,author_image,content,image_urls,video_urls,moderation_status)
        SELECT cid,actor,u.name,u.avatar_url,text_value,image_values,video_values,'pending' FROM public.users u WHERE u.id=actor RETURNING id INTO content_id;
    ELSIF action='submit_comment' THEN
      IF NOT EXISTS(SELECT 1 FROM public.community_posts WHERE id=(input->>'postId')::uuid AND community_id=cid AND moderation_status='approved') THEN RAISE EXCEPTION 'Post is no longer available'; END IF;
      INSERT INTO public.community_comments(community_id,post_id,author_id,author_name,author_image,content,moderation_status)
        SELECT cid,(input->>'postId')::uuid,actor,u.name,u.avatar_url,text_value,'pending' FROM public.users u WHERE u.id=actor RETURNING id INTO content_id;
    ELSIF action='edit_post' THEN
      SELECT * INTO target_post FROM public.community_posts WHERE id=(input->>'postId')::uuid AND community_id=cid AND author_id=actor FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Post unavailable or not yours'; END IF;
      content_id:=target_post.id;
    ELSE
      SELECT * INTO target_comment FROM public.community_comments WHERE id=(input->>'commentId')::uuid AND community_id=cid AND author_id=actor FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Reply unavailable or not yours'; END IF;
      content_id:=target_comment.id;
    END IF;
    UPDATE public.community_content_reviews SET status='superseded' WHERE target_id=content_id AND status='pending';
    INSERT INTO public.community_content_reviews(community_id,kind,target_id,author_id,content,image_urls,video_urls,mentioned_user_ids,is_announcement,is_revision)
      VALUES(cid,content_kind,content_id,actor,text_value,image_values,video_values,mentions,announcement,action LIKE 'edit_%') RETURNING * INTO review;
    INSERT INTO public.community_jobs(community_id,kind,payload) VALUES(cid,'moderation',jsonb_build_object('reviewId',review.id));
    RETURN jsonb_build_object('id',content_id,'reviewId',review.id,'moderation_status','pending');
  ELSIF action='review_content' THEN
    IF actor_role IS NULL OR actor_role NOT IN ('staff','owner','admin','moderator') THEN RAISE EXCEPTION 'Not authorized'; END IF;
    SELECT * INTO review FROM public.community_content_reviews WHERE id=(input->>'reviewId')::uuid AND community_id=cid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;
    PERFORM private.resolve_community_content(review.id,input->>'decision',input->>'reason');
  ELSIF action IN ('delete_post','delete_comment','pin','report') THEN
    content_kind:=CASE WHEN action='delete_comment' OR input->>'kind'='comment' THEN 'comment' ELSE 'post' END;
    content_id:=coalesce(nullif(input->>'postId',''),nullif(input->>'commentId',''),nullif(input->>'targetId',''))::uuid;
    IF mine.status IS DISTINCT FROM 'active' AND actor_role IS DISTINCT FROM 'staff' THEN RAISE EXCEPTION 'Join this community first'; END IF;
    IF content_kind='post' THEN
      SELECT * INTO target_post FROM public.community_posts WHERE id=content_id AND community_id=cid;
      IF NOT FOUND THEN RAISE EXCEPTION 'Post unavailable'; END IF;
      recipient:=target_post.author_id;
    ELSE
      SELECT * INTO target_comment FROM public.community_comments WHERE id=content_id AND community_id=cid;
      IF NOT FOUND THEN RAISE EXCEPTION 'Reply unavailable'; END IF;
      recipient:=target_comment.author_id;
    END IF;
    IF action='report' THEN
      IF char_length(btrim(coalesce(input->>'reason',''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Explain your report in 3 to 500 characters'; END IF;
      INSERT INTO public.community_reports(community_id,reporter_id,target_id,kind,reason) VALUES(cid,actor,content_id,content_kind,btrim(input->>'reason'))
        ON CONFLICT(reporter_id,target_id,kind) DO NOTHING;
    ELSE
      IF (action='pin' OR recipient<>actor) AND (actor_role IS NULL OR actor_role NOT IN ('staff','owner','admin','moderator')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
      IF action='pin' THEN UPDATE public.community_posts SET is_pinned=coalesce((input->>'pinned')::boolean,false),updated_at=now() WHERE id=content_id;
      ELSE
        UPDATE public.community_content_reviews SET status='superseded' WHERE target_id=content_id AND status='pending';
        IF content_kind='post' THEN DELETE FROM public.community_posts WHERE id=content_id; ELSE DELETE FROM public.community_comments WHERE id=content_id; END IF;
      END IF;
    END IF;
  ELSIF action='resolve_report' THEN
    IF actor_role IS NULL OR actor_role NOT IN ('staff','owner','admin','moderator') THEN RAISE EXCEPTION 'Not authorized'; END IF;
    UPDATE public.community_reports SET status='resolved' WHERE id=(input->>'reportId')::uuid AND community_id=cid;
  ELSE
    RAISE EXCEPTION 'Unknown community action';
  END IF;
  IF action='request' THEN
    FOR recipient IN SELECT user_id FROM public.community_memberships WHERE community_id=cid AND status='active' AND role IN ('admin','moderator') LOOP
      PERFORM private.community_notify(cid,recipient,'join_request','New community join request');
    END LOOP;
  ELSIF action='review_request' THEN
    PERFORM private.community_notify(cid,target_user,'request_'||(input->>'decision'),'Your community join request was '||(input->>'decision'));
  ELSIF action='invite' THEN
    PERFORM private.community_notify(cid,target_user,'invitation','You have been invited to a community');
  ELSIF action='offer_ownership' THEN
    PERFORM private.community_notify(cid,target_user,'ownership_offer','You have been offered community ownership');
  ELSIF action IN ('role','ban','unban','remove') THEN
    PERFORM private.community_notify(cid,target_user,'membership_'||action,'Your community membership has changed');
  END IF;
  RETURN jsonb_build_object('ok',true);
END;
$$;
REVOKE ALL ON FUNCTION private.run_community_action(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.run_community_action(uuid,text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.community_action(p_community_id uuid,p_action text,p_data jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.run_community_action(p_community_id,p_action,p_data) $$;
REVOKE ALL ON FUNCTION public.community_action(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_action(uuid,text,jsonb) TO authenticated;

-- Old clients use these names; route them through the same checks.
CREATE OR REPLACE FUNCTION public.accept_community_invite(p_community_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN PERFORM public.community_action(p_community_id,'accept_invite','{}'); END; $$;
CREATE OR REPLACE FUNCTION public.approve_community_join_request(p_community_id uuid,p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN PERFORM public.community_action(p_community_id,'review_request',jsonb_build_object('userId',p_user_id,'decision','approved')); END; $$;
REVOKE ALL ON FUNCTION public.accept_community_invite(uuid),public.approve_community_join_request(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_community_invite(uuid),public.approve_community_join_request(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_community_owner_on_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.approval_status='pending' AND NEW.approval_status='approved' AND NEW.created_by IS NOT NULL THEN
   UPDATE public.communities SET owner_id=CASE WHEN type='interest' THEN created_by END WHERE id=NEW.id;
   INSERT INTO public.community_memberships(community_id,user_id,role,status,is_auto_joined) VALUES(NEW.id,NEW.created_by,'admin','active',false)
     ON CONFLICT(community_id,user_id) DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_auto_join_ward_community() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cid uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.home_ward IS NOT DISTINCT FROM OLD.home_ward AND NEW.home_lga IS NOT DISTINCT FROM OLD.home_lga AND NEW.home_state IS NOT DISTINCT FROM OLD.home_state THEN RETURN NEW; END IF;
 UPDATE public.community_memberships m SET status='left',updated_at=now()
 WHERE m.user_id=NEW.id AND m.is_auto_joined AND m.status='active' AND m.role='member'
   AND NOT EXISTS(SELECT 1 FROM public.communities c WHERE c.id=m.community_id AND c.state=NEW.home_state AND c.lga=NEW.home_lga AND (c.type='lga' OR c.ward=NEW.home_ward));
 FOR cid IN SELECT c.id FROM public.communities c WHERE c.approval_status='approved' AND c.state=NEW.home_state AND c.lga=NEW.home_lga
   AND nullif(NEW.home_state,'') IS NOT NULL AND nullif(NEW.home_lga,'') IS NOT NULL
   AND (c.type='lga' OR (c.type='ward' AND nullif(NEW.home_ward,'') IS NOT NULL AND c.ward=NEW.home_ward)) LOOP
   INSERT INTO public.community_memberships(community_id,user_id,role,status,is_auto_joined) VALUES(cid,NEW.id,'member','active',true)
     ON CONFLICT(community_id,user_id) DO NOTHING;
 END LOOP;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION private.community_can_read_media(object_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE cid uuid; ref text := 'storage://community-media/'||object_name;
BEGIN
 cid:=split_part(object_name,'/',1)::uuid;
 IF auth.uid() IS NULL OR NOT public.is_current_session_active() OR NOT EXISTS(SELECT 1 FROM public.communities WHERE id=cid AND approval_status='approved') THEN RETURN false; END IF;
 IF split_part(object_name,'/',2)=auth.uid()::text THEN RETURN true; END IF;
 IF public.is_community_mod_or_admin(cid,auth.uid()) THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=cid AND user_id=auth.uid() AND status='active')
   AND EXISTS(SELECT 1 FROM public.community_posts WHERE community_id=cid AND moderation_status='approved' AND (ref=ANY(image_urls) OR ref=ANY(video_urls)));
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END; $$;
REVOKE ALL ON FUNCTION private.community_can_read_media(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.community_can_read_media(text) TO authenticated;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('community-media','community-media',false,41943040,ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/quicktime','video/webm'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
CREATE POLICY community_media_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='community-media' AND private.community_can_read_media(name));
CREATE POLICY community_media_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(
 bucket_id='community-media' AND public.is_current_session_active() AND split_part(name,'/',2)=auth.uid()::text
 AND EXISTS(SELECT 1 FROM public.community_memberships m WHERE m.community_id::text=split_part(name,'/',1) AND m.user_id=auth.uid() AND m.status='active')
 AND name NOT LIKE '%..%' AND name NOT LIKE '%\\%');

DROP POLICY IF EXISTS memberships_select_own ON public.community_memberships;
CREATE POLICY memberships_select_own ON public.community_memberships FOR SELECT TO authenticated USING(
 public.is_current_session_active() AND (user_id=auth.uid() OR private.community_role(community_id,auth.uid()) IS NOT NULL));

DROP POLICY IF EXISTS comm_posts_select ON public.community_posts;
CREATE POLICY comm_posts_select ON public.community_posts FOR SELECT TO authenticated USING(
 public.is_current_session_active() AND EXISTS(SELECT 1 FROM public.communities WHERE id=community_posts.community_id AND approval_status='approved')
 AND (private.community_role(community_id,auth.uid())='staff' OR (
   EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=community_posts.community_id AND user_id=auth.uid() AND status='active')
   AND (moderation_status='approved' OR author_id=auth.uid() OR public.is_community_mod_or_admin(community_id,auth.uid())))));
DROP POLICY IF EXISTS comm_comments_select ON public.community_comments;
CREATE POLICY comm_comments_select ON public.community_comments FOR SELECT TO authenticated USING(
 public.is_current_session_active() AND EXISTS(SELECT 1 FROM public.communities WHERE id=community_comments.community_id AND approval_status='approved')
 AND (private.community_role(community_id,auth.uid())='staff' OR (
   EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=community_comments.community_id AND user_id=auth.uid() AND status='active')
   AND EXISTS(SELECT 1 FROM public.community_posts WHERE id=community_comments.post_id AND community_id=community_comments.community_id)
   AND (moderation_status='approved' OR author_id=auth.uid() OR public.is_community_mod_or_admin(community_id,auth.uid())))));

CREATE FUNCTION private.community_invite_candidates(cid uuid,q text) RETURNS TABLE(id uuid,name text,avatar_url text,phone_verified boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_community_mod_or_admin(cid,auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 RETURN QUERY SELECT u.id,u.name,u.avatar_url,u.phone_verified FROM public.users u
 WHERE EXISTS(SELECT 1 FROM public.followers WHERE follower_id=auth.uid() AND following_id=u.id)
 AND EXISTS(SELECT 1 FROM public.followers WHERE follower_id=u.id AND following_id=auth.uid())
 AND NOT (auth.uid()=ANY(u.blocked_users)) AND NOT EXISTS(SELECT 1 FROM public.users me WHERE me.id=auth.uid() AND u.id=ANY(me.blocked_users))
 AND NOT EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=cid AND user_id=u.id AND status IN ('active','banned'))
 AND u.name ILIKE '%'||left(coalesce(q,''),60)||'%' ORDER BY u.name LIMIT 50;
END; $$;
CREATE FUNCTION public.community_invite_candidates(p_community_id uuid,p_query text DEFAULT '') RETURNS TABLE(id uuid,name text,avatar_url text,phone_verified boolean)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM private.community_invite_candidates(p_community_id,p_query) $$;
REVOKE ALL ON FUNCTION private.community_invite_candidates(uuid,text),public.community_invite_candidates(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.community_invite_candidates(uuid,text),public.community_invite_candidates(uuid,text) TO authenticated;

CREATE FUNCTION public.claim_community_jobs(p_limit int DEFAULT 20) RETURNS SETOF public.community_jobs
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 WITH due AS(SELECT id FROM public.community_jobs WHERE (status='queued' OR (status='processing' AND claimed_at<now()-interval '5 minutes'))
   AND attempt_count<3 AND next_attempt_at<=now() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT least(greatest(p_limit,1),50))
 UPDATE public.community_jobs j SET status='processing',attempt_count=j.attempt_count+1,claimed_at=now() FROM due WHERE j.id=due.id RETURNING j.*;
$$;
REVOKE ALL ON FUNCTION public.claim_community_jobs(int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_community_jobs(int) TO service_role;

-- Realtime changes are still filtered by each table's RLS.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['communities','community_memberships','community_posts','community_comments','community_invites','community_join_requests','community_content_reviews','community_reports','community_ownership_transfers'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
     EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
   END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';

-- Preserve the existing review backlog when switching to the durable worker.
INSERT INTO public.community_content_reviews(community_id,kind,target_id,author_id,content,image_urls,video_urls)
 SELECT community_id,'post',id,author_id,content,coalesce(image_urls,'{}'),coalesce(video_urls,'{}') FROM public.community_posts WHERE moderation_status IN ('pending','moderation_error');
INSERT INTO public.community_content_reviews(community_id,kind,target_id,author_id,content)
 SELECT community_id,'comment',id,author_id,content FROM public.community_comments WHERE moderation_status IN ('pending','moderation_error');
INSERT INTO public.community_jobs(community_id,kind,payload)
 SELECT community_id,'moderation',jsonb_build_object('reviewId',id) FROM public.community_content_reviews WHERE status='pending';

CREATE OR REPLACE FUNCTION public.fn_community_comment_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.post_id ELSE NEW.post_id END;
BEGIN
 UPDATE public.community_posts SET comment_count=(SELECT count(*) FROM public.community_comments WHERE post_id=pid AND moderation_status='approved'),updated_at=now() WHERE id=pid;
 RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS tr_community_comment_count ON public.community_comments;
CREATE TRIGGER tr_community_comment_count AFTER INSERT OR UPDATE OF moderation_status OR DELETE ON public.community_comments FOR EACH ROW EXECUTE FUNCTION public.fn_community_comment_count();

-- Uses the same Vault credentials as the existing push delivery worker.
DO $schedule$ BEGIN
 IF to_regnamespace('cron') IS NOT NULL THEN
   PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='process-community-jobs';
   PERFORM cron.schedule('process-community-jobs','* * * * *',$job$
     SELECT net.http_post(
       url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url')||'/functions/v1/process-community-jobs',
       headers:=jsonb_build_object('Content-Type','application/json','apikey',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key'),
         'Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')),body:='{}'::jsonb)
     WHERE EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='project_url') AND EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='service_role_key');
   $job$);
 END IF;
END $schedule$;
COMMIT;
