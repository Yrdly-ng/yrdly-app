-- New Payluk marketplace and service reservations use the merchant commission
-- configured in Payluk. Existing transaction rows retain their old fee mode.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_checkout_reservation(p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
 IF p_payload->>'item_type' NOT IN ('post','catalog_item') THEN RAISE EXCEPTION 'Invalid item type'; END IF;
 IF p_payload->>'item_type' = 'catalog_item' AND NOT public.reserve_catalog_stock((p_payload->>'item_id')::uuid,1) THEN
  RAISE EXCEPTION 'Item no longer available' USING ERRCODE = '23514';
 END IF;
 INSERT INTO public.escrow_transactions(item_id,buyer_id,seller_id,amount,commission,total_amount,seller_amount,status,
   payment_method,delivery_details,item_type,metadata)
 VALUES(p_payload->>'item_id',(p_payload->>'buyer_id')::uuid,(p_payload->>'seller_id')::uuid,
   (p_payload->>'amount')::numeric,(p_payload->>'commission')::numeric,(p_payload->>'total_amount')::numeric,
   (p_payload->>'seller_amount')::numeric,'pending','card',p_payload->'delivery_details',p_payload->>'item_type',
   coalesce(p_payload->'metadata','{}'::jsonb) || jsonb_build_object('inventory_reserved',p_payload->>'item_type' = 'catalog_item'))
 RETURNING id INTO v_id;
 RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.reserve_booking_checkout(p_booking_id uuid, p_buyer_id uuid, p_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  booking public.bookings%ROWTYPE; service public.service_offerings%ROWTYPE; business public.businesses%ROWTYPE;
  quote public.quote_requests%ROWTYPE; payment public.booking_payments%ROWTYPE; tx public.escrow_transactions%ROWTYPE;
  chosen text; price numeric; fee numeric;
BEGIN
  SELECT * INTO booking FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND OR booking.customer_id IS DISTINCT FROM p_buyer_id THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF booking.status NOT IN ('requested','confirmed') OR booking.appointment_time<=now() THEN RAISE EXCEPTION 'booking_not_payable'; END IF;
  SELECT * INTO business FROM public.businesses WHERE id=booking.business_id;
  SELECT * INTO service FROM public.service_offerings WHERE id=booking.service_id;
  IF business.owner_id IS NULL OR business.owner_id=p_buyer_id OR NOT business.is_active
    OR service.business_id IS DISTINCT FROM booking.business_id OR NOT service.is_active THEN RAISE EXCEPTION 'booking_service_unavailable'; END IF;
  chosen:=CASE WHEN booking.quote_id IS NOT NULL THEN 'full' WHEN service.escrow_enabled THEN 'escrow'
    WHEN service.requires_full_payment THEN 'full' WHEN service.deposit_required THEN 'deposit' ELSE NULL END;
  IF chosen IS NULL OR (p_type IS NOT NULL AND p_type IS DISTINCT FROM chosen) THEN RAISE EXCEPTION 'booking_payment_type_mismatch'; END IF;
  IF booking.quote_id IS NOT NULL THEN
    SELECT * INTO quote FROM public.quote_requests WHERE id=booking.quote_id;
    IF quote.customer_id IS DISTINCT FROM p_buyer_id OR quote.business_id IS DISTINCT FROM business.id
      OR quote.status<>'converted' OR quote.converted_booking_id IS DISTINCT FROM booking.id
      OR (quote.expires_at IS NOT NULL AND quote.expires_at<=now()) THEN RAISE EXCEPTION 'booking_quote_invalid'; END IF;
    price:=quote.estimated_price;
  ELSIF chosen='deposit' THEN
    price:=CASE WHEN service.deposit_amount>0 THEN service.deposit_amount
      WHEN service.deposit_percent>0 THEN round(service.price*service.deposit_percent/100,2) ELSE service.price END;
  ELSE price:=service.price; END IF;
  IF price IS NULL OR price::text IN ('NaN','Infinity','-Infinity') OR price<1200 OR round(price,2)<>price THEN
    RAISE EXCEPTION 'Booking payment must be at least NGN 1200, with at most two decimal places.';
  END IF;
  SELECT * INTO payment FROM public.booking_payments WHERE booking_id=booking.id
    AND status IN ('deposit_pending','deposit_paid','fully_paid','escrow_held','escrow_released') ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF payment.escrow_transaction_id IS NULL THEN RAISE EXCEPTION 'legacy_booking_payment_requires_review'; END IF;
    SELECT * INTO tx FROM public.escrow_transactions WHERE id=payment.escrow_transaction_id;
    IF payment.type::text<>chosen OR payment.amount<>price THEN RAISE EXCEPTION 'booking_checkout_changed'; END IF;
    RETURN jsonb_build_object('transaction',to_jsonb(tx),'newly_created',false);
  END IF;
  IF booking.status<>'confirmed' THEN RAISE EXCEPTION 'Wait for the business to accept your appointment and final price before paying'; END IF;
  IF booking.payment_flow='staged_50_50' THEN RAISE EXCEPTION 'Staged service checkout is not available yet. No payment has been started'; END IF;
  IF booking.payment_status IN ('deposit_paid','fully_paid','escrow_held','escrow_released') THEN RAISE EXCEPTION 'booking_already_paid'; END IF;
  fee:=round(price*0.03,2);
  INSERT INTO public.escrow_transactions(item_id,item_type,buyer_id,seller_id,amount,commission,total_amount,seller_amount,
    status,payment_method,delivery_details,payment_provider,payment_reference,metadata)
  VALUES(booking.id::text,'booking',p_buyer_id,business.owner_id,price,fee,price,price,'pending','card',
    '{"option":"service_booking"}','payluk','bk-'||gen_random_uuid()::text,
    jsonb_build_object('booking_id',booking.id,'booking_payment_type',chosen,'payluk_fee_mode','native_commission_v1'))
  RETURNING * INTO tx;
  INSERT INTO public.booking_payments(booking_id,amount,type,status,provider,payluk_reference,escrow_hold,
    escrow_transaction_id,commission,total_amount)
  VALUES(booking.id,price,chosen::public.payment_type_enum,'deposit_pending','payluk',tx.payment_reference,true,tx.id,fee,price);
  UPDATE public.bookings SET payment_status='deposit_pending' WHERE id=booking.id;
  RETURN jsonb_build_object('transaction',to_jsonb(tx),'newly_created',true);
END $$;

CREATE OR REPLACE FUNCTION public.save_payluk_dispute_plan(p_operation_id uuid,p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 op public.dispute_resolution_operations%ROWTYPE; tx public.escrow_transactions%ROWTYPE;
 principal numeric; fee numeric; additional_fee numeric; pool numeric; buyer numeric; seller numeric;
 expected_principal numeric; expected_pool numeric; expected_buyer numeric; expected_status text; v numeric;
BEGIN
 SELECT * INTO op FROM public.dispute_resolution_operations WHERE id=p_operation_id FOR UPDATE;
 IF NOT FOUND OR op.status<>'processing' THEN RAISE EXCEPTION 'Resolution is not processing'; END IF;
 SELECT t.* INTO tx FROM public.escrow_transactions t JOIN public.disputes d ON d.transaction_id=t.id WHERE d.id=op.dispute_id;
 IF tx.payment_provider IS DISTINCT FROM 'payluk' OR tx.status<>'disputed'
   OR p_plan->>'escrowId' IS DISTINCT FROM tx.payluk_escrow_id THEN RAISE EXCEPTION 'Escrow does not match dispute'; END IF;
 principal:=(p_plan->>'principal')::numeric; fee:=(p_plan->>'fee')::numeric;
 additional_fee:=(p_plan->>'additionalFee')::numeric; pool:=(p_plan->>'pool')::numeric;
 buyer:=(p_plan->>'buyerAmount')::numeric; seller:=(p_plan->>'sellerAmount')::numeric;
 FOREACH v IN ARRAY ARRAY[tx.amount,op.refund_amount,op.seller_amount,principal,fee,additional_fee,pool,buyer,seller] LOOP
  IF v IS NULL OR v::text IN ('NaN','Infinity','-Infinity') OR v<0 OR round(v,2)<>v THEN RAISE EXCEPTION 'Invalid settlement amount'; END IF;
 END LOOP;
 IF tx.amount<=0 OR op.refund_amount+op.seller_amount<>tx.amount THEN RAISE EXCEPTION 'Gross ruling does not equal price'; END IF;
 expected_principal:=CASE WHEN tx.metadata->>'payluk_fee_mode'='seller_commission_v1' THEN tx.amount-tx.commission ELSE tx.amount END;
 IF principal<>expected_principal OR fee>principal OR p_plan->>'whoPays' IS NULL
   OR p_plan->>'whoPays' NOT IN ('buyer','seller','both') THEN RAISE EXCEPTION 'Provider price or fee mismatch'; END IF;
 IF tx.metadata->>'payluk_fee_mode' IN ('seller_commission_v1','buyer_commission_v1')
   AND (p_plan->>'whoPays'<>'seller' OR additional_fee<>tx.commission) THEN RAISE EXCEPTION 'Commission allocation mismatch'; END IF;
 IF tx.metadata->>'payluk_fee_mode'='native_commission_v1'
   AND (p_plan->>'whoPays'<>'seller' OR additional_fee<>0) THEN RAISE EXCEPTION 'Native commission allocation mismatch'; END IF;
 expected_pool:=principal-CASE p_plan->>'whoPays' WHEN 'seller' THEN fee WHEN 'both' THEN round(fee/2,2) ELSE 0 END;
 expected_buyer:=round(expected_pool*op.refund_amount/tx.amount,2);
 expected_status:=CASE WHEN op.refund_amount=0 THEN 'COMPLETED' WHEN op.seller_amount=0 THEN 'REFUNDED' ELSE 'SPLIT' END;
 IF pool<=0 OR pool<>expected_pool OR buyer<>expected_buyer OR seller<>pool-buyer
   OR p_plan->>'status' IS DISTINCT FROM expected_status
   OR (p_plan->>'additionalFeeRefundable')::boolean IS DISTINCT FROM (expected_status<>'COMPLETED')
   OR (expected_status='SPLIT' AND (buyer=0 OR seller=0)) THEN RAISE EXCEPTION 'Invalid fee-adjusted ruling'; END IF;
 IF op.provider_plan IS NOT NULL AND op.provider_plan<>p_plan THEN RAISE EXCEPTION 'A saved settlement plan cannot change'; END IF;
 UPDATE public.dispute_resolution_operations SET provider_plan=p_plan,updated_at=now() WHERE id=op.id;
 RETURN p_plan;
END; $$;

REVOKE ALL ON FUNCTION public.create_checkout_reservation(jsonb),public.reserve_booking_checkout(uuid,uuid,text),
  public.save_payluk_dispute_plan(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_reservation(jsonb),public.reserve_booking_checkout(uuid,uuid,text),
  public.save_payluk_dispute_plan(uuid,jsonb) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
