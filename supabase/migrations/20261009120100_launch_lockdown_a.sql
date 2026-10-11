-- Apply ONLY after the matching web code is deployed and shared-backend clients are verified.
-- public_profiles_a is an additive prerequisite, applied separately before deployment.
BEGIN;
CREATE OR REPLACE FUNCTION public.audit_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin);
$$;
REVOKE ALL ON FUNCTION public.audit_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_is_admin() TO anon, authenticated, service_role;

CREATE UNIQUE INDEX users_payluk_customer_unique ON public.users(payluk_customer_id)
WHERE payluk_customer_id IS NOT NULL;
DROP POLICY "Users can read all users" ON public.users;
CREATE POLICY users_private_read ON public.users FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()) OR (SELECT public.audit_is_admin()));

CREATE OR REPLACE FUNCTION public.audit_guard_user_trust() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
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
END; $$;
CREATE TRIGGER audit_guard_user_trust BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.audit_guard_user_trust();

CREATE OR REPLACE FUNCTION public.audit_server_write_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'This write requires a server operation' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
DROP POLICY "Users can create escrow transactions" ON public.escrow_transactions;
DROP POLICY "Users can update own escrow transactions" ON public.escrow_transactions;
CREATE TRIGGER audit_guard_escrow BEFORE INSERT OR UPDATE OR DELETE ON public.escrow_transactions
FOR EACH ROW EXECUTE FUNCTION public.audit_server_write_only();
DROP POLICY "Users can manage own seller accounts" ON public.seller_accounts;
CREATE POLICY seller_accounts_owner_read ON public.seller_accounts FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY "Users can manage own payout requests" ON public.payout_requests;
CREATE POLICY payout_requests_owner_read ON public.payout_requests FOR SELECT TO authenticated USING (seller_id = (SELECT auth.uid()));
CREATE TRIGGER audit_guard_seller_accounts BEFORE INSERT OR UPDATE OR DELETE ON public.seller_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_server_write_only();
CREATE TRIGGER audit_guard_payout_requests BEFORE INSERT OR UPDATE OR DELETE ON public.payout_requests FOR EACH ROW EXECUTE FUNCTION public.audit_server_write_only();
DROP POLICY tickets_insert_own ON public.tickets;
DROP POLICY "Organizers can view and update tickets for their events" ON public.tickets;
CREATE POLICY tickets_organizer_read ON public.tickets FOR SELECT TO authenticated USING
(EXISTS (SELECT 1 FROM public.events WHERE events.id = tickets.event_id AND events.organizer_id = (SELECT auth.uid())));
ALTER TABLE public.tickets ALTER COLUMN status SET DEFAULT 'CANCELLED';
CREATE TRIGGER audit_guard_ticket_insert BEFORE INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.audit_server_write_only();

DROP POLICY "Customers create bookings" ON public.bookings;
CREATE POLICY bookings_unpaid_insert ON public.bookings FOR INSERT TO authenticated
WITH CHECK (customer_id = (SELECT auth.uid()) AND status = 'requested' AND payment_status = 'unpaid');
CREATE OR REPLACE FUNCTION public.audit_guard_booking_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF NEW.customer_id IS DISTINCT FROM auth.uid() OR NEW.status <> 'requested' OR NEW.payment_status <> 'unpaid' THEN
    RAISE EXCEPTION 'Bookings must start requested and unpaid' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER audit_guard_booking_insert BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.audit_guard_booking_insert();

DROP POLICY "Anyone can insert safety alerts" ON public.safety_alerts;
DROP POLICY "Anyone can update safety alerts" ON public.safety_alerts;
DROP POLICY "Anyone can view all safety alerts" ON public.safety_alerts;
CREATE POLICY safety_read ON public.safety_alerts FOR SELECT USING (status = 'approved' OR user_id = (SELECT auth.uid()) OR (SELECT public.audit_is_admin()));
CREATE POLICY safety_author_update ON public.safety_alerts FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE TRIGGER audit_guard_safety_insert BEFORE INSERT ON public.safety_alerts FOR EACH ROW EXECUTE FUNCTION public.audit_server_write_only();
CREATE OR REPLACE FUNCTION public.audit_guard_safety_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.status IS DISTINCT FROM OLD.status OR
     NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending alert content can be edited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER audit_guard_safety_update BEFORE UPDATE ON public.safety_alerts FOR EACH ROW EXECUTE FUNCTION public.audit_guard_safety_update();

CREATE OR REPLACE FUNCTION public.audit_guard_conversation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF ROW(NEW.participant_ids,NEW.type,NEW.created_by,NEW.admin_ids) IS DISTINCT FROM
     ROW(OLD.participant_ids,OLD.type,OLD.created_by,OLD.admin_ids) THEN
    RAISE EXCEPTION 'Conversation membership is server managed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER audit_guard_conversation BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.audit_guard_conversation();
CREATE OR REPLACE FUNCTION public.check_message_update_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - ARRAY['text','content','image_url','video_url','media_url','media_type','read_by','deleted_by','is_read','updated_at','edited_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['text','content','image_url','video_url','media_url','media_type','read_by','deleted_by','is_read','updated_at','edited_at']) THEN
    RAISE EXCEPTION 'Message identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF ROW(NEW.text,to_jsonb(NEW)->'content',NEW.image_url,NEW.video_url,NEW.media_url,NEW.media_type) IS DISTINCT FROM
     ROW(OLD.text,to_jsonb(OLD)->'content',OLD.image_url,OLD.video_url,OLD.media_url,OLD.media_type) THEN
    IF OLD.sender_id IS DISTINCT FROM auth.uid() OR OLD.created_at < now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'Only the sender can edit recent content' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF ARRAY(SELECT x FROM unnest(COALESCE(NEW.read_by,'{}'::text[])) x WHERE x <> auth.uid()::text ORDER BY x)
      IS DISTINCT FROM ARRAY(SELECT x FROM unnest(COALESCE(OLD.read_by,'{}'::text[])) x WHERE x <> auth.uid()::text ORDER BY x)
    OR ARRAY(SELECT x FROM unnest(COALESCE(NEW.deleted_by,'{}'::text[])) x WHERE x <> auth.uid()::text ORDER BY x)
      IS DISTINCT FROM ARRAY(SELECT x FROM unnest(COALESCE(OLD.deleted_by,'{}'::text[])) x WHERE x <> auth.uid()::text ORDER BY x) THEN
    RAISE EXCEPTION 'Read and deletion markers belong to each participant' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP POLICY "Allow select on posts" ON public.posts;
CREATE POLICY posts_visible ON public.posts FOR SELECT USING
(user_id = (SELECT auth.uid()) OR (moderation_status = 'approved' AND (
 COALESCE(visibility,'public') ILIKE 'public' OR (visibility ILIKE 'friends' AND
 EXISTS(SELECT 1 FROM public.followers WHERE follower_id = auth.uid() AND following_id = posts.user_id) AND
 EXISTS(SELECT 1 FROM public.followers WHERE follower_id = posts.user_id AND following_id = auth.uid()))
)) OR (SELECT public.audit_is_admin()));
DROP POLICY "Public can view published events" ON public.events;
CREATE POLICY events_visible ON public.events FOR SELECT USING
(status = 'PUBLISHED' AND moderation_status = 'approved');
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
CREATE TRIGGER audit_guard_event_moderation BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.audit_guard_moderation();

REVOKE ALL ON FUNCTION public.create_notification(uuid,varchar,varchar,text,uuid,uuid,varchar,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.remove_notification_actor(uuid,varchar,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid,varchar,varchar,text,uuid,uuid,varchar,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_notification_actor(uuid,varchar,uuid,uuid) TO service_role;
ALTER FUNCTION public.create_notification(uuid,varchar,varchar,text,uuid,uuid,varchar,jsonb) SET search_path = public,pg_temp;
ALTER FUNCTION public.remove_notification_actor(uuid,varchar,uuid,uuid) SET search_path = public,pg_temp;
CREATE OR REPLACE FUNCTION public.toggle_post_like(p_post_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_liked_by UUID[];
  v_is_liked BOOLEAN;
  v_new_liked_by UUID[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Like actor must match session' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.posts WHERE id = p_post_id AND (user_id = auth.uid() OR moderation_status = 'approved')) THEN
      RAISE EXCEPTION 'Post unavailable' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT COALESCE(liked_by, ARRAY[]::UUID[]) INTO v_liked_by
  FROM public.posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post % not found', p_post_id;
  END IF;

  v_is_liked := (p_user_id = ANY(v_liked_by));

  IF v_is_liked THEN
    SELECT ARRAY_AGG(elem) INTO v_new_liked_by
    FROM UNNEST(v_liked_by) AS elem
    WHERE elem <> p_user_id;

    v_new_liked_by := COALESCE(v_new_liked_by, ARRAY[]::UUID[]);
  ELSE
    v_new_liked_by := ARRAY_APPEND(COALESCE(v_liked_by, ARRAY[]::UUID[]), p_user_id);
  END IF;

  UPDATE public.posts
  SET liked_by = v_new_liked_by
  WHERE id = p_post_id;

  RETURN jsonb_build_object(
    'is_liked', NOT v_is_liked,
    'likes_count', CARDINALITY(v_new_liked_by),
    'liked_by', v_new_liked_by
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.toggle_post_like(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.toggle_post_like(uuid,uuid) TO authenticated,service_role;

DROP POLICY "Allow users to delete their own chat images" ON storage.objects;
DROP POLICY "Allow users to update their own chat images" ON storage.objects;
DROP POLICY "Users can delete their own chat images" ON storage.objects;
DROP POLICY "Users can update their own chat images" ON storage.objects;
DROP POLICY "Authenticated users can delete post images" ON storage.objects;
DROP POLICY "Authenticated users can update post images" ON storage.objects;
DROP POLICY "Allow authenticated users to view chat images" ON storage.objects;
DROP POLICY "Service upload brand-assets" ON storage.objects;
CREATE POLICY audit_owned_media_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id IN ('post-images','chat-images') AND owner_id = (SELECT auth.uid())::text)
WITH CHECK (bucket_id IN ('post-images','chat-images') AND owner_id = (SELECT auth.uid())::text);
CREATE POLICY audit_owned_media_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id IN ('post-images','chat-images') AND owner_id = (SELECT auth.uid())::text);
CREATE POLICY audit_chat_media_read ON storage.objects FOR SELECT TO authenticated USING
(bucket_id = 'chat-images' AND (owner_id = (SELECT auth.uid())::text OR EXISTS
 (SELECT 1 FROM public.conversations c WHERE (SELECT auth.uid()) = ANY(c.participant_ids)
 AND c.id::text = CASE WHEN (storage.foldername(name))[1] = 'chat'
 THEN (storage.foldername(name))[2] ELSE (storage.foldername(name))[1] END)));
UPDATE storage.buckets SET file_size_limit = 5242880,
allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/svg+xml'] WHERE id = 'brand-assets';
-- Public bucket URLs still bypass SELECT policies: private media conversion is separate.
COMMIT;
NOTIFY pgrst, 'reload schema';
