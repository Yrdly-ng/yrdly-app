BEGIN;

-- NULL retains the uncertainty of historical rows. Only new attempts record
-- whether verification could have been sent; never infer this from error text.
ALTER TABLE public.payout_requests ADD COLUMN execution_stage text
 CHECK (execution_stage IN ('preparing','submitted'));

DROP FUNCTION public.requeue_seller_payout(uuid,uuid,numeric);
CREATE FUNCTION public.requeue_seller_payout(
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
  AND verification_status = 'verified' AND (account_updated_at IS NULL OR account_updated_at <= now()-interval '24 hours')) THEN RETURN false; END IF;
 SELECT coalesce(sum(seller_amount),0) INTO v_earnings FROM public.escrow_transactions
 WHERE seller_id = p_seller_id AND status = 'completed' AND coalesce(item_type,'post') <> 'ticket' AND payment_provider = 'payluk';
 SELECT coalesce(sum(amount) FILTER(WHERE status = 'completed'),0),coalesce(sum(amount) FILTER(WHERE status IN ('pending','processing')),0)
 INTO v_spent,v_reserved FROM public.payout_requests WHERE seller_id = p_seller_id AND id <> p_payout_id;
 IF v_payout.amount > least(v_earnings-v_spent-v_reserved,p_wallet_limit-v_reserved) THEN RETURN false; END IF;
 UPDATE public.payout_requests SET status = 'pending',failure_reason = NULL WHERE id = v_payout.id;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.requeue_seller_payout(uuid,uuid,numeric,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_seller_payout(uuid,uuid,numeric,text,text) TO service_role;
COMMENT ON COLUMN public.payout_requests.execution_stage IS
 'Server-only attempt marker: preparing is before payment verification, submitted is durably saved before verification; NULL legacy is uncertain.';
COMMIT;
NOTIFY pgrst, 'reload schema';
