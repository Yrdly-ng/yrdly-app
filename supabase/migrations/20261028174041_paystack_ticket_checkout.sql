-- Additive sandbox checkout. Provider money is verified by the server before
-- calling these service-role-only functions. No migration initiates payments.
ALTER TABLE public.tickets ADD COLUMN is_test_payment boolean NOT NULL DEFAULT false;
CREATE TABLE public.paystack_ticket_orders (
  transaction_id uuid PRIMARY KEY REFERENCES public.escrow_transactions(id),
  domain text NOT NULL CHECK (domain IN ('test','live')),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','initializing','pending','paid','closed','refund_required')),
  authorization_url text,
  access_code text,
  provider_transaction_id text,
  provider_fee_kobo bigint CHECK (provider_fee_kobo >= 0),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX paystack_ticket_provider_transaction ON public.paystack_ticket_orders(domain,provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE TABLE public.paystack_event_webhooks (
  digest text PRIMARY KEY,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  retry_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paystack_event_webhooks_pending ON public.paystack_event_webhooks(received_at) WHERE processed_at IS NULL;
CREATE TABLE public.paystack_ticket_delivery (
  transaction_id uuid PRIMARY KEY REFERENCES public.paystack_ticket_orders(transaction_id),
  organizer_notification_id uuid,
  delivered_at timestamptz,
  locked_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  retry_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paystack_ticket_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paystack_event_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paystack_ticket_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paystack_ticket_orders,public.paystack_event_webhooks,public.paystack_ticket_delivery FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.paystack_ticket_orders,public.paystack_event_webhooks,public.paystack_ticket_delivery TO service_role;

CREATE FUNCTION public.close_paystack_ticket_checkout(p_transaction_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE tx public.escrow_transactions%ROWTYPE; tier uuid; order_row public.paystack_ticket_orders%ROWTYPE;
BEGIN
  SELECT tier_id INTO tier FROM public.ticket_checkout_reservations WHERE transaction_id=p_transaction_id;
  PERFORM 1 FROM public.ticket_tiers WHERE id=tier FOR UPDATE;
  SELECT * INTO tx FROM public.escrow_transactions WHERE id=p_transaction_id FOR UPDATE;
  SELECT * INTO order_row FROM public.paystack_ticket_orders WHERE transaction_id=p_transaction_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider IS DISTINCT FROM 'paystack' OR tx.item_type IS DISTINCT FROM 'ticket' THEN RAISE EXCEPTION 'ticket_checkout_not_found'; END IF;
  IF order_row.state='closed' THEN RETURN; END IF;
  IF order_row.state IN ('paid','refund_required') OR tx.status NOT IN ('pending','creating_escrow','reconciling') THEN RAISE EXCEPTION 'ticket_checkout_already_paid'; END IF;
  UPDATE public.ticket_checkout_reservations SET remaining=0 WHERE transaction_id=p_transaction_id;
  UPDATE public.paystack_ticket_orders SET state='closed',updated_at=now() WHERE transaction_id=p_transaction_id;
  UPDATE public.escrow_transactions SET status='cancelled',updated_at=now() WHERE id=p_transaction_id;
END $$;

CREATE FUNCTION public.reserve_paystack_ticket_checkout(p_payload jsonb,p_domain text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE tier public.ticket_tiers%ROWTYPE; event_row public.events%ROWTYPE; tx public.escrow_transactions%ROWTYPE;
  buyer uuid := (p_payload->>'buyer_id')::uuid; qty integer := (p_payload->>'quantity')::integer;
  held integer; owned integer; gross numeric; fee numeric; expired uuid;
BEGIN
  IF p_domain IS NULL OR p_domain NOT IN ('test','live') THEN RAISE EXCEPTION 'invalid_payment_environment'; END IF;
  SELECT * INTO tier FROM public.ticket_tiers WHERE id=(p_payload->>'tier_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_tier_not_found'; END IF;
  SELECT * INTO event_row FROM public.events WHERE id=tier.event_id;
  IF event_row.id IS DISTINCT FROM (p_payload->>'event_id')::uuid OR event_row.status IS DISTINCT FROM 'PUBLISHED'
    OR event_row.end_time IS NULL OR event_row.end_time<=now() OR buyer IS NULL OR buyer=event_row.organizer_id
    OR tier.is_visible IS DISTINCT FROM true OR (tier.sale_ends_at IS NOT NULL AND tier.sale_ends_at<=now()) THEN RAISE EXCEPTION 'ticket_checkout_unavailable'; END IF;
  IF qty IS NULL OR qty NOT BETWEEN 1 AND 5 OR tier.price IS NULL OR tier.price::text IN ('NaN','Infinity','-Infinity')
    OR tier.price<1200 OR round(tier.price,2)<>tier.price THEN RAISE EXCEPTION 'invalid_ticket_checkout'; END IF;
  -- Paystack payment links can remain payable after local seat expiry. A later
  -- verified payment is retained for refund review, never given another seat.
  FOR expired IN SELECT r.transaction_id FROM public.ticket_checkout_reservations r
    JOIN public.paystack_ticket_orders o ON o.transaction_id=r.transaction_id
    WHERE r.tier_id=tier.id AND r.remaining>0 AND r.expires_at<=now()
      AND o.state IN ('reserved','initializing','pending') ORDER BY r.transaction_id LOOP
    PERFORM public.close_paystack_ticket_checkout(expired);
  END LOOP;
  SELECT x.* INTO tx FROM public.escrow_transactions x JOIN public.ticket_checkout_reservations r ON r.transaction_id=x.id
    WHERE r.tier_id=tier.id AND r.buyer_id=buyer AND r.remaining>0
    ORDER BY x.created_at DESC LIMIT 1 FOR UPDATE OF x;
  IF FOUND THEN
    IF tx.payment_provider IS DISTINCT FROM 'paystack' THEN RAISE EXCEPTION 'finish_existing_provider_checkout'; END IF;
    IF (tx.metadata->>'quantity')::integer<>qty THEN RAISE EXCEPTION 'ticket_checkout_quantity_changed'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.paystack_ticket_orders WHERE transaction_id=tx.id AND domain=p_domain) THEN RAISE EXCEPTION 'payment_environment_mismatch'; END IF;
    RETURN jsonb_build_object('transaction',to_jsonb(tx),'newly_created',false);
  END IF;
  SELECT coalesce(sum(remaining),0) INTO held FROM public.ticket_checkout_reservations WHERE tier_id=tier.id;
  IF tier.capacity IS NOT NULL AND tier.sold+held+qty>tier.capacity THEN RAISE EXCEPTION 'ticket_tier_sold_out'; END IF;
  SELECT count(*) INTO owned FROM public.tickets WHERE tier_id=tier.id AND buyer_id=buyer AND status IN ('PAID','USED');
  SELECT owned+coalesce(sum(remaining),0) INTO owned FROM public.ticket_checkout_reservations WHERE tier_id=tier.id AND buyer_id=buyer;
  IF owned+qty>5 THEN RAISE EXCEPTION 'ticket_buyer_limit'; END IF;
  gross:=round(tier.price*qty,2); fee:=round(gross*0.03,2);
  INSERT INTO public.escrow_transactions(item_id,item_type,buyer_id,seller_id,amount,commission,total_amount,seller_amount,status,payment_method,delivery_details,payment_provider,payment_reference,metadata)
    VALUES(tier.id::text,'ticket',buyer,event_row.organizer_id,gross,fee,gross,gross-fee,'pending','card','{"option":"event_entry"}','paystack',
      'evt-'||gen_random_uuid()::text,p_payload||jsonb_build_object('ticket_reserved',true,'paystack_domain',p_domain)) RETURNING * INTO tx;
  INSERT INTO public.ticket_checkout_reservations(transaction_id,tier_id,buyer_id,quantity,remaining,expires_at)
    VALUES(tx.id,tier.id,buyer,qty,qty,now()+interval '10 minutes');
  INSERT INTO public.paystack_ticket_orders(transaction_id,domain) VALUES(tx.id,p_domain);
  RETURN jsonb_build_object('transaction',to_jsonb(tx),'newly_created',true);
END $$;

-- Keep older clients on their original provider when a Paystack order exists.
ALTER FUNCTION public.reserve_ticket_checkout(jsonb) RENAME TO reserve_payluk_ticket_checkout;
CREATE FUNCTION public.reserve_ticket_checkout(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.ticket_tiers WHERE id=(p_payload->>'tier_id')::uuid FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_reservations r JOIN public.escrow_transactions x ON x.id=r.transaction_id
    WHERE r.tier_id=(p_payload->>'tier_id')::uuid AND r.buyer_id=(p_payload->>'buyer_id')::uuid AND r.remaining>0 AND x.payment_provider IS DISTINCT FROM 'payluk') THEN
    RAISE EXCEPTION 'finish_existing_provider_checkout';
  END IF;
  RETURN public.reserve_payluk_ticket_checkout(p_payload);
END $$;

CREATE FUNCTION public.fulfill_paystack_ticket_checkout(p_transaction_id uuid,p_verified jsonb,p_tickets jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE tx public.escrow_transactions%ROWTYPE; order_row public.paystack_ticket_orders%ROWTYPE; reservation public.ticket_checkout_reservations%ROWTYPE;
  event_row public.events%ROWTYPE; tier public.ticket_tiers%ROWTYPE; qty integer; ticket jsonb; issued jsonb; first_id uuid;
  notification_id uuid; fees bigint; gross bigint; commission_kobo bigint;
BEGIN
  SELECT tier_id INTO tier.id FROM public.ticket_checkout_reservations WHERE transaction_id=p_transaction_id;
  SELECT * INTO tier FROM public.ticket_tiers WHERE id=tier.id FOR UPDATE;
  SELECT * INTO tx FROM public.escrow_transactions WHERE id=p_transaction_id FOR UPDATE;
  SELECT * INTO order_row FROM public.paystack_ticket_orders WHERE transaction_id=p_transaction_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider IS DISTINCT FROM 'paystack' OR tx.item_type IS DISTINCT FROM 'ticket' THEN RAISE EXCEPTION 'ticket_checkout_not_found'; END IF;
  SELECT * INTO reservation FROM public.ticket_checkout_reservations WHERE transaction_id=p_transaction_id FOR UPDATE;
  SELECT * INTO event_row FROM public.events WHERE id=(tx.metadata->>'event_id')::uuid FOR UPDATE;
  gross:=round(tx.total_amount*100); commission_kobo:=round(tx.commission*100);
  IF p_verified->>'status' IS DISTINCT FROM 'success' OR p_verified->>'reference' IS DISTINCT FROM tx.payment_reference
    OR p_verified->>'currency' IS DISTINCT FROM 'NGN' OR p_verified->>'domain' IS DISTINCT FROM order_row.domain
    OR (p_verified->>'amount')::numeric IS DISTINCT FROM gross::numeric
    OR p_verified->'metadata'->>'yrdly_transaction_id' IS DISTINCT FROM tx.id::text
    OR coalesce(p_verified->>'id','')!~'^[0-9]+$' OR p_verified->>'paid_at' IS NULL
    OR p_verified->>'fees' IS NULL OR (p_verified->>'fees')::numeric<>trunc((p_verified->>'fees')::numeric) THEN
    RAISE EXCEPTION 'paystack_verification_mismatch';
  END IF;
  fees:=(p_verified->>'fees')::bigint;
  IF fees<0 OR fees>gross-commission_kobo THEN RAISE EXCEPTION 'paystack_fee_requires_review'; END IF;
  IF order_row.provider_transaction_id IS NOT NULL AND order_row.provider_transaction_id IS DISTINCT FROM p_verified->>'id' THEN RAISE EXCEPTION 'paystack_transaction_mismatch'; END IF;
  IF order_row.state='refund_required' THEN RETURN jsonb_build_object('refund_required',true); END IF;
  SELECT jsonb_agg(jsonb_build_object('id',id,'event_id',event_id,'ticket_code',ticket_code,'qr_data',qr_data) ORDER BY purchase_ticket_index)
    INTO issued FROM public.tickets WHERE payment_tx_ref=tx.id::text;
  qty:=(tx.metadata->>'quantity')::integer;
  IF order_row.state='paid' THEN
    IF coalesce(jsonb_array_length(issued),0)<>qty THEN RAISE EXCEPTION 'ticket_issuance_requires_review'; END IF;
    RETURN jsonb_build_object('tickets',issued,'quantity',qty,'newly_issued',false);
  END IF;
  IF issued IS NOT NULL THEN RAISE EXCEPTION 'ticket_issuance_requires_review'; END IF;
  UPDATE public.paystack_ticket_orders SET provider_transaction_id=p_verified->>'id',provider_fee_kobo=fees,
    paid_at=(p_verified->>'paid_at')::timestamptz,updated_at=now() WHERE transaction_id=tx.id;
  IF order_row.state='closed' OR reservation.remaining IS DISTINCT FROM qty OR reservation.expires_at<=now()
    OR event_row.status IS DISTINCT FROM 'PUBLISHED' OR event_row.end_time IS NULL OR event_row.end_time<=now() THEN
    UPDATE public.paystack_ticket_orders SET state='refund_required' WHERE transaction_id=tx.id;
    UPDATE public.ticket_checkout_reservations SET remaining=0 WHERE transaction_id=tx.id;
    UPDATE public.escrow_transactions SET status='reconciling',updated_at=now() WHERE id=tx.id;
    INSERT INTO public.payment_reconciliation_flags(provider,reference,transaction_id,reason)
      VALUES('paystack',tx.payment_reference,tx.id,'ticket_paid_after_reservation_closed') ON CONFLICT(provider,reference,reason) DO NOTHING;
    RETURN jsonb_build_object('refund_required',true);
  END IF;
  IF jsonb_typeof(p_tickets) IS DISTINCT FROM 'array' OR jsonb_array_length(p_tickets)<>qty THEN RAISE EXCEPTION 'invalid_ticket_payload'; END IF;
  UPDATE public.paystack_ticket_orders SET state='paid' WHERE transaction_id=tx.id;
  -- The earnings migration attaches its trigger here. Order facts precede this
  -- transition; ticket rows and financial liability commit in one transaction.
  UPDATE public.escrow_transactions SET status='paid',seller_amount=(gross-commission_kobo-fees)::numeric/100,
    updated_at=now() WHERE id=tx.id;
  FOR ticket IN SELECT value FROM jsonb_array_elements(p_tickets) LOOP
    INSERT INTO public.tickets(buyer_id,event_id,tier_id,attendee_name,attendee_email,attendee_phone,ticket_code,qr_data,status,
      payment_tx_ref,purchase_ticket_index,payment_provider,settlement_mode,payment_provider_ref,amount_paid,expires_at,is_test_payment)
    VALUES(tx.buyer_id,event_row.id,tier.id,tx.metadata->>'attendee_name',tx.metadata->>'attendee_email',tx.metadata->>'attendee_phone',
      ticket->>'ticket_code',ticket->>'qr_data','PAID',tx.id::text,(ticket->>'index')::integer,'paystack','held',tx.payment_reference,
      tx.total_amount/qty,event_row.end_time,order_row.domain='test');
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('id',id,'event_id',event_id,'ticket_code',ticket_code,'qr_data',qr_data) ORDER BY purchase_ticket_index)
    INTO issued FROM public.tickets WHERE payment_tx_ref=tx.id::text;
  first_id:=(issued->0->>'id')::uuid;
  UPDATE public.events SET attendee_count=coalesce(attendee_count,0)+qty WHERE id=event_row.id;
  INSERT INTO public.notifications(user_id,type,title,message,sender_id,related_id,related_type,data)
    VALUES(event_row.organizer_id,'ticket_purchase',CASE WHEN order_row.domain='test' THEN 'Sandbox tickets issued' ELSE 'Tickets sold' END,coalesce(tx.metadata->>'attendee_name','A buyer')||' bought '||qty::text||' ticket(s) for '||event_row.title,
      tx.buyer_id,first_id,'ticket',jsonb_build_object('audience','organizer','eventId',event_row.id,'eventTitle',event_row.title,'ticketId',first_id,'tierName',tier.name,'quantity',qty))
    RETURNING id INTO notification_id;
  INSERT INTO public.paystack_ticket_delivery(transaction_id,organizer_notification_id) VALUES(tx.id,notification_id);
  RETURN jsonb_build_object('tickets',issued,'quantity',qty,'newly_issued',true);
END $$;

REVOKE ALL ON FUNCTION public.reserve_paystack_ticket_checkout(jsonb,text),public.close_paystack_ticket_checkout(uuid),
  public.fulfill_paystack_ticket_checkout(uuid,jsonb,jsonb),public.reserve_ticket_checkout(jsonb),public.reserve_payluk_ticket_checkout(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_paystack_ticket_checkout(jsonb,text),public.close_paystack_ticket_checkout(uuid),
  public.fulfill_paystack_ticket_checkout(uuid,jsonb,jsonb),public.reserve_ticket_checkout(jsonb),public.reserve_payluk_ticket_checkout(jsonb) TO service_role;
