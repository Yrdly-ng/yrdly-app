-- Migration: Fix create_notification security mode to SECURITY DEFINER and prevent impersonation/anon exploits
-- Reason: By default, functions execute with SECURITY INVOKER (the permissions of the caller).
-- When User A (liker/follower) triggers a notification for User B (recipient), the RPC attempts to
-- INSERT a row into `notifications` with `user_id = User B`. The RLS INSERT policy requires
-- `user_id = auth.uid()`, which fails because User B != User A.
-- Setting SECURITY DEFINER allows this controlled RPC function to bypass RLS and create cross-user
-- notifications while retaining strict parameter validation inside the function body.
--
-- Security Guard 1: An impersonation check (`p_sender_id != auth.uid()`) is added to ensure an
-- authenticated user cannot pass a fake `p_sender_id` to forge notifications as another user.
-- `auth.uid() IS NOT NULL` allows trusted server-side/service-role calls (where auth.uid() is NULL) to proceed.
--
-- Security Guard 2: EXECUTE privileges are REVOKED from PUBLIC (which includes `anon`) and GRANTED only
-- to `authenticated` and `service_role`. This prevents anonymous/unauthenticated callers (whose auth.uid()
-- is also NULL) from spoofing service-role requests.

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
    -- Prevent impersonation: if a sender_id is provided by an authenticated client,
    -- it must match the caller's own auth.uid(). Server/service-role callers (where auth.uid() is NULL)
    -- are allowed through once role permission is verified (see REVOKE FROM PUBLIC below).
    IF p_sender_id IS NOT NULL AND auth.uid() IS NOT NULL AND p_sender_id != auth.uid() THEN
        RAISE EXCEPTION 'sender_id must match the authenticated caller';
    END IF;

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

-- Restrict execution: remove PUBLIC/anon access. Only authenticated
-- users and the service role should be able to call this function.
-- This closes the gap where an unauthenticated caller's NULL auth.uid()
-- would otherwise be indistinguishable from a trusted service-role call.
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, character varying, character varying, text, uuid, uuid, character varying, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, character varying, character varying, text, uuid, uuid, character varying, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, character varying, character varying, text, uuid, uuid, character varying, jsonb) TO service_role;
