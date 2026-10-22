BEGIN;
ALTER TABLE public.payout_requests ADD COLUMN reconciliation_due_at timestamptz;
ALTER TABLE public.payout_requests ADD COLUMN review_notified_at timestamptz;

CREATE FUNCTION public.claim_delayed_withdrawal_check()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_payout public.payout_requests%ROWTYPE;
BEGIN
 SELECT * INTO v_payout FROM public.payout_requests
 WHERE status='processing' AND execution_stage='submitted' AND payment_provider='payluk'
   AND transaction_reference IS NOT NULL AND coalesce(processed_at,requested_at)<=now()-interval '2 minutes'
   AND (reconciliation_due_at IS NULL OR reconciliation_due_at<=now())
 ORDER BY reconciliation_due_at NULLS FIRST, requested_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.payout_requests SET reconciliation_due_at=now()+interval '5 minutes' WHERE id=v_payout.id;
 RETURN jsonb_build_object('id',v_payout.id,'seller_id',v_payout.seller_id,'amount',v_payout.amount,'transaction_reference',v_payout.transaction_reference);
END; $$;

CREATE FUNCTION public.alert_delayed_withdrawal(p_payout_id uuid,p_reference text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_seller uuid;
BEGIN
 UPDATE public.payout_requests SET review_notified_at=now(),
 failure_reason='Withdrawal delayed: Payluk has not confirmed the outcome. Support review required; funds remain held to prevent a duplicate transfer.'
 WHERE id=p_payout_id AND status='processing' AND execution_stage='submitted'
 AND transaction_reference=p_reference AND coalesce(processed_at,requested_at)<=now()-interval '15 minutes'
 AND review_notified_at IS NULL RETURNING seller_id INTO v_seller;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.notifications(user_id,type,title,message,related_id,related_type,is_read,data)
 SELECT id,'payout_failed','Withdrawal delayed — needs review',
 'Payluk has not confirmed this withdrawal. Contact support with its reference. Do not send another transfer; the balance remains protected.',
 p_payout_id,'payout',false,jsonb_build_object('payoutId',p_payout_id,'needsReview',true)
 FROM public.users WHERE id=v_seller OR is_admin=true;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.claim_delayed_withdrawal_check(),public.alert_delayed_withdrawal(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_delayed_withdrawal_check(),public.alert_delayed_withdrawal(uuid,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
