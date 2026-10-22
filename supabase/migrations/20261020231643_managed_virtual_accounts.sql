-- Managed fictional accounts. No identities are provisioned and no scheduler is enabled here.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
ALTER TABLE public.users ADD COLUMN account_kind text NOT NULL DEFAULT 'human'
 CHECK(account_kind IN ('human','managed_virtual'));
ALTER TABLE public.posts ADD COLUMN activity_origin text NOT NULL DEFAULT 'organic'
 CHECK(activity_origin IN ('organic','synthetic'));
ALTER TABLE public.comments ADD COLUMN activity_origin text NOT NULL DEFAULT 'organic'
 CHECK(activity_origin IN ('organic','synthetic'));
ALTER TABLE public.posts ADD COLUMN synthetic_like_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.posts ADD COLUMN synthetic_comment_count integer NOT NULL DEFAULT 0;

CREATE TABLE public.managed_virtual_accounts(
 slot integer PRIMARY KEY CHECK(slot BETWEEN 1 AND 50),
 user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
 persona jsonb NOT NULL CHECK(jsonb_typeof(persona)='object'),
 persona_version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'paused' CHECK(status IN ('paused','active','retired')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.managed_virtual_config(
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false,
 client_disclosure_ready boolean NOT NULL DEFAULT false,
 CHECK(NOT enabled OR client_disclosure_ready),
 posting_enabled boolean NOT NULL DEFAULT false, commenting_enabled boolean NOT NULL DEFAULT false,
 liking_enabled boolean NOT NULL DEFAULT false, generation bigint NOT NULL DEFAULT 1,
 start_hour integer NOT NULL DEFAULT 8 CHECK(start_hour BETWEEN 0 AND 23),
 end_hour integer NOT NULL DEFAULT 21 CHECK(end_hour BETWEEN 1 AND 24 AND end_hour>start_hour),
 daily_posts integer NOT NULL DEFAULT 10 CHECK(daily_posts BETWEEN 0 AND 50),
 daily_comments integer NOT NULL DEFAULT 20 CHECK(daily_comments BETWEEN 0 AND 100),
 daily_likes integer NOT NULL DEFAULT 50 CHECK(daily_likes BETWEEN 0 AND 250),
 account_daily_posts integer NOT NULL DEFAULT 1 CHECK(account_daily_posts BETWEEN 0 AND 2),
 account_weekly_posts integer NOT NULL DEFAULT 3 CHECK(account_weekly_posts BETWEEN 0 AND 7),
 account_daily_comments integer NOT NULL DEFAULT 2 CHECK(account_daily_comments BETWEEN 0 AND 5),
 account_daily_likes integer NOT NULL DEFAULT 5 CHECK(account_daily_likes BETWEEN 0 AND 10),
 target_daily_comments integer NOT NULL DEFAULT 3 CHECK(target_daily_comments BETWEEN 0 AND 5),
 target_likes integer NOT NULL DEFAULT 5 CHECK(target_likes BETWEEN 0 AND 10),
 cooldown_minutes integer NOT NULL DEFAULT 60 CHECK(cooldown_minutes BETWEEN 15 AND 1440),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.managed_virtual_config(id) VALUES(true);
CREATE TABLE public.managed_virtual_drafts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.managed_virtual_accounts(user_id),
 action text NOT NULL CHECK(action IN ('post','comment','like')), text text, topic text,
 target_post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
 parent_comment_id uuid REFERENCES public.comments(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 review_reason text, reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((action='post' AND target_post_id IS NULL AND parent_comment_id IS NULL) OR (action IN ('comment','like') AND target_post_id IS NOT NULL)),
 CHECK(action='comment' OR parent_comment_id IS NULL),
 CHECK(action='like' OR (length(trim(text)) BETWEEN 10 AND 2000 AND length(trim(topic)) BETWEEN 2 AND 80))
);
CREATE TABLE public.managed_virtual_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL UNIQUE REFERENCES public.managed_virtual_drafts(id),
 idempotency_key text NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 8 AND 200),
 generation bigint NOT NULL, scheduled_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz,
 result_id uuid, last_error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CHECK(expires_at>scheduled_at AND expires_at<=scheduled_at+interval '24 hours')
);
CREATE INDEX managed_virtual_jobs_due ON public.managed_virtual_jobs(scheduled_at) WHERE status IN ('queued','running');
CREATE TABLE public.managed_virtual_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid, account_id uuid,
 operation text NOT NULL, job_id uuid, target_id uuid, outcome text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX managed_virtual_audit_quota ON public.managed_virtual_audit(created_at,account_id,operation) WHERE outcome='executed';
CREATE TABLE public.managed_virtual_likes(
 post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES public.managed_virtual_accounts(user_id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(post_id,account_id)
);
-- An unexposed, transaction-bound permit cannot be forged through client GUCs.
CREATE TABLE private.managed_virtual_permits(
 transaction_id bigint PRIMARY KEY, account_id uuid NOT NULL, action text NOT NULL, target_id uuid
);
ALTER TABLE private.managed_virtual_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.managed_virtual_permits FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['managed_virtual_accounts','managed_virtual_config','managed_virtual_drafts','managed_virtual_jobs','managed_virtual_audit','managed_virtual_likes'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
 END LOOP;
END $$;

CREATE FUNCTION private.is_managed_virtual(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.managed_virtual_accounts WHERE user_id=p_id)
$$;
REVOKE ALL ON FUNCTION private.is_managed_virtual(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.managed_virtual_permitted(p_id uuid,p_action text,p_target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.managed_virtual_permits WHERE transaction_id=txid_current()
  AND account_id=p_id AND action=p_action AND target_id IS NOT DISTINCT FROM p_target)
$$;
REVOKE ALL ON FUNCTION private.managed_virtual_permitted(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.guard_managed_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.account_kind='managed_virtual' AND NEW.account_kind<>'managed_virtual' THEN
  RAISE EXCEPTION 'Managed account classification is permanent' USING ERRCODE='42501';
 END IF;
 IF NEW.account_kind='managed_virtual' AND NOT private.is_managed_virtual(NEW.id) THEN
  RAISE EXCEPTION 'Managed identities require registry provisioning' USING ERRCODE='42501';
 END IF;
 IF private.is_managed_virtual(NEW.id) AND (NEW.account_kind<>'managed_virtual' OR NEW.verified_seller OR NEW.phone_verified OR NEW.is_admin) THEN
  RAISE EXCEPTION 'Managed identities cannot impersonate verified humans or administrators' USING ERRCODE='42501';
 END IF;
 IF private.is_managed_virtual(NEW.id) THEN
  NEW.is_online:=false; NEW.last_seen:=NULL;
  IF coalesce(cardinality(NEW.friends),0)>0 THEN RAISE EXCEPTION 'Virtual accounts cannot form friendships' USING ERRCODE='42501'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(NEW.friends) actor WHERE private.is_managed_virtual(actor)) THEN RAISE EXCEPTION 'Virtual accounts cannot form friendships' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_managed_identity BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION private.guard_managed_identity();

-- Preserve human auto-enrolment; managed profiles never join location communities.
DO $$ BEGIN
 IF to_regprocedure('public.fn_auto_join_ward_community()') IS NOT NULL THEN
  DROP TRIGGER IF EXISTS tr_auto_join_ward_community ON public.users;
  CREATE TRIGGER tr_auto_join_ward_community AFTER INSERT OR UPDATE OF home_ward,home_lga,home_state ON public.users
   FOR EACH ROW WHEN (NEW.account_kind='human') EXECUTE FUNCTION public.fn_auto_join_ward_community();
 END IF;
END $$;

CREATE OR REPLACE VIEW public.public_profiles WITH(security_invoker=false) AS
SELECT id,name,username,avatar_url,bio,interests,created_at,updated_at,
 home_state,home_lga,verified_seller,phone_verified,rating,review_count,discoverable,is_online,last_seen,
 jsonb_build_object('state',home_state,'lga',home_lga) AS location,
 COALESCE(cardinality(friends),0) AS friend_count,account_kind
FROM public.users;
REVOKE ALL ON public.public_profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.public_profiles TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.is_current_session_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT private.is_managed_virtual(auth.uid()) AND EXISTS(
 SELECT 1 FROM private.active_account_sessions a JOIN auth.sessions s ON s.id=a.session_id AND s.user_id=a.user_id
 WHERE a.user_id=auth.uid() AND a.session_id::text=auth.jwt()->>'session_id' AND(s.not_after IS NULL OR s.not_after>now()))
$$;

CREATE FUNCTION public.managed_virtual_register(p_slot integer,p_user_id uuid,p_persona jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing uuid;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Backend provisioning only' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.managed_virtual_config WHERE id FOR UPDATE;
 SELECT user_id INTO existing FROM public.managed_virtual_accounts WHERE slot=p_slot;
 IF FOUND THEN
  IF existing<>p_user_id THEN RAISE EXCEPTION 'Slot already provisioned'; END IF;
  RETURN existing;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND raw_app_meta_data->>'managed_virtual_slot'=p_slot::text AND banned_until>now()) THEN RAISE EXCEPTION 'Provision a banned managed Auth identity with matching slot metadata'; END IF;
 IF EXISTS(SELECT 1 FROM public.posts WHERE user_id=p_user_id) OR EXISTS(SELECT 1 FROM public.comments WHERE user_id=p_user_id)
 OR EXISTS(SELECT 1 FROM auth.sessions WHERE user_id=p_user_id) THEN RAISE EXCEPTION 'Provision a new unused identity'; END IF;
 INSERT INTO public.users(id,name,email,username,bio,interests)
 SELECT p_user_id,(p_persona->>'name')||' · YRDLY virtual',u.email,p_persona->>'username',
  coalesce(p_persona->>'bio','Fictional YRDLY-managed virtual account.'),
  (jsonb_populate_record(NULL::public.users,jsonb_build_object('interests',coalesce(p_persona->'interests','[]'::jsonb)))).interests
 FROM auth.users u WHERE u.id=p_user_id
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,username=excluded.username,
  bio=excluded.bio,interests=excluded.interests;
 INSERT INTO public.managed_virtual_accounts(slot,user_id,persona) VALUES(p_slot,p_user_id,p_persona);
 UPDATE public.users SET account_kind='managed_virtual',verified_seller=false,phone_verified=false,is_admin=false,
 is_online=false,last_seen=NULL,home_state=p_persona->'location'->>'state',
 home_lga=p_persona->'location'->>'lga' WHERE id=p_user_id;
 INSERT INTO public.managed_virtual_audit(account_id,operation,outcome,detail) VALUES(p_user_id,'register','applied',jsonb_build_object('slot',p_slot));
 RETURN p_user_id;
END $$;
REVOKE ALL ON FUNCTION public.managed_virtual_register(integer,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.managed_virtual_register(integer,uuid,jsonb) TO service_role;

-- Even SECURITY DEFINER/service-role writes must obey attribution and capability restrictions.
CREATE FUNCTION private.guard_managed_feed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE managed boolean; original_managed boolean; target public.posts; parent public.comments;
BEGIN
 managed:=private.is_managed_virtual(NEW.user_id);
 IF TG_OP='UPDATE' THEN
  original_managed:=private.is_managed_virtual(OLD.user_id);
  IF (managed OR original_managed) AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
   RAISE EXCEPTION 'Managed content ownership is immutable' USING ERRCODE='42501';
  END IF;
 END IF;
 NEW.activity_origin:=CASE WHEN managed THEN 'synthetic' ELSE 'organic' END;
 IF TG_TABLE_NAME='posts' THEN
  IF EXISTS(SELECT 1 FROM unnest(NEW.liked_by) actor WHERE private.is_managed_virtual(actor)) THEN
   RAISE EXCEPTION 'Synthetic likes must not enter organic engagement' USING ERRCODE='42501';
  END IF;
  -- Counters are authoritative even when older clients submit stale values.
  SELECT count(*) FILTER(WHERE activity_origin='organic'),count(*) FILTER(WHERE activity_origin='synthetic')
   INTO NEW.comment_count,NEW.synthetic_comment_count FROM public.comments WHERE post_id=NEW.id;
  SELECT count(*) INTO NEW.synthetic_like_count FROM public.managed_virtual_likes WHERE post_id=NEW.id;
  IF managed THEN
   IF NEW.category<>'General' THEN RAISE EXCEPTION 'Managed accounts may only publish General posts' USING ERRCODE='42501'; END IF;
   IF TG_OP='INSERT' OR (to_jsonb(NEW)-ARRAY['liked_by','comment_count','synthetic_comment_count','synthetic_like_count','moderation_status','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['liked_by','comment_count','synthetic_comment_count','synthetic_like_count','moderation_status','updated_at']) THEN
    IF NOT private.managed_virtual_permitted(NEW.user_id,'post',NULL) THEN RAISE EXCEPTION 'Managed posts require scheduled execution' USING ERRCODE='42501'; END IF;
   END IF;
  END IF;
 ELSE
  IF managed THEN
   SELECT * INTO target FROM public.posts WHERE id=NEW.post_id;
   IF NOT FOUND OR NOT private.is_managed_virtual(target.user_id) OR target.user_id=NEW.user_id OR target.category IS DISTINCT FROM 'General' OR target.moderation_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Managed comments require another managed account approved General post' USING ERRCODE='42501';
   END IF;
   IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.comments WHERE id=NEW.parent_id;
    IF NOT FOUND OR parent.post_id<>NEW.post_id OR NOT private.is_managed_virtual(parent.user_id) THEN
     RAISE EXCEPTION 'Managed replies cannot target human comments' USING ERRCODE='42501';
    END IF;
   END IF;
   IF TG_OP='INSERT' OR (to_jsonb(NEW)-ARRAY['moderation_status','updated_at','like_count']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['moderation_status','updated_at','like_count']) THEN
    IF NOT private.managed_virtual_permitted(NEW.user_id,'comment',NEW.post_id) THEN RAISE EXCEPTION 'Managed comments require scheduled execution' USING ERRCODE='42501'; END IF;
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_guard_managed_feed BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION private.guard_managed_feed();
CREATE TRIGGER zz_guard_managed_feed BEFORE INSERT OR UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION private.guard_managed_feed();

CREATE OR REPLACE FUNCTION public.tr_update_post_comment_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN UPDATE public.posts SET comment_count=comment_count WHERE id=OLD.post_id; END IF;
 IF TG_OP<>'DELETE' THEN UPDATE public.posts SET comment_count=comment_count WHERE id=NEW.post_id; END IF;
 RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS tr_update_post_comment_count ON public.comments;
CREATE TRIGGER tr_update_post_comment_count AFTER INSERT OR UPDATE OR DELETE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.tr_update_post_comment_count();

CREATE FUNCTION private.guard_managed_like() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT private.managed_virtual_permitted(NEW.account_id,'like',NEW.post_id) THEN
 RAISE EXCEPTION 'Synthetic likes require scheduled execution' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_managed_like BEFORE INSERT OR UPDATE ON public.managed_virtual_likes FOR EACH ROW EXECUTE FUNCTION private.guard_managed_like();
CREATE FUNCTION private.sync_managed_likes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.posts SET synthetic_like_count=synthetic_like_count WHERE id=coalesce(NEW.post_id,OLD.post_id);
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER sync_managed_likes AFTER INSERT OR UPDATE OR DELETE ON public.managed_virtual_likes FOR EACH ROW EXECUTE FUNCTION private.sync_managed_likes();

CREATE FUNCTION private.guard_managed_unrelated() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_data jsonb; key text; value jsonb; actor text;
BEGIN
 IF private.is_managed_virtual(auth.uid()) THEN RAISE EXCEPTION 'Managed identities cannot use interactive actions' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 row_data:=to_jsonb(NEW);
 FOR key,value IN SELECT * FROM jsonb_each(row_data) LOOP
  IF key=ANY(ARRAY['user_id','owner_id','sender_id','recipient_id','buyer_id','seller_id','customer_id','author_id','creator_id','created_by','requester_id','invitee_id','inviter_id','reporter_id','scanner_id','staff_user_id','participant_ids','member_ids','attendees','friends','followed_by','liked_by']) OR key=ANY(TG_ARGV) THEN
   IF jsonb_typeof(value)='array' THEN
    FOR actor IN SELECT jsonb_array_elements_text(value) LOOP
     IF actor~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND private.is_managed_virtual(actor::uuid) THEN
      RAISE EXCEPTION 'This action is unavailable to managed virtual accounts' USING ERRCODE='42501'; END IF;
    END LOOP;
   ELSIF jsonb_typeof(value)='string' THEN
    actor:=value#>>'{}';
    IF actor~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND private.is_managed_virtual(actor::uuid) THEN
     RAISE EXCEPTION 'This action is unavailable to managed virtual accounts' USING ERRCODE='42501'; END IF;
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
-- Cover every currently installed action table, including privileged RPC destinations.
-- FK-derived argument names also protect non-standard identity columns.
DO $$ DECLARE t record; keys text; BEGIN
 FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT LIKE 'managed_virtual_%'
 AND c.relname NOT IN ('users','posts','comments','notifications','push_notification_outbox','push_notification_deliveries','reports','user_blocks') LOOP
  SELECT string_agg(DISTINCT quote_literal(a.attname),',') INTO keys FROM pg_constraint f
   JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=ANY(f.conkey)
   WHERE f.contype='f' AND f.conrelid=t.oid AND f.confrelid IN ('public.users'::regclass,'auth.users'::regclass);
  EXECUTE format('CREATE TRIGGER guard_managed_unrelated BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.guard_managed_unrelated(%s)',t.relname,coalesce(keys,''));
 END LOOP;
END $$;

CREATE FUNCTION private.suppress_managed_notifications() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_data jsonb:=to_jsonb(NEW); actor text;
BEGIN
 IF private.is_managed_virtual((row_data->>'user_id')::uuid) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM private.managed_virtual_permits WHERE transaction_id=txid_current()) THEN RETURN NULL; END IF;
 FOREACH actor IN ARRAY ARRAY[row_data->>'sender_id',row_data->>'actor_id',row_data->'data'->>'actor_id',row_data->'data'->>'sender_id',row_data->'data'->>'user_id',row_data->'payload'->'data'->>'senderId',row_data->'payload'->'data'->>'actorId'] LOOP
  IF actor~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND private.is_managed_virtual(actor::uuid) THEN RETURN NULL; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER aa_suppress_managed_notifications BEFORE INSERT OR UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION private.suppress_managed_notifications();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['push_notification_outbox','push_notification_deliveries'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('CREATE TRIGGER aa_suppress_managed_notifications BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.suppress_managed_notifications()',t);
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION public.managed_virtual_admin(p_operation text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE config public.managed_virtual_config; draft public.managed_virtual_drafts; result jsonb; new_id uuid; actor uuid:=auth.uid();
BEGIN
 IF NOT public.audit_is_admin() OR private.is_managed_virtual(actor) THEN RAISE EXCEPTION 'Active administrator session required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT config FROM public.managed_virtual_config WHERE id FOR UPDATE;
 CASE p_operation
 WHEN 'status' THEN
  RETURN jsonb_build_object('config',to_jsonb(config),
   'accounts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY slot),'[]') FROM public.managed_virtual_accounts a),
   'drafts',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM (SELECT * FROM public.managed_virtual_drafts ORDER BY created_at DESC LIMIT 100) d),
   'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]') FROM (SELECT * FROM public.managed_virtual_jobs ORDER BY created_at DESC LIMIT 100) j),
   'audit',(SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM (SELECT * FROM public.managed_virtual_audit ORDER BY id DESC LIMIT 100) e));
 WHEN 'stop' THEN
  UPDATE public.managed_virtual_config SET enabled=false,generation=generation+1,updated_at=clock_timestamp() WHERE id RETURNING to_jsonb(managed_virtual_config.*) INTO result;
  UPDATE public.managed_virtual_jobs SET status='cancelled',last_error='Emergency stop',lease_token=NULL,lease_until=NULL WHERE status IN ('queued','running');
 WHEN 'configure' THEN
  UPDATE public.managed_virtual_config SET
   enabled=coalesce((p_payload->>'enabled')::boolean,enabled),
   client_disclosure_ready=coalesce((p_payload->>'client_disclosure_ready')::boolean,client_disclosure_ready),
   posting_enabled=coalesce((p_payload->>'posting_enabled')::boolean,posting_enabled),
   commenting_enabled=coalesce((p_payload->>'commenting_enabled')::boolean,commenting_enabled),
   liking_enabled=coalesce((p_payload->>'liking_enabled')::boolean,liking_enabled),
   start_hour=coalesce((p_payload->>'start_hour')::integer,start_hour),end_hour=coalesce((p_payload->>'end_hour')::integer,end_hour),
   daily_posts=coalesce((p_payload->>'daily_posts')::integer,daily_posts),daily_comments=coalesce((p_payload->>'daily_comments')::integer,daily_comments),daily_likes=coalesce((p_payload->>'daily_likes')::integer,daily_likes),
   account_daily_posts=coalesce((p_payload->>'account_daily_posts')::integer,account_daily_posts),account_weekly_posts=coalesce((p_payload->>'account_weekly_posts')::integer,account_weekly_posts),
   account_daily_comments=coalesce((p_payload->>'account_daily_comments')::integer,account_daily_comments),account_daily_likes=coalesce((p_payload->>'account_daily_likes')::integer,account_daily_likes),
   target_daily_comments=coalesce((p_payload->>'target_daily_comments')::integer,target_daily_comments),target_likes=coalesce((p_payload->>'target_likes')::integer,target_likes),
   cooldown_minutes=coalesce((p_payload->>'cooldown_minutes')::integer,cooldown_minutes),
   generation=generation+1,updated_at=clock_timestamp() WHERE id RETURNING to_jsonb(managed_virtual_config.*) INTO result;
  UPDATE public.managed_virtual_jobs SET status='cancelled',last_error='Configuration changed; reschedule deliberately',lease_token=NULL,lease_until=NULL WHERE status IN ('queued','running');
 WHEN 'account' THEN
  IF EXISTS(SELECT 1 FROM public.managed_virtual_accounts WHERE user_id=(p_payload->>'user_id')::uuid AND status='retired') THEN RAISE EXCEPTION 'Retired identities cannot reactivate'; END IF;
  UPDATE public.managed_virtual_accounts SET status=coalesce(p_payload->>'status',status),
   persona=coalesce(p_payload->'persona',persona),persona_version=persona_version+CASE WHEN p_payload ? 'persona' THEN 1 ELSE 0 END
   WHERE user_id=(p_payload->>'user_id')::uuid RETURNING to_jsonb(managed_virtual_accounts.*) INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Account not found'; END IF;
  UPDATE public.managed_virtual_jobs SET status='cancelled',last_error='Account settings changed; reschedule deliberately',lease_token=NULL,lease_until=NULL
   WHERE status IN ('queued','running') AND draft_id IN(SELECT id FROM public.managed_virtual_drafts WHERE account_id=(p_payload->>'user_id')::uuid);
 WHEN 'draft' THEN
  INSERT INTO public.managed_virtual_drafts(account_id,action,text,topic,target_post_id,parent_comment_id)
   VALUES((p_payload->>'account_id')::uuid,p_payload->>'action',p_payload->>'text',p_payload->>'topic',(p_payload->>'target_post_id')::uuid,(p_payload->>'parent_comment_id')::uuid)
   RETURNING to_jsonb(managed_virtual_drafts.*) INTO result;
 WHEN 'review' THEN
  UPDATE public.managed_virtual_drafts SET status=CASE WHEN (p_payload->>'approved')::boolean THEN 'approved' ELSE 'rejected' END,
   review_reason=p_payload->>'reason',reviewed_by=actor,reviewed_at=clock_timestamp()
   WHERE id=(p_payload->>'draft_id')::uuid RETURNING to_jsonb(managed_virtual_drafts.*) INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Draft not found'; END IF;
 WHEN 'schedule' THEN
  SELECT * INTO STRICT draft FROM public.managed_virtual_drafts WHERE id=(p_payload->>'draft_id')::uuid;
  IF draft.status<>'approved' THEN RAISE EXCEPTION 'Approve the draft before scheduling'; END IF;
  IF (p_payload->>'scheduled_at')::timestamptz < clock_timestamp()-interval '1 minute' OR (p_payload->>'scheduled_at')::timestamptz > clock_timestamp()+interval '30 days' THEN RAISE EXCEPTION 'Schedule within the next 30 days'; END IF;
  -- Only cancelled, unexecuted jobs may be rescheduled; completed identities remain idempotent.
  INSERT INTO public.managed_virtual_jobs(draft_id,idempotency_key,generation,scheduled_at,expires_at)
   VALUES(draft.id,p_payload->>'idempotency_key',config.generation,(p_payload->>'scheduled_at')::timestamptz,coalesce((p_payload->>'expires_at')::timestamptz,(p_payload->>'scheduled_at')::timestamptz+interval '2 hours'))
   ON CONFLICT(draft_id) DO UPDATE SET generation=excluded.generation,scheduled_at=excluded.scheduled_at,expires_at=excluded.expires_at,status='queued',attempts=0,last_error=NULL
    WHERE managed_virtual_jobs.status='cancelled' AND managed_virtual_jobs.result_id IS NULL
   RETURNING to_jsonb(managed_virtual_jobs.*) INTO result;
  IF result IS NULL THEN SELECT to_jsonb(j) INTO result FROM public.managed_virtual_jobs j WHERE draft_id=draft.id; END IF;
 ELSE RAISE EXCEPTION 'Unsupported managed-account operation';
 END CASE;
 INSERT INTO public.managed_virtual_audit(actor_id,operation,outcome,detail) VALUES(actor,p_operation,'applied',jsonb_build_object('request',p_payload,'result',result));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.managed_virtual_admin(text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.managed_virtual_admin(text,jsonb) TO authenticated;

CREATE FUNCTION public.claim_managed_virtual_jobs(p_limit integer DEFAULT 5) RETURNS SETOF public.managed_virtual_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE config public.managed_virtual_config; local_hour integer;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Backend worker only' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT config FROM public.managed_virtual_config WHERE id FOR UPDATE;
 IF NOT config.enabled THEN RETURN; END IF;
 UPDATE public.managed_virtual_jobs SET status='cancelled',last_error='Expired or invalidated' WHERE status IN ('queued','running') AND(expires_at<=clock_timestamp() OR generation<>config.generation);
 UPDATE public.managed_virtual_jobs SET status='failed',last_error='Retry limit reached' WHERE status='running' AND lease_until<clock_timestamp() AND attempts>=3;
 local_hour:=extract(hour FROM clock_timestamp() AT TIME ZONE 'Africa/Lagos');
 IF local_hour<config.start_hour OR local_hour>=config.end_hour THEN RETURN; END IF;
 RETURN QUERY WITH selected AS(
  SELECT j.id FROM public.managed_virtual_jobs j JOIN public.managed_virtual_drafts d ON d.id=j.draft_id
  JOIN public.managed_virtual_accounts a ON a.user_id=d.account_id
  WHERE ((j.status='queued') OR(j.status='running' AND j.lease_until<clock_timestamp()))
   AND j.attempts<3 AND j.scheduled_at<=clock_timestamp() AND j.expires_at>clock_timestamp() AND j.generation=config.generation
   AND a.status='active' AND d.status='approved'
   AND CASE d.action WHEN 'post' THEN config.posting_enabled WHEN 'comment' THEN config.commenting_enabled ELSE config.liking_enabled END
  ORDER BY j.scheduled_at FOR UPDATE OF j SKIP LOCKED LIMIT greatest(0,least(coalesce(p_limit,5),5))
 ) UPDATE public.managed_virtual_jobs j SET status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes'
 FROM selected WHERE j.id=selected.id RETURNING j.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_managed_virtual_jobs(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_managed_virtual_jobs(integer) TO service_role;

CREATE FUNCTION private.managed_text_words(p_text text) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(array_agg(DISTINCT word),'{}') FROM unnest(regexp_split_to_array(lower(coalesce(p_text,'')),'[^[:alnum:]]+')) word WHERE length(word)>2
$$;
REVOKE ALL ON FUNCTION private.managed_text_words(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.execute_managed_virtual_job(p_job_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE config public.managed_virtual_config; job public.managed_virtual_jobs; draft public.managed_virtual_drafts;
 account public.managed_virtual_accounts; profile public.users; target public.posts; v_result_id uuid;
 fleet_limit integer; account_limit integer; today timestamptz; reason text; words text[]; local_hour integer;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Backend worker only' USING ERRCODE='42501'; END IF;
 -- Serializes all final writes, configuration changes and stop acknowledgement.
 SELECT * INTO STRICT config FROM public.managed_virtual_config WHERE id FOR UPDATE;
 SELECT * INTO STRICT job FROM public.managed_virtual_jobs WHERE id=p_job_id FOR UPDATE;
 IF job.status='done' THEN RETURN jsonb_build_object('status','done','result_id',job.result_id); END IF;
 IF job.status<>'running' OR job.lease_token IS DISTINCT FROM p_lease_token OR job.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Job lease unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT draft FROM public.managed_virtual_drafts WHERE id=job.draft_id;
 SELECT * INTO STRICT account FROM public.managed_virtual_accounts WHERE user_id=draft.account_id;
 SELECT * INTO STRICT profile FROM public.users WHERE id=draft.account_id;
 BEGIN
  IF NOT config.enabled OR job.generation<>config.generation OR job.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Execution disabled, invalidated or expired'; END IF;
  IF account.status<>'active' OR draft.status<>'approved' OR coalesce((to_jsonb(profile)->>'is_suspended')::boolean,false) OR coalesce((to_jsonb(profile)->>'is_banned')::boolean,false) OR coalesce(to_jsonb(profile)->>'status','') IN ('suspended','banned') THEN RAISE EXCEPTION 'Account or draft unavailable'; END IF;
  IF NOT (CASE draft.action WHEN 'post' THEN config.posting_enabled WHEN 'comment' THEN config.commenting_enabled ELSE config.liking_enabled END) THEN RAISE EXCEPTION 'Action disabled'; END IF;
  local_hour:=extract(hour FROM clock_timestamp() AT TIME ZONE 'Africa/Lagos');
  IF local_hour<config.start_hour OR local_hour>=config.end_hour
   OR local_hour<coalesce((account.persona->'posting_preferences'->>'start_hour')::integer,0)
   OR local_hour>=coalesce((account.persona->'posting_preferences'->>'end_hour')::integer,24) THEN RAISE EXCEPTION 'Outside configured activity window'; END IF;
  today:=date_trunc('day',clock_timestamp() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';
  fleet_limit:=CASE draft.action WHEN 'post' THEN config.daily_posts WHEN 'comment' THEN config.daily_comments ELSE config.daily_likes END;
  account_limit:=CASE draft.action WHEN 'post' THEN config.account_daily_posts WHEN 'comment' THEN config.account_daily_comments ELSE config.account_daily_likes END;
  IF draft.action='post' THEN account_limit:=least(account_limit,coalesce((account.persona->'posting_preferences'->>'max_posts_per_day')::integer,account_limit)); END IF;
  IF (SELECT count(*) FROM public.managed_virtual_audit WHERE outcome='executed' AND operation=draft.action AND created_at>=today)>=fleet_limit
   OR (SELECT count(*) FROM public.managed_virtual_audit WHERE outcome='executed' AND operation=draft.action AND account_id=draft.account_id AND created_at>=today)>=account_limit THEN RAISE EXCEPTION 'Daily activity limit reached'; END IF;
  IF EXISTS(SELECT 1 FROM public.managed_virtual_audit WHERE outcome='executed' AND account_id=draft.account_id AND created_at>clock_timestamp()-make_interval(mins=>config.cooldown_minutes)) THEN RAISE EXCEPTION 'Account cooldown active'; END IF;
  IF draft.action='post' AND(SELECT count(*) FROM public.managed_virtual_audit WHERE outcome='executed' AND operation='post' AND account_id=draft.account_id AND created_at>clock_timestamp()-interval '7 days')>=least(config.account_weekly_posts,coalesce((account.persona->'posting_preferences'->>'max_posts_per_week')::integer,config.account_weekly_posts)) THEN RAISE EXCEPTION 'Weekly posting limit reached'; END IF;
  IF draft.action<>'like' THEN
   words:=private.managed_text_words(draft.text);
   IF cardinality(words)<3 THEN RAISE EXCEPTION 'Content must contain distinct substantive words'; END IF;
   IF EXISTS(SELECT 1 FROM public.managed_virtual_drafts prior JOIN public.managed_virtual_jobs j ON j.draft_id=prior.id
    WHERE prior.id<>draft.id AND j.status='done' AND j.completed_at>clock_timestamp()-interval '30 days'
    AND (regexp_replace(lower(prior.text),'[^[:alnum:]]','','g')=regexp_replace(lower(draft.text),'[^[:alnum:]]','','g')
      OR (SELECT count(*)::numeric/greatest(cardinality(words),cardinality(private.managed_text_words(prior.text)),1) FROM unnest(words) w WHERE w=ANY(private.managed_text_words(prior.text)))>=0.8)) THEN RAISE EXCEPTION 'Duplicate or repetitive content'; END IF;
   IF EXISTS(SELECT 1 FROM public.managed_virtual_drafts prior JOIN public.managed_virtual_jobs j ON j.draft_id=prior.id
    WHERE prior.account_id=draft.account_id AND lower(trim(prior.topic))=lower(trim(draft.topic)) AND j.status='done' AND j.completed_at>clock_timestamp()-interval '7 days') THEN RAISE EXCEPTION 'Topic cooldown active'; END IF;
  END IF;
  IF draft.target_post_id IS NOT NULL THEN
   SELECT * INTO STRICT target FROM public.posts WHERE id=draft.target_post_id FOR UPDATE;
   IF target.moderation_status IS DISTINCT FROM 'approved' OR target.category IS DISTINCT FROM 'General' OR target.user_id=draft.account_id
    OR coalesce(to_jsonb(target)->>'visibility','public')<>'public' THEN RAISE EXCEPTION 'Target is ineligible'; END IF;
   IF EXISTS(SELECT 1 FROM public.users u WHERE u.id IN (draft.account_id,target.user_id) AND
     (coalesce(to_jsonb(u)->'blocked_users','[]') ? CASE WHEN u.id=draft.account_id THEN target.user_id::text ELSE draft.account_id::text END
      OR coalesce(to_jsonb(u)->'blockedUsers','[]') ? CASE WHEN u.id=draft.account_id THEN target.user_id::text ELSE draft.account_id::text END)) THEN RAISE EXCEPTION 'Interaction is blocked'; END IF;
   IF draft.action='comment' THEN
    IF NOT private.is_managed_virtual(target.user_id) THEN RAISE EXCEPTION 'Managed accounts never comment on human posts'; END IF;
    IF (SELECT count(*) FROM public.managed_virtual_audit WHERE outcome='executed' AND operation='comment' AND target_id=target.id AND created_at>=today)>=config.target_daily_comments THEN RAISE EXCEPTION 'Target comment limit reached'; END IF;
    IF EXISTS(SELECT 1 FROM public.managed_virtual_audit WHERE outcome='executed' AND operation='comment' AND account_id=draft.account_id AND target_id=target.id AND created_at>clock_timestamp()-interval '24 hours') THEN RAISE EXCEPTION 'Account and target cooldown active'; END IF;
   ELSE
    IF (SELECT count(*) FROM public.managed_virtual_likes WHERE post_id=target.id)>=config.target_likes THEN RAISE EXCEPTION 'Target like limit reached'; END IF;
    IF EXISTS(SELECT 1 FROM public.managed_virtual_likes WHERE post_id=target.id AND account_id=draft.account_id) THEN RAISE EXCEPTION 'Already liked'; END IF;
   END IF;
  END IF;
  INSERT INTO private.managed_virtual_permits(transaction_id,account_id,action,target_id) VALUES(txid_current(),draft.account_id,draft.action,draft.target_post_id);
  CASE draft.action
  WHEN 'post' THEN
   INSERT INTO public.posts(user_id,author_name,author_image,text,category,moderation_status,state,lga)
   VALUES(profile.id,profile.name,profile.avatar_url,draft.text,'General','approved',profile.home_state,profile.home_lga) RETURNING id INTO v_result_id;
  WHEN 'comment' THEN
   INSERT INTO public.comments(post_id,user_id,author_name,author_image,text,parent_id)
   VALUES(draft.target_post_id,profile.id,profile.name,profile.avatar_url,draft.text,draft.parent_comment_id) RETURNING id INTO v_result_id;
  WHEN 'like' THEN
   INSERT INTO public.managed_virtual_likes(post_id,account_id) VALUES(draft.target_post_id,profile.id);
   v_result_id:=draft.target_post_id;
  END CASE;
  DELETE FROM private.managed_virtual_permits WHERE transaction_id=txid_current();
  UPDATE public.managed_virtual_jobs SET status='done',result_id=v_result_id,completed_at=clock_timestamp(),lease_until=NULL,lease_token=NULL WHERE id=job.id;
  INSERT INTO public.managed_virtual_audit(account_id,operation,job_id,target_id,outcome,detail)
   VALUES(draft.account_id,draft.action,job.id,coalesce(draft.target_post_id,v_result_id),'executed',jsonb_build_object('result_id',v_result_id,'persona_version',account.persona_version,'generation',config.generation));
  RETURN jsonb_build_object('status','done','result_id',v_result_id);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
  -- The failed action subtransaction rolls back; its rejection remains auditable.
  UPDATE public.managed_virtual_jobs SET status='failed',last_error=left(reason,500),lease_until=NULL,lease_token=NULL WHERE id=job.id;
  INSERT INTO public.managed_virtual_audit(account_id,operation,job_id,target_id,outcome,detail)
   VALUES(draft.account_id,draft.action,job.id,draft.target_post_id,'rejected',jsonb_build_object('reason',left(reason,500)));
  RETURN jsonb_build_object('status','failed','reason',left(reason,500));
 END;
END $$;
REVOKE ALL ON FUNCTION public.execute_managed_virtual_job(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_managed_virtual_job(uuid,uuid) TO service_role;

-- Trigger functions are not API endpoints.
REVOKE ALL ON FUNCTION private.guard_managed_identity(),private.guard_managed_feed(),private.guard_managed_like(),private.sync_managed_likes(),private.guard_managed_unrelated(),private.suppress_managed_notifications() FROM PUBLIC,anon,authenticated,service_role;
-- Installed inactive: deployment alone must not start periodic activity.
DO $$ BEGIN
 IF to_regnamespace('cron') IS NOT NULL THEN
  PERFORM cron.schedule('process-managed-virtual-jobs','*/5 * * * *',$job$
   SELECT net.http_post(
    url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url')||'/functions/v1/process-managed-virtual-jobs',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')),
    body:='{}'::jsonb)
   WHERE EXISTS(SELECT 1 FROM public.managed_virtual_config WHERE id AND enabled)
    AND EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='project_url')
    AND EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='service_role_key');
  $job$);
  PERFORM cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname='process-managed-virtual-jobs';
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
