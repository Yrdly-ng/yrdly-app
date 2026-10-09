-- Additive prerequisites: apply B and D before deploying the new money handlers.
BEGIN;
ALTER TABLE public.users
 ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS is_banned boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
 ADD COLUMN IF NOT EXISTS suspension_reason text,
 ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
CREATE OR REPLACE FUNCTION public.guard_suspension_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
 IF TG_OP = 'INSERT' THEN
   IF NEW.is_suspended OR NEW.is_banned OR NEW.status <> 'active' OR NEW.suspension_reason IS NOT NULL OR NEW.suspended_at IS NOT NULL THEN
     RAISE EXCEPTION 'Suspension is server managed' USING ERRCODE = '42501';
   END IF;
 ELSIF ROW(NEW.is_suspended,NEW.is_banned,NEW.status,NEW.suspension_reason,NEW.suspended_at) IS DISTINCT FROM
       ROW(OLD.is_suspended,OLD.is_banned,OLD.status,OLD.suspension_reason,OLD.suspended_at) THEN
   RAISE EXCEPTION 'Suspension is server managed' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_suspension_fields BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_suspension_fields();

ALTER TABLE public.tickets
 ADD COLUMN IF NOT EXISTS payment_provider text CHECK(payment_provider IN ('payluk','paystack')),
 ADD COLUMN IF NOT EXISTS settlement_mode text NOT NULL DEFAULT 'unknown' CHECK(settlement_mode IN ('unknown','held','split','free'));
-- Never guess settlement mode for historical paid tickets.
UPDATE public.tickets SET settlement_mode = 'free' WHERE amount_paid = 0;
ALTER TABLE public.event_payouts ADD COLUMN IF NOT EXISTS payment_provider text CHECK(payment_provider IN ('payluk','paystack'));

CREATE TABLE IF NOT EXISTS public.payment_reconciliation_flags (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL,
 reference text NOT NULL, transaction_id uuid REFERENCES public.escrow_transactions(id),
 reason text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 UNIQUE(provider,reference,reason)
);
ALTER TABLE public.payment_reconciliation_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_reconciliation_flags FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.payment_reconciliation_flags TO service_role;

CREATE OR REPLACE FUNCTION public.finish_dispute_resolution(p_operation_id uuid, p_provider_reference text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_operation public.dispute_resolution_operations%ROWTYPE;
  v_dispute public.disputes%ROWTYPE;
  v_transaction public.escrow_transactions%ROWTYPE;
  v_new_status public.escrow_status;
BEGIN
  SELECT * INTO v_operation FROM public.dispute_resolution_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resolution operation not found' USING ERRCODE = 'P0002'; END IF;
  IF v_operation.status = 'succeeded' THEN RETURN; END IF;
  IF v_operation.status <> 'processing' THEN
    RAISE EXCEPTION 'Resolution requires reconciliation and cannot be replayed' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_dispute FROM public.disputes WHERE id = v_operation.dispute_id FOR UPDATE;
  SELECT * INTO v_transaction FROM public.escrow_transactions WHERE id = v_dispute.transaction_id FOR UPDATE;
  v_new_status := CASE WHEN v_operation.seller_amount > 0 THEN 'completed' ELSE 'cancelled' END;

  UPDATE public.disputes
  SET resolution = v_operation.resolution,
      refund_amount = v_operation.refund_amount,
      seller_amount = v_operation.seller_amount,
      status = 'resolved',
      resolved_by = v_operation.requested_by,
      resolved_at = now(),
      updated_at = now()
  WHERE id = v_dispute.id;

  UPDATE public.escrow_transactions
  SET status = v_new_status, dispute_resolved_at = now(), updated_at = now()
  WHERE id = v_transaction.id;

  IF v_new_status = 'cancelled' AND v_transaction.item_id IS NOT NULL THEN
    IF v_transaction.item_type = 'ticket' OR v_transaction.metadata ? 'event_id' THEN
      UPDATE public.tickets
      SET status = 'CANCELLED', updated_at = now()
      WHERE payment_tx_ref = v_transaction.id::text
         OR payment_provider_ref IN (v_transaction.payluk_escrow_id, v_transaction.payment_reference);
    ELSIF v_transaction.item_type = 'catalog_item' THEN
      UPDATE public.catalog_items
      SET quantity = coalesce(quantity, 0) + 1, in_stock = true, updated_at = now()
      WHERE id::text = v_transaction.item_id;
    ELSE
      UPDATE public.posts
      SET is_sold = false, sold_to_user_id = NULL, sold_at = NULL, transaction_id = NULL
      WHERE id::text = v_transaction.item_id;
    END IF;
  END IF;

  UPDATE public.dispute_resolution_operations
  SET status = 'succeeded', provider_reference = p_provider_reference,
      error_message = NULL, updated_at = now()
  WHERE id = v_operation.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_paid_marketplace_listing_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.escrow_transactions tx WHERE tx.item_id = OLD.id::text
   AND COALESCE(tx.item_type,'post') = 'post' AND tx.status <> 'cancelled') THEN
   RAISE EXCEPTION 'This listing has a transaction and cannot be deleted' USING ERRCODE = '23514';
 END IF;
 RETURN OLD;
END; $$;

CREATE OR REPLACE FUNCTION public.apply_escrow_refund(p_transaction_id uuid, p_provider_reference text, p_refund_amount numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.escrow_transactions%ROWTYPE;
BEGIN
 SELECT * INTO tx FROM public.escrow_transactions WHERE id = p_transaction_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown transaction'; END IF;
 IF tx.status = 'cancelled' THEN RETURN false; END IF;
 IF tx.status = 'completed' THEN
   INSERT INTO public.payment_reconciliation_flags(provider,reference,transaction_id,reason)
   VALUES ('payluk',p_provider_reference,tx.id,'refund_after_completion') ON CONFLICT DO NOTHING;
   RETURN false;
 END IF;
 IF p_refund_amount IS NULL OR p_refund_amount < 0 OR p_refund_amount > tx.amount THEN RAISE EXCEPTION 'Invalid refund amount'; END IF;
 UPDATE public.escrow_transactions SET status = 'cancelled', updated_at = now() WHERE id = tx.id;
 UPDATE public.disputes SET refund_amount = p_refund_amount, status = 'resolved', resolution = 'refund',
   resolved_at = now(), updated_at = now() WHERE transaction_id = tx.id;
 IF NOT FOUND THEN
   INSERT INTO public.disputes(transaction_id,opened_by,dispute_reason,status,resolution,refund_amount,resolved_at)
   VALUES(tx.id,tx.buyer_id,'Provider refund','resolved','refund',p_refund_amount,now());
 END IF;
 IF tx.item_type = 'ticket' OR tx.metadata ? 'event_id' THEN
   UPDATE public.tickets SET status = 'REFUNDED', refund_status = 'processed', updated_at = now()
   WHERE payment_tx_ref = tx.id::text OR payment_provider_ref = p_provider_reference;
 ELSIF tx.item_type = 'catalog_item' THEN
   IF tx.metadata->>'inventory_reserved' = 'true' THEN
     PERFORM public.release_catalog_stock(tx.item_id::uuid,1);
   ELSE
     INSERT INTO public.payment_reconciliation_flags(provider,reference,transaction_id,reason)
     VALUES('payluk',p_provider_reference,tx.id,'legacy_stock_refund') ON CONFLICT DO NOTHING;
   END IF;
 ELSE
   UPDATE public.posts SET is_sold = false,sold_to_user_id = NULL,sold_at = NULL,transaction_id = NULL
   WHERE id::text = tx.item_id AND transaction_id = tx.id;
 END IF;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.apply_escrow_refund(uuid,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_escrow_refund(uuid,text,numeric) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
