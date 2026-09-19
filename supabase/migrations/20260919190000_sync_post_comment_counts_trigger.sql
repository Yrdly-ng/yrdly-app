-- Migration: Automatic Database Trigger for Post Comment Count Synchronization

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

-- Sync current counts for all existing posts
UPDATE public.posts p
SET comment_count = (
  SELECT COUNT(*)
  FROM public.comments c
  WHERE c.post_id = p.id
);
