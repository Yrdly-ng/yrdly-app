-- =============================================================================
-- Communities Fix Migration 20261003010003
-- Fix PostgreSQL 42P17: "infinite recursion detected in policy for relation community_memberships"
-- Uses SECURITY DEFINER function to break subquery self-reference loop.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_community_mod_or_admin(p_community_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_memberships
    WHERE community_id = p_community_id
      AND user_id = p_user_id
      AND role IN ('moderator', 'admin')
      AND status = 'active'
  );
$$;

DROP POLICY IF EXISTS "memberships_select_own" ON public.community_memberships;
CREATE POLICY "memberships_select_own" ON public.community_memberships FOR SELECT TO authenticated, anon USING (
  user_id = auth.uid()
  OR public.is_community_mod_or_admin(community_id, auth.uid())
);

DROP POLICY IF EXISTS "memberships_mod_update" ON public.community_memberships;
CREATE POLICY "memberships_mod_update" ON public.community_memberships FOR UPDATE TO authenticated USING (
  public.is_community_mod_or_admin(community_id, auth.uid())
);

GRANT SELECT ON public.communities TO authenticated, anon;
GRANT SELECT ON public.community_memberships TO authenticated, anon;
GRANT SELECT ON public.community_posts TO authenticated, anon;
GRANT SELECT ON public.community_comments TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
