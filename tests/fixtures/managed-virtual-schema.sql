-- Disposable PostgreSQL/PGlite schema: mirrors the columns used by the integration.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT auth.jwt()->>'role' $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb DEFAULT '{}',banned_until timestamptz);
CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE private.active_account_sessions(user_id uuid PRIMARY KEY REFERENCES auth.users,session_id uuid NOT NULL,signed_in_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.users(id uuid PRIMARY KEY REFERENCES auth.users,email text,name text,username text,avatar_url text,bio text,interests text[],created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),home_state text,home_lga text,verified_seller boolean DEFAULT false,phone_verified boolean DEFAULT false,rating numeric,review_count int,discoverable boolean,is_online boolean,last_seen timestamptz,friends uuid[],is_admin boolean DEFAULT false,is_suspended boolean DEFAULT false,blocked_users uuid[] DEFAULT '{}');
CREATE TABLE public.posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES public.users,author_name text,author_image text,text text,timestamp timestamptz DEFAULT now(),category text,moderation_status text DEFAULT 'approved',liked_by uuid[] DEFAULT '{}',comment_count int DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),state text,lga text,visibility text DEFAULT 'public',title text,description text,image_urls text[],video_urls text[]);
CREATE TABLE public.comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),post_id uuid REFERENCES public.posts ON DELETE CASCADE,user_id uuid REFERENCES public.users,author_name text,author_image text,text text,parent_id uuid REFERENCES public.comments,timestamp timestamptz DEFAULT now(),moderation_status text DEFAULT 'approved');
CREATE TABLE public.conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),participant_ids uuid[]);
CREATE TABLE public.messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid REFERENCES public.conversations,sender_id uuid REFERENCES public.users,text text);
CREATE TABLE public.business_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES public.users,comment text);
CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES public.users,sender_id uuid,actor_id uuid,data jsonb);
CREATE TABLE public.push_notification_deliveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES public.users,notification_id uuid REFERENCES public.notifications,payload jsonb);
CREATE TABLE public.comment_likes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES public.users,comment_id uuid REFERENCES public.comments);

-- Model the existing location-enrolment side effect during profile provisioning.
ALTER TABLE public.users ADD COLUMN home_ward text;
CREATE TABLE public.community_memberships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES public.users);
CREATE FUNCTION public.fn_auto_join_ward_community() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.home_state IS NOT NULL AND NEW.home_lga IS NOT NULL THEN
  INSERT INTO public.community_memberships(user_id) VALUES(NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tr_auto_join_ward_community AFTER INSERT OR UPDATE OF home_ward,home_lga,home_state ON public.users
FOR EACH ROW EXECUTE FUNCTION public.fn_auto_join_ward_community();

-- Copied verbatim from 20261014164602: real session recording and current-session check.
CREATE FUNCTION private.record_new_account_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 INSERT INTO private.active_account_sessions(user_id,session_id,signed_in_at)
 VALUES(NEW.user_id,NEW.id,NEW.created_at)
 ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id,signed_in_at=excluded.signed_in_at
 WHERE (excluded.signed_in_at,excluded.session_id) >
       (active_account_sessions.signed_in_at,active_account_sessions.session_id);
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.record_new_account_session() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER record_new_account_session AFTER INSERT ON auth.sessions
FOR EACH ROW EXECUTE FUNCTION private.record_new_account_session();

CREATE FUNCTION public.is_current_session_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM private.active_account_sessions a JOIN auth.sessions s ON s.id=a.session_id AND s.user_id=a.user_id
   WHERE a.user_id=auth.uid() AND a.session_id::text=auth.jwt()->>'session_id'
     AND (s.not_after IS NULL OR s.not_after > now())
 );
$$;
REVOKE ALL ON FUNCTION public.is_current_session_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_current_session_active() TO anon,authenticated;


-- Copied verbatim from 20261014164602: existing administrator authorization.
CREATE OR REPLACE FUNCTION public.audit_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE WHEN auth.uid() IS NULL THEN false ELSE public.is_current_session_active() AND
   EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND is_admin) END;
$$;

-- Copied verbatim from 20261014164602: existing table write-session guards.
CREATE FUNCTION private.guard_active_session_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.role()='authenticated' AND NOT public.is_current_session_active() THEN
   RAISE EXCEPTION 'Your account was signed in on another device. Please log in again to continue.' USING ERRCODE='28000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.guard_active_session_write() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p') LOOP
   EXECUTE format('CREATE TRIGGER enforce_active_account_session BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.guard_active_session_write()', t.relname);
   IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=t.relname AND c.relrowsecurity) THEN
     EXECUTE format('CREATE POLICY active_account_session ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.is_current_session_active())) WITH CHECK ((SELECT public.is_current_session_active()))',t.relname);
   END IF;
 END LOOP;
END $$;

-- Copied verbatim from 20261009120100: existing home-post moderation trigger.
CREATE OR REPLACE FUNCTION public.audit_guard_moderation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.moderation_status := 'pending';
    IF TG_TABLE_NAME = 'events' THEN NEW.status := 'DRAFT'; END IF;
  ELSIF NEW.moderation_status IS DISTINCT FROM OLD.moderation_status THEN
    RAISE EXCEPTION 'Moderation is server managed' USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME = 'events' THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'Publish events through the server' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'posts' THEN
      IF ROW(NEW.text,NEW.title,NEW.description,NEW.image_urls,NEW.video_urls) IS DISTINCT FROM
         ROW(OLD.text,OLD.title,OLD.description,OLD.image_urls,OLD.video_urls) THEN
        NEW.moderation_status := 'pending';
      END IF;
    ELSIF TG_TABLE_NAME = 'events' THEN
      IF ROW(NEW.title,NEW.description,NEW.image_urls,NEW.video_urls) IS DISTINCT FROM
         ROW(OLD.title,OLD.description,OLD.image_urls,OLD.video_urls) THEN
        NEW.moderation_status := 'pending'; NEW.status := 'DRAFT';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER audit_guard_post_moderation BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.audit_guard_moderation();

-- Copied verbatim from 20260919190000: existing home-post comment counter.
CREATE OR REPLACE FUNCTION tr_update_post_comment_count()
RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_update_post_comment_count ON public.comments;
CREATE TRIGGER tr_update_post_comment_count
AFTER INSERT OR DELETE OR UPDATE OF post_id ON public.comments
FOR EACH ROW
EXECUTE FUNCTION tr_update_post_comment_count();

