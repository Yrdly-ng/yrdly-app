-- Keep bank-transfer escrows alive beyond Payluk's 30-minute reconciliation cycle.
-- Deploy application server code using the longer TTL *before* applying this SQL:
-- older application code can delete provider escrows before calling this function.
-- Providerless checkout-creation orphans still expire after ten minutes.
BEGIN;
CREATE OR REPLACE FUNCTION public.expire_checkout_reservation(
  p_transaction_id uuid,
  p_expected_escrow_id text,
  p_expected_token text,
  p_provider_invalidated boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.escrow_transactions%ROWTYPE;
  lifetime interval;
BEGIN
  SELECT * INTO tx FROM public.escrow_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR tx.item_type NOT IN ('post', 'catalog_item')
     OR tx.status NOT IN ('pending', 'creating_escrow', 'reconciling')
     OR tx.payluk_escrow_id IS DISTINCT FROM p_expected_escrow_id
     OR tx.payluk_tx_ref IS DISTINCT FROM p_expected_token THEN
    RETURN false;
  END IF;

  -- A provider-backed bank transfer can take multiple reconciliation cycles.
  -- Partially persisted provider identities are never invalidated or expired.
  IF tx.payluk_escrow_id IS NOT NULL OR tx.payluk_tx_ref IS NOT NULL THEN
    IF tx.payluk_escrow_id IS NULL OR tx.payluk_tx_ref IS NULL
       OR p_provider_invalidated IS DISTINCT FROM true THEN
      RETURN false;
    END IF;
    lifetime := interval '2 hours';
  ELSE
    IF tx.status <> 'pending' THEN
      RETURN false; -- Unknown provider-creation outcome must stay for review.
    END IF;
    lifetime := interval '10 minutes';
  END IF;

  IF tx.created_at > now() - lifetime THEN RETURN false; END IF;

  IF tx.item_type = 'catalog_item' AND tx.metadata->>'inventory_reserved' = 'true' THEN
    PERFORM public.release_catalog_stock(tx.item_id::uuid, 1);
  END IF;
  UPDATE public.escrow_transactions
     SET status = 'cancelled',
         metadata = coalesce(metadata, '{}'::jsonb)
           || jsonb_build_object('inventory_reserved', false, 'expired_at', now()),
         updated_at = now()
   WHERE id = tx.id;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.expire_checkout_reservation(uuid,text,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_checkout_reservation(uuid,text,text,boolean) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
