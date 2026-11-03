-- Preserve the provider environment bound before escrow creation.
CREATE OR REPLACE FUNCTION public.finalize_staged_booking_checkout(p_transaction uuid,p_escrow text,p_token text,p_fee numeric,p_milestones jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.escrow_transactions%ROWTYPE; b public.bookings%ROWTYPE; m jsonb; first_kobo bigint; pos integer:=0;
BEGIN
 SELECT * INTO t FROM public.escrow_transactions WHERE id=p_transaction FOR UPDATE;
 IF NOT FOUND OR t.status<>'creating_escrow' OR t.metadata->>'booking_payment_flow' IS DISTINCT FROM 'staged_50_50'
 OR coalesce(t.metadata->>'payluk_environment','') NOT IN ('test','live')
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
 metadata=t.metadata||jsonb_build_object('payluk_fee',p_fee,'payluk_environment',t.metadata->>'payluk_environment') WHERE id=t.id;
 UPDATE public.booking_payments SET total_amount=t.amount+p_fee,payluk_escrow_id=p_escrow WHERE escrow_transaction_id=t.id;
 RETURN true;
END $$;
