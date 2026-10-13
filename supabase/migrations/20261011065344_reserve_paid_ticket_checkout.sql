-- Deploy only with the matching ticket checkout/fulfillment code.
-- Old unpaid links must be reconciled before enabling paid reservations.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.escrow_transactions x
    WHERE x.item_type = 'ticket'
      AND x.status IN ('pending','creating_escrow','reconciling','paid','shipped','delivered')
      AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.payment_tx_ref = x.id::text)
  ) THEN
    RAISE EXCEPTION 'Reconcile unfulfilled legacy ticket checkouts before this migration';
  END IF;
END $$;

CREATE TABLE public.ticket_checkout_reservations (
  transaction_id uuid PRIMARY KEY REFERENCES public.escrow_transactions(id) ON DELETE CASCADE,
  tier_id uuid NOT NULL REFERENCES public.ticket_tiers(id),
  buyer_id uuid NOT NULL REFERENCES public.users(id),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 5),
  remaining integer NOT NULL CHECK (remaining >= 0 AND remaining <= quantity),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_checkout_reservations_active_tier
  ON public.ticket_checkout_reservations(tier_id, expires_at) WHERE remaining > 0;
ALTER TABLE public.ticket_checkout_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_checkout_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ticket_checkout_reservations TO service_role;

CREATE FUNCTION public.reserve_ticket_checkout(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tier public.ticket_tiers%ROWTYPE;
  event_row public.events%ROWTYPE;
  tx public.escrow_transactions%ROWTYPE;
  buyer uuid := (p_payload->>'buyer_id')::uuid;
  qty integer := (p_payload->>'quantity')::integer;
  reserved integer;
  owned integer;
  gross numeric;
  fee numeric;
BEGIN
  SELECT * INTO tier FROM public.ticket_tiers WHERE id = (p_payload->>'tier_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_tier_not_found'; END IF;
  SELECT * INTO event_row FROM public.events WHERE id = tier.event_id;
  IF event_row.id IS DISTINCT FROM (p_payload->>'event_id')::uuid
    OR event_row.status <> 'PUBLISHED' OR event_row.end_time <= now()
    OR buyer IS NULL OR buyer = event_row.organizer_id OR NOT tier.is_visible
    OR (tier.sale_ends_at IS NOT NULL AND tier.sale_ends_at <= now()) THEN
    RAISE EXCEPTION 'ticket_checkout_unavailable';
  END IF;
  IF qty IS NULL OR qty NOT BETWEEN 1 AND 5 OR tier.price < 1053 OR round(tier.price,2) <> tier.price THEN
    RAISE EXCEPTION 'invalid_ticket_checkout';
  END IF;
  SELECT x.* INTO tx FROM public.escrow_transactions x
    JOIN public.ticket_checkout_reservations r ON r.transaction_id = x.id
    WHERE r.tier_id = tier.id AND r.buyer_id = buyer AND r.remaining > 0
      AND x.status IN ('pending','creating_escrow','reconciling','paid','shipped','delivered')
    ORDER BY x.created_at DESC LIMIT 1 FOR UPDATE OF x;
  IF FOUND THEN
    IF (tx.metadata->>'quantity')::integer <> qty THEN RAISE EXCEPTION 'ticket_checkout_quantity_changed'; END IF;
    RETURN jsonb_build_object('transaction',to_jsonb(tx),'newly_created',false);
  END IF;
  SELECT coalesce(sum(remaining),0) INTO reserved FROM public.ticket_checkout_reservations WHERE tier_id = tier.id;
  IF tier.capacity IS NOT NULL AND tier.sold + reserved + qty > tier.capacity THEN
    RAISE EXCEPTION 'ticket_tier_sold_out';
  END IF;
  SELECT count(*) INTO owned FROM public.tickets WHERE tier_id = tier.id AND buyer_id = buyer AND status IN ('PAID','USED');
  SELECT owned + coalesce(sum(remaining),0) INTO owned FROM public.ticket_checkout_reservations WHERE tier_id = tier.id AND buyer_id = buyer;
  IF owned + qty > 5 THEN RAISE EXCEPTION 'ticket_buyer_limit'; END IF;
  gross := round(tier.price * qty,2);
  fee := round(gross * 0.03,2);
  INSERT INTO public.escrow_transactions(item_id,item_type,buyer_id,seller_id,amount,commission,total_amount,seller_amount,status,payment_method,delivery_details,payment_provider,payment_reference,metadata)
    VALUES(tier.id::text,'ticket',buyer,event_row.organizer_id,gross,fee,gross,gross-fee,'pending','card',
      '{"option":"event_entry"}','payluk','evt-' || gen_random_uuid()::text,
      p_payload || jsonb_build_object('payluk_fee_mode','seller_commission_v1','ticket_reserved',true))
    RETURNING * INTO tx;
  INSERT INTO public.ticket_checkout_reservations(transaction_id,tier_id,buyer_id,quantity,remaining)
    VALUES(tx.id,tier.id,buyer,qty,qty);
  RETURN jsonb_build_object('transaction',to_jsonb(tx),'newly_created',true);
END $$;

-- Call only after no provider creation was attempted, or after the provider
-- positively deleted the recorded unpaid escrow. An unknown result stays held.
CREATE FUNCTION public.release_ticket_checkout(p_transaction_id uuid, p_deleted_escrow_id text DEFAULT NULL, p_before_provider boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.escrow_transactions%ROWTYPE; tier uuid;
BEGIN
  SELECT tier_id INTO tier FROM public.ticket_checkout_reservations WHERE transaction_id = p_transaction_id;
  PERFORM 1 FROM public.ticket_tiers WHERE id = tier FOR UPDATE;
  SELECT * INTO tx FROM public.escrow_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR tx.item_type <> 'ticket' OR tx.status NOT IN ('pending','creating_escrow','reconciling') THEN
    RAISE EXCEPTION 'ticket_checkout_not_releasable';
  END IF;
  IF tx.payluk_escrow_id IS NOT NULL AND tx.payluk_escrow_id IS DISTINCT FROM p_deleted_escrow_id THEN
    RAISE EXCEPTION 'provider_deletion_confirmation_required';
  END IF;
  IF tx.status = 'reconciling' AND tx.payluk_escrow_id IS NULL THEN
    RAISE EXCEPTION 'unknown_provider_creation_requires_review';
  END IF;
  IF tx.status = 'creating_escrow' AND tx.payluk_escrow_id IS NULL AND NOT p_before_provider THEN
    RAISE EXCEPTION 'ticket_checkout_setup_in_progress';
  END IF;
  UPDATE public.ticket_checkout_reservations SET remaining = 0 WHERE transaction_id = tx.id;
  UPDATE public.escrow_transactions SET status = 'cancelled',updated_at = now() WHERE id = tx.id;
END $$;

CREATE OR REPLACE FUNCTION public.adjust_ticket_tier_sold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE was_active boolean; is_active boolean; held integer; owned integer;
BEGIN
  IF TG_OP = 'INSERT' THEN is_active := NEW.status IN ('PAID','USED');
  ELSIF TG_OP = 'UPDATE' THEN
    was_active := OLD.status IN ('PAID','USED'); is_active := NEW.status IN ('PAID','USED');
    IF NEW.status = 'USED' AND OLD.status IS DISTINCT FROM NEW.status AND OLD.refund_status IS NOT NULL THEN
      RAISE EXCEPTION 'Ticket has a refund request and cannot be checked in';
    END IF;
    IF NEW.tier_id IS DISTINCT FROM OLD.tier_id THEN RAISE EXCEPTION 'Ticket tier cannot be changed'; END IF;
    IF was_active = is_active THEN RETURN NEW; END IF;
  ELSE was_active := OLD.status IN ('PAID','USED'); END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND was_active AND NOT is_active) THEN
    IF was_active THEN UPDATE public.ticket_tiers SET sold = greatest(0,sold-1) WHERE id = OLD.tier_id; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF is_active THEN
    PERFORM 1 FROM public.ticket_tiers WHERE id = NEW.tier_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.ticket_tiers WHERE id = NEW.tier_id AND event_id = NEW.event_id) THEN
      RAISE EXCEPTION 'ticket_event_tier_mismatch';
    END IF;
    -- Convert this order's reserved seat to a sold seat in the same transaction.
    UPDATE public.ticket_checkout_reservations SET remaining = remaining-1
      WHERE transaction_id::text = NEW.payment_tx_ref AND tier_id = NEW.tier_id AND buyer_id = NEW.buyer_id AND remaining > 0;
    SELECT coalesce(sum(remaining),0) INTO held FROM public.ticket_checkout_reservations WHERE tier_id = NEW.tier_id;
    SELECT count(*) INTO owned FROM public.tickets WHERE tier_id = NEW.tier_id AND buyer_id = NEW.buyer_id AND status IN ('PAID','USED');
    SELECT owned + coalesce(sum(remaining),0) INTO owned FROM public.ticket_checkout_reservations WHERE tier_id = NEW.tier_id AND buyer_id = NEW.buyer_id;
    IF owned >= 5 THEN RAISE EXCEPTION 'ticket_buyer_limit'; END IF;
    UPDATE public.ticket_tiers SET sold = sold+1 WHERE id = NEW.tier_id AND (capacity IS NULL OR sold+held < capacity);
    IF NOT FOUND THEN RAISE EXCEPTION 'ticket_tier_sold_out'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.reserve_ticket_checkout(jsonb), public.release_ticket_checkout(uuid,text,boolean), public.adjust_ticket_tier_sold() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ticket_checkout(jsonb), public.release_ticket_checkout(uuid,text,boolean) TO service_role;
