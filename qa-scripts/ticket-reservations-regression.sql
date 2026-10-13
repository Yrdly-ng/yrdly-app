BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE raw_user_meta_data->>'qa_prefix' IS DISTINCT FROM 'YRDLY-QA') THEN
    RAISE EXCEPTION 'Requires isolated QA database';
  END IF;
END $$;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '25s';
DO $test$
DECLARE seller uuid; buyer uuid; outsider uuid; event_id uuid; tier uuid; tx uuid; tx2 uuid;
  result jsonb; payload jsonb; denied boolean; checks jsonb := '[]';
BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  SELECT id INTO seller FROM public.users ORDER BY id LIMIT 1;
  SELECT id INTO buyer FROM public.users WHERE id <> seller ORDER BY id LIMIT 1;
  SELECT id INTO outsider FROM public.users WHERE id NOT IN (seller,buyer) ORDER BY id LIMIT 1;
  IF outsider IS NULL THEN RAISE EXCEPTION 'Three QA profiles required'; END IF;
  INSERT INTO public.events(organizer_id,title,start_time,end_time,status,moderation_status)
    VALUES(seller,'YRDLY-QA rollback ticket reservations',now()+interval '1 day',now()+interval '2 days','PUBLISHED','approved') RETURNING id INTO event_id;
  INSERT INTO public.ticket_tiers(event_id,name,price,capacity) VALUES(event_id,'YRDLY-QA rollback tier',2500,2) RETURNING id INTO tier;
  EXECUTE 'SET LOCAL ROLE service_role';
  payload := jsonb_build_object('event_id',event_id,'tier_id',tier,'buyer_id',buyer,'quantity',2,'attendee_name','YRDLY-QA','attendee_email','qa@example.test');
  result := public.reserve_ticket_checkout(payload); tx := (result->'transaction'->>'id')::uuid;
  result := public.reserve_ticket_checkout(payload);
  IF (result->>'newly_created')::boolean OR (result->'transaction'->>'id')::uuid <> tx
    OR (SELECT remaining FROM public.ticket_checkout_reservations WHERE transaction_id=tx) <> 2
    OR (SELECT sold FROM public.ticket_tiers WHERE id=tier) <> 0 THEN RAISE EXCEPTION 'Retry changed reservation'; END IF;
  checks := checks || '[{"test":"retry reuses one unpaid order and two seats","result":"PASS"}]';
  denied := false;
  BEGIN PERFORM public.reserve_ticket_checkout(payload || jsonb_build_object('buyer_id',outsider,'quantity',1));
  EXCEPTION WHEN raise_exception THEN denied := SQLERRM = 'ticket_tier_sold_out'; END;
  IF NOT denied THEN RAISE EXCEPTION 'Last seats oversold'; END IF;
  checks := checks || '[{"test":"another buyer cannot reserve held capacity","result":"PASS"}]';
  denied := false;
  BEGIN INSERT INTO public.tickets(buyer_id,event_id,tier_id,attendee_name,attendee_email,ticket_code,status,amount_paid)
    VALUES(outsider,event_id,tier,'QA','qa@example.test','YRDLY-QA-'||gen_random_uuid(),'PAID',0);
  EXCEPTION WHEN raise_exception THEN denied := SQLERRM = 'ticket_tier_sold_out'; END;
  IF NOT denied THEN RAISE EXCEPTION 'Ticket insertion stole reserved seats'; END IF;
  checks := checks || '[{"test":"direct ticket fulfillment respects other reservations","result":"PASS"}]';
  PERFORM public.release_ticket_checkout(tx);
  IF (SELECT remaining FROM public.ticket_checkout_reservations WHERE transaction_id=tx) <> 0
    OR (SELECT status FROM public.escrow_transactions WHERE id=tx) <> 'cancelled' THEN RAISE EXCEPTION 'Unpaid release failed'; END IF;
  result := public.reserve_ticket_checkout(payload); tx2 := (result->'transaction'->>'id')::uuid;
  IF tx2 = tx THEN RAISE EXCEPTION 'Released reservation reused'; END IF;
  checks := checks || '[{"test":"safe unpaid cancellation returns seats for a new order","result":"PASS"}]';
  UPDATE public.escrow_transactions SET status='paid' WHERE id=tx2;
  INSERT INTO public.tickets(buyer_id,event_id,tier_id,attendee_name,attendee_email,ticket_code,status,amount_paid,payment_tx_ref,purchase_ticket_index,payment_provider,settlement_mode)
    SELECT buyer,event_id,tier,'QA','qa@example.test','YRDLY-QA-'||gen_random_uuid(),'PAID',2500,tx2::text,n,'payluk','held' FROM generate_series(0,1) n;
  IF (SELECT remaining FROM public.ticket_checkout_reservations WHERE transaction_id=tx2) <> 0
    OR (SELECT sold FROM public.ticket_tiers WHERE id=tier) <> 2 THEN RAISE EXCEPTION 'Fulfillment double-counted capacity'; END IF;
  checks := checks || '[{"test":"paid fulfillment atomically converts reserved seats to sold seats","result":"PASS"}]';
  denied := false;
  BEGIN PERFORM public.release_ticket_checkout(tx2); EXCEPTION WHEN raise_exception THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Paid order released without refund'; END IF;
  checks := checks || '[{"test":"paid order cannot be cancelled as unpaid","result":"PASS"}]';
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',buyer)::text,true);
  denied := false;
  BEGIN PERFORM public.reserve_ticket_checkout(payload); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'User invoked reservation RPC'; END IF;
  denied := false;
  BEGIN PERFORM 1 FROM public.ticket_checkout_reservations; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'User read private reservation data'; END IF;
  checks := checks || '[{"test":"authenticated reservation RPC and table access denied","result":"PASS","sqlstate":"42501"}]';
  EXECUTE 'SET LOCAL ROLE anon';
  denied := false;
  BEGIN PERFORM public.release_ticket_checkout(tx2); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Anonymous reservation release accepted'; END IF;
  checks := checks || '[{"test":"anonymous release denied","result":"PASS","sqlstate":"42501"}]';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('audit.ticket_reservations',checks::text,true);
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('audit.ticket_reservations',(checks || jsonb_build_array(jsonb_build_object('result','FAIL','sqlstate',SQLSTATE,'message',SQLERRM)))::text,true);
END $test$;
SELECT current_setting('audit.ticket_reservations')::jsonb AS results;
ROLLBACK;
