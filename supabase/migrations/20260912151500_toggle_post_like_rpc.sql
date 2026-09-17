CREATE OR REPLACE FUNCTION public.toggle_post_like(p_post_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_liked_by UUID[];
  v_is_liked BOOLEAN;
  v_new_liked_by UUID[];
BEGIN
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
$$;

GRANT EXECUTE ON FUNCTION public.toggle_post_like(UUID, UUID) TO authenticated, service_role, anon;

