-- Preserve existing checkout recovery. New reservations require acceptance.
-- Staged checkout remains closed until the commission contract is supported.
BEGIN;
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
  IF booking.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Wait for the business to accept your appointment and final price before paying';
  END IF;
  IF booking.payment_flow = 'staged_50_50' THEN
    RAISE EXCEPTION 'Staged service checkout is not available yet. No payment has been started';
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

REVOKE ALL ON FUNCTION public.reserve_booking_checkout(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_booking_checkout(uuid,uuid,text) TO service_role;
COMMIT;
