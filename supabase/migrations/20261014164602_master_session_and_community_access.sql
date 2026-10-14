-- Single active session is authoritative in the database, including still-valid JWTs.
-- Activation uses the immutable auth.sessions creation time, never refresh/last-seen time.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE private.active_account_sessions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  signed_in_at timestamptz NOT NULL
);
ALTER TABLE private.active_account_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.active_account_sessions FROM PUBLIC, anon, authenticated;
-- Preserve the newest existing login at cutover. Tombstones survive sign-out so
-- an older access token can never become active again when the newest session ends.
INSERT INTO private.active_account_sessions(user_id,session_id,signed_in_at)
SELECT DISTINCT ON (user_id) user_id,id,created_at FROM auth.sessions
ORDER BY user_id,created_at DESC,id DESC;

-- Supabase owns auth.sessions; this AFTER INSERT observer only records the newest
-- immutable login. It never modifies auth rows, refresh tokens, or credentials.
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

-- Backwards-compatible client handshake; normal refresh never transfers ownership.
CREATE FUNCTION public.activate_latest_session() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT public.is_current_session_active();
$$;
REVOKE ALL ON FUNCTION public.activate_latest_session() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activate_latest_session() TO authenticated;

-- Restrictive policies supplement every table's existing ownership/visibility rules.
-- The write trigger also protects writes inside existing SECURITY DEFINER RPCs.
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
CREATE POLICY active_account_session ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_current_session_active())) WITH CHECK ((SELECT public.is_current_session_active()));

-- A creator may inspect rejected submission metadata, but membership must never
-- grant access to an unapproved community's content, even with legacy memberships.
CREATE FUNCTION private.community_is_approved(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.communities WHERE id=cid AND approval_status='approved');
$$;
GRANT USAGE ON SCHEMA private TO authenticated,anon;
GRANT EXECUTE ON FUNCTION private.community_is_approved(uuid) TO authenticated,anon;
REVOKE EXECUTE ON FUNCTION private.community_is_approved(uuid) FROM PUBLIC;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['community_memberships','community_posts','community_comments','community_invites','community_join_requests'] LOOP
   EXECUTE format('CREATE POLICY approved_community_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated,anon USING (private.community_is_approved(community_id)) WITH CHECK (private.community_is_approved(community_id))',name);
 END LOOP;
END $$;
CREATE POLICY approved_community_only ON public.community_post_likes AS RESTRICTIVE FOR ALL TO authenticated,anon
USING (EXISTS(SELECT 1 FROM public.community_posts p WHERE p.id=post_id AND private.community_is_approved(p.community_id)))
WITH CHECK (EXISTS(SELECT 1 FROM public.community_posts p WHERE p.id=post_id AND private.community_is_approved(p.community_id)));
CREATE POLICY approved_community_only ON public.community_comment_likes AS RESTRICTIVE FOR ALL TO authenticated,anon
USING (EXISTS(SELECT 1 FROM public.community_comments c WHERE c.id=comment_id AND private.community_is_approved(c.community_id)))
WITH CHECK (EXISTS(SELECT 1 FROM public.community_comments c WHERE c.id=comment_id AND private.community_is_approved(c.community_id)));
CREATE OR REPLACE FUNCTION public.is_messages_participant(conv_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT public.is_current_session_active() AND EXISTS(
   SELECT 1 FROM public.conversations WHERE id=conv_id AND auth.uid()=ANY(participant_ids)
 );
$$;
CREATE OR REPLACE FUNCTION public.audit_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE WHEN auth.uid() IS NULL THEN false ELSE public.is_current_session_active() AND
   EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND is_admin) END;
$$;
CREATE OR REPLACE FUNCTION public.is_community_mod_or_admin(p_community_id uuid,p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE WHEN auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN false
 ELSE public.is_current_session_active() AND private.community_is_approved(p_community_id) AND
   EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=p_community_id AND user_id=auth.uid()
     AND role IN ('moderator','admin') AND status='active') END;
$$;

-- Existing privileged community RPCs must also reject writes to rejected groups.
CREATE FUNCTION private.guard_approved_community_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.role()='authenticated' AND NOT private.community_is_approved(CASE WHEN TG_OP='DELETE' THEN OLD.community_id ELSE NEW.community_id END) THEN
   RAISE EXCEPTION 'This community is not approved for active access' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.guard_approved_community_write() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['community_memberships','community_posts','community_comments','community_invites','community_join_requests'] LOOP
   EXECUTE format('CREATE TRIGGER enforce_approved_community BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.guard_approved_community_write()',name);
 END LOOP;
END $$;
-- Session checks use existing auth session indexes; chat history paginates on this path.
CREATE INDEX IF NOT EXISTS messages_conversation_created_id_idx ON public.messages(conversation_id,created_at DESC,id DESC);
NOTIFY pgrst, 'reload schema';
COMMIT;
