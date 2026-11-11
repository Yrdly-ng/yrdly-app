-- QA-ONLY reconciliation of production security controls, 11 November 2026.
-- Source: read-only pg_get_functiondef, pg_policies and pg_get_triggerdef
-- from YRDLY production. Do not merge this migration into production.
-- Supabase migrations execute transactionally; no data or auth rows are copied.

-- Recreate six missing server-side audit guard functions.
CREATE OR REPLACE FUNCTION public.audit_guard_booking_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF NEW.customer_id IS DISTINCT FROM auth.uid() OR NEW.status <> 'requested' OR NEW.payment_status <> 'unpaid' THEN
    RAISE EXCEPTION 'Bookings must start requested and unpaid' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $function$;
GRANT EXECUTE ON FUNCTION public.audit_guard_booking_insert() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.audit_guard_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF ROW(NEW.participant_ids,NEW.type,NEW.created_by,NEW.admin_ids) IS DISTINCT FROM
     ROW(OLD.participant_ids,OLD.type,OLD.created_by,OLD.admin_ids) THEN
    RAISE EXCEPTION 'Conversation membership is server managed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $function$;
GRANT EXECUTE ON FUNCTION public.audit_guard_conversation() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.audit_guard_moderation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
END; $function$;
GRANT EXECUTE ON FUNCTION public.audit_guard_moderation() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.audit_guard_safety_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.status IS DISTINCT FROM OLD.status OR
     NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending alert content can be edited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $function$;
GRANT EXECUTE ON FUNCTION public.audit_guard_safety_update() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.audit_guard_user_trust()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.payluk_customer_id IS NOT NULL OR NEW.phone_verified OR NEW.phone_verified_at IS NOT NULL
      OR NEW.is_admin OR NEW.role <> 'user' OR NEW.verified_seller
      OR NEW.rating <> 0 OR NEW.review_count <> 0 OR NEW.no_show_count <> 0
      OR NEW.late_cancellation_count <> 0 OR NEW.is_flagged THEN
      RAISE EXCEPTION 'Trust fields are server managed' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF ROW(NEW.payluk_customer_id,NEW.phone_verified,NEW.phone_verified_at,NEW.is_admin,NEW.role,
      NEW.verified_seller,NEW.rating,NEW.review_count,NEW.no_show_count,NEW.late_cancellation_count,NEW.is_flagged)
      IS DISTINCT FROM ROW(OLD.payluk_customer_id,OLD.phone_verified,OLD.phone_verified_at,OLD.is_admin,OLD.role,
      OLD.verified_seller,OLD.rating,OLD.review_count,OLD.no_show_count,OLD.late_cancellation_count,OLD.is_flagged)
      OR ((OLD.phone_verified OR NEW.phone_verified) AND NEW.phone IS DISTINCT FROM OLD.phone) THEN
      RAISE EXCEPTION 'Trust fields are server managed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;
GRANT EXECUTE ON FUNCTION public.audit_guard_user_trust() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.audit_server_write_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'This write requires a server operation' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $function$;
GRANT EXECUTE ON FUNCTION public.audit_server_write_only() TO PUBLIC, anon, authenticated, service_role;

-- Remove legacy permissive QA policies which have been retired in production.
DROP POLICY IF EXISTS "Customers create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can create escrow transactions" ON public.escrow_transactions;
DROP POLICY IF EXISTS "Users can update own escrow transactions" ON public.escrow_transactions;
DROP POLICY IF EXISTS "Public can view published events" ON public.events;
DROP POLICY IF EXISTS "Users can manage own payout requests" ON public.payout_requests;
DROP POLICY IF EXISTS "Allow select on posts" ON public.posts;
DROP POLICY IF EXISTS "Anyone can insert safety alerts" ON public.safety_alerts;
DROP POLICY IF EXISTS "Anyone can update safety alerts" ON public.safety_alerts;
DROP POLICY IF EXISTS "Anyone can view all safety alerts" ON public.safety_alerts;
DROP POLICY IF EXISTS "Users can manage own seller accounts" ON public.seller_accounts;
DROP POLICY IF EXISTS "Organizers can view and update tickets for their events" ON public.tickets;
DROP POLICY IF EXISTS "tickets_insert_own" ON public.tickets;
DROP POLICY IF EXISTS "Users can read all users" ON public.users;

-- Restore nine restrictive production RLS policies.
DROP POLICY IF EXISTS "bookings_unpaid_insert" ON public.bookings;
CREATE POLICY "bookings_unpaid_insert" ON public.bookings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((customer_id = ( SELECT auth.uid() AS uid)) AND (status = 'requested'::booking_status) AND (payment_status = 'unpaid'::payment_status_enum)));

DROP POLICY IF EXISTS "events_visible" ON public.events;
CREATE POLICY "events_visible" ON public.events AS PERMISSIVE FOR SELECT TO PUBLIC USING (((status = 'PUBLISHED'::text) AND (moderation_status = 'approved'::text)));

DROP POLICY IF EXISTS "payout_requests_owner_read" ON public.payout_requests;
CREATE POLICY "payout_requests_owner_read" ON public.payout_requests AS PERMISSIVE FOR SELECT TO authenticated USING ((seller_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "posts_visible" ON public.posts;
CREATE POLICY "posts_visible" ON public.posts AS PERMISSIVE FOR SELECT TO PUBLIC USING (((user_id = ( SELECT auth.uid() AS uid)) OR ((moderation_status = 'approved'::text) AND ((COALESCE(visibility, 'public'::text) ~~* 'public'::text) OR ((visibility ~~* 'friends'::text) AND (EXISTS ( SELECT 1
   FROM followers
  WHERE ((followers.follower_id = auth.uid()) AND (followers.following_id = posts.user_id)))) AND (EXISTS ( SELECT 1
   FROM followers
  WHERE ((followers.follower_id = posts.user_id) AND (followers.following_id = auth.uid()))))))) OR ( SELECT audit_is_admin() AS audit_is_admin)));

DROP POLICY IF EXISTS "safety_author_update" ON public.safety_alerts;
CREATE POLICY "safety_author_update" ON public.safety_alerts AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "safety_read" ON public.safety_alerts;
CREATE POLICY "safety_read" ON public.safety_alerts AS PERMISSIVE FOR SELECT TO PUBLIC USING (((status = 'approved'::text) OR (user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT audit_is_admin() AS audit_is_admin)));

DROP POLICY IF EXISTS "seller_accounts_owner_read" ON public.seller_accounts;
CREATE POLICY "seller_accounts_owner_read" ON public.seller_accounts AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "tickets_organizer_read" ON public.tickets;
CREATE POLICY "tickets_organizer_read" ON public.tickets AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM events
  WHERE ((events.id = tickets.event_id) AND (events.organizer_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "users_private_read" ON public.users;
CREATE POLICY "users_private_read" ON public.users AS PERMISSIVE FOR SELECT TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT audit_is_admin() AS audit_is_admin)));

-- Reattach the actual production audit triggers to the critical tables.
DROP TRIGGER IF EXISTS "audit_guard_booking_insert" ON public.bookings;
CREATE TRIGGER audit_guard_booking_insert BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.audit_guard_booking_insert();
DROP TRIGGER IF EXISTS "audit_guard_conversation" ON public.conversations;
CREATE TRIGGER audit_guard_conversation BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.audit_guard_conversation();
DROP TRIGGER IF EXISTS "audit_guard_escrow" ON public.escrow_transactions;
CREATE TRIGGER audit_guard_escrow BEFORE INSERT OR DELETE OR UPDATE ON public.escrow_transactions FOR EACH ROW EXECUTE FUNCTION public.audit_server_write_only();
DROP TRIGGER IF EXISTS "audit_guard_event_moderation" ON public.events;
CREATE TRIGGER audit_guard_event_moderation BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.audit_guard_moderation();
DROP TRIGGER IF EXISTS "audit_guard_payout_requests" ON public.payout_requests;
CREATE TRIGGER audit_guard_payout_requests BEFORE INSERT OR DELETE OR UPDATE ON public.payout_requests FOR EACH ROW EXECUTE FUNCTION public.audit_server_write_only();
DROP TRIGGER IF EXISTS "audit_guard_post_moderation" ON public.posts;
CREATE TRIGGER audit_guard_post_moderation BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.audit_guard_moderation();
DROP TRIGGER IF EXISTS "audit_guard_safety_insert" ON public.safety_alerts;
CREATE TRIGGER audit_guard_safety_insert BEFORE INSERT ON public.safety_alerts FOR EACH ROW EXECUTE FUNCTION public.audit_server_write_only();
DROP TRIGGER IF EXISTS "audit_guard_safety_update" ON public.safety_alerts;
CREATE TRIGGER audit_guard_safety_update BEFORE UPDATE ON public.safety_alerts FOR EACH ROW EXECUTE FUNCTION public.audit_guard_safety_update();
DROP TRIGGER IF EXISTS "audit_guard_seller_accounts" ON public.seller_accounts;
CREATE TRIGGER audit_guard_seller_accounts BEFORE INSERT OR DELETE OR UPDATE ON public.seller_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_server_write_only();
DROP TRIGGER IF EXISTS "audit_guard_ticket_insert" ON public.tickets;
CREATE TRIGGER audit_guard_ticket_insert BEFORE INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.audit_server_write_only();
DROP TRIGGER IF EXISTS "audit_guard_user_trust" ON public.users;
CREATE TRIGGER audit_guard_user_trust BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.audit_guard_user_trust();
