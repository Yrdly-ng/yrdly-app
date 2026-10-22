-- Expire stale pending checkout reservations after a TTL.
--
-- A pending escrow_transaction with no payluk_escrow_id that has not been
-- updated for more than p_ttl_minutes (default 10) is abandoned:
--   • status  -> 'cancelled'
--   • catalog_item inventory is restored via release_catalog_stock
--   • post unique index slot is freed (no extra action needed)
--
-- This function is idempotent and safe to call repeatedly.

CREATE OR REPLACE FUNCTION public.expire_stale_checkout_reservations(
  p_ttl_minutes integer DEFAULT 10
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx     public.escrow_transactions%ROWTYPE;
  cutoff timestamptz;
  cnt    integer := 0;
BEGIN
  IF p_ttl_minutes IS NULL OR p_ttl_minutes < 1 THEN
    RAISE EXCEPTION 'p_ttl_minutes must be >= 1';
  END IF;

  cutoff := now() - (p_ttl_minutes || ' minutes')::interval;

  FOR tx IN
    SELECT * FROM public.escrow_transactions
    WHERE status = 'pending'
      AND payluk_escrow_id IS NULL
      AND updated_at < cutoff
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Restore catalog stock if it was reserved
    IF tx.item_type = 'catalog_item'
       AND coalesce(tx.metadata->>'inventory_reserved','false') = 'true' THEN
      PERFORM public.release_catalog_stock(tx.item_id::uuid, 1);
    END IF;

    UPDATE public.escrow_transactions
    SET
      status   = 'cancelled',
      metadata = coalesce(metadata, '{}'::jsonb)
                 || jsonb_build_object('inventory_reserved', false, 'expired_at', now()),
      updated_at = now()
    WHERE id = tx.id;

    cnt := cnt + 1;
  END LOOP;

  RETURN cnt;
END; $$;

-- Service role only — never expose to anon/authenticated.
REVOKE ALL ON FUNCTION public.expire_stale_checkout_reservations(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.expire_stale_checkout_reservations(integer) TO service_role;

-- ── Optional: schedule automatic cleanup every 5 minutes via pg_cron ──
-- Uncomment the block below if pg_cron is enabled on this Supabase project.
-- Run: SELECT cron.schedule('expire-stale-reservations', '*/5 * * * *',
--   $$SELECT public.expire_stale_checkout_reservations(10)$$);

NOTIFY pgrst, 'reload schema';
