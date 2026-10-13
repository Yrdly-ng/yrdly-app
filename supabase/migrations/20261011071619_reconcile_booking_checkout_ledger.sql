-- Additive booking ledger bridge. Legacy payments stay distinguishable and must
-- be reconciled explicitly; their old provider links are never silently replaced.
ALTER TABLE public.booking_payments
  ADD COLUMN escrow_transaction_id uuid UNIQUE REFERENCES public.escrow_transactions(id),
  ADD COLUMN commission numeric CHECK (commission >= 0),
  ADD COLUMN total_amount numeric CHECK (total_amount >= amount);

CREATE FUNCTION public.reserve_booking_checkout(p_booking_id uuid, p_buyer_id uuid, p_type text DEFAULT NULL)
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
  IF price IS NULL OR price::text IN ('NaN','Infinity','-Infinity') OR price < 1000 OR round(price,2) <> price THEN
    RAISE EXCEPTION 'invalid_booking_payment_amount';
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

-- The common escrow ledger is authoritative for both balances and booking state.
CREATE FUNCTION public.sync_booking_escrow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE payment public.booking_payments%ROWTYPE; next_status public.payment_status_enum;
BEGIN
  IF NEW.item_type IS DISTINCT FROM 'booking' THEN RETURN NEW; END IF;
  SELECT * INTO payment FROM public.booking_payments WHERE escrow_transaction_id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.status = 'completed' THEN next_status := 'escrow_released';
  ELSIF NEW.status IN ('paid','shipped','delivered','disputed') THEN
    next_status := CASE payment.type WHEN 'deposit' THEN 'deposit_paid'::public.payment_status_enum
      WHEN 'full' THEN 'fully_paid'::public.payment_status_enum ELSE 'escrow_held'::public.payment_status_enum END;
  ELSIF NEW.status = 'cancelled' THEN
    next_status := CASE WHEN NEW.paid_at IS NOT NULL THEN 'refunded'::public.payment_status_enum ELSE 'failed'::public.payment_status_enum END;
  ELSE next_status := 'deposit_pending'; END IF;
  UPDATE public.booking_payments SET status = next_status,
    payluk_escrow_id = NEW.payluk_escrow_id,payluk_payment_token = NEW.payluk_tx_ref,
    paid_at = coalesce(paid_at,NEW.paid_at),escrow_hold = NEW.status NOT IN ('completed','cancelled')
    WHERE id = payment.id;
  UPDATE public.bookings SET payment_status = next_status WHERE id = payment.booking_id;
  RETURN NEW;
END $$;
CREATE TRIGGER sync_booking_escrow AFTER UPDATE OF status,payluk_escrow_id,payluk_tx_ref ON public.escrow_transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_booking_escrow();

CREATE FUNCTION public.guard_booking_pending_checkout() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('cancelled','late_cancelled') AND NEW.status IS DISTINCT FROM OLD.status
    AND EXISTS (SELECT 1 FROM public.booking_payments p JOIN public.escrow_transactions x ON x.id = p.escrow_transaction_id
      WHERE p.booking_id = OLD.id AND x.status IN ('pending','creating_escrow','reconciling')) THEN
    RAISE EXCEPTION 'Cancel the unpaid checkout before cancelling this booking';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_booking_pending_checkout BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_pending_checkout();

REVOKE ALL ON FUNCTION public.reserve_booking_checkout(uuid,uuid,text),public.sync_booking_escrow(),public.guard_booking_pending_checkout()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_booking_checkout(uuid,uuid,text) TO service_role;
