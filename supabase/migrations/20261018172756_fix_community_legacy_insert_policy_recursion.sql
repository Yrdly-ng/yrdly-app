BEGIN;
-- The legacy BEFORE INSERT adapter consumes authenticated writes and performs
-- the checked insertion as the command owner. No row reaches this policy.
-- Old insert policies traversed communities/invites back into memberships.
DROP POLICY IF EXISTS memberships_insert_open ON public.community_memberships;
DROP POLICY IF EXISTS memberships_insert_invite ON public.community_memberships;
DROP POLICY IF EXISTS memberships_insert_mod ON public.community_memberships;
CREATE POLICY memberships_insert_via_command ON public.community_memberships
 FOR INSERT TO authenticated WITH CHECK(false);
NOTIFY pgrst,'reload schema';
COMMIT;
