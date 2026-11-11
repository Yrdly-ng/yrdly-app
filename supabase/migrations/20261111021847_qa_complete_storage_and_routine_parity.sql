-- QA-ONLY migration. Exact schema parity with approved production definitions.
-- NO PRODUCTION DEPLOYMENT. Does not copy user data, storage objects, keys or balances.
-- Produced from read-only pg_catalog definitions of YRDLY production (11 Nov 2026).

-- Fix a missing index and one column default for the empty QA copy.
CREATE UNIQUE INDEX users_payluk_customer_unique ON public.users USING btree (payluk_customer_id) WHERE (payluk_customer_id IS NOT NULL);
ALTER TABLE public.tickets ALTER COLUMN status SET DEFAULT 'CANCELLED'::text;

-- Restore the three current production notification/engagement function bodies.
CREATE OR REPLACE FUNCTION public.create_notification(p_user_id uuid, p_type character varying, p_title character varying, p_message text, p_sender_id uuid DEFAULT NULL::uuid, p_related_id uuid DEFAULT NULL::uuid, p_related_type character varying DEFAULT NULL::character varying, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_notification_id UUID;
    v_existing_id UUID;
    v_was_read BOOLEAN;
    v_actor_ids UUID[];
    v_new_actor_ids UUID[];
    v_actor_count INT;
    v_sender_name TEXT;
    v_other_name TEXT;
    v_new_message TEXT := p_message;
    v_recent_threshold TIMESTAMP := NOW() - INTERVAL '24 hours';
BEGIN
    -- Grouping logic for post_like
    IF p_type = 'post_like' AND p_related_id IS NOT NULL AND p_sender_id IS NOT NULL THEN
        SELECT id, is_read, COALESCE(ARRAY(SELECT jsonb_array_elements_text(data->'actor_ids')::uuid), ARRAY[sender_id])
        INTO v_existing_id, v_was_read, v_actor_ids
        FROM public.notifications
        WHERE user_id = p_user_id AND type = p_type AND related_id = p_related_id AND created_at >= v_recent_threshold
        ORDER BY created_at DESC LIMIT 1
        FOR UPDATE;

        IF v_existing_id IS NOT NULL THEN
            IF NOT p_sender_id = ANY(v_actor_ids) THEN
                v_new_actor_ids := array_prepend(p_sender_id, v_actor_ids);
                v_actor_count := array_length(v_new_actor_ids, 1);

                SELECT name INTO v_sender_name FROM public.users WHERE id = v_new_actor_ids[1];
                
                IF v_actor_count = 2 THEN
                    SELECT name INTO v_other_name FROM public.users WHERE id = v_new_actor_ids[2];
                    v_new_message := v_sender_name || ' and ' || v_other_name || ' liked your post';
                ELSIF v_actor_count = 3 THEN
                    SELECT name INTO v_other_name FROM public.users WHERE id = v_new_actor_ids[2];
                    v_new_message := v_sender_name || ', ' || v_other_name || ' and 1 other liked your post';
                ELSIF v_actor_count > 3 THEN
                    SELECT name INTO v_other_name FROM public.users WHERE id = v_new_actor_ids[2];
                    v_new_message := v_sender_name || ', ' || v_other_name || ' and ' || (v_actor_count - 2) || ' others liked your post';
                END IF;

                UPDATE public.notifications
                SET sender_id = p_sender_id, message = v_new_message, is_read = false, updated_at = NOW(),
                    data = jsonb_set(jsonb_set(COALESCE(data, '{}'::jsonb), '{actor_ids}', to_jsonb(v_new_actor_ids)), '{actor_count}', to_jsonb(v_actor_count))
                WHERE id = v_existing_id
                RETURNING id INTO v_notification_id;

                -- Push only if it was previously read
                RETURN jsonb_build_object('id', v_notification_id, 'should_push', v_was_read, 'message', v_new_message);
            ELSE
                RETURN jsonb_build_object('id', v_existing_id, 'should_push', false);
            END IF;
        END IF;
    END IF;

    -- Default insert behavior
    IF p_type = 'post_like' AND p_sender_id IS NOT NULL THEN
        p_data := jsonb_set(jsonb_set(COALESCE(p_data, '{}'::jsonb), '{actor_ids}', to_jsonb(ARRAY[p_sender_id])), '{actor_count}', '1'::jsonb);
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, sender_id, related_id, related_type, data) 
    VALUES (p_user_id, p_type, p_title, p_message, p_sender_id, p_related_id, p_related_type, p_data) 
    RETURNING id INTO v_notification_id;

    RETURN jsonb_build_object('id', v_notification_id, 'should_push', true, 'message', p_message);
END;
$function$


CREATE OR REPLACE FUNCTION public.remove_notification_actor(p_user_id uuid, p_type character varying, p_sender_id uuid, p_related_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_notification RECORD;
    v_actor_ids UUID[];
    v_new_actor_ids UUID[];
    v_actor_count INT;
    v_sender_name TEXT;
    v_other_name TEXT;
    v_new_message TEXT;
BEGIN
    SELECT id, message, COALESCE(ARRAY(SELECT jsonb_array_elements_text(data->'actor_ids')::uuid), ARRAY[sender_id]) as actors, data
    INTO v_notification
    FROM public.notifications
    WHERE user_id = p_user_id AND type = p_type AND related_id = p_related_id
    ORDER BY created_at DESC LIMIT 1
    FOR UPDATE;

    IF v_notification.id IS NOT NULL THEN
        v_actor_ids := v_notification.actors;
        
        IF p_sender_id = ANY(v_actor_ids) THEN
            SELECT array_agg(a) INTO v_new_actor_ids FROM unnest(v_actor_ids) a WHERE a != p_sender_id;
            v_actor_count := COALESCE(array_length(v_new_actor_ids, 1), 0);

            IF v_actor_count = 0 THEN
                DELETE FROM public.notifications WHERE id = v_notification.id;
                RETURN true;
            ELSE
                SELECT name INTO v_sender_name FROM public.users WHERE id = v_new_actor_ids[1];
                IF v_actor_count = 1 THEN
                    v_new_message := v_sender_name || ' liked your post';
                ELSIF v_actor_count = 2 THEN
                    SELECT name INTO v_other_name FROM public.users WHERE id = v_new_actor_ids[2];
                    v_new_message := v_sender_name || ' and ' || v_other_name || ' liked your post';
                ELSIF v_actor_count = 3 THEN
                    SELECT name INTO v_other_name FROM public.users WHERE id = v_new_actor_ids[2];
                    v_new_message := v_sender_name || ', ' || v_other_name || ' and 1 other liked your post';
                ELSIF v_actor_count > 3 THEN
                    SELECT name INTO v_other_name FROM public.users WHERE id = v_new_actor_ids[2];
                    v_new_message := v_sender_name || ', ' || v_other_name || ' and ' || (v_actor_count - 2) || ' others liked your post';
                END IF;

                -- Crucial: updating sender_id, message, and array but explicitly NOT touching is_read
                UPDATE public.notifications
                SET sender_id = v_new_actor_ids[1], message = v_new_message, updated_at = NOW(),
                    data = jsonb_set(jsonb_set(COALESCE(v_notification.data, '{}'::jsonb), '{actor_ids}', to_jsonb(v_new_actor_ids)), '{actor_count}', to_jsonb(v_actor_count))
                WHERE id = v_notification.id;
                RETURN true;
            END IF;
        END IF;
    END IF;
    RETURN false;
END;
$function$


CREATE OR REPLACE FUNCTION public.toggle_post_like(p_post_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
$function$


-- Drop only obsolete QA storage policies that no longer exist in production.
DROP POLICY IF EXISTS "Allow authenticated users to upload chat images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to view chat images" ON storage.objects;
DROP POLICY IF EXISTS "Allow users to delete their own chat images" ON storage.objects;
DROP POLICY IF EXISTS "Allow users to update their own chat images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete post images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update post images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users upload chat videos" ON storage.objects;
DROP POLICY IF EXISTS "Public read report images" ON storage.objects;
DROP POLICY IF EXISTS "Service upload brand-assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own chat images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own chat images" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload report images to their folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own chat images" ON storage.objects;

-- Reapply precisely scoped production chat, post and report storage policies.
DROP POLICY IF EXISTS "audit_chat_media_delete" ON storage.objects;
CREATE POLICY "audit_chat_media_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = ANY (ARRAY['chat-images'::text, 'chat-videos'::text])) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((( SELECT auth.uid() AS uid) = ANY (c.participant_ids)) AND ((c.id)::text =
        CASE
            WHEN ((storage.foldername(objects.name))[1] = 'chat'::text) THEN (storage.foldername(objects.name))[2]
            ELSE (storage.foldername(objects.name))[1]
        END))))));

DROP POLICY IF EXISTS "audit_chat_media_insert" ON storage.objects;
CREATE POLICY "audit_chat_media_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = ANY (ARRAY['chat-images'::text, 'chat-videos'::text])) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((( SELECT auth.uid() AS uid) = ANY (c.participant_ids)) AND ((c.id)::text =
        CASE
            WHEN ((storage.foldername(objects.name))[1] = 'chat'::text) THEN (storage.foldername(objects.name))[2]
            ELSE (storage.foldername(objects.name))[1]
        END))))));

DROP POLICY IF EXISTS "audit_chat_media_read" ON storage.objects;
CREATE POLICY "audit_chat_media_read" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = ANY (ARRAY['chat-images'::text, 'chat-videos'::text])) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((( SELECT auth.uid() AS uid) = ANY (c.participant_ids)) AND ((c.id)::text =
        CASE
            WHEN ((storage.foldername(objects.name))[1] = 'chat'::text) THEN (storage.foldername(objects.name))[2]
            ELSE (storage.foldername(objects.name))[1]
        END))))));

DROP POLICY IF EXISTS "audit_chat_media_update" ON storage.objects;
CREATE POLICY "audit_chat_media_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = ANY (ARRAY['chat-images'::text, 'chat-videos'::text])) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((( SELECT auth.uid() AS uid) = ANY (c.participant_ids)) AND ((c.id)::text =
        CASE
            WHEN ((storage.foldername(objects.name))[1] = 'chat'::text) THEN (storage.foldername(objects.name))[2]
            ELSE (storage.foldername(objects.name))[1]
        END)))))) WITH CHECK (((bucket_id = ANY (ARRAY['chat-images'::text, 'chat-videos'::text])) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((( SELECT auth.uid() AS uid) = ANY (c.participant_ids)) AND ((c.id)::text =
        CASE
            WHEN ((storage.foldername(objects.name))[1] = 'chat'::text) THEN (storage.foldername(objects.name))[2]
            ELSE (storage.foldername(objects.name))[1]
        END))))));

DROP POLICY IF EXISTS "audit_owned_media_delete" ON storage.objects;
CREATE POLICY "audit_owned_media_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'post-images'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text)));

DROP POLICY IF EXISTS "audit_owned_media_update" ON storage.objects;
CREATE POLICY "audit_owned_media_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'post-images'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text))) WITH CHECK (((bucket_id = 'post-images'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text)));

DROP POLICY IF EXISTS "audit_report_media_delete" ON storage.objects;
CREATE POLICY "audit_report_media_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'reports'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

DROP POLICY IF EXISTS "audit_report_media_insert" ON storage.objects;
CREATE POLICY "audit_report_media_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'reports'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

DROP POLICY IF EXISTS "audit_report_media_read" ON storage.objects;
CREATE POLICY "audit_report_media_read" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'reports'::text) AND (((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) OR ( SELECT audit_is_admin() AS audit_is_admin))));

DROP POLICY IF EXISTS "audit_report_media_update" ON storage.objects;
CREATE POLICY "audit_report_media_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'reports'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text))) WITH CHECK (((bucket_id = 'reports'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

