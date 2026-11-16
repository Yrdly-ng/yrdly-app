-- Dispute resolution cannot be an early organizer release path.
CREATE FUNCTION public.save_payluk_event_dispute_plan(p_operation_id uuid,p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE op public.dispute_resolution_operations%ROWTYPE; tx public.escrow_transactions%ROWTYPE; ev public.events%ROWTYPE; saved_hold timestamptz;
BEGIN
 SELECT * INTO op FROM public.dispute_resolution_operations WHERE id=p_operation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event_resolution_missing'; END IF;
 SELECT x.* INTO tx FROM public.escrow_transactions x JOIN public.disputes d ON d.transaction_id=x.id WHERE d.id=op.dispute_id FOR UPDATE OF x;
 IF NOT FOUND OR tx.item_type<>'ticket' OR tx.payment_provider<>'payluk'
 OR tx.metadata->>'payluk_fee_mode' IS DISTINCT FROM 'native_commission_v1'
 OR tx.metadata->>'payluk_environment' IS NULL OR tx.metadata->>'payluk_environment' NOT IN ('test','live') THEN RAISE EXCEPTION 'event_resolution_contract_mismatch'; END IF;
 SELECT * INTO ev FROM public.events WHERE id=(tx.metadata->>'event_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event_resolution_event_missing'; END IF;
 IF (p_plan->>'sellerAmount')::numeric>0 THEN
  saved_hold:=(tx.metadata->>'event_release_not_before')::timestamptz;
  IF ev.status='CANCELLED' OR ev.end_time IS NULL OR saved_hold IS NULL
  OR ev.end_time+interval '24 hours'>now() OR saved_hold>now() THEN RAISE EXCEPTION 'event_dispute_release_hold'; END IF;
 END IF;
 RETURN public.save_payluk_dispute_plan(p_operation_id,p_plan);
END $$;
REVOKE ALL ON FUNCTION public.save_payluk_event_dispute_plan(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_payluk_event_dispute_plan(uuid,jsonb) TO service_role;
