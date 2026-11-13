-- Explicit domains for new event finance calls; legacy overloads remain test-only.
ALTER TABLE public.payluk_event_withdrawals DROP CONSTRAINT payluk_event_withdrawals_domain_check;
ALTER TABLE public.payluk_event_withdrawals ADD CONSTRAINT payluk_event_withdrawals_domain_check CHECK(domain IN ('test','live'));

CREATE FUNCTION public.reserve_payluk_event_withdrawal(p_event_id uuid,p_owner uuid,p_expected bigint,p_bank_name text,p_account_name text,p_last_four text,p_domain text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ev public.events%ROWTYPE; w public.payluk_event_withdrawals%ROWTYPE; total bigint;
BEGIN
 IF p_domain IS NULL OR p_domain NOT IN ('test','live') THEN RAISE EXCEPTION 'invalid_event_payment_domain'; END IF;
 SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF ev.organizer_id IS DISTINCT FROM p_owner OR ev.end_time IS NULL OR ev.end_time+interval '24 hours'>now() OR ev.status='CANCELLED' THEN RAISE EXCEPTION 'event_withdrawal_unavailable'; END IF;
 -- One transaction per order is reserved forever on uncertainty; no automatic re-spend.
 PERFORM 1 FROM public.escrow_transactions WHERE item_type='ticket' AND metadata->>'event_id'=p_event_id::text FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.tickets WHERE event_id=p_event_id AND payment_provider='payluk' AND refund_status IS NOT NULL AND status<>'REFUNDED')
 OR EXISTS(SELECT 1 FROM public.escrow_transactions WHERE item_type='ticket' AND metadata->>'event_id'=p_event_id::text AND status='disputed')
 OR EXISTS(SELECT 1 FROM public.payluk_event_refund_requests r JOIN public.tickets t ON t.id=r.ticket_id WHERE r.event_id=p_event_id AND t.status<>'REFUNDED') THEN RAISE EXCEPTION 'event_financial_hold'; END IF;
 SELECT coalesce(sum(round(x.seller_amount*100)::bigint),0) INTO total FROM public.escrow_transactions x
 WHERE x.item_type='ticket' AND x.payment_provider='payluk' AND x.seller_id=p_owner AND x.metadata->>'event_id'=p_event_id::text
 AND x.metadata->>'payluk_environment'=p_domain AND x.metadata->>'payluk_fee_mode'='native_commission_v1'
 AND x.status IN ('paid','completed') AND x.seller_amount>0 AND x.payluk_tx_ref IS NOT NULL AND x.payluk_escrow_id IS NOT NULL
 AND (x.metadata->>'event_release_not_before')::timestamptz<=now()
 AND (SELECT count(*) FROM public.tickets t WHERE t.payment_tx_ref=x.id::text AND t.event_id=p_event_id AND t.payment_provider='payluk' AND t.status IN ('PAID','USED'))=(x.metadata->>'quantity')::integer
 AND NOT EXISTS(SELECT 1 FROM public.tickets t WHERE t.payment_tx_ref=x.id::text AND (t.refund_status IS NOT NULL OR t.status NOT IN ('PAID','USED')))
 AND NOT EXISTS(SELECT 1 FROM public.payluk_event_allocations a WHERE a.transaction_id=x.id);
 IF total IS DISTINCT FROM p_expected OR total<100000 OR p_last_four !~ '^\d{4}$' THEN RAISE EXCEPTION 'event_balance_changed'; END IF;
 INSERT INTO public.payluk_event_withdrawals(event_id,organizer_id,domain,amount_kobo,bank_name,account_name,account_last_four) VALUES(p_event_id,p_owner,p_domain,total,p_bank_name,p_account_name,p_last_four) RETURNING * INTO w;
 INSERT INTO public.payluk_event_allocations(transaction_id,withdrawal_id,amount_kobo)
 SELECT x.id,w.id,round(x.seller_amount*100)::bigint FROM public.escrow_transactions x
 WHERE x.item_type='ticket' AND x.payment_provider='payluk' AND x.seller_id=p_owner AND x.metadata->>'event_id'=p_event_id::text
 AND x.metadata->>'payluk_environment'=p_domain AND x.metadata->>'payluk_fee_mode'='native_commission_v1'
 AND x.status IN ('paid','completed') AND x.seller_amount>0 AND x.payluk_tx_ref IS NOT NULL AND x.payluk_escrow_id IS NOT NULL
 AND (x.metadata->>'event_release_not_before')::timestamptz<=now()
 AND (SELECT count(*) FROM public.tickets t WHERE t.payment_tx_ref=x.id::text AND t.event_id=p_event_id AND t.payment_provider='payluk' AND t.status IN ('PAID','USED'))=(x.metadata->>'quantity')::integer
 AND NOT EXISTS(SELECT 1 FROM public.tickets t WHERE t.payment_tx_ref=x.id::text AND (t.refund_status IS NOT NULL OR t.status NOT IN ('PAID','USED')))
 AND NOT EXISTS(SELECT 1 FROM public.payluk_event_allocations a WHERE a.transaction_id=x.id);
 RETURN to_jsonb(w);
END $$;
REVOKE ALL ON FUNCTION public.reserve_payluk_event_withdrawal(uuid,uuid,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_payluk_event_withdrawal(uuid,uuid,bigint,text,text,text,text) TO service_role;

CREATE FUNCTION public.request_payluk_event_refund(p_ticket_id uuid,p_owner uuid,p_reason text,p_domain text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tickets%ROWTYPE; ev uuid; r public.payluk_event_refund_requests%ROWTYPE;
BEGIN
 IF p_domain IS NULL OR p_domain NOT IN ('test','live') THEN RAISE EXCEPTION 'invalid_event_payment_domain'; END IF;
 SELECT event_id INTO ev FROM public.tickets WHERE id=p_ticket_id;
 PERFORM 1 FROM public.events WHERE id=ev AND organizer_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event_refund_forbidden'; END IF;
 SELECT * INTO t FROM public.tickets WHERE id=p_ticket_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.escrow_transactions x WHERE x.id::text=t.payment_tx_ref AND x.payment_provider='payluk' AND x.metadata->>'payluk_environment'=p_domain AND x.metadata->>'payluk_fee_mode'='native_commission_v1') THEN RAISE EXCEPTION 'event_refund_requires_legacy_review'; END IF;
 IF t.payment_provider<>'payluk' OR t.status<>'PAID' OR t.amount_paid<=0 THEN RAISE EXCEPTION 'event_refund_unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.payluk_event_allocations WHERE transaction_id::text=t.payment_tx_ref) THEN RAISE EXCEPTION 'event_payout_already_reserved'; END IF;
 INSERT INTO public.payluk_event_refund_requests(ticket_id,event_id,transaction_id,requested_by,reason) VALUES(t.id,ev,t.payment_tx_ref::uuid,p_owner,p_reason) ON CONFLICT(ticket_id) DO NOTHING;
 UPDATE public.tickets SET refund_status='pending',updated_at=now() WHERE id=t.id;
 SELECT * INTO r FROM public.payluk_event_refund_requests WHERE ticket_id=t.id;
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.request_payluk_event_refund(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_payluk_event_refund(uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.lease_payluk_event_withdrawal(p_reference text,p_owner uuid,p_token uuid,p_domain text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.payluk_event_withdrawals%ROWTYPE; clock_at timestamptz;
BEGIN
 IF p_domain IS NULL OR p_domain NOT IN ('test','live') THEN RAISE EXCEPTION 'invalid_event_payment_domain'; END IF;
 SELECT * INTO w FROM public.payluk_event_withdrawals WHERE reference=p_reference AND organizer_id=p_owner FOR UPDATE;
 IF NOT FOUND OR w.domain<>p_domain OR w.status NOT IN ('reserved','submitting','pending')
 OR w.next_attempt_at>now() OR w.processing_until>now() THEN RETURN NULL; END IF;
 SELECT next_allowed_at INTO clock_at FROM public.payluk_event_worker_clock WHERE id=true FOR UPDATE;
 IF clock_at>now() THEN RETURN NULL; END IF;
 UPDATE public.payluk_event_worker_clock SET next_allowed_at=now()+interval '2 minutes' WHERE id=true;
 UPDATE public.payluk_event_withdrawals SET processing_token=p_token,processing_until=now()+interval '2 minutes',
 next_attempt_at=now()+interval '1 minute',status=CASE WHEN status='reserved' THEN 'submitting' ELSE status END,updated_at=now()
 WHERE id=w.id RETURNING * INTO w;
 RETURN to_jsonb(w);
END $$;
REVOKE ALL ON FUNCTION public.lease_payluk_event_withdrawal(text,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lease_payluk_event_withdrawal(text,uuid,uuid,text) TO service_role;

-- A release's environment is a financial identity, not a mutable deployment setting.
CREATE FUNCTION public.guard_payluk_event_environment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='payluk_event_withdrawals' THEN
  IF NEW.domain IS DISTINCT FROM OLD.domain THEN RAISE EXCEPTION 'event_payment_domain_immutable'; END IF;
 ELSE
  IF OLD.item_type='ticket' AND OLD.metadata->>'payluk_fee_mode'='native_commission_v1'
  AND (NEW.metadata->>'payluk_environment' IS DISTINCT FROM OLD.metadata->>'payluk_environment'
       OR NEW.payment_provider IS DISTINCT FROM OLD.payment_provider
       OR NEW.item_type IS DISTINCT FROM OLD.item_type) THEN
   RAISE EXCEPTION 'event_payment_domain_immutable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_payluk_event_environment() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_payluk_event_environment() TO service_role;
CREATE TRIGGER guard_payluk_event_withdrawal_environment BEFORE UPDATE ON public.payluk_event_withdrawals
FOR EACH ROW EXECUTE FUNCTION public.guard_payluk_event_environment();
CREATE TRIGGER guard_payluk_event_transaction_environment BEFORE UPDATE ON public.escrow_transactions
FOR EACH ROW EXECUTE FUNCTION public.guard_payluk_event_environment();
