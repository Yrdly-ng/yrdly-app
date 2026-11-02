-- Separate consent from the irreversible provider-submission boundary.
-- Legacy approving rows may already have sent a confirmation: retain read-only recovery.
ALTER TABLE public.booking_milestone_releases ADD COLUMN submission_started_at timestamptz;
UPDATE public.booking_milestone_releases
SET submission_started_at=coalesce(consented_at,created_at)
WHERE status IN ('approving','released','review');

CREATE OR REPLACE FUNCTION public.authorize_booking_milestone_release(p_booking uuid,p_buyer uuid,p_position smallint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; m public.booking_milestone_releases%ROWTYPE; t public.escrow_transactions%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id=p_booking FOR UPDATE;
 IF NOT FOUND OR b.customer_id IS DISTINCT FROM p_buyer OR b.payment_flow<>'staged_50_50'
 OR b.status NOT IN ('confirmed','completed') THEN RAISE EXCEPTION 'booking_release_unavailable'; END IF;
 IF p_position=2 AND b.status<>'completed' THEN RAISE EXCEPTION 'Confirm service completion before final release'; END IF;
 SELECT * INTO m FROM public.booking_milestone_releases WHERE booking_id=b.id AND buyer_id=p_buyer AND position=p_position FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'milestone_not_found'; END IF;
 SELECT * INTO t FROM public.escrow_transactions WHERE id=m.transaction_id FOR UPDATE;
 IF t.status NOT IN ('paid','completed') OR t.buyer_id IS DISTINCT FROM p_buyer
 OR t.payluk_escrow_id IS DISTINCT FROM m.escrow_id
 OR EXISTS(SELECT 1 FROM public.disputes WHERE transaction_id=t.id) THEN RAISE EXCEPTION 'milestone_payment_unavailable'; END IF;
 IF p_position=2 AND NOT EXISTS(SELECT 1 FROM public.booking_milestone_releases WHERE transaction_id=m.transaction_id AND position=1 AND status='released')
 THEN RAISE EXCEPTION 'First milestone must be verified'; END IF;
 IF m.status='pending' THEN
  UPDATE public.booking_milestone_releases SET status='approving',consented_at=now() WHERE id=m.id RETURNING * INTO m;
 END IF;
 RETURN jsonb_build_object('release',to_jsonb(m),'submit',m.status='approving' AND m.submission_started_at IS NULL);
END $$;

-- Recheck booking, payment and dispute eligibility immediately before the one allowed request.
CREATE FUNCTION public.claim_booking_milestone_submission(p_release uuid,p_buyer uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m public.booking_milestone_releases%ROWTYPE; authorized jsonb;
BEGIN
 SELECT * INTO m FROM public.booking_milestone_releases WHERE id=p_release;
 IF NOT FOUND OR m.buyer_id IS DISTINCT FROM p_buyer THEN RAISE EXCEPTION 'milestone_submission_unavailable'; END IF;
 authorized := public.authorize_booking_milestone_release(m.booking_id,p_buyer,m.position);
 IF NOT coalesce((authorized->>'submit')::boolean,false) THEN RETURN false; END IF;
 UPDATE public.booking_milestone_releases SET submission_started_at=now()
 WHERE id=p_release AND buyer_id=p_buyer AND status='approving' AND submission_started_at IS NULL;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_booking_milestone_submission(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_booking_milestone_submission(uuid,uuid) TO service_role;

-- Consented but never-submitted releases remain in the refundable held pool.
CREATE OR REPLACE FUNCTION public.save_booking_milestone_dispute_plan(p_operation uuid,p_plan jsonb)
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
 coalesce(sum(amount_kobo) FILTER(WHERE status='pending' OR (status='approving' AND submission_started_at IS NULL)),0)::numeric/100 INTO released,held
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
