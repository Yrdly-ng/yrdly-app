-- YRDLY production security and performance advisor remediation.
-- Safe to reapply: indexes and policy drops are idempotent.

ALTER FUNCTION public.toggle_post_like(uuid, uuid) SET search_path = '';

CREATE OR REPLACE FUNCTION public.is_community_mod_or_admin(p_community_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND p_user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.community_memberships
    WHERE community_id = p_community_id AND user_id = auth.uid()
      AND role IN ('moderator', 'admin') AND status = 'active'
  );
$$;
REVOKE ALL ON FUNCTION public.is_community_mod_or_admin(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_community_mod_or_admin(uuid,uuid) TO anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.accept_community_invite(uuid),
  public.approve_community_join_request(uuid,uuid),
  public.community_toggle_post_like(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_community_invite(uuid),
  public.approve_community_join_request(uuid,uuid),
  public.community_toggle_post_like(uuid,uuid,text) TO authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.fn_community_comment_count(),
  public.fn_auto_join_ward_community(),
  public.fn_check_community_post_rate_limit(),
  public.fn_community_member_count(),
  public.guard_booking_payment_and_status(),
  public.guard_community_content(),
  public.guard_community_membership_update(),
  public.guard_quote_request_write(),
  public.guard_ticket_client_update(),
  public.prevent_paid_marketplace_listing_delete(),
  public.queue_community_content_for_moderation(),
  public.reset_conversation_deleted_by(),
  public.tr_update_post_comment_count() FROM PUBLIC,anon,authenticated;

DROP POLICY IF EXISTS "Enable select for admin sessions" ON public.admin_sessions;
DROP POLICY IF EXISTS "Enable insert for admin sessions" ON public.admin_sessions;
REVOKE ALL PRIVILEGES ON TABLE public.admin_sessions FROM anon,authenticated;

CREATE INDEX IF NOT EXISTS idx_communities_owner_id ON public.communities (owner_id);
CREATE INDEX IF NOT EXISTS idx_communities_reviewed_by ON public.communities (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_communities_ward_id ON public.communities (ward_id);
CREATE INDEX IF NOT EXISTS idx_push_notification_deliveries_notification_id ON public.push_notification_deliveries (notification_id);
CREATE INDEX IF NOT EXISTS idx_push_notification_deliveries_user_id ON public.push_notification_deliveries (user_id);

DO $$
DECLARE r record; q text; w text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname='public'
      AND (
        (coalesce(qual,'') LIKE '%auth.uid()%' AND coalesce(qual,'') NOT LIKE '%SELECT auth.uid()%')
        OR
        (coalesce(with_check,'') LIKE '%auth.uid()%' AND coalesce(with_check,'') NOT LIKE '%SELECT auth.uid()%')
      )
  LOOP
    q := CASE WHEN r.qual IS NULL THEN NULL ELSE replace(r.qual, 'auth.uid()', '(select auth.uid())') END;
    w := CASE WHEN r.with_check IS NULL THEN NULL ELSE replace(r.with_check, 'auth.uid()', '(select auth.uid())') END;
    EXECUTE format('ALTER POLICY %I ON %I.%I %s %s',
      r.policyname, r.schemaname, r.tablename,
      CASE WHEN q IS NULL THEN '' ELSE format('USING (%s)', q) END,
      CASE WHEN w IS NULL THEN '' ELSE format('WITH CHECK (%s)', w) END
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
