-- Toggle like on community_post and sync like_count atomically
CREATE OR REPLACE FUNCTION public.community_toggle_post_like(
  p_post_id UUID,
  p_user_id UUID,
  p_action  TEXT  -- 'like' | 'unlike'
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_action = 'like' THEN
    INSERT INTO public.community_post_likes(post_id, user_id)
    VALUES (p_post_id, p_user_id)
    ON CONFLICT DO NOTHING;
    UPDATE public.community_posts
    SET like_count = (SELECT COUNT(*) FROM public.community_post_likes WHERE post_id = p_post_id),
        updated_at = NOW()
    WHERE id = p_post_id;
  ELSE
    DELETE FROM public.community_post_likes WHERE post_id = p_post_id AND user_id = p_user_id;
    UPDATE public.community_posts
    SET like_count = (SELECT COUNT(*) FROM public.community_post_likes WHERE post_id = p_post_id),
        updated_at = NOW()
    WHERE id = p_post_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.community_toggle_post_like(UUID, UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.community_toggle_post_like(UUID, UUID, TEXT) TO authenticated;
