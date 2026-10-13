-- Preserve the gross ruling and record Payluk's actual fee-adjusted allocation separately.
-- Additive prerequisites; install in QA before deploying the matching settlement handlers.
BEGIN;
ALTER TABLE public.dispute_resolution_operations
 ADD COLUMN provider_plan jsonb,
 ADD COLUMN provider_settlement jsonb;
ALTER TABLE public.disputes ADD COLUMN provider_settlement jsonb;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.disputes d JOIN public.escrow_transactions t ON t.id=d.transaction_id
   WHERE d.status='resolved' AND d.refund_amount>0 AND d.seller_amount>0 AND t.status='completed') THEN
  RAISE EXCEPTION 'Reconcile historical split settlements before installing the new allocation ledger';
 END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.begin_dispute_resolution(
  p_dispute_id uuid,
  p_admin_id uuid,
  p_resolution text,
  p_refund_amount numeric,
  p_seller_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dispute public.disputes%ROWTYPE;
  v_transaction public.escrow_transactions%ROWTYPE;
  v_operation public.dispute_resolution_operations%ROWTYPE;
BEGIN
  SELECT * INTO v_dispute FROM public.disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispute not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_id AND is_admin = true) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  -- Return an existing operation before checking current transaction status or
  -- request amounts. A retry after a committed resolution must never replay a payment.
  SELECT * INTO v_operation
  FROM public.dispute_resolution_operations
  WHERE dispute_id = p_dispute_id;
  IF FOUND THEN
    IF v_operation.status = 'retryable' THEN
      UPDATE public.dispute_resolution_operations
      SET status = 'processing', requested_by = p_admin_id, error_message = NULL, updated_at = now()
      WHERE id = v_operation.id
      RETURNING * INTO v_operation;
      RETURN jsonb_build_object('operation', to_jsonb(v_operation), 'newly_created', true);
    END IF;
    RETURN jsonb_build_object('operation', to_jsonb(v_operation), 'newly_created', false);
  END IF;

  IF p_resolution IS NULL OR length(trim(p_resolution)) = 0 OR length(p_resolution) > 1000 THEN
    RAISE EXCEPTION 'A valid resolution is required' USING ERRCODE = '22023';
  END IF;
  IF p_refund_amount IS NULL OR p_seller_amount IS NULL OR p_refund_amount < 0 OR p_seller_amount < 0
     OR p_refund_amount::text IN ('NaN','Infinity','-Infinity') OR p_seller_amount::text IN ('NaN','Infinity','-Infinity')
     OR round(p_refund_amount,2)<>p_refund_amount OR round(p_seller_amount,2)<>p_seller_amount THEN
    RAISE EXCEPTION 'Resolution amounts must be non-negative numbers' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_transaction FROM public.escrow_transactions WHERE id = v_dispute.transaction_id FOR UPDATE;
  IF NOT FOUND OR v_transaction.status::text <> 'disputed' THEN
    RAISE EXCEPTION 'Transaction is not in a disputed state' USING ERRCODE = '22023';
  END IF;
  IF v_transaction.payment_provider = 'payluk' AND v_dispute.provider_submission_status <> 'submitted' THEN
    RAISE EXCEPTION 'Payluk dispute must be submitted successfully before resolution' USING ERRCODE = '22023';
  END IF;
  IF v_transaction.payment_provider = 'payluk'
     AND v_dispute.provider_seller_reply_status IN ('processing', 'needs_reconciliation') THEN
    RAISE EXCEPTION 'Payluk seller reply must be reconciled before resolution' USING ERRCODE = '22023';
  END IF;
  IF v_dispute.status NOT IN ('open', 'under_review') THEN
    RAISE EXCEPTION 'Dispute is not open for resolution' USING ERRCODE = '22023';
  END IF;
  IF p_refund_amount + p_seller_amount <> v_transaction.amount THEN
    RAISE EXCEPTION 'Refund and seller amounts must equal the transaction amount' USING ERRCODE = '22023';
  END IF;
  IF v_transaction.payment_provider IS DISTINCT FROM 'payluk'
     AND p_refund_amount > 0
     AND nullif(v_transaction.payment_reference, '') IS NULL THEN
    RAISE EXCEPTION 'Missing payment reference for refund' USING ERRCODE = '22023';
  END IF;
  IF v_transaction.payment_provider IS DISTINCT FROM 'payluk'
     AND p_refund_amount > 0 AND p_seller_amount > 0 THEN
    RAISE EXCEPTION 'Partial split resolutions are only supported for Payluk transactions' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.dispute_resolution_operations (
    dispute_id, requested_by, resolution, refund_amount, seller_amount,
    payment_provider, status
  ) VALUES (
    p_dispute_id, p_admin_id, trim(p_resolution), p_refund_amount, p_seller_amount,
    v_transaction.payment_provider, 'processing'
  ) RETURNING * INTO v_operation;

  RETURN jsonb_build_object('operation', to_jsonb(v_operation), 'newly_created', true);
END;
$$;

REVOKE ALL ON FUNCTION public.begin_dispute_resolution(uuid, uuid, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_dispute_resolution(uuid, uuid, text, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.save_payluk_dispute_plan(p_operation_id uuid, p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 op public.dispute_resolution_operations%ROWTYPE;
 tx public.escrow_transactions%ROWTYPE;
 principal numeric; fee numeric; additional_fee numeric; pool numeric; buyer numeric; seller numeric;
 expected_principal numeric; expected_pool numeric; expected_buyer numeric; expected_status text; v numeric;
BEGIN
 SELECT * INTO op FROM public.dispute_resolution_operations WHERE id=p_operation_id FOR UPDATE;
 IF NOT FOUND OR op.status <> 'processing' THEN RAISE EXCEPTION 'Resolution is not processing'; END IF;
 SELECT t.* INTO tx FROM public.escrow_transactions t JOIN public.disputes d ON d.transaction_id=t.id WHERE d.id=op.dispute_id;
 IF tx.payment_provider IS DISTINCT FROM 'payluk' OR tx.status <> 'disputed'
    OR p_plan->>'escrowId' IS DISTINCT FROM tx.payluk_escrow_id THEN RAISE EXCEPTION 'Escrow does not match dispute'; END IF;
 principal := (p_plan->>'principal')::numeric; fee := (p_plan->>'fee')::numeric;
 additional_fee := (p_plan->>'additionalFee')::numeric; pool := (p_plan->>'pool')::numeric;
 buyer := (p_plan->>'buyerAmount')::numeric; seller := (p_plan->>'sellerAmount')::numeric;
 FOREACH v IN ARRAY ARRAY[tx.amount,op.refund_amount,op.seller_amount,principal,fee,additional_fee,pool,buyer,seller] LOOP
  IF v IS NULL OR v::text IN ('NaN','Infinity','-Infinity') OR v<0 OR round(v,2)<>v THEN RAISE EXCEPTION 'Invalid settlement amount'; END IF;
 END LOOP;
 IF tx.amount<=0 OR op.refund_amount+op.seller_amount<>tx.amount THEN RAISE EXCEPTION 'Gross ruling does not equal price'; END IF;
 expected_principal := CASE WHEN tx.metadata->>'payluk_fee_mode'='seller_commission_v1' THEN tx.amount-tx.commission ELSE tx.amount END;
 IF principal<>expected_principal OR fee>principal OR p_plan->>'whoPays' IS NULL
    OR p_plan->>'whoPays' NOT IN ('buyer','seller','both') THEN RAISE EXCEPTION 'Provider price or fee mismatch'; END IF;
 IF tx.metadata->>'payluk_fee_mode' IN ('seller_commission_v1','buyer_commission_v1')
    AND (p_plan->>'whoPays'<>'seller' OR additional_fee<>tx.commission) THEN RAISE EXCEPTION 'Commission allocation mismatch'; END IF;
 expected_pool := principal - CASE p_plan->>'whoPays' WHEN 'seller' THEN fee WHEN 'both' THEN round(fee/2,2) ELSE 0 END;
 expected_buyer := round(expected_pool*op.refund_amount/tx.amount,2);
 expected_status := CASE WHEN op.refund_amount=0 THEN 'COMPLETED' WHEN op.seller_amount=0 THEN 'REFUNDED' ELSE 'SPLIT' END;
 IF pool<=0 OR pool<>expected_pool OR buyer<>expected_buyer OR seller<>pool-buyer
    OR p_plan->>'status' IS DISTINCT FROM expected_status
    OR (p_plan->>'additionalFeeRefundable')::boolean IS DISTINCT FROM (expected_status<>'COMPLETED')
    OR (expected_status='SPLIT' AND (buyer=0 OR seller=0)) THEN RAISE EXCEPTION 'Invalid fee-adjusted ruling'; END IF;
 IF op.provider_plan IS NOT NULL AND op.provider_plan<>p_plan THEN RAISE EXCEPTION 'A saved settlement plan cannot change'; END IF;
 UPDATE public.dispute_resolution_operations SET provider_plan=p_plan,updated_at=now() WHERE id=op.id;
 RETURN p_plan;
END; $$;
REVOKE ALL ON FUNCTION public.save_payluk_dispute_plan(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_payluk_dispute_plan(uuid,jsonb) TO service_role;

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
  IF v_operation.provider_plan IS NULL OR v_operation.provider_settlement IS NULL THEN
    RAISE EXCEPTION 'Verified Payluk settlement is required' USING ERRCODE = '22023';
  END IF;
  v_new_status := CASE WHEN (v_operation.provider_plan->>'sellerAmount')::numeric > 0 THEN 'completed' ELSE 'cancelled' END;

  UPDATE public.disputes
  SET resolution = v_operation.resolution,
      refund_amount = v_operation.refund_amount,
      seller_amount = v_operation.seller_amount,
      provider_settlement = v_operation.provider_settlement,
      status = 'resolved',
      resolved_by = v_operation.requested_by,
      resolved_at = now(),
      updated_at = now()
  WHERE id = v_dispute.id;

  UPDATE public.escrow_transactions
  SET status = v_new_status,
      seller_amount = (v_operation.provider_plan->>'sellerAmount')::numeric,
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('dispute_settlement',v_operation.provider_settlement),
      dispute_resolved_at = now(), updated_at = now()
  WHERE id = v_transaction.id;

  IF v_new_status = 'cancelled' AND v_transaction.status <> 'cancelled' AND v_transaction.item_id IS NOT NULL THEN
    IF v_transaction.item_type = 'ticket' OR v_transaction.metadata ? 'event_id' THEN
      UPDATE public.tickets
      SET status = 'REFUNDED', refund_status = 'processed', updated_at = now()
      WHERE payment_tx_ref = v_transaction.id::text
         OR payment_provider_ref IN (v_transaction.payluk_escrow_id, v_transaction.payment_reference);
    ELSIF v_transaction.item_type = 'catalog_item' THEN
      IF v_transaction.metadata->>'inventory_reserved' = 'true' THEN
        PERFORM public.release_catalog_stock(v_transaction.item_id::uuid,1);
      ELSE
        INSERT INTO public.payment_reconciliation_flags(provider,reference,transaction_id,reason)
        VALUES('payluk',coalesce(p_provider_reference,v_transaction.id::text),v_transaction.id,'legacy_stock_refund') ON CONFLICT DO NOTHING;
      END IF;
    ELSE
      UPDATE public.posts
      SET is_sold = false, sold_to_user_id = NULL, sold_at = NULL, transaction_id = NULL
      WHERE id::text = v_transaction.item_id AND transaction_id = v_transaction.id;
    END IF;
  END IF;

  UPDATE public.dispute_resolution_operations
  SET status = 'succeeded', provider_reference = p_provider_reference,
      error_message = NULL, updated_at = now()
  WHERE id = v_operation.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_payluk_dispute_settlement(p_transaction_id uuid, p_settlement jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE op public.dispute_resolution_operations%ROWTYPE; plan jsonb; settled jsonb;
BEGIN
 SELECT o.* INTO op FROM public.dispute_resolution_operations o JOIN public.disputes d ON d.id=o.dispute_id
 WHERE d.transaction_id=p_transaction_id FOR UPDATE OF o;
 IF NOT FOUND THEN RETURN false; END IF;
 plan := op.provider_plan;
 IF plan IS NULL OR (plan->>'escrowId') IS DISTINCT FROM (p_settlement->>'escrowId')
    OR (plan->>'status') IS DISTINCT FROM (p_settlement->>'status')
    OR (plan->>'principal')::numeric IS DISTINCT FROM (p_settlement->>'principal')::numeric
    OR (plan->>'fee')::numeric IS DISTINCT FROM (p_settlement->>'fee')::numeric
    OR (plan->>'whoPays') IS DISTINCT FROM (p_settlement->>'whoPays')
    OR (plan->>'additionalFee')::numeric IS DISTINCT FROM (p_settlement->>'additionalFee')::numeric
    OR ((plan->>'status')<>'COMPLETED' AND (plan->>'additionalFeeRefundable')::boolean IS DISTINCT FROM (p_settlement->>'additionalFeeRefundable')::boolean) THEN
   RAISE EXCEPTION 'Payluk settlement does not match the saved plan';
 END IF;
 IF plan->>'status'='SPLIT' AND (
    (plan->>'pool')::numeric IS DISTINCT FROM (p_settlement->>'pool')::numeric
    OR (plan->>'buyerAmount')::numeric IS DISTINCT FROM (p_settlement->>'buyerAmount')::numeric
    OR (plan->>'sellerAmount')::numeric IS DISTINCT FROM (p_settlement->>'sellerAmount')::numeric) THEN
   RAISE EXCEPTION 'Payluk split allocation does not match the saved plan';
 END IF;
 IF op.status='succeeded' THEN RETURN true; END IF;
 IF op.status NOT IN ('processing','needs_reconciliation') THEN RAISE EXCEPTION 'Resolution is not awaiting settlement'; END IF;
 settled := plan || jsonb_build_object('buyerCredit',(plan->>'buyerAmount')::numeric
   + CASE WHEN (plan->>'additionalFeeRefundable')::boolean THEN (plan->>'additionalFee')::numeric ELSE 0 END);
 UPDATE public.dispute_resolution_operations SET provider_settlement=settled,status='processing',updated_at=now() WHERE id=op.id;
 PERFORM public.finish_dispute_resolution(op.id,plan->>'escrowId');
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.apply_payluk_dispute_settlement(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_payluk_dispute_settlement(uuid,jsonb) TO service_role;
COMMIT;
