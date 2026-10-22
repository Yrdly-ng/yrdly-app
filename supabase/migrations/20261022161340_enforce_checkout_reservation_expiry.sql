-- A fixed ten-minute deadline, with provider invalidation required before release.
BEGIN;
CREATE OR REPLACE FUNCTION public.expire_checkout_reservation(
  p_transaction_id uuid,
  p_expected_escrow_id text,
  p_expected_token text,
  p_provider_invalidated boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.escrow_transactions%ROWTYPE;
BEGIN
  SELECT * INTO tx FROM public.escrow_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR tx.item_type NOT IN ('post', 'catalog_item')
     OR tx.created_at > now() - interval '10 minutes'
     OR tx.status NOT IN ('pending', 'creating_escrow', 'reconciling')
     OR tx.payluk_escrow_id IS DISTINCT FROM p_expected_escrow_id
     OR tx.payluk_tx_ref IS DISTINCT FROM p_expected_token THEN RETURN false; END IF;
  IF tx.payluk_escrow_id IS NOT NULL OR tx.payluk_tx_ref IS NOT NULL THEN
    IF p_provider_invalidated IS DISTINCT FROM true OR tx.payluk_escrow_id IS NULL OR tx.payluk_tx_ref IS NULL THEN RETURN false; END IF;
  ELSIF tx.status <> 'pending' THEN
    RETURN false; -- Creation may have reached Payluk: never guess that no payment link exists.
  END IF;
  IF tx.item_type = 'catalog_item' AND tx.metadata->>'inventory_reserved' = 'true' THEN
    PERFORM public.release_catalog_stock(tx.item_id::uuid, 1);
  END IF;
  UPDATE public.escrow_transactions SET status = 'cancelled',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('inventory_reserved', false, 'expired_at', now()),
    updated_at = now() WHERE id = tx.id;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.expire_checkout_reservation(uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_checkout_reservation(uuid,text,text,boolean) TO service_role;

-- Keep the existing SQL cleanup safe for pending rows without any remote checkout.
-- Provider-backed rows are handled by the server, which must invalidate their link first.
CREATE OR REPLACE FUNCTION public.expire_stale_checkout_reservations(p_ttl_minutes integer DEFAULT 10)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.escrow_transactions%ROWTYPE; cnt integer := 0;
BEGIN
  IF p_ttl_minutes IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'Checkout reservations expire after exactly 10 minutes'; END IF;
  FOR tx IN SELECT * FROM public.escrow_transactions
    WHERE item_type IN ('post','catalog_item') AND status = 'pending'
      AND payluk_escrow_id IS NULL AND payluk_tx_ref IS NULL
      AND created_at <= now() - interval '10 minutes'
    FOR UPDATE SKIP LOCKED
  LOOP
    IF public.expire_checkout_reservation(tx.id, NULL, NULL, false) THEN cnt := cnt + 1; END IF;
  END LOOP;
  RETURN cnt;
END; $$;
REVOKE ALL ON FUNCTION public.expire_stale_checkout_reservations(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_checkout_reservations(integer) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
