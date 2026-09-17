-- 1. Drop existing function to change return type
DROP FUNCTION IF EXISTS public.create_notification(uuid, character varying, character varying, text, uuid, uuid, character varying, jsonb);

-- 2. Create the new grouping-aware RPC
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id uuid,
    p_type character varying,
    p_title character varying,
    p_message text,
    p_sender_id uuid DEFAULT NULL::uuid,
    p_related_id uuid DEFAULT NULL::uuid,
    p_related_type character varying DEFAULT NULL::character varying,
    p_data jsonb DEFAULT '{}'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
$function$;

-- 3. Create the un-like removal RPC
CREATE OR REPLACE FUNCTION public.remove_notification_actor(
    p_user_id uuid,
    p_type character varying,
    p_sender_id uuid,
    p_related_id uuid
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
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
$function$;
