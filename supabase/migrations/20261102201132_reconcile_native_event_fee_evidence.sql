-- Recover a provisional order after provider creation/funding interrupted checkout setup.
-- Only server-verified escrow evidence may replace an unallocated native ticket quote.
CREATE FUNCTION public.record_payluk_event_fee_evidence(p_transaction uuid,p_escrow text,p_environment text,p_principal numeric,p_fee numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE tx public.escrow_transactions%ROWTYPE;
BEGIN
 SELECT * INTO tx FROM public.escrow_transactions WHERE id=p_transaction FOR UPDATE;
 IF NOT FOUND OR tx.item_type IS DISTINCT FROM 'ticket' OR tx.payment_provider IS DISTINCT FROM 'payluk'
 OR tx.metadata->>'payluk_fee_mode' IS DISTINCT FROM 'native_commission_v1'
 OR p_environment IS NULL OR p_environment NOT IN ('test','live')
 OR tx.metadata->>'payluk_environment' IS DISTINCT FROM p_environment
 OR tx.payluk_escrow_id IS DISTINCT FROM p_escrow OR tx.payluk_tx_ref IS NULL
 OR tx.status NOT IN ('pending','creating_escrow','reconciling','paid','completed')
 OR p_principal IS NULL OR p_principal IS DISTINCT FROM tx.amount
 OR p_fee IS NULL OR p_fee::text IN ('NaN','Infinity','-Infinity')
 OR round(p_fee,2)<>p_fee OR p_fee<0 OR p_fee<tx.commission OR p_fee>tx.amount
 THEN RAISE EXCEPTION 'event_fee_evidence_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.payluk_event_allocations WHERE transaction_id=tx.id) THEN
  RAISE EXCEPTION 'event_fee_evidence_already_allocated';
 END IF;
 IF tx.metadata ? 'payluk_fee' AND (tx.metadata->>'payluk_fee')::numeric IS DISTINCT FROM p_fee THEN
  RAISE EXCEPTION 'event_fee_quote_changed';
 END IF;
 UPDATE public.escrow_transactions SET seller_amount=p_principal-p_fee,
 metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('payluk_fee',p_fee,'event_fee_evidence_verified_at',now()),updated_at=now()
 WHERE id=tx.id RETURNING * INTO tx;
 RETURN to_jsonb(tx);
END $$;
REVOKE ALL ON FUNCTION public.record_payluk_event_fee_evidence(uuid,text,text,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_payluk_event_fee_evidence(uuid,text,text,numeric,numeric) TO service_role;
