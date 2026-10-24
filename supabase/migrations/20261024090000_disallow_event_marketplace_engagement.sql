-- Events and marketplace posts are transactional/discovery content, not social
-- threads. Keep community engagement in its dedicated tables unaffected.

CREATE OR REPLACE FUNCTION public.assert_post_social_engagement_enabled(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_category text;
BEGIN
  SELECT p.category INTO v_category
  FROM public.posts AS p
  WHERE p.id = p_post_id;

  IF lower(btrim(coalesce(v_category, ''))) = ANY (ARRAY['event', 'for sale', 'selling', 'giveaway']) THEN
    RAISE EXCEPTION 'Likes and comments are unavailable for events and marketplace listings'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_post_social_engagement_enabled(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_restricted_post_likes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_category text;
  v_old_likes uuid[] := coalesce(OLD.liked_by, ARRAY[]::uuid[]);
  v_new_likes uuid[] := coalesce(NEW.liked_by, ARRAY[]::uuid[]);
BEGIN
  -- Removing an old like remains allowed so stale reactions can be cleared.
  IF EXISTS (
    SELECT 1 FROM unnest(v_new_likes) AS likes(new_like)
    WHERE NOT (new_like = ANY(v_old_likes))
  ) THEN
    SELECT p.category INTO v_category FROM public.posts AS p WHERE p.id = NEW.id;
    IF lower(btrim(coalesce(v_category, ''))) = ANY (ARRAY['event', 'for sale', 'selling', 'giveaway']) THEN
      RAISE EXCEPTION 'Likes are unavailable for events and marketplace listings'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_restricted_post_likes ON public.posts;
CREATE TRIGGER guard_restricted_post_likes
  BEFORE UPDATE OF liked_by ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_restricted_post_likes();

CREATE OR REPLACE FUNCTION public.guard_restricted_post_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.assert_post_social_engagement_enabled(NEW.post_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_restricted_comment_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_post_id uuid;
BEGIN
  SELECT c.post_id INTO v_post_id
  FROM public.comments AS c
  WHERE c.id = NEW.comment_id;

  IF v_post_id IS NOT NULL THEN
    PERFORM public.assert_post_social_engagement_enabled(v_post_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_restricted_post_likes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_restricted_post_comment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_restricted_comment_like() FROM PUBLIC, anon, authenticated;

-- The base comments tables predate checked-in migrations in this repository.
-- Fail explicitly if the target database does not have them, so the app never
-- deploys with only a partial database guard.
DO $$
BEGIN
  IF to_regclass('public.comments') IS NULL OR to_regclass('public.comment_likes') IS NULL THEN
    RAISE EXCEPTION 'Expected public.comments and public.comment_likes tables before applying engagement restrictions';
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS guard_restricted_post_comment ON public.comments';
  EXECUTE 'CREATE TRIGGER guard_restricted_post_comment BEFORE INSERT OR UPDATE OF post_id, like_count ON public.comments FOR EACH ROW EXECUTE FUNCTION public.guard_restricted_post_comment()';

  EXECUTE 'DROP TRIGGER IF EXISTS guard_restricted_comment_like ON public.comment_likes';
  EXECUTE 'CREATE TRIGGER guard_restricted_comment_like BEFORE INSERT OR UPDATE OF comment_id ON public.comment_likes FOR EACH ROW EXECUTE FUNCTION public.guard_restricted_comment_like()';
END;
$$;
