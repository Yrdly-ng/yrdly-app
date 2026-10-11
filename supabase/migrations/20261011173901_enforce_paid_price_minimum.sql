-- Approved paid-price policy. Existing historical prices/ledgers are not rewritten.
-- Guard price changes only, so legacy inventory/status/refund updates still work.
CREATE FUNCTION public.guard_paid_price_minimum() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE amount numeric; allow_free boolean := false; fields text[];
BEGIN
  fields := CASE TG_TABLE_NAME
    WHEN 'posts' THEN ARRAY['category','price']
    WHEN 'service_offerings' THEN ARRAY['price','deposit_required','deposit_amount','deposit_percent','requires_full_payment','escrow_enabled']
    WHEN 'quote_requests' THEN ARRAY['estimated_price'] ELSE ARRAY['price'] END;
  IF TG_OP = 'UPDATE' AND NOT EXISTS (
    SELECT 1 FROM unnest(fields) AS field
    WHERE to_jsonb(NEW)->field IS DISTINCT FROM to_jsonb(OLD)->field
  ) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'posts' THEN
    IF NEW.category IS DISTINCT FROM 'For Sale' THEN RETURN NEW; END IF;
    amount := NEW.price;
  ELSIF TG_TABLE_NAME = 'quote_requests' THEN
    amount := NEW.estimated_price;
    IF amount IS NULL THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'service_offerings' THEN
    amount := NEW.price;
    IF NEW.deposit_amount IS NOT NULL AND (NEW.deposit_amount::text IN ('NaN','Infinity','-Infinity') OR NEW.deposit_amount < 0 OR round(NEW.deposit_amount,2) <> NEW.deposit_amount) THEN
      RAISE EXCEPTION 'Enter a valid deposit amount with at most two decimal places.' USING ERRCODE = '23514';
    END IF;
    IF NEW.deposit_percent IS NOT NULL AND NEW.deposit_percent NOT BETWEEN 0 AND 100 THEN
      RAISE EXCEPTION 'Deposit percentage must be between 0 and 100.' USING ERRCODE = '23514';
    END IF;
    IF amount IS NOT NULL AND (amount::text IN ('NaN','Infinity','-Infinity') OR amount < 0 OR (amount > 0 AND amount < 1200)) THEN
      RAISE EXCEPTION 'Paid service prices must be at least NGN 1200.' USING ERRCODE = '23514';
    END IF;
    IF NEW.deposit_required AND NOT coalesce(NEW.escrow_enabled,false) AND NOT coalesce(NEW.requires_full_payment,false) THEN
      amount := CASE WHEN NEW.deposit_amount > 0 THEN NEW.deposit_amount
        WHEN NEW.deposit_percent > 0 THEN round(NEW.price * NEW.deposit_percent / 100,2)
        ELSE NEW.price END;
    ELSE RETURN NEW;
    END IF;
  ELSE
    amount := NEW.price;
    allow_free := TG_TABLE_NAME = 'ticket_tiers';
  END IF;
  IF amount IS NULL OR amount::text IN ('NaN','Infinity','-Infinity') OR round(amount,2) <> amount
    OR (amount < 1200 AND NOT (allow_free AND amount = 0)) THEN
    RAISE EXCEPTION 'Paid prices and booking payments must be at least NGN 1200, with at most two decimal places.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_paid_price_minimum() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_paid_price_minimum BEFORE INSERT OR UPDATE OF category,price ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_paid_price_minimum();
CREATE TRIGGER guard_paid_price_minimum BEFORE INSERT OR UPDATE OF price ON public.catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_paid_price_minimum();
CREATE TRIGGER guard_paid_price_minimum BEFORE INSERT OR UPDATE OF price ON public.ticket_tiers
  FOR EACH ROW EXECUTE FUNCTION public.guard_paid_price_minimum();
CREATE TRIGGER guard_paid_price_minimum BEFORE INSERT OR UPDATE OF price,deposit_required,deposit_amount,deposit_percent,requires_full_payment,escrow_enabled ON public.service_offerings
  FOR EACH ROW EXECUTE FUNCTION public.guard_paid_price_minimum();
CREATE TRIGGER guard_paid_price_minimum BEFORE INSERT OR UPDATE OF estimated_price ON public.quote_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_paid_price_minimum();

CREATE OR REPLACE FUNCTION public.reserve_booking_checkout(p_booking_id uuid, p_buyer_id uuid, p_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  booking public.bookings%ROWTYPE;
  service public.service_offerings%ROWTYPE;
  business public.businesses%ROWTYPE;
  quote public.quote_requests%ROWTYPE;
  payment public.booking_payments%ROWTYPE;
  tx public.escrow_transactions%ROWTYPE;
  chosen text;
  price numeric;
  fee numeric;
BEGIN
  SELECT * INTO booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR booking.customer_id IS DISTINCT FROM p_buyer_id THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;
  IF booking.status NOT IN ('requested','confirmed') OR booking.appointment_time <= now() THEN
    RAISE EXCEPTION 'booking_not_payable';
  END IF;
  SELECT * INTO business FROM public.businesses WHERE id = booking.business_id;
  SELECT * INTO service FROM public.service_offerings WHERE id = booking.service_id;
  IF business.owner_id IS NULL OR business.owner_id = p_buyer_id OR NOT business.is_active
     OR service.business_id IS DISTINCT FROM booking.business_id OR NOT service.is_active THEN
    RAISE EXCEPTION 'booking_service_unavailable';
  END IF;
  chosen := CASE WHEN booking.quote_id IS NOT NULL THEN 'full'
    WHEN service.escrow_enabled THEN 'escrow'
    WHEN service.requires_full_payment THEN 'full'
    WHEN service.deposit_required THEN 'deposit' ELSE NULL END;
  IF chosen IS NULL OR (p_type IS NOT NULL AND p_type IS DISTINCT FROM chosen) THEN
    RAISE EXCEPTION 'booking_payment_type_mismatch';
  END IF;
  IF booking.quote_id IS NOT NULL THEN
    SELECT * INTO quote FROM public.quote_requests WHERE id = booking.quote_id;
    IF quote.customer_id IS DISTINCT FROM p_buyer_id OR quote.business_id IS DISTINCT FROM business.id
       OR quote.status <> 'converted' OR quote.converted_booking_id IS DISTINCT FROM booking.id
       OR (quote.expires_at IS NOT NULL AND quote.expires_at <= now()) THEN
      RAISE EXCEPTION 'booking_quote_invalid';
    END IF;
    price := quote.estimated_price;
  ELSIF chosen = 'deposit' THEN
    price := CASE WHEN service.deposit_amount > 0 THEN service.deposit_amount
      WHEN service.deposit_percent > 0 THEN round(service.price * service.deposit_percent / 100,2)
      ELSE service.price END;
  ELSE price := service.price;
  END IF;
  IF price IS NULL OR price::text IN ('NaN','Infinity','-Infinity') OR price < 1200 OR round(price,2) <> price THEN
    RAISE EXCEPTION 'Booking payment must be at least NGN 1200, with at most two decimal places.';
  END IF;
  SELECT * INTO payment FROM public.booking_payments
    WHERE booking_id = booking.id AND status IN ('deposit_pending','deposit_paid','fully_paid','escrow_held','escrow_released')
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF payment.escrow_transaction_id IS NULL THEN RAISE EXCEPTION 'legacy_booking_payment_requires_review'; END IF;
    -- Do not lock the transaction while holding the booking lock: callbacks
    -- update the transaction first and synchronize the booking in their trigger.
    SELECT * INTO tx FROM public.escrow_transactions WHERE id = payment.escrow_transaction_id;
    IF payment.type::text <> chosen OR payment.amount <> price THEN RAISE EXCEPTION 'booking_checkout_changed'; END IF;
    RETURN jsonb_build_object('transaction',to_jsonb(tx),'newly_created',false);
  END IF;
  IF booking.payment_status IN ('deposit_paid','fully_paid','escrow_held','escrow_released') THEN
    RAISE EXCEPTION 'booking_already_paid';
  END IF;
  fee := round(price * 0.03,2);
  INSERT INTO public.escrow_transactions(item_id,item_type,buyer_id,seller_id,amount,commission,total_amount,seller_amount,
    status,payment_method,delivery_details,payment_provider,payment_reference,metadata)
    VALUES(booking.id::text,'booking',p_buyer_id,business.owner_id,price,fee,price+fee,price,
      'pending','card','{"option":"service_booking"}','payluk','bk-' || gen_random_uuid()::text,
      jsonb_build_object('booking_id',booking.id,'booking_payment_type',chosen,'payluk_fee_mode','buyer_commission_v1'))
    RETURNING * INTO tx;
  INSERT INTO public.booking_payments(booking_id,amount,type,status,provider,payluk_reference,escrow_hold,
    escrow_transaction_id,commission,total_amount)
    VALUES(booking.id,price,chosen::public.payment_type_enum,'deposit_pending','payluk',tx.payment_reference,true,tx.id,fee,price+fee);
  UPDATE public.bookings SET payment_status = 'deposit_pending' WHERE id = booking.id;
  RETURN jsonb_build_object('transaction',to_jsonb(tx),'newly_created',true);
END $$;

CREATE OR REPLACE FUNCTION public.reserve_ticket_checkout(p_payload jsonb) RETURNS jsonb
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
  IF qty IS NULL OR qty NOT BETWEEN 1 AND 5 OR tier.price IS NULL OR tier.price::text IN ('NaN','Infinity','-Infinity') OR tier.price < 1200 OR round(tier.price,2) <> tier.price THEN
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

CREATE OR REPLACE FUNCTION public.create_checkout_reservation(p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; price numeric; requested numeric;
BEGIN
 IF p_payload->>'item_type' NOT IN ('post','catalog_item') THEN RAISE EXCEPTION 'Invalid item type'; END IF;
 requested := (p_payload->>'amount')::numeric;
 IF p_payload->>'item_type' = 'post' THEN
  SELECT p.price INTO price FROM public.posts p WHERE p.id = (p_payload->>'item_id')::uuid AND p.category = 'For Sale' FOR UPDATE;
 ELSE
  SELECT c.price INTO price FROM public.catalog_items c WHERE c.id = (p_payload->>'item_id')::uuid FOR UPDATE;
 END IF;
 IF price IS NULL OR price::text IN ('NaN','Infinity','-Infinity') OR price < 1200
    OR requested IS DISTINCT FROM price OR round(requested,2) <> requested THEN
  RAISE EXCEPTION 'Item price must be at least NGN 1200 and match the current listing.' USING ERRCODE = '23514';
 END IF;
 IF p_payload->>'item_type' = 'catalog_item' AND NOT public.reserve_catalog_stock((p_payload->>'item_id')::uuid,1) THEN
  RAISE EXCEPTION 'Item no longer available' USING ERRCODE = '23514';
 END IF;
 INSERT INTO public.escrow_transactions(item_id,buyer_id,seller_id,amount,commission,total_amount,seller_amount,status,payment_method,delivery_details,item_type,metadata)
 VALUES(p_payload->>'item_id',(p_payload->>'buyer_id')::uuid,(p_payload->>'seller_id')::uuid,
 (p_payload->>'amount')::numeric,(p_payload->>'commission')::numeric,(p_payload->>'total_amount')::numeric,
 (p_payload->>'seller_amount')::numeric,'pending','card',p_payload->'delivery_details',p_payload->>'item_type',
 jsonb_build_object('inventory_reserved',p_payload->>'item_type' = 'catalog_item')) RETURNING id INTO v_id;
 RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.reserve_booking_checkout(uuid,uuid,text),public.reserve_ticket_checkout(jsonb),public.create_checkout_reservation(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_booking_checkout(uuid,uuid,text),public.reserve_ticket_checkout(jsonb),public.create_checkout_reservation(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
