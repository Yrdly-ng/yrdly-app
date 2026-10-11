-- Additive hardening. Bodies were inspected against the actual QA schema.
-- Keep pg_temp explicit and last so temporary tables cannot shadow public ones.
BEGIN;
ALTER FUNCTION public.update_business_staff_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_community_comment_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_auto_join_ward_community() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_quote_requests_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_community_post_rate_limit() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_community_member_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.refresh_seller_review_aggregate(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.reset_conversation_deleted_by() SET search_path = public, pg_temp;
ALTER FUNCTION public.scan_ticket(text, uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_ticket_checked_in() SET search_path = public, pg_temp;
ALTER FUNCTION public.tr_update_post_comment_count() SET search_path = public, pg_temp;
COMMIT;
