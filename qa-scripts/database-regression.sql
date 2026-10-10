BEGIN;
-- Refuse any database containing non-QA Auth accounts, even if run manually.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM auth.users WHERE raw_user_meta_data->>'qa_prefix' IS DISTINCT FROM 'YRDLY-QA')
 OR (SELECT count(*) FROM auth.users WHERE raw_user_meta_data->>'qa_prefix' = 'YRDLY-QA') < 3 THEN
  RAISE EXCEPTION 'This rollback regression requires the isolated QA database';
 END IF;
END; $$;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '25s';
DO $audit$
DECLARE
 actor uuid; buyer uuid; outsider uuid; item uuid; tx uuid; tx2 uuid; tx3 uuid;
 account uuid; payout uuid; payout2 uuid; dispute uuid; operation uuid;
 event_id uuid; tier uuid; ticket uuid; listing uuid; paid_listing uuid;
 payload jsonb; results jsonb := '[]'; outcome text; denied boolean; n integer; applied boolean; replayed boolean;
BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 SELECT u.id INTO actor FROM public.users u JOIN auth.users a ON a.id=u.id
 WHERE NOT coalesce(u.is_admin,false)
 AND NOT EXISTS(SELECT 1 FROM public.payout_requests p WHERE p.seller_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM public.escrow_transactions e WHERE e.seller_id=u.id)
 ORDER BY u.id LIMIT 1;
 SELECT id INTO buyer FROM public.users WHERE id <> actor ORDER BY id LIMIT 1;
 SELECT id INTO outsider FROM public.users WHERE id NOT IN (actor,buyer) ORDER BY id LIMIT 1;
 IF actor IS NULL OR buyer IS NULL OR outsider IS NULL THEN RAISE EXCEPTION 'Three fixture actors required'; END IF;
 PERFORM set_config('audit.actor',actor::text,true);

 -- No existing orders, payout accounts or paid records are changed.
 INSERT INTO public.catalog_items(title,price,quantity,inventory_count,in_stock)
 VALUES('AUDIT_ROLLBACK_ONLY_20261010',100,2,2,true) RETURNING id INTO item;
 EXECUTE 'SET LOCAL ROLE service_role';
 IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Service role test setup failed'; END IF;
 payload := jsonb_build_object('item_id',item,'buyer_id',buyer,'seller_id',actor,
 'amount',100,'commission',3,'total_amount',103,'seller_amount',100,
 'item_type','catalog_item','delivery_details','{}'::jsonb);
 tx := public.create_checkout_reservation(payload);
 IF (SELECT quantity FROM public.catalog_items WHERE id=item) <> 1 THEN RAISE EXCEPTION 'Initial stock not reserved'; END IF;
 denied := false;
 BEGIN PERFORM public.create_checkout_reservation(payload);
 EXCEPTION WHEN unique_violation THEN denied := true; END;
 IF NOT denied OR (SELECT quantity FROM public.catalog_items WHERE id=item) <> 1 THEN RAISE EXCEPTION 'Duplicate order did not roll stock back'; END IF;
 tx2 := public.create_checkout_reservation(payload || jsonb_build_object('buyer_id',outsider));
 denied := false;
 BEGIN PERFORM public.create_checkout_reservation(payload);
 EXCEPTION WHEN check_violation THEN denied := true; END;
 IF NOT denied OR (SELECT quantity FROM public.catalog_items WHERE id=item) <> 0 THEN RAISE EXCEPTION 'Oversell accepted'; END IF;
 results := results || jsonb_build_array(jsonb_build_object('test','catalog duplicate and sold-out reservations','result','PASS','stock',0));
 PERFORM public.abandon_checkout_reservation(tx);
 PERFORM public.abandon_checkout_reservation(tx);
 PERFORM public.abandon_checkout_reservation(tx2);
 IF (SELECT quantity FROM public.catalog_items WHERE id=item) <> 2 THEN RAISE EXCEPTION 'Abandon restored stock more than once'; END IF;
 results := results || '[{"test":"abandon replay restores stock once","result":"PASS"}]'::jsonb;

 tx := public.create_checkout_reservation(payload);
 outcome := public.apply_escrow_payment(tx,'payluk','audit-rollback-payment');
 IF outcome <> 'applied' OR public.apply_escrow_payment(tx,'payluk','audit-rollback-payment') <> 'replay'
 OR (SELECT quantity FROM public.catalog_items WHERE id=item) <> 1 THEN RAISE EXCEPTION 'Payment replay changed inventory'; END IF;
 results := results || '[{"test":"payment replay does not reserve twice","result":"PASS"}]'::jsonb;
 applied := public.apply_escrow_refund(tx,'audit-rollback-refund',100);
 replayed := public.apply_escrow_refund(tx,'audit-rollback-refund',100);
 IF NOT applied OR replayed
 OR (SELECT quantity FROM public.catalog_items WHERE id=item) <> 2
 OR (SELECT count(*) FROM public.disputes WHERE transaction_id=tx AND refund_amount=100 AND status='resolved') <> 1
 THEN RAISE EXCEPTION 'Refund replay was not idempotent'; END IF;
 results := results || '[{"test":"full refund records amount and restores inventory once","result":"PASS"}]'::jsonb;
 outcome := public.apply_escrow_payment(tx,'payluk','audit-rollback-late');
 IF outcome <> 'review'
 OR (SELECT status FROM public.escrow_transactions WHERE id=tx) <> 'cancelled'
 OR NOT EXISTS(SELECT 1 FROM public.payment_reconciliation_flags WHERE transaction_id=tx AND reason='late_success')
 THEN RAISE EXCEPTION 'Late success resurrected a cancelled order'; END IF;
 results := results || '[{"test":"late payment stays cancelled with durable reconciliation flag","result":"PASS"}]'::jsonb;
 tx := public.create_checkout_reservation(payload);
 PERFORM public.apply_escrow_payment(tx,'payluk','audit-rollback-partial');
 applied := public.apply_escrow_refund(tx,'audit-rollback-partial',50);
 IF applied
 OR (SELECT status FROM public.escrow_transactions WHERE id=tx) <> 'paid'
 OR (SELECT quantity FROM public.catalog_items WHERE id=item) <> 1
 OR NOT EXISTS(SELECT 1 FROM public.payment_reconciliation_flags WHERE transaction_id=tx AND reason='partial_refund_requires_resolution')
 THEN RAISE EXCEPTION 'Partial refund incorrectly finalized'; END IF;
 results := results || '[{"test":"partial refund held for reconciliation without stock release","result":"PASS"}]'::jsonb;
 UPDATE public.escrow_transactions SET status='disputed' WHERE id=tx;
 INSERT INTO public.disputes(transaction_id,opened_by,dispute_reason) VALUES(tx,buyer,'AUDIT_ROLLBACK_ONLY_20261010') RETURNING id INTO dispute;
 INSERT INTO public.dispute_resolution_operations(dispute_id,requested_by,resolution,refund_amount,seller_amount,status)
 VALUES(dispute,actor,'refund',100,0,'processing') RETURNING id INTO operation;
 PERFORM public.finish_dispute_resolution(operation,'audit-rollback-resolution');
 PERFORM public.finish_dispute_resolution(operation,'audit-rollback-resolution');
 IF (SELECT status FROM public.escrow_transactions WHERE id=tx) <> 'cancelled'
 OR (SELECT status FROM public.dispute_resolution_operations WHERE id=operation) <> 'succeeded'
 OR (SELECT refund_amount FROM public.disputes WHERE id=dispute) <> 100
 OR (SELECT quantity FROM public.catalog_items WHERE id=item) <> 2
 THEN RAISE EXCEPTION 'Dispute finalization failed or replay restored stock'; END IF;
 results := results || '[{"test":"typed dispute resolution and replay","result":"PASS"}]'::jsonb;

 INSERT INTO public.events(organizer_id,title,start_time,status)
 VALUES(actor,'AUDIT_ROLLBACK_ONLY_20261010',now()+interval '1 day','DRAFT') RETURNING id INTO event_id;
 INSERT INTO public.ticket_tiers(event_id,name,price,capacity) VALUES(event_id,'AUDIT_ROLLBACK_ONLY_20261010',100,2) RETURNING id INTO tier;
 INSERT INTO public.escrow_transactions(item_id,buyer_id,seller_id,amount,commission,total_amount,seller_amount,status,payment_method,delivery_details,item_type,payment_provider)
 VALUES(event_id::text,buyer,actor,100,3,103,100,'paid','card','{}','ticket','payluk') RETURNING id INTO tx;
 INSERT INTO public.tickets(buyer_id,event_id,tier_id,attendee_name,attendee_email,ticket_code,status,amount_paid,payment_tx_ref,payment_provider,settlement_mode)
 VALUES(buyer,event_id,tier,'Audit fixture','audit@example.invalid','AUDIT_ROLLBACK_ONLY_'||gen_random_uuid(),'PAID',100,tx::text,'payluk','held') RETURNING id INTO ticket;
 applied := public.apply_escrow_refund(tx,'audit-rollback-ticket',100);
 replayed := public.apply_escrow_refund(tx,'audit-rollback-ticket',100);
 IF NOT applied OR replayed
 OR (SELECT status FROM public.tickets WHERE id=ticket) <> 'REFUNDED'
 OR (SELECT refund_status FROM public.tickets WHERE id=ticket) <> 'processed'
 OR (SELECT sold FROM public.ticket_tiers WHERE id=tier) <> 0 THEN RAISE EXCEPTION 'Ticket refund/tier count inconsistent'; END IF;
 results := results || '[{"test":"ticket refund state and tier capacity restored once","result":"PASS"}]'::jsonb;

 INSERT INTO public.posts(user_id,author_name,text,category) VALUES(actor,'Audit fixture','AUDIT_ROLLBACK_ONLY_20261010','For Sale') RETURNING id INTO listing;
 DELETE FROM public.posts WHERE id=listing;
 INSERT INTO public.posts(user_id,author_name,text,category) VALUES(actor,'Audit fixture','AUDIT_ROLLBACK_ONLY_20261010','For Sale') RETURNING id INTO paid_listing;
 INSERT INTO public.escrow_transactions(item_id,buyer_id,seller_id,amount,commission,total_amount,seller_amount,status,payment_method,delivery_details,item_type)
 VALUES(paid_listing::text,buyer,actor,100,3,103,100,'paid','card','{}','post') RETURNING id INTO tx;
 denied := false;
 BEGIN DELETE FROM public.posts WHERE id=paid_listing; EXCEPTION WHEN check_violation THEN denied := true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Paid listing deletion allowed'; END IF;
 UPDATE public.escrow_transactions SET status='cancelled' WHERE id=tx;
 DELETE FROM public.posts WHERE id=paid_listing;
 results := results || '[{"test":"delete unpaid/cancelled listing allowed and paid listing blocked","result":"PASS"}]'::jsonb;

 INSERT INTO public.escrow_transactions(item_id,buyer_id,seller_id,amount,commission,total_amount,seller_amount,status,payment_method,delivery_details,item_type,payment_provider)
 VALUES(gen_random_uuid()::text,buyer,actor,10000,300,10300,10000,'completed','card','{}','post','payluk');
 INSERT INTO public.escrow_transactions(item_id,buyer_id,seller_id,amount,commission,total_amount,seller_amount,status,payment_method,delivery_details,item_type,payment_provider)
 VALUES(gen_random_uuid()::text,buyer,actor,100000,3000,103000,100000,'completed','card','{}','post',NULL),
 (gen_random_uuid()::text,buyer,actor,100000,3000,103000,100000,'completed','card','{}','ticket','payluk');
 INSERT INTO public.seller_accounts(user_id,account_type,account_details,is_active,verification_status,account_updated_at,payout_enabled)
 VALUES(actor,'bank_account','{}',true,'verified',now(),false) RETURNING id INTO account;
 denied := false;
 BEGIN PERFORM public.reserve_seller_payout(actor,account,7000,1000000,NULL);
 EXCEPTION WHEN raise_exception THEN denied := true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Cooling-off account accepted'; END IF;
 UPDATE public.seller_accounts SET account_updated_at=now()-interval '2 days',verification_status='pending' WHERE id=account;
 denied := false;
 BEGIN PERFORM public.reserve_seller_payout(actor,account,7000,1000000,NULL);
 EXCEPTION WHEN raise_exception THEN denied := true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Unverified account accepted'; END IF;
 UPDATE public.seller_accounts SET verification_status='verified' WHERE id=account;
 denied := false;
 BEGIN PERFORM public.reserve_seller_payout(buyer,account,7000,1000000,NULL);
 EXCEPTION WHEN raise_exception THEN denied := true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Wrong account owner accepted'; END IF;
 results := results || '[{"test":"payout account ownership verification and cooling-off","result":"PASS"}]'::jsonb;
 denied := false;
 BEGIN PERFORM public.reserve_seller_payout(actor,account,11000,1000000,NULL);
 EXCEPTION WHEN check_violation THEN denied := true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Ticket/unknown-provider earnings spent from Payluk seller ledger'; END IF;
 payout := public.reserve_seller_payout(actor,account,7000,10000,NULL);
 denied := false;
 BEGIN PERFORM public.reserve_seller_payout(actor,account,7000,10000,NULL);
 EXCEPTION WHEN check_violation THEN denied := true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Pending payout reservation ignored'; END IF;
 payout2 := public.reserve_seller_payout(actor,account,3000,10000,NULL);
 IF (SELECT sum(amount) FROM public.payout_requests WHERE seller_id=actor AND status='pending') <> 10000 THEN RAISE EXCEPTION 'Payout reservation total wrong'; END IF;
 results := results || '[{"test":"payout provider isolation and pending reservations","result":"PASS","reserved":10000}]'::jsonb;
 UPDATE public.payout_requests SET status='processing',transaction_reference='audit-rollback-payout' WHERE id=payout;
 applied := public.requeue_seller_payout(payout,actor,10000);
 IF NOT applied OR (SELECT status FROM public.payout_requests WHERE id=payout) <> 'pending' THEN RAISE EXCEPTION 'Requeue counted its own reservation twice'; END IF;
 UPDATE public.payout_requests SET status='failed',payment_provider=NULL WHERE id=payout;
 IF public.requeue_seller_payout(payout,actor,10000) THEN RAISE EXCEPTION 'Unknown provider requeued'; END IF;
 results := results || '[{"test":"requeue excludes own reservation and rejects unknown provider","result":"PASS"}]'::jsonb;

 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 denied := false;
 BEGIN UPDATE public.users SET is_suspended=true WHERE id=actor;
 EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Client changed own suspension'; END IF;
 results := results || '[{"test":"authenticated user cannot change suspension","result":"PASS","sqlstate":"42501"}]'::jsonb;
 FOREACH outcome IN ARRAY ARRAY[
 'public.reserve_catalog_stock('''||item||'''::uuid,1)',
 'public.release_catalog_stock('''||item||'''::uuid,1)',
 'public.create_checkout_reservation(''{}''::jsonb)',
 'public.abandon_checkout_reservation('''||tx||'''::uuid)',
 'public.apply_escrow_payment('''||tx||'''::uuid,''payluk'',''audit'')',
 'public.apply_escrow_refund('''||tx||'''::uuid,''audit'',100)',
 'public.finish_dispute_resolution('''||operation||'''::uuid,''audit'')',
 'public.reserve_seller_payout('''||actor||'''::uuid,'''||account||'''::uuid,1,1,NULL)',
 'public.requeue_seller_payout('''||payout||'''::uuid,'''||actor||'''::uuid,1)'
 ] LOOP
  denied := false;
  BEGIN EXECUTE 'SELECT '||outcome; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Client money RPC accepted: %',split_part(outcome,'(',1); END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','authenticated denied '||split_part(outcome,'(',1),'result','PASS','sqlstate','42501'));
 END LOOP;
 SELECT count(*) INTO n FROM public.public_profiles;
 denied := false;
 BEGIN EXECUTE 'SELECT email FROM public.public_profiles LIMIT 1'; EXCEPTION WHEN undefined_column THEN denied := true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Email exposed in public profile view'; END IF;
 results := results || '[{"test":"authenticated profile projection readable without email","result":"PASS","email_sqlstate":"42703"}]'::jsonb;
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE anon';
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 SELECT count(*) INTO n FROM public.public_profiles;
 denied := false;
 BEGIN PERFORM public.reserve_catalog_stock(item,1); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Anonymous stock RPC accepted'; END IF;
 results := results || '[{"test":"anonymous profile projection readable and stock RPC denied","result":"PASS","rpc_sqlstate":"42501"}]'::jsonb;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('audit.results',results::text,true);
EXCEPTION WHEN OTHERS THEN
 EXECUTE 'RESET ROLE';
 PERFORM set_config('audit.results',(results || jsonb_build_array(jsonb_build_object('test','unexpected validation failure','result','FAIL','sqlstate',SQLSTATE,'message',SQLERRM)))::text,true);
END;
$audit$;
SELECT current_setting('audit.results')::jsonb AS results, current_setting('transaction_read_only') AS transaction_read_only;
ROLLBACK;

