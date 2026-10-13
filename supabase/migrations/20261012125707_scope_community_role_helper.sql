-- RLS and the community approval/content functions ask about their own caller.
-- Keep that recursion-safe lookup while removing the arbitrary-user role oracle.
CREATE OR REPLACE FUNCTION public.is_community_mod_or_admin(p_community_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND p_user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.community_memberships
    WHERE community_id = p_community_id AND user_id = auth.uid()
      AND role IN ('moderator', 'admin') AND status = 'active'
  );
$$;

-- Anonymous SELECT policies call the helper with auth.uid() = NULL. It must
-- remain callable for those policies, and always returns false for that caller.
REVOKE ALL ON FUNCTION public.is_community_mod_or_admin(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_community_mod_or_admin(uuid,uuid) TO anon,authenticated,service_role;

-- These mutations already require a verified actor in their bodies. Remove
-- the unnecessary anonymous API grant without changing signed-in callers.
REVOKE EXECUTE ON FUNCTION public.accept_community_invite(uuid),
  public.approve_community_join_request(uuid,uuid),
  public.community_toggle_post_like(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_community_invite(uuid),
  public.approve_community_join_request(uuid,uuid),
  public.community_toggle_post_like(uuid,uuid,text) TO authenticated,service_role;

-- Trigger execution uses the table trigger; clients never call these as RPCs.
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

NOTIFY pgrst, 'reload schema';
