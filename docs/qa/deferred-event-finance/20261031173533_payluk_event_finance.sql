-- Sandbox-only organizer initiated settlement. Never infer funds from wallet totals.
CREATE TABLE public.payluk_event_withdrawals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES public.events(id),
 organizer_id uuid NOT NULL REFERENCES public.users(id), domain text NOT NULL CHECK(domain='test'),
 reference text NOT NULL UNIQUE DEFAULT ('evt-plk-'||gen_random_uuid()::text),
 amount_kobo bigint NOT NULL CHECK(amount_kobo>0), actual_debit_kobo bigint, expected_debit_kobo bigint,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','submitting','pending','success','review')),
 provider_reference text UNIQUE, bank_name text NOT NULL, account_name text NOT NULL, account_last_four text NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.payluk_event_allocations (
 transaction_id uuid PRIMARY KEY REFERENCES public.escrow_transactions(id),
 withdrawal_id uuid NOT NULL REFERENCES public.payluk_event_withdrawals(id),
 amount_kobo bigint NOT NULL CHECK(amount_kobo>0)
);
CREATE TABLE public.payluk_event_refund_requests (
 ticket_id uuid PRIMARY KEY REFERENCES public.tickets(id), event_id uuid NOT NULL REFERENCES public.events(id),
 transaction_id uuid NOT NULL REFERENCES public.escrow_transactions(id), requested_by uuid NOT NULL REFERENCES public.users(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 2000), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payluk_event_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payluk_event_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payluk_event_refund_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payluk_event_withdrawals,public.payluk_event_allocations,public.payluk_event_refund_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.payluk_event_withdrawals,public.payluk_event_allocations,public.payluk_event_refund_requests TO service_role;

CREATE FUNCTION public.reserve_payluk_event_withdrawal(p_event_id uuid,p_owner uuid,p_expected bigint,p_bank_name text,p_account_name text,p_last_four text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ev public.events%ROWTYPE; w public.payluk_event_withdrawals%ROWTYPE; total bigint;
BEGIN
 SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF ev.organizer_id IS DISTINCT FROM p_owner OR ev.end_time IS NULL OR ev.end_time+interval '24 hours'>now() OR ev.status='CANCELLED' THEN RAISE EXCEPTION 'event_withdrawal_unavailable'; END IF;
 -- One transaction per order is reserved forever on uncertainty; no automatic re-spend.
 PERFORM 1 FROM public.escrow_transactions WHERE item_type='ticket' AND metadata->>'event_id'=p_event_id::text FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.tickets WHERE event_id=p_event_id AND payment_provider='payluk' AND refund_status IS NOT NULL AND status<>'REFUNDED')
 OR EXISTS(SELECT 1 FROM public.escrow_transactions WHERE item_type='ticket' AND metadata->>'event_id'=p_event_id::text AND status='disputed')
 OR EXISTS(SELECT 1 FROM public.payluk_event_refund_requests r JOIN public.tickets t ON t.id=r.ticket_id WHERE r.event_id=p_event_id AND t.status<>'REFUNDED') THEN RAISE EXCEPTION 'event_financial_hold'; END IF;
 SELECT coalesce(sum(round(x.seller_amount*100)::bigint),0) INTO total FROM public.escrow_transactions x
 WHERE x.item_type='ticket' AND x.payment_provider='payluk' AND x.seller_id=p_owner AND x.metadata->>'event_id'=p_event_id::text
 AND x.metadata->>'payluk_environment'='test' AND x.metadata->>'payluk_fee_mode'='native_commission_v1'
 AND x.status IN ('paid','completed') AND x.seller_amount>0 AND x.payluk_tx_ref IS NOT NULL AND x.payluk_escrow_id IS NOT NULL
 AND (x.metadata->>'event_release_not_before')::timestamptz<=now()
 AND (SELECT count(*) FROM public.tickets t WHERE t.payment_tx_ref=x.id::text AND t.event_id=p_event_id AND t.payment_provider='payluk' AND t.status IN ('PAID','USED'))=(x.metadata->>'quantity')::integer
 AND NOT EXISTS(SELECT 1 FROM public.tickets t WHERE t.payment_tx_ref=x.id::text AND (t.refund_status IS NOT NULL OR t.status NOT IN ('PAID','USED')))
 AND NOT EXISTS(SELECT 1 FROM public.payluk_event_allocations a WHERE a.transaction_id=x.id);
 IF total IS DISTINCT FROM p_expected OR total<100000 OR p_last_four !~ '^\d{4}$' THEN RAISE EXCEPTION 'event_balance_changed'; END IF;
 INSERT INTO public.payluk_event_withdrawals(event_id,organizer_id,domain,amount_kobo,bank_name,account_name,account_last_four) VALUES(p_event_id,p_owner,'test',total,p_bank_name,p_account_name,p_last_four) RETURNING * INTO w;
 INSERT INTO public.payluk_event_allocations(transaction_id,withdrawal_id,amount_kobo)
 SELECT x.id,w.id,round(x.seller_amount*100)::bigint FROM public.escrow_transactions x
 WHERE x.item_type='ticket' AND x.payment_provider='payluk' AND x.seller_id=p_owner AND x.metadata->>'event_id'=p_event_id::text
 AND x.metadata->>'payluk_environment'='test' AND x.metadata->>'payluk_fee_mode'='native_commission_v1'
 AND x.status IN ('paid','completed') AND x.seller_amount>0 AND x.payluk_tx_ref IS NOT NULL AND x.payluk_escrow_id IS NOT NULL
 AND (x.metadata->>'event_release_not_before')::timestamptz<=now()
 AND (SELECT count(*) FROM public.tickets t WHERE t.payment_tx_ref=x.id::text AND t.event_id=p_event_id AND t.payment_provider='payluk' AND t.status IN ('PAID','USED'))=(x.metadata->>'quantity')::integer
 AND NOT EXISTS(SELECT 1 FROM public.tickets t WHERE t.payment_tx_ref=x.id::text AND (t.refund_status IS NOT NULL OR t.status NOT IN ('PAID','USED')))
 AND NOT EXISTS(SELECT 1 FROM public.payluk_event_allocations a WHERE a.transaction_id=x.id);
 RETURN to_jsonb(w);
END $$;

CREATE FUNCTION public.request_payluk_event_refund(p_ticket_id uuid,p_owner uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tickets%ROWTYPE; ev uuid; r public.payluk_event_refund_requests%ROWTYPE;
BEGIN
 SELECT event_id INTO ev FROM public.tickets WHERE id=p_ticket_id;
 PERFORM 1 FROM public.events WHERE id=ev AND organizer_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event_refund_forbidden'; END IF;
 SELECT * INTO t FROM public.tickets WHERE id=p_ticket_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.escrow_transactions x WHERE x.id::text=t.payment_tx_ref AND x.payment_provider='payluk' AND x.metadata->>'payluk_environment'='test' AND x.metadata->>'payluk_fee_mode'='native_commission_v1') THEN RAISE EXCEPTION 'event_refund_requires_legacy_review'; END IF;
 IF t.payment_provider<>'payluk' OR t.status<>'PAID' OR t.amount_paid<=0 THEN RAISE EXCEPTION 'event_refund_unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.payluk_event_allocations WHERE transaction_id::text=t.payment_tx_ref) THEN RAISE EXCEPTION 'event_payout_already_reserved'; END IF;
 INSERT INTO public.payluk_event_refund_requests(ticket_id,event_id,transaction_id,requested_by,reason) VALUES(t.id,ev,t.payment_tx_ref::uuid,p_owner,p_reason) ON CONFLICT(ticket_id) DO NOTHING;
 UPDATE public.tickets SET refund_status='pending',updated_at=now() WHERE id=t.id;
 SELECT * INTO r FROM public.payluk_event_refund_requests WHERE ticket_id=t.id;
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.reserve_payluk_event_withdrawal(uuid,uuid,bigint,text,text,text), public.request_payluk_event_refund(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_payluk_event_withdrawal(uuid,uuid,bigint,text,text,text), public.request_payluk_event_refund(uuid,uuid,text) TO service_role;
