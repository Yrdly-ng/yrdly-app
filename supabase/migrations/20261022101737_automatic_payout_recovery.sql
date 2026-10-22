BEGIN;
-- No backfill: historical and manual withdrawals never enter this queue.
CREATE TABLE public.automatic_payout_recovery (
 payout_id uuid PRIMARY KEY REFERENCES public.payout_requests(id),
 state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','done','attention')),
 action text NOT NULL DEFAULT 'inspect' CHECK (action IN ('inspect','retry','reconcile')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4),
 checks integer NOT NULL DEFAULT 0,
 due_at timestamptz NOT NULL DEFAULT (now()+interval '5 minutes'),
 lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
 lease_until timestamptz NOT NULL DEFAULT (now()+interval '5 minutes'),
 provider_debit numeric, net_amount numeric, provider_reference text, attempt_reference text,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automatic_payout_recovery_due ON public.automatic_payout_recovery(due_at) WHERE state='active';
CREATE TABLE public.payout_recovery_worker (
 id boolean PRIMARY KEY DEFAULT true CHECK (id), token uuid, available_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.payout_recovery_worker(id) VALUES(true);
ALTER TABLE public.automatic_payout_recovery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_recovery_worker ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automatic_payout_recovery, public.payout_recovery_worker FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.automatic_payout_recovery, public.payout_recovery_worker TO service_role;

CREATE FUNCTION public.reserve_automatic_seller_payout(p_seller_id uuid,p_account_id uuid,p_amount numeric,p_wallet_limit numeric,p_transaction_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_token uuid;
BEGIN
 IF p_transaction_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE id=p_transaction_id AND seller_id=p_seller_id AND status='completed' AND payment_provider='payluk' AND coalesce(item_type,'post')<>'ticket') THEN RAISE EXCEPTION 'Completed marketplace sale required'; END IF;
 v_id := public.reserve_seller_payout(p_seller_id,p_account_id,p_amount,p_wallet_limit,p_transaction_id);
 INSERT INTO public.automatic_payout_recovery(payout_id) VALUES(v_id) RETURNING lease_token INTO v_token;
 RETURN jsonb_build_object('id',v_id,'token',v_token);
END; $$;

CREATE FUNCTION public.claim_automatic_payout_recovery(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job public.automatic_payout_recovery%ROWTYPE;
BEGIN
 -- Global worker lease also spaces repeated invocations; one payout per run.
 PERFORM 1 FROM public.payout_recovery_worker WHERE id=true AND available_at<=now() FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO v_job FROM public.automatic_payout_recovery WHERE state='active' AND due_at<=now() AND lease_until<=now() ORDER BY due_at,payout_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.payout_recovery_worker SET token=p_token,available_at=now()+interval '5 minutes' WHERE id=true;
 UPDATE public.automatic_payout_recovery SET lease_token=p_token,lease_until=now()+interval '5 minutes',checks=checks+1,updated_at=now() WHERE payout_id=v_job.payout_id RETURNING * INTO v_job;
 RETURN to_jsonb(v_job);
END; $$;

CREATE FUNCTION public.start_automatic_payout_attempt(p_payout_id uuid,p_token uuid,p_reference text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.automatic_payout_recovery WHERE payout_id=p_payout_id AND state='active' AND lease_token=p_token AND lease_until>now() AND attempts<4 FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.payout_requests SET status='processing',transaction_reference=p_reference,payment_provider='payluk',execution_stage='preparing' WHERE id=p_payout_id AND status='pending';
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.automatic_payout_recovery SET attempts=attempts+1,action='inspect',attempt_reference=p_reference,provider_debit=NULL,net_amount=NULL,provider_reference=NULL,updated_at=now() WHERE payout_id=p_payout_id;
 RETURN true;
END; $$;

CREATE FUNCTION public.submit_automatic_payout_attempt(p_payout_id uuid,p_token uuid,p_expected_reference text,p_reference text,p_debit numeric,p_net numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Fences a paused/expired worker before it can call Payluk verify.
 PERFORM 1 FROM public.automatic_payout_recovery WHERE payout_id=p_payout_id AND state='active' AND lease_token=p_token AND lease_until>now() FOR UPDATE;
 IF NOT FOUND OR p_debit IS NULL OR p_net IS NULL OR p_net<=0 OR p_debit<p_net THEN RETURN false; END IF;
 UPDATE public.payout_requests SET transaction_reference=p_reference,execution_stage='submitted' WHERE id=p_payout_id AND status='processing' AND execution_stage='preparing' AND transaction_reference=p_expected_reference AND p_debit<=amount;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.automatic_payout_recovery SET action='reconcile',provider_debit=p_debit,net_amount=p_net,provider_reference=p_reference,updated_at=now() WHERE payout_id=p_payout_id;
 RETURN true;
END; $$;

CREATE FUNCTION public.requeue_automatic_payout(p_payout_id uuid,p_token uuid,p_reference text,p_status text,p_wallet_limit numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_seller uuid; v_job public.automatic_payout_recovery%ROWTYPE;
BEGIN
 SELECT * INTO v_job FROM public.automatic_payout_recovery WHERE payout_id=p_payout_id AND state='active' AND lease_token=p_token AND lease_until>now() AND attempts<4 FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT seller_id INTO v_seller FROM public.payout_requests WHERE id=p_payout_id;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_seller::text,0));
 PERFORM 1 FROM public.payout_requests WHERE id=p_payout_id AND transaction_reference=v_job.attempt_reference AND execution_stage='preparing' AND (status='processing' OR (status='failed' AND v_job.action='retry')) FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN public.requeue_seller_payout(p_payout_id,v_seller,p_wallet_limit,p_reference,p_status);
END; $$;

CREATE FUNCTION public.finish_automatic_payout_recovery(p_payout_id uuid,p_token uuid,p_action text,p_delay_seconds integer,p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_seller uuid;
BEGIN
 IF p_action NOT IN ('done','attention','retry','reconcile') THEN RAISE EXCEPTION 'Invalid recovery outcome'; END IF;
 UPDATE public.automatic_payout_recovery SET state=CASE WHEN p_action IN ('done','attention') THEN p_action ELSE 'active' END,
 action=CASE WHEN p_action IN ('retry','reconcile') THEN p_action ELSE action END,
 due_at=now()+make_interval(secs=>greatest(coalesce(p_delay_seconds,300),60)),lease_until=now(),last_error=left(p_error,1000),updated_at=now()
 WHERE payout_id=p_payout_id AND state='active' AND lease_token=p_token AND lease_until>now();
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.payout_recovery_worker SET available_at=now()+interval '1 minute' WHERE id=true AND token=p_token;
 IF p_action='attention' THEN
  SELECT seller_id INTO v_seller FROM public.payout_requests WHERE id=p_payout_id;
  -- Queue transition and alerts commit together; no duplicate alerts on cron redelivery.
  INSERT INTO public.notifications(user_id,type,title,message,related_id,related_type,is_read,data)
  SELECT id,'payout_failed','Payout needs attention',
   CASE WHEN id=v_seller THEN 'Your automatic payout needs review. Contact support before requesting another transfer.' ELSE 'An automatic payout needs review. Check its provider reference before any retry.' END,
   p_payout_id,'payout',false,jsonb_build_object('payoutId',p_payout_id,'recovery','attention')
  FROM public.users WHERE id=v_seller OR is_admin=true;
 END IF;
 RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.reserve_automatic_seller_payout(uuid,uuid,numeric,numeric,uuid),public.claim_automatic_payout_recovery(uuid),public.start_automatic_payout_attempt(uuid,uuid,text),public.submit_automatic_payout_attempt(uuid,uuid,text,text,numeric,numeric),public.requeue_automatic_payout(uuid,uuid,text,text,numeric),public.finish_automatic_payout_recovery(uuid,uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_automatic_seller_payout(uuid,uuid,numeric,numeric,uuid),public.claim_automatic_payout_recovery(uuid),public.start_automatic_payout_attempt(uuid,uuid,text),public.submit_automatic_payout_attempt(uuid,uuid,text,text,numeric,numeric),public.requeue_automatic_payout(uuid,uuid,text,text,numeric),public.finish_automatic_payout_recovery(uuid,uuid,text,integer,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
