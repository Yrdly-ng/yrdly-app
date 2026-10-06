-- Community submissions remain private until a staff member approves them.
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_communities_pending_review
  ON public.communities(created_at DESC) WHERE approval_status = 'pending';

DROP POLICY IF EXISTS "communities_select" ON public.communities;
CREATE POLICY "communities_select" ON public.communities FOR SELECT TO authenticated USING (
  (approval_status = 'approved' AND (
    privacy IN ('open', 'request')
    OR EXISTS (
      SELECT 1 FROM public.community_memberships m
      WHERE m.community_id = communities.id AND m.user_id = (SELECT auth.uid()) AND m.status = 'active'
    )
  ))
  OR created_by = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid()) AND (u.is_admin = true OR u.role IN ('admin', 'moderator'))
  )
);

DROP POLICY IF EXISTS "communities_admin_insert" ON public.communities;
CREATE POLICY "communities_admin_insert" ON public.communities FOR INSERT TO authenticated WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid()) AND (u.is_admin = true OR u.role = 'admin')
  )
);

CREATE POLICY "communities_verified_submission" ON public.communities FOR INSERT TO authenticated WITH CHECK (
  created_by = (SELECT auth.uid())
  AND type = 'interest'
  AND is_official = false
  AND approval_status = 'pending'
  AND char_length(btrim(name)) BETWEEN 3 AND 60
  AND char_length(btrim(coalesce(description, ''))) BETWEEN 1 AND 500
  AND EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.phone_verified = true
  )
);

DROP POLICY IF EXISTS "communities_admin_update" ON public.communities;
CREATE POLICY "communities_staff_update" ON public.communities FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid()) AND (u.is_admin = true OR u.role IN ('admin', 'moderator'))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid()) AND (u.is_admin = true OR u.role IN ('admin', 'moderator'))
  )
);

DROP POLICY IF EXISTS "memberships_insert_open" ON public.community_memberships;
CREATE POLICY "memberships_insert_open" ON public.community_memberships FOR INSERT TO authenticated WITH CHECK (
  user_id = (SELECT auth.uid()) AND status = 'active' AND role = 'member' AND
  EXISTS (
    SELECT 1 FROM public.communities c
    WHERE c.id = community_id AND c.privacy = 'open' AND c.approval_status = 'approved'
  )
);

CREATE OR REPLACE FUNCTION public.fn_community_owner_on_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.approval_status = 'pending' AND NEW.approval_status = 'approved' AND NEW.created_by IS NOT NULL THEN
    INSERT INTO public.community_memberships (community_id, user_id, role, status, is_auto_joined)
    VALUES (NEW.id, NEW.created_by, 'admin', 'active', false)
    ON CONFLICT (community_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_community_owner_on_approval ON public.communities;
CREATE TRIGGER tr_community_owner_on_approval
  AFTER UPDATE OF approval_status ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.fn_community_owner_on_approval();

REVOKE ALL ON FUNCTION public.fn_community_owner_on_approval() FROM PUBLIC, anon, authenticated;
