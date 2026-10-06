-- Dispute workflow hardening. Apply only after reviewing the preflight check
-- for duplicate disputes below; this migration intentionally never deletes data.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.disputes
    GROUP BY transaction_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate disputes exist per transaction; reconcile them before applying this migration';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS disputes_one_per_transaction
  ON public.disputes (transaction_id);

-- The API now owns creation and all privileged changes. Clients may no longer
-- insert or update dispute rows directly, even when they are a party.
DROP POLICY IF EXISTS "Users can update own disputes evidence" ON public.disputes;
DROP POLICY IF EXISTS "Users can insert own disputes" ON public.disputes;
DROP POLICY IF EXISTS "Users can create disputes" ON public.disputes;
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'disputes'
      AND cmd IN ('INSERT', 'UPDATE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.disputes', v_policy.policyname);
  END LOOP;
END;
$$;
REVOKE SELECT, INSERT, UPDATE ON public.disputes FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, transaction_id, opened_by, dispute_reason, buyer_evidence, seller_evidence,
  resolution, status, resolved_by, refund_amount, seller_amount,
  created_at, updated_at, resolved_at
) ON public.disputes TO authenticated;

ALTER TABLE public.disputes
  ADD COLUMN IF NOT EXISTS provider_submission_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS provider_submission_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.disputes'::regclass
      AND conname = 'disputes_provider_submission_status_check'
  ) THEN
    ALTER TABLE public.disputes
      ADD CONSTRAINT disputes_provider_submission_status_check
      CHECK (provider_submission_status IN ('not_required', 'processing', 'submitted', 'needs_reconciliation'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.dispute_resolution_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL UNIQUE REFERENCES public.disputes(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  resolution text NOT NULL,
  refund_amount numeric(12, 2) NOT NULL CHECK (refund_amount >= 0),
  seller_amount numeric(12, 2) NOT NULL CHECK (seller_amount >= 0),
  payment_provider text,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'succeeded', 'needs_reconciliation', 'retryable')),
  provider_reference text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dispute_resolution_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dispute_resolution_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.dispute_resolution_operations TO service_role;

CREATE OR REPLACE FUNCTION public.open_marketplace_dispute(
  p_transaction_id uuid,
  p_opened_by uuid,
  p_reason text,
  p_evidence jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transaction public.escrow_transactions%ROWTYPE;
  v_dispute_id uuid;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'A valid dispute reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_transaction
  FROM public.escrow_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_opened_by IS NULL
     OR (p_opened_by IS DISTINCT FROM v_transaction.buyer_id
         AND p_opened_by IS DISTINCT FROM v_transaction.seller_id) THEN
    RAISE EXCEPTION 'Only a transaction participant can open a dispute' USING ERRCODE = '42501';
  END IF;

  IF v_transaction.payment_provider = 'payluk' AND p_opened_by IS DISTINCT FROM v_transaction.buyer_id THEN
    RAISE EXCEPTION 'The buyer must open Payluk disputes; sellers may add evidence after filing' USING ERRCODE = '42501';
  END IF;

  IF v_transaction.status::text NOT IN ('paid', 'shipped', 'delivered') THEN
    RAISE EXCEPTION 'Transaction is not eligible for a dispute' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.disputes WHERE transaction_id = p_transaction_id) THEN
    RAISE EXCEPTION 'A dispute already exists for this transaction' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.disputes (
    transaction_id,
    opened_by,
    dispute_reason,
    buyer_evidence,
    seller_evidence,
    status,
    refund_amount,
    seller_amount,
    created_at,
    updated_at
  ) VALUES (
    p_transaction_id,
    p_opened_by,
    trim(p_reason),
    CASE WHEN v_transaction.buyer_id = p_opened_by THEN coalesce(p_evidence, '{}'::jsonb) ELSE '{}'::jsonb END,
    CASE WHEN v_transaction.seller_id = p_opened_by THEN coalesce(p_evidence, '{}'::jsonb) ELSE '{}'::jsonb END,
    'open',
    0,
    0,
    now(),
    now()
  ) RETURNING id INTO v_dispute_id;

  UPDATE public.escrow_transactions
  SET status = 'disputed', dispute_reason = trim(p_reason), updated_at = now()
  WHERE id = p_transaction_id;

  RETURN v_dispute_id;
END;
$$;

REVOKE ALL ON FUNCTION public.open_marketplace_dispute(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_marketplace_dispute(uuid, uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.append_dispute_evidence(
  p_dispute_id uuid,
  p_user_id uuid,
  p_evidence jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dispute public.disputes%ROWTYPE;
  v_transaction public.escrow_transactions%ROWTYPE;
  v_previous jsonb;
  v_next jsonb;
BEGIN
  SELECT * INTO v_dispute FROM public.disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispute not found' USING ERRCODE = 'P0002'; END IF;
  IF v_dispute.status NOT IN ('open', 'under_review') THEN
    RAISE EXCEPTION 'Evidence can only be added to an open dispute' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_transaction FROM public.escrow_transactions WHERE id = v_dispute.transaction_id;
  IF p_user_id IS NULL OR (p_user_id IS DISTINCT FROM v_transaction.buyer_id AND p_user_id IS DISTINCT FROM v_transaction.seller_id) THEN
    RAISE EXCEPTION 'Only a transaction participant can submit evidence' USING ERRCODE = '42501';
  END IF;

  v_previous := CASE WHEN p_user_id = v_transaction.buyer_id
    THEN coalesce(v_dispute.buyer_evidence, '{}'::jsonb)
    ELSE coalesce(v_dispute.seller_evidence, '{}'::jsonb) END;
  v_next := v_previous
    || (coalesce(p_evidence, '{}'::jsonb) - 'photos' - 'chatScreenshots' - 'description')
    || jsonb_build_object(
      'photos', coalesce(v_previous->'photos', '[]'::jsonb) || coalesce(p_evidence->'photos', '[]'::jsonb),
      'chatScreenshots', coalesce(v_previous->'chatScreenshots', '[]'::jsonb) || coalesce(p_evidence->'chatScreenshots', '[]'::jsonb)
    );
  IF nullif(p_evidence->>'description', '') IS NOT NULL THEN
    v_next := jsonb_set(
      v_next,
      '{description}',
      to_jsonb(concat_ws(E'\n\n', nullif(v_previous->>'description', ''), nullif(p_evidence->>'description', ''))),
      true
    );
  END IF;

  IF p_user_id = v_transaction.buyer_id THEN
    UPDATE public.disputes SET buyer_evidence = v_next, updated_at = now() WHERE id = p_dispute_id;
  ELSE
    UPDATE public.disputes SET seller_evidence = v_next, updated_at = now() WHERE id = p_dispute_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.append_dispute_evidence(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_dispute_evidence(uuid, uuid, jsonb) TO service_role;

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
  IF p_refund_amount IS NULL OR p_seller_amount IS NULL OR p_refund_amount < 0 OR p_seller_amount < 0 THEN
    RAISE EXCEPTION 'Resolution amounts must be non-negative numbers' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_transaction FROM public.escrow_transactions WHERE id = v_dispute.transaction_id FOR UPDATE;
  IF NOT FOUND OR v_transaction.status::text <> 'disputed' THEN
    RAISE EXCEPTION 'Transaction is not in a disputed state' USING ERRCODE = '22023';
  END IF;
  IF v_transaction.payment_provider = 'payluk' AND v_dispute.provider_submission_status <> 'submitted' THEN
    RAISE EXCEPTION 'Payluk dispute must be submitted successfully before resolution' USING ERRCODE = '22023';
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

CREATE OR REPLACE FUNCTION public.finish_dispute_resolution(
  p_operation_id uuid,
  p_provider_reference text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.dispute_resolution_operations%ROWTYPE;
  v_dispute public.disputes%ROWTYPE;
  v_transaction public.escrow_transactions%ROWTYPE;
  v_new_status text;
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
$$;

REVOKE ALL ON FUNCTION public.finish_dispute_resolution(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_dispute_resolution(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.flag_dispute_resolution_reconciliation(
  p_operation_id uuid,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.dispute_resolution_operations
  SET status = 'needs_reconciliation',
      error_message = left(coalesce(p_error_message, 'Provider result requires manual review'), 1000),
      updated_at = now()
  WHERE id = p_operation_id AND status = 'processing';
END;
$$;

REVOKE ALL ON FUNCTION public.flag_dispute_resolution_reconciliation(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_dispute_resolution_reconciliation(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_dispute_resolution(
  p_dispute_id uuid,
  p_admin_id uuid,
  p_outcome text,
  p_provider_reference text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.dispute_resolution_operations%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_id AND is_admin = true) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_outcome NOT IN ('applied', 'not_applied') THEN
    RAISE EXCEPTION 'Outcome must be applied or not_applied' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_operation
  FROM public.dispute_resolution_operations
  WHERE dispute_id = p_dispute_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resolution operation not found' USING ERRCODE = 'P0002'; END IF;
  IF p_outcome = 'applied' AND v_operation.status = 'succeeded' THEN RETURN 'succeeded'; END IF;
  IF v_operation.status <> 'needs_reconciliation'
     AND NOT (v_operation.status = 'processing' AND v_operation.updated_at < now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Only flagged or stale operations can be reconciled' USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'applied' THEN
    UPDATE public.dispute_resolution_operations
    SET status = 'processing', updated_at = now()
    WHERE id = v_operation.id;
    PERFORM public.finish_dispute_resolution(v_operation.id, p_provider_reference);
    RETURN 'succeeded';
  END IF;

  UPDATE public.dispute_resolution_operations
  SET status = 'retryable',
      error_message = 'Administrator verified that the provider did not apply the payment and has no pending payment; retry is permitted.',
      updated_at = now()
  WHERE id = v_operation.id;
  RETURN 'retryable';
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_dispute_resolution(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_dispute_resolution(uuid, uuid, text, text) TO service_role;

-- Private evidence files are scoped by transaction ID and uploader ID.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dispute-evidence',
  'dispute-evidence',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Dispute parties upload evidence" ON storage.objects;
CREATE POLICY "Dispute parties upload evidence"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dispute-evidence'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.escrow_transactions tx
      WHERE tx.id::text = (storage.foldername(name))[1]
        AND (tx.buyer_id = auth.uid() OR tx.seller_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Dispute parties and admins read evidence" ON storage.objects;
CREATE POLICY "Dispute parties and admins read evidence"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'dispute-evidence'
    AND (
      EXISTS (
        SELECT 1 FROM public.escrow_transactions tx
        WHERE tx.id::text = (storage.foldername(name))[1]
          AND (tx.buyer_id = auth.uid() OR tx.seller_id = auth.uid())
      )
      OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_admin = true)
    )
  );
