-- Remove only the account-change waiting period; retain all payout safety checks.
BEGIN;
CREATE OR REPLACE FUNCTION public.reserve_seller_payout(p_seller_id uuid,p_account_id uuid,p_amount numeric,p_wallet_limit numeric,p_transaction_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_earnings numeric;v_spent numeric;v_reserved numeric;v_id uuid;
BEGIN
 IF p_amount IS NULL OR p_amount <= 0 OR p_wallet_limit IS NULL OR p_wallet_limit < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_seller_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.seller_accounts WHERE id = p_account_id AND user_id = p_seller_id AND is_active
  AND verification_status = 'verified') THEN
  RAISE EXCEPTION 'Verified payout account required';
 END IF;
 SELECT coalesce(sum(seller_amount),0) INTO v_earnings FROM public.escrow_transactions WHERE seller_id = p_seller_id AND status = 'completed' AND coalesce(item_type,'post') <> 'ticket' AND payment_provider = 'payluk';
 SELECT coalesce(sum(amount) FILTER(WHERE status = 'completed'),0),coalesce(sum(amount) FILTER(WHERE status IN ('pending','processing')),0)
 INTO v_spent,v_reserved FROM public.payout_requests WHERE seller_id = p_seller_id;
 IF p_amount > least(v_earnings-v_spent-v_reserved,p_wallet_limit-v_reserved) THEN RAISE EXCEPTION 'Insufficient unreserved balance' USING ERRCODE = '23514'; END IF;
 INSERT INTO public.payout_requests(seller_id,account_id,amount,status,transaction_id,payment_provider)
 VALUES(p_seller_id,p_account_id,p_amount,'pending',p_transaction_id,'payluk') RETURNING id INTO v_id;
 RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.reserve_seller_payout(uuid,uuid,numeric,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_seller_payout(uuid,uuid,numeric,numeric,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.requeue_seller_payout(
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
  AND verification_status = 'verified') THEN RETURN false; END IF;
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
COMMIT;
NOTIFY pgrst, 'reload schema';
