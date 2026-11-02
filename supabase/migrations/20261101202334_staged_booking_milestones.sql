-- Additive milestone evidence. Activation and application require separate authorization.
CREATE TABLE public.booking_milestone_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id uuid NOT NULL REFERENCES public.bookings(id),
 transaction_id uuid NOT NULL REFERENCES public.escrow_transactions(id),
 escrow_id text NOT NULL,
 milestone_id text NOT NULL,
 position smallint NOT NULL CHECK(position IN (1,2)),
 amount_kobo bigint NOT NULL CHECK(amount_kobo > 0),
 buyer_id uuid NOT NULL REFERENCES public.users(id),
 seller_id uuid NOT NULL REFERENCES public.users(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approving','released','review')),
 consented_at timestamptz,
 provider_released_at timestamptz,
 verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(transaction_id,position), UNIQUE(escrow_id,milestone_id),
 CHECK(status<>'released' OR (consented_at IS NOT NULL AND provider_released_at IS NOT NULL AND verified_at IS NOT NULL))
);
ALTER TABLE public.booking_milestone_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_milestone_releases FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.booking_milestone_releases TO service_role;

CREATE FUNCTION public.authorize_booking_milestone_release(p_booking uuid,p_buyer uuid,p_position smallint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; m public.booking_milestone_releases%ROWTYPE; t public.escrow_transactions%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id=p_booking FOR UPDATE;
 IF NOT FOUND OR b.customer_id IS DISTINCT FROM p_buyer OR b.payment_flow<>'staged_50_50'
 OR b.status NOT IN ('confirmed','completed') THEN RAISE EXCEPTION 'booking_release_unavailable'; END IF;
 IF p_position=2 AND b.status<>'completed' THEN RAISE EXCEPTION 'Confirm service completion before final release'; END IF;
 SELECT * INTO m FROM public.booking_milestone_releases WHERE booking_id=b.id AND buyer_id=p_buyer AND position=p_position FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'milestone_not_found'; END IF;
 SELECT * INTO t FROM public.escrow_transactions WHERE id=m.transaction_id;
 IF t.status NOT IN ('paid','completed') OR t.buyer_id IS DISTINCT FROM p_buyer
 OR t.payluk_escrow_id IS DISTINCT FROM m.escrow_id THEN RAISE EXCEPTION 'milestone_payment_unavailable'; END IF;
 IF p_position=2 AND NOT EXISTS(SELECT 1 FROM public.booking_milestone_releases WHERE transaction_id=m.transaction_id AND position=1 AND status='released')
 THEN RAISE EXCEPTION 'First milestone must be verified'; END IF;
 IF m.status<>'pending' THEN RETURN jsonb_build_object('release',to_jsonb(m),'submit',false); END IF;
 UPDATE public.booking_milestone_releases SET status='approving',consented_at=now() WHERE id=m.id RETURNING * INTO m;
 RETURN jsonb_build_object('release',to_jsonb(m),'submit',true);
END $$;

CREATE FUNCTION public.record_booking_milestone_release(p_release uuid,p_escrow text,p_milestone text,p_amount bigint,p_released_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m public.booking_milestone_releases%ROWTYPE;
BEGIN
 SELECT * INTO m FROM public.booking_milestone_releases WHERE id=p_release FOR UPDATE;
 IF NOT FOUND OR m.escrow_id IS DISTINCT FROM p_escrow OR m.milestone_id IS DISTINCT FROM p_milestone
 OR m.amount_kobo IS DISTINCT FROM p_amount OR p_released_at IS NULL OR p_released_at>now()+interval '5 minutes'
 OR m.consented_at IS NULL OR m.status NOT IN ('approving','released') THEN RAISE EXCEPTION 'milestone_evidence_mismatch'; END IF;
 IF m.status='released' THEN RETURN false; END IF;
 UPDATE public.booking_milestone_releases SET status='released',provider_released_at=p_released_at,verified_at=now() WHERE id=m.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.authorize_booking_milestone_release(uuid,uuid,smallint),public.record_booking_milestone_release(uuid,text,text,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_booking_milestone_release(uuid,uuid,smallint),public.record_booking_milestone_release(uuid,text,text,bigint,timestamptz) TO service_role;

CREATE FUNCTION public.reserve_staged_booking_checkout(p_booking uuid,p_buyer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; owner uuid; tx public.escrow_transactions%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id=p_booking FOR UPDATE;
 IF NOT FOUND OR b.customer_id IS DISTINCT FROM p_buyer OR b.payment_flow<>'staged_50_50'
 OR b.status<>'confirmed' OR b.appointment_time<=now() OR b.agreed_price IS NULL OR b.agreed_price<1200
 OR b.agreed_price::text IN ('NaN','Infinity','-Infinity') OR round(b.agreed_price,2)<>b.agreed_price
 THEN RAISE EXCEPTION 'staged_booking_unavailable'; END IF;
 SELECT owner_id INTO owner FROM public.businesses WHERE id=b.business_id AND is_active;
 IF owner IS NULL OR owner=p_buyer THEN RAISE EXCEPTION 'booking_owner_unavailable'; END IF;
 SELECT t.* INTO tx FROM public.escrow_transactions t WHERE t.item_type='booking' AND t.item_id=b.id::text
 AND t.status<>'cancelled' ORDER BY t.created_at DESC LIMIT 1;
 IF FOUND THEN
 IF tx.metadata->>'booking_payment_flow' IS DISTINCT FROM 'staged_50_50' OR tx.amount<>b.agreed_price THEN RAISE EXCEPTION 'existing_booking_contract_requires_review'; END IF;
 RETURN to_jsonb(tx);
 END IF;
 INSERT INTO public.escrow_transactions(item_id,item_type,buyer_id,seller_id,amount,commission,total_amount,seller_amount,status,payment_method,delivery_details,payment_provider,payment_reference,metadata)
 VALUES(b.id::text,'booking',p_buyer,owner,b.agreed_price,round(b.agreed_price*0.03,2),b.agreed_price,b.agreed_price,'pending','card','{"option":"service_booking"}','payluk','bk-'||gen_random_uuid()::text,
 jsonb_build_object('booking_id',b.id,'booking_payment_flow','staged_50_50','payluk_fee_mode','milestone_native_commission_v1','booking_payment_type','escrow')) RETURNING * INTO tx;
 INSERT INTO public.booking_payments(booking_id,amount,type,status,provider,payluk_reference,escrow_hold,escrow_transaction_id,commission,total_amount)
 VALUES(b.id,b.agreed_price,'escrow','deposit_pending','payluk',tx.payment_reference,true,tx.id,tx.commission,tx.total_amount);
 UPDATE public.bookings SET payment_status='deposit_pending' WHERE id=b.id;
 RETURN to_jsonb(tx);
END $$;
REVOKE ALL ON FUNCTION public.reserve_staged_booking_checkout(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_staged_booking_checkout(uuid,uuid) TO service_role;

CREATE FUNCTION public.staged_seller_earned_total(p_seller uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce((SELECT sum(t.seller_amount) FROM public.escrow_transactions t
 WHERE t.seller_id=p_seller AND t.status='completed' AND coalesce(t.item_type,'post')<>'ticket'
 AND t.payment_provider='payluk' AND coalesce(t.metadata->>'booking_payment_flow','')<>'staged_50_50'),0)
 + coalesce((SELECT sum(m.amount_kobo)::numeric/100 FROM public.booking_milestone_releases m
 JOIN public.escrow_transactions t ON t.id=m.transaction_id
 WHERE m.seller_id=p_seller AND m.status='released' AND t.status IN ('paid','completed','cancelled')
 AND t.payment_provider='payluk' AND t.metadata->>'booking_payment_flow'='staged_50_50'),0)
 + coalesce((SELECT sum((o.provider_plan->>'sellerAmount')::numeric) FROM public.dispute_resolution_operations o
 JOIN public.disputes d ON d.id=o.dispute_id JOIN public.escrow_transactions t ON t.id=d.transaction_id
 WHERE t.seller_id=p_seller AND o.status='succeeded' AND o.provider_plan->>'milestone'='true'),0)
$$;
REVOKE ALL ON FUNCTION public.staged_seller_earned_total(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staged_seller_earned_total(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_seller_payout(p_seller_id uuid,p_account_id uuid,p_amount numeric,p_wallet_limit numeric,p_transaction_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_earnings numeric;v_spent numeric;v_reserved numeric;v_id uuid;
BEGIN
 IF p_amount IS NULL OR p_amount <= 0 OR p_wallet_limit IS NULL OR p_wallet_limit < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_seller_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.seller_accounts WHERE id = p_account_id AND user_id = p_seller_id AND is_active
  AND verification_status = 'verified') THEN
  RAISE EXCEPTION 'Verified payout account required';
 END IF;
 SELECT public.staged_seller_earned_total(p_seller_id) INTO v_earnings;
 SELECT coalesce(sum(amount) FILTER(WHERE status = 'completed'),0),coalesce(sum(amount) FILTER(WHERE status IN ('pending','processing')),0)
 INTO v_spent,v_reserved FROM public.payout_requests WHERE seller_id = p_seller_id;
 IF p_amount > least(v_earnings-v_spent-v_reserved,p_wallet_limit-v_reserved) THEN RAISE EXCEPTION 'Insufficient unreserved balance' USING ERRCODE = '23514'; END IF;
 INSERT INTO public.payout_requests(seller_id,account_id,amount,status,transaction_id,payment_provider)
 VALUES(p_seller_id,p_account_id,p_amount,'pending',p_transaction_id,'payluk') RETURNING id INTO v_id;
 RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.reserve_seller_payout(uuid,uuid,numeric,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_seller_payout(uuid,uuid,numeric,numeric,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.requeue_seller_payout(
 p_payout_id uuid,p_seller_id uuid,p_wallet_limit numeric,
 p_expected_reference text,p_expected_status text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_payout public.payout_requests%ROWTYPE;v_earnings numeric;v_spent numeric;v_reserved numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_seller_id::text,0));
 SELECT * INTO v_payout FROM public.payout_requests WHERE id = p_payout_id AND seller_id = p_seller_id FOR UPDATE;
 IF NOT FOUND OR v_payout.status NOT IN ('failed','processing') OR v_payout.payment_provider IS DISTINCT FROM 'payluk'
  OR v_payout.transaction_reference IS NULL OR p_wallet_limit IS NULL
  OR p_expected_reference IS NULL OR p_expected_status IS NULL
  OR v_payout.transaction_reference IS DISTINCT FROM p_expected_reference
  OR v_payout.status IS DISTINCT FROM p_expected_status THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.seller_accounts WHERE id = v_payout.account_id AND user_id = p_seller_id AND is_active
  AND verification_status = 'verified') THEN RETURN false; END IF;
 SELECT public.staged_seller_earned_total(p_seller_id) INTO v_earnings;
 SELECT coalesce(sum(amount) FILTER(WHERE status = 'completed'),0),coalesce(sum(amount) FILTER(WHERE status IN ('pending','processing')),0)
 INTO v_spent,v_reserved FROM public.payout_requests WHERE seller_id = p_seller_id AND id <> p_payout_id;
 IF v_payout.amount > least(v_earnings-v_spent-v_reserved,p_wallet_limit-v_reserved) THEN RETURN false; END IF;
 UPDATE public.payout_requests SET status = 'pending',failure_reason = NULL WHERE id = v_payout.id;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.requeue_seller_payout(uuid,uuid,numeric,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_seller_payout(uuid,uuid,numeric,text,text) TO service_role;

CREATE FUNCTION public.finalize_staged_booking_checkout(p_transaction uuid,p_escrow text,p_token text,p_fee numeric,p_milestones jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.escrow_transactions%ROWTYPE; b public.bookings%ROWTYPE; m jsonb; first_kobo bigint; pos integer:=0;
BEGIN
 SELECT * INTO t FROM public.escrow_transactions WHERE id=p_transaction FOR UPDATE;
 IF NOT FOUND OR t.status<>'creating_escrow' OR t.metadata->>'booking_payment_flow' IS DISTINCT FROM 'staged_50_50'
 OR p_escrow IS NULL OR p_token IS NULL OR p_fee IS NULL OR p_fee::text IN ('NaN','Infinity','-Infinity')
 OR p_fee<t.commission OR round(p_fee,2)<>p_fee OR jsonb_typeof(p_milestones)<>'array' OR jsonb_array_length(p_milestones)<>2
 THEN RAISE EXCEPTION 'checkout_finalize_mismatch'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=(t.metadata->>'booking_id')::uuid;
 IF b.customer_id IS DISTINCT FROM t.buyer_id OR b.agreed_price IS DISTINCT FROM t.amount OR b.status<>'confirmed'
 THEN RAISE EXCEPTION 'booking_contract_changed'; END IF;
 first_kobo:=floor(t.amount*100/2);
 FOR m IN SELECT value FROM jsonb_array_elements(p_milestones) LOOP
 pos:=pos+1;
 IF m->>'id' IS NULL OR (m->>'amount_kobo')::bigint IS DISTINCT FROM (CASE WHEN pos=1 THEN first_kobo ELSE (t.amount*100)::bigint-first_kobo END)
 THEN RAISE EXCEPTION 'milestone_amount_mismatch'; END IF;
 INSERT INTO public.booking_milestone_releases(booking_id,transaction_id,escrow_id,milestone_id,position,amount_kobo,buyer_id,seller_id)
 VALUES(b.id,t.id,p_escrow,m->>'id',pos,(m->>'amount_kobo')::bigint,t.buyer_id,t.seller_id);
 END LOOP;
 UPDATE public.escrow_transactions SET status='pending',payluk_escrow_id=p_escrow,payluk_tx_ref=p_token,total_amount=t.amount+p_fee,
 metadata=t.metadata||jsonb_build_object('payluk_fee',p_fee,'payluk_environment','test') WHERE id=t.id;
 UPDATE public.booking_payments SET total_amount=t.amount+p_fee,payluk_escrow_id=p_escrow WHERE escrow_transaction_id=t.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finalize_staged_booking_checkout(uuid,text,text,numeric,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_staged_booking_checkout(uuid,text,text,numeric,jsonb) TO service_role;

CREATE FUNCTION public.save_booking_milestone_dispute_plan(p_operation uuid,p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE op public.dispute_resolution_operations%ROWTYPE; t public.escrow_transactions%ROWTYPE; released numeric; held numeric; value numeric;
BEGIN
 SELECT * INTO op FROM public.dispute_resolution_operations WHERE id=p_operation FOR UPDATE;
 IF NOT FOUND OR op.status<>'processing' THEN RAISE EXCEPTION 'Resolution unavailable'; END IF;
 SELECT e.* INTO t FROM public.escrow_transactions e JOIN public.disputes d ON d.transaction_id=e.id WHERE d.id=op.dispute_id;
 IF NOT (p_plan ?& ARRAY['escrowId','milestone','whoPays','additionalFee','principal','previouslyReleased','pool','buyerAmount','sellerAmount','status'])
 OR p_plan IS NULL THEN RAISE EXCEPTION 'Incomplete milestone ruling'; END IF;
 FOREACH value IN ARRAY ARRAY[(p_plan->>'additionalFee')::numeric,(p_plan->>'principal')::numeric,(p_plan->>'previouslyReleased')::numeric,
 (p_plan->>'pool')::numeric,(p_plan->>'buyerAmount')::numeric,(p_plan->>'sellerAmount')::numeric] LOOP
 IF value IS NULL OR value::text IN ('NaN','Infinity','-Infinity') OR value<0 OR round(value,2)<>value THEN RAISE EXCEPTION 'Invalid milestone ruling amount'; END IF;
 END LOOP;
 IF t.status<>'disputed' OR t.metadata->>'booking_payment_flow' IS DISTINCT FROM 'staged_50_50'
 OR p_plan->>'escrowId' IS DISTINCT FROM t.payluk_escrow_id OR p_plan->>'milestone' IS DISTINCT FROM 'true'
 OR p_plan->>'whoPays'<>'buyer' OR (p_plan->>'additionalFee')::numeric<>0 OR (p_plan->>'principal')::numeric<>t.amount
 THEN RAISE EXCEPTION 'Milestone plan mismatch'; END IF;
 SELECT coalesce(sum(amount_kobo) FILTER(WHERE status='released'),0)::numeric/100,
 coalesce(sum(amount_kobo) FILTER(WHERE status='pending'),0)::numeric/100 INTO released,held
 FROM public.booking_milestone_releases WHERE transaction_id=t.id;
 IF released+held<>t.amount OR held<=0 OR released<>(p_plan->>'previouslyReleased')::numeric
 OR held<>(p_plan->>'pool')::numeric OR op.refund_amount<>(p_plan->>'buyerAmount')::numeric
 OR op.seller_amount<>released+(p_plan->>'sellerAmount')::numeric
 OR op.refund_amount<0 OR op.refund_amount>held OR op.seller_amount<released
 OR (p_plan->>'status') IS DISTINCT FROM (CASE WHEN op.refund_amount=0 THEN 'COMPLETED' WHEN op.seller_amount=released THEN 'REFUNDED' ELSE 'SPLIT' END)
 THEN RAISE EXCEPTION 'Held milestone allocation mismatch'; END IF;
 IF op.provider_plan IS NOT NULL AND op.provider_plan<>p_plan THEN RAISE EXCEPTION 'Original ruling is immutable'; END IF;
 UPDATE public.dispute_resolution_operations SET provider_plan=p_plan,updated_at=now() WHERE id=op.id;
 RETURN p_plan;
END $$;
REVOKE ALL ON FUNCTION public.save_booking_milestone_dispute_plan(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_booking_milestone_dispute_plan(uuid,jsonb) TO service_role;
