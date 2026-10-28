-- Additive, provider-separated ledger. Bank transfers require an organiser request.
ALTER TABLE public.paystack_ticket_orders ADD COLUMN financial_hold boolean NOT NULL DEFAULT false;
ALTER TABLE public.paystack_ticket_orders ADD COLUMN hold_reason text;
CREATE TABLE public.paystack_event_earnings (
  transaction_id uuid PRIMARY KEY REFERENCES public.escrow_transactions(id),
  event_id uuid NOT NULL REFERENCES public.events(id),
  organizer_id uuid NOT NULL REFERENCES public.users(id),
  domain text NOT NULL CHECK (domain IN ('test','live')),
  gross_kobo bigint NOT NULL CHECK (gross_kobo > 0),
  commission_kobo bigint NOT NULL CHECK (commission_kobo >= 0),
  provider_fee_kobo bigint NOT NULL CHECK (provider_fee_kobo >= 0),
  proceeds_kobo bigint NOT NULL CHECK (proceeds_kobo >= 0),
  refunded_kobo bigint NOT NULL DEFAULT 0 CHECK (refunded_kobo >= 0 AND refunded_kobo <= gross_kobo),
  settled_at timestamptz,
  financial_hold boolean NOT NULL DEFAULT false,
  hold_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (proceeds_kobo = greatest(0, gross_kobo - commission_kobo - provider_fee_kobo))
);
CREATE INDEX paystack_event_earnings_event ON public.paystack_event_earnings(event_id, domain);

CREATE TABLE public.paystack_event_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id),
  organizer_id uuid NOT NULL REFERENCES public.users(id),
  domain text NOT NULL CHECK (domain IN ('test','live')),
  reference text NOT NULL UNIQUE,
  amount_kobo bigint NOT NULL CHECK (amount_kobo >= 10000),
  recipient_code text NOT NULL,
  bank_name text NOT NULL,
  account_name text NOT NULL,
  account_last_four text NOT NULL CHECK (account_last_four ~ '^\d{4}$'),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','submitting','pending','otp','success','failed','reversed','review')),
  transfer_code text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.paystack_event_withdrawal_allocations (
  withdrawal_id uuid NOT NULL REFERENCES public.paystack_event_withdrawals(id),
  transaction_id uuid NOT NULL REFERENCES public.paystack_event_earnings(transaction_id),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  PRIMARY KEY (withdrawal_id,transaction_id)
);
CREATE TABLE public.paystack_ticket_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL UNIQUE REFERENCES public.tickets(id),
  transaction_id uuid NOT NULL REFERENCES public.paystack_event_earnings(transaction_id),
  event_id uuid NOT NULL REFERENCES public.events(id),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  provider_refund_id text UNIQUE,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','submitting','pending','processing','processed','failed','needs-attention','review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paystack_event_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paystack_event_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paystack_event_withdrawal_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paystack_ticket_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paystack_event_earnings, public.paystack_event_withdrawals, public.paystack_event_withdrawal_allocations, public.paystack_ticket_refunds FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.paystack_event_earnings, public.paystack_event_withdrawals, public.paystack_event_withdrawal_allocations, public.paystack_ticket_refunds TO service_role;

CREATE FUNCTION public.record_paystack_event_earnings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.paystack_ticket_orders%ROWTYPE; ev public.events%ROWTYPE;
BEGIN
  IF NEW.item_type <> 'ticket' OR NEW.payment_provider <> 'paystack' OR NEW.status <> 'paid' THEN RETURN NEW; END IF;
  SELECT * INTO o FROM public.paystack_ticket_orders WHERE transaction_id = NEW.id;
  SELECT * INTO ev FROM public.events WHERE id = (NEW.metadata->>'event_id')::uuid;
  IF o.state <> 'paid' OR o.provider_fee_kobo IS NULL OR o.paid_at IS NULL OR ev.organizer_id IS DISTINCT FROM NEW.seller_id THEN
    RAISE EXCEPTION 'paystack_earnings_unverified';
  END IF;
  INSERT INTO public.paystack_event_earnings(transaction_id,event_id,organizer_id,domain,gross_kobo,commission_kobo,provider_fee_kobo,proceeds_kobo,settled_at,financial_hold,hold_reason)
  VALUES(NEW.id,ev.id,NEW.seller_id,o.domain,round(NEW.amount*100)::bigint,round(NEW.commission*100)::bigint,o.provider_fee_kobo,
    greatest(0,round((NEW.amount-NEW.commission)*100)::bigint-o.provider_fee_kobo),
    CASE WHEN o.domain = 'test' THEN o.paid_at ELSE NULL END,o.financial_hold,o.hold_reason)
  ON CONFLICT (transaction_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER record_paystack_event_earnings AFTER UPDATE OF status ON public.escrow_transactions
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.record_paystack_event_earnings();

-- All financial changes lock the event first, serializing withdrawals/refunds/disputes.
-- Only sandbox withdrawal is enabled by this migration. Live settlement evidence,
-- reserve/fee policy, and operational approval are required before widening it.
CREATE FUNCTION public.reserve_paystack_event_withdrawal(p_event_id uuid, p_organizer_id uuid, p_domain text, p_expected_kobo bigint, p_recipient text, p_bank_name text, p_account_name text, p_last_four text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ev public.events%ROWTYPE; total bigint; w public.paystack_event_withdrawals%ROWTYPE;
BEGIN
  SELECT * INTO ev FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF ev.organizer_id IS DISTINCT FROM p_organizer_id OR p_domain <> 'test' OR ev.end_time IS NULL OR ev.end_time + interval '24 hours' > now() OR ev.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'event_withdrawal_unavailable';
  END IF;
  IF EXISTS (SELECT 1 FROM public.paystack_event_earnings WHERE event_id=p_event_id AND domain=p_domain AND financial_hold) THEN RAISE EXCEPTION 'event_financial_review_required'; END IF;
  IF EXISTS (SELECT 1 FROM public.paystack_ticket_refunds WHERE event_id=p_event_id AND status <> 'processed') THEN RAISE EXCEPTION 'event_refund_pending'; END IF;
  SELECT coalesce(sum(greatest(0,e.proceeds_kobo-e.refunded_kobo+round(e.refunded_kobo*0.03)::bigint)),0) INTO total
    FROM public.paystack_event_earnings e WHERE e.event_id=p_event_id AND e.domain=p_domain AND e.settled_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.paystack_event_withdrawal_allocations a JOIN public.paystack_event_withdrawals prior ON prior.id=a.withdrawal_id WHERE a.transaction_id=e.transaction_id AND prior.status <> 'failed');
  IF total < 10000 OR total IS DISTINCT FROM p_expected_kobo THEN RAISE EXCEPTION 'event_withdrawal_balance_changed'; END IF;
  INSERT INTO public.paystack_event_withdrawals(event_id,organizer_id,domain,reference,amount_kobo,recipient_code,bank_name,account_name,account_last_four)
    VALUES(p_event_id,p_organizer_id,p_domain,'evt-'||gen_random_uuid()::text,total,p_recipient,p_bank_name,p_account_name,p_last_four) RETURNING * INTO w;
  INSERT INTO public.paystack_event_withdrawal_allocations(withdrawal_id,transaction_id,amount_kobo)
    SELECT w.id,e.transaction_id,greatest(0,e.proceeds_kobo-e.refunded_kobo+round(e.refunded_kobo*0.03)::bigint)
    FROM public.paystack_event_earnings e WHERE e.event_id=p_event_id AND e.domain=p_domain AND e.settled_at IS NOT NULL
      AND greatest(0,e.proceeds_kobo-e.refunded_kobo+round(e.refunded_kobo*0.03)::bigint)>0
      AND NOT EXISTS (SELECT 1 FROM public.paystack_event_withdrawal_allocations a JOIN public.paystack_event_withdrawals x ON x.id=a.withdrawal_id WHERE a.transaction_id=e.transaction_id AND x.status <> 'failed');
  RETURN to_jsonb(w);
END $$;

CREATE FUNCTION public.reserve_paystack_ticket_refund(p_ticket_id uuid,p_organizer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ev_id uuid; t public.tickets%ROWTYPE; e public.paystack_event_earnings%ROWTYPE; r public.paystack_ticket_refunds%ROWTYPE;
BEGIN
  SELECT event_id INTO ev_id FROM public.tickets WHERE id=p_ticket_id;
  PERFORM 1 FROM public.events WHERE id=ev_id AND organizer_id=p_organizer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_refund_forbidden'; END IF;
  SELECT * INTO t FROM public.tickets WHERE id=p_ticket_id FOR UPDATE;
  SELECT * INTO r FROM public.paystack_ticket_refunds WHERE ticket_id=p_ticket_id;
  IF FOUND THEN RETURN to_jsonb(r); END IF;
  SELECT * INTO e FROM public.paystack_event_earnings WHERE transaction_id::text=t.payment_tx_ref FOR UPDATE;
  IF e.transaction_id IS NULL OR t.payment_provider <> 'paystack' OR t.status <> 'PAID' OR t.refund_status IS NOT NULL THEN RAISE EXCEPTION 'ticket_refund_unavailable'; END IF;
  IF e.financial_hold OR EXISTS (SELECT 1 FROM public.paystack_event_withdrawal_allocations a JOIN public.paystack_event_withdrawals w ON w.id=a.withdrawal_id WHERE a.transaction_id=e.transaction_id AND w.status <> 'failed') THEN RAISE EXCEPTION 'ticket_refund_requires_support'; END IF;
  INSERT INTO public.paystack_ticket_refunds(ticket_id,transaction_id,event_id,amount_kobo)
    VALUES(t.id,e.transaction_id,ev_id,round(t.amount_paid*100)::bigint) RETURNING * INTO r;
  UPDATE public.tickets SET refund_status='pending',updated_at=now() WHERE id=t.id;
  RETURN to_jsonb(r);
END $$;

CREATE FUNCTION public.reconcile_paystack_ticket_refund(p_refund_id uuid,p_provider_id text,p_status text,p_amount bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.paystack_ticket_refunds%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.paystack_ticket_refunds WHERE id=p_refund_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_ticket_refund'; END IF;
  PERFORM 1 FROM public.events WHERE id=r.event_id FOR UPDATE;
  SELECT * INTO r FROM public.paystack_ticket_refunds WHERE id=p_refund_id FOR UPDATE;
  IF r.amount_kobo <> p_amount OR (r.provider_refund_id IS NOT NULL AND r.provider_refund_id <> p_provider_id) OR p_status NOT IN ('pending','processing','processed','failed','needs-attention') THEN RAISE EXCEPTION 'refund_verification_mismatch'; END IF;
  IF r.status='processed' THEN RETURN; END IF;
  UPDATE public.paystack_ticket_refunds SET provider_refund_id=p_provider_id,status=p_status,updated_at=now() WHERE id=r.id;
  -- Failed/uncertain refunds keep the admission and withdrawal hold until review.
  UPDATE public.tickets SET refund_status=p_status, status=CASE WHEN p_status='processed' THEN 'REFUNDED' ELSE status END,updated_at=now() WHERE id=r.ticket_id;
  IF p_status='processed' THEN UPDATE public.paystack_event_earnings SET refunded_kobo=refunded_kobo+r.amount_kobo WHERE transaction_id=r.transaction_id; END IF;
END $$;

CREATE FUNCTION public.reconcile_paystack_event_withdrawal(p_reference text,p_status text,p_amount bigint,p_recipient text,p_transfer_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.paystack_event_withdrawals%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.paystack_event_withdrawals WHERE reference=p_reference;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_event_withdrawal'; END IF;
  PERFORM 1 FROM public.events WHERE id=w.event_id FOR UPDATE;
  SELECT * INTO w FROM public.paystack_event_withdrawals WHERE reference=p_reference FOR UPDATE;
  IF w.amount_kobo <> p_amount OR w.recipient_code <> p_recipient OR (w.transfer_code IS NOT NULL AND w.transfer_code <> p_transfer_code) OR p_status NOT IN ('pending','otp','success','failed','reversed') THEN RAISE EXCEPTION 'withdrawal_verification_mismatch'; END IF;
  IF w.status='reversed' OR (w.status='success' AND p_status <> 'reversed') THEN RETURN; END IF;
  IF w.status='failed' AND p_status <> 'failed' THEN p_status := 'review'; END IF;
  UPDATE public.paystack_event_withdrawals SET status=p_status,transfer_code=p_transfer_code,updated_at=now() WHERE id=w.id;
  IF p_status IN ('reversed','review') THEN UPDATE public.paystack_event_earnings SET financial_hold=true,hold_reason='Transfer reversal or conflicting provider result requires review' WHERE event_id=w.event_id; END IF;
END $$;

CREATE FUNCTION public.hold_paystack_event_order(p_transaction_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ev uuid;
BEGIN
  SELECT (metadata->>'event_id')::uuid INTO ev FROM public.escrow_transactions WHERE id=p_transaction_id AND payment_provider='paystack' AND item_type='ticket';
  PERFORM 1 FROM public.events WHERE id=ev FOR UPDATE;
  UPDATE public.paystack_ticket_orders SET financial_hold=true,hold_reason=left(p_reason,300) WHERE transaction_id=p_transaction_id;
  UPDATE public.paystack_event_earnings SET financial_hold=true,hold_reason=left(p_reason,300) WHERE transaction_id=p_transaction_id;
END $$;

CREATE FUNCTION public.get_paystack_event_totals(p_event_id uuid,p_domain text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
WITH context AS (
  SELECT ev.end_time + interval '24 hours' <= now() AND ev.status <> 'CANCELLED'
    AND NOT EXISTS (SELECT 1 FROM public.paystack_event_earnings e WHERE e.event_id=ev.id AND e.domain=p_domain AND e.financial_hold)
    AND NOT EXISTS (SELECT 1 FROM public.paystack_ticket_refunds r WHERE r.event_id=ev.id AND r.status <> 'processed') AS mature
  FROM public.events ev WHERE ev.id=p_event_id
), balances AS (
  SELECT e.*, greatest(0,e.proceeds_kobo-e.refunded_kobo+round(e.refunded_kobo*0.03)::bigint) AS net,
    EXISTS (SELECT 1 FROM public.paystack_event_withdrawal_allocations a JOIN public.paystack_event_withdrawals w ON w.id=a.withdrawal_id WHERE a.transaction_id=e.transaction_id AND w.status <> 'failed') AS allocated
  FROM public.paystack_event_earnings e WHERE e.event_id=p_event_id AND e.domain=p_domain
)
SELECT jsonb_build_object('financialHold',EXISTS (SELECT 1 FROM public.paystack_event_earnings e WHERE e.event_id=p_event_id AND e.domain=p_domain AND e.financial_hold) OR EXISTS (SELECT 1 FROM public.paystack_ticket_refunds r WHERE r.event_id=p_event_id AND r.status <> 'processed'),
  'grossKobo',coalesce(sum(gross_kobo),0),'commissionKobo',coalesce(sum(commission_kobo),0),
  'providerFeeKobo',coalesce(sum(provider_fee_kobo),0),
  'availableKobo',coalesce(sum(net) FILTER (WHERE NOT allocated AND settled_at IS NOT NULL AND (SELECT mature FROM context)),0),
  'heldKobo',coalesce(sum(net) FILTER (WHERE NOT allocated AND (settled_at IS NULL OR NOT coalesce((SELECT mature FROM context),false))),0),
  'withdrawnKobo',(SELECT coalesce(sum(amount_kobo),0) FROM public.paystack_event_withdrawals WHERE event_id=p_event_id AND domain=p_domain AND status='success'))
FROM balances;
$$;
REVOKE ALL ON FUNCTION public.get_paystack_event_totals(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_paystack_event_totals(uuid,text) TO service_role;

-- The event row lock serializes this check with paid Paystack fulfillment.
CREATE FUNCTION public.guard_paid_event_cancellation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status='CANCELLED' AND OLD.status IS DISTINCT FROM NEW.status AND EXISTS (
    SELECT 1 FROM public.tickets WHERE event_id=NEW.id AND (status='USED' OR (status='PAID' AND coalesce(amount_paid,1)<>0))
  ) THEN RAISE EXCEPTION 'Refund or reconcile paid tickets before cancelling this event'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_paid_event_cancellation BEFORE UPDATE OF status ON public.events FOR EACH ROW EXECUTE FUNCTION public.guard_paid_event_cancellation();
REVOKE ALL ON FUNCTION public.guard_paid_event_cancellation() FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.record_paystack_event_earnings(),public.reserve_paystack_event_withdrawal(uuid,uuid,text,bigint,text,text,text,text),public.reserve_paystack_ticket_refund(uuid,uuid),public.reconcile_paystack_ticket_refund(uuid,text,text,bigint),public.reconcile_paystack_event_withdrawal(text,text,bigint,text,text),public.hold_paystack_event_order(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_paystack_event_withdrawal(uuid,uuid,text,bigint,text,text,text,text),public.reserve_paystack_ticket_refund(uuid,uuid),public.reconcile_paystack_ticket_refund(uuid,text,text,bigint),public.reconcile_paystack_event_withdrawal(text,text,bigint,text,text),public.hold_paystack_event_order(uuid,text) TO service_role;
