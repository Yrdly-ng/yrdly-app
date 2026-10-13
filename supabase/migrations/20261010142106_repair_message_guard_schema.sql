-- Correct the staged message guard without assuming an optional content column exists.
-- Apply after launch_lockdown_a; verified against the isolated Staging branch.
BEGIN;
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
COMMIT;
NOTIFY pgrst, 'reload schema';
