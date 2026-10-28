-- Extend existing social-engagement guards to business promotions on the home feed.
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

  IF lower(btrim(coalesce(v_category, ''))) = ANY (ARRAY['event', 'for sale', 'selling', 'giveaway', 'business', 'marketplace']) THEN
    RAISE EXCEPTION 'Likes and comments are unavailable for events, business posts and marketplace listings'
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
    IF lower(btrim(coalesce(v_category, ''))) = ANY (ARRAY['event', 'for sale', 'selling', 'giveaway', 'business', 'marketplace']) THEN
      RAISE EXCEPTION 'Likes are unavailable for events, business posts and marketplace listings'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_restricted_post_likes() FROM PUBLIC, anon, authenticated;
