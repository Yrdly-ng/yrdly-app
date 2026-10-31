-- Local, reviewed migration only. Production application requires separate authorization.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE public.sales_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
  title text NOT NULL, rules_version text NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  review_ends_at timestamptz NOT NULL, timezone text NOT NULL,
  prize_pool_naira integer NOT NULL CHECK (prize_pool_naira > 0),
  final_snapshot jsonb, final_source_hash text, finalized_at timestamptz,
  CHECK (starts_at < ends_at AND ends_at < review_ends_at)
);
INSERT INTO public.sales_campaigns(slug,title,rules_version,starts_at,ends_at,review_ends_at,timezone,prize_pool_naira)
VALUES('small-businesses','YRDLY × Small Businesses','2026-11-v1',
 '2026-10-31T23:00:00Z','2026-11-30T23:00:00Z','2026-12-07T23:00:00Z','Africa/Lagos',500000);

CREATE TABLE public.campaign_participations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES public.sales_campaigns(id),
  business_id uuid NOT NULL, owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','suspended','disqualified')),
  rules_version text NOT NULL, accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), approved_at timestamptz,
  reason text, UNIQUE(campaign_id,business_id), UNIQUE(campaign_id,owner_id)
);
-- Deliberately retain identity snapshots if a source business/account is deleted.
CREATE TABLE public.campaign_sale_evidence (
  transaction_id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES public.sales_campaigns(id),
  participation_id uuid NOT NULL REFERENCES public.campaign_participations(id),
  business_id uuid NOT NULL, seller_id uuid NOT NULL, buyer_id uuid NOT NULL, item_id text NOT NULL,
  amount numeric NOT NULL CHECK(amount > 0 AND amount::text NOT IN ('NaN','Infinity','-Infinity')),
  environment text NOT NULL CHECK(environment IN ('live','test')),
  order_created_at timestamptz NOT NULL, captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  refund_confirmed_at timestamptz, receipt_confirmed_at timestamptz, completed_at timestamptz, provider_verified_at timestamptz,
  provider_escrow_id text, provider_status text,
  manual_hold boolean NOT NULL DEFAULT false, hold_reason text,
  CHECK(completed_at IS NULL OR (receipt_confirmed_at IS NOT NULL AND provider_verified_at IS NOT NULL))
);
CREATE INDEX campaign_sale_evidence_business ON public.campaign_sale_evidence(campaign_id,business_id);
CREATE UNIQUE INDEX campaign_release_once ON public.campaign_sale_evidence(environment,provider_escrow_id)
 WHERE completed_at IS NOT NULL AND provider_escrow_id IS NOT NULL;
CREATE TABLE public.campaign_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES public.sales_campaigns(id),
  actor_id uuid, action text NOT NULL, subject_id uuid, reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
  before_state jsonb, after_state jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX campaign_audit_campaign ON public.campaign_audit(campaign_id,created_at DESC);
ALTER TABLE public.sales_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_participations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_sale_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_campaigns,public.campaign_participations,public.campaign_sale_evidence,public.campaign_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.sales_campaigns,public.campaign_participations,public.campaign_sale_evidence TO service_role;
GRANT SELECT,INSERT ON public.campaign_audit TO service_role;

CREATE FUNCTION private.guard_campaign_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME='campaign_audit' THEN RAISE EXCEPTION 'Campaign history is immutable'; END IF;
 IF TG_TABLE_NAME='campaign_sale_evidence' THEN
  IF (to_jsonb(NEW)-ARRAY['receipt_confirmed_at','completed_at','provider_verified_at','provider_escrow_id','provider_status','manual_hold','hold_reason','refund_confirmed_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['receipt_confirmed_at','completed_at','provider_verified_at','provider_escrow_id','provider_status','manual_hold','hold_reason','refund_confirmed_at'])
    OR (OLD.refund_confirmed_at IS NOT NULL AND NEW.refund_confirmed_at IS DISTINCT FROM OLD.refund_confirmed_at)
    OR (OLD.receipt_confirmed_at IS NOT NULL AND NEW.receipt_confirmed_at IS DISTINCT FROM OLD.receipt_confirmed_at)
    OR (OLD.completed_at IS NOT NULL AND (NEW.completed_at,NEW.provider_verified_at,NEW.provider_escrow_id,NEW.provider_status)
      IS DISTINCT FROM (OLD.completed_at,OLD.provider_verified_at,OLD.provider_escrow_id,OLD.provider_status)) THEN
   RAISE EXCEPTION 'Sale origin and completion evidence are immutable'; END IF;
 ELSIF TG_TABLE_NAME='campaign_participations' THEN
  IF (to_jsonb(NEW)-ARRAY['status','reason','approved_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reason','approved_at'])
    OR (OLD.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
   RAISE EXCEPTION 'Participation identity and approval time are immutable'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['final_snapshot','final_source_hash','finalized_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['final_snapshot','final_source_hash','finalized_at'])
    OR OLD.finalized_at IS NOT NULL THEN RAISE EXCEPTION 'Campaign rules and finalized results are immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER campaign_history BEFORE UPDATE OR DELETE ON public.campaign_audit FOR EACH ROW EXECUTE FUNCTION private.guard_campaign_history();
CREATE TRIGGER campaign_evidence_immutable BEFORE UPDATE OR DELETE ON public.campaign_sale_evidence FOR EACH ROW EXECUTE FUNCTION private.guard_campaign_history();
CREATE TRIGGER campaign_participation_immutable BEFORE UPDATE OR DELETE ON public.campaign_participations FOR EACH ROW EXECUTE FUNCTION private.guard_campaign_history();
CREATE TRIGGER campaign_rules_immutable BEFORE UPDATE OR DELETE ON public.sales_campaigns FOR EACH ROW EXECUTE FUNCTION private.guard_campaign_history();

CREATE FUNCTION public.enroll_sales_campaign(p_actor uuid,p_business_id uuid,p_rules_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.sales_campaigns; p public.campaign_participations;
BEGIN
 SELECT * INTO c FROM public.sales_campaigns WHERE slug='small-businesses' FOR UPDATE;
 IF c.ends_at<=clock_timestamp() OR c.finalized_at IS NOT NULL THEN RAISE EXCEPTION 'Campaign enrollment has ended'; END IF;
 IF p_rules_version IS DISTINCT FROM c.rules_version THEN RAISE EXCEPTION 'Accept the current campaign rules'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=p_business_id AND owner_id=p_actor AND is_active AND moderation_status='approved' AND mode::text IN ('product','both')) THEN
  RAISE EXCEPTION 'Choose an approved product business you own'; END IF;
 SELECT * INTO p FROM public.campaign_participations WHERE campaign_id=c.id AND owner_id=p_actor;
 IF FOUND THEN
  IF p.business_id<>p_business_id THEN RAISE EXCEPTION 'Only one business per owner may enter'; END IF;
  RETURN to_jsonb(p);
 END IF;
 INSERT INTO public.campaign_participations(campaign_id,business_id,owner_id,rules_version) VALUES(c.id,p_business_id,p_actor,c.rules_version) RETURNING * INTO p;
 INSERT INTO public.campaign_audit(campaign_id,actor_id,action,subject_id,reason,after_state)
 VALUES(c.id,p_actor,'enroll',p.id,'Owner accepted campaign rules',to_jsonb(p));
 RETURN to_jsonb(p);
END $$;

-- Called before any provider operation; no caller-supplied business, price or clock.
CREATE FUNCTION public.capture_campaign_order(p_transaction_id uuid,p_environment text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.escrow_transactions; c public.sales_campaigns; p public.campaign_participations; selected_business_id uuid;
BEGIN
 IF p_environment IS NULL OR p_environment NOT IN ('live','test') THEN RAISE EXCEPTION 'Unknown payment environment'; END IF;
 SELECT * INTO t FROM public.escrow_transactions WHERE id=p_transaction_id FOR UPDATE;
 IF NOT FOUND OR t.item_type IS DISTINCT FROM 'catalog_item' THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_sale_evidence WHERE transaction_id=t.id) THEN RETURN true; END IF;
 SELECT * INTO c FROM public.sales_campaigns WHERE slug='small-businesses';
 IF c.finalized_at IS NOT NULL OR t.created_at<c.starts_at OR t.created_at>=c.ends_at THEN RETURN false; END IF;
 IF t.status<>'pending' OR t.payluk_escrow_id IS NOT NULL THEN RAISE EXCEPTION 'Capture attribution before starting payment'; END IF;
 SELECT b.id INTO selected_business_id FROM public.catalog_items i JOIN public.businesses b ON b.id=i.business_id
 WHERE i.id::text=t.item_id AND b.owner_id=t.seller_id AND b.is_active AND b.moderation_status='approved' AND b.mode::text IN ('product','both') FOR SHARE OF i,b;
 IF selected_business_id IS NULL THEN RETURN false; END IF;
 SELECT * INTO p FROM public.campaign_participations WHERE campaign_id=c.id AND campaign_participations.business_id=selected_business_id AND status='approved'
   AND owner_id=t.seller_id AND approved_at<=t.created_at FOR SHARE;
 IF NOT FOUND OR t.buyer_id=t.seller_id OR t.amount<=0 THEN RETURN false; END IF;
 INSERT INTO public.campaign_sale_evidence(transaction_id,campaign_id,participation_id,business_id,seller_id,buyer_id,item_id,amount,environment,order_created_at)
 VALUES(t.id,c.id,p.id,selected_business_id,t.seller_id,t.buyer_id,t.item_id,t.amount,p_environment,t.created_at) ON CONFLICT DO NOTHING;
 RETURN true;
END $$;

-- Record the authenticated buyer's explicit receipt action before provider release.
-- A previously timed-claimed order cannot acquire new buyer-confirmation provenance.
CREATE FUNCTION public.begin_campaign_receipt(p_transaction_id uuid,p_buyer_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.escrow_transactions; e public.campaign_sale_evidence;
BEGIN
 SELECT * INTO t FROM public.escrow_transactions WHERE id=p_transaction_id FOR UPDATE;
 SELECT * INTO e FROM public.campaign_sale_evidence WHERE transaction_id=p_transaction_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF t.buyer_id IS DISTINCT FROM p_buyer_id OR e.buyer_id IS DISTINCT FROM p_buyer_id OR t.buyer_id=t.seller_id THEN RAISE EXCEPTION 'Only the buyer may confirm receipt'; END IF;
 IF e.receipt_confirmed_at IS NOT NULL THEN RETURN true; END IF;
 IF t.status NOT IN ('paid','shipped','delivered') THEN RETURN false; END IF;
 UPDATE public.campaign_sale_evidence SET receipt_confirmed_at=clock_timestamp() WHERE transaction_id=t.id;
 INSERT INTO public.campaign_audit(campaign_id,actor_id,action,subject_id,reason) VALUES(e.campaign_id,p_buyer_id,'buyer_receipt',t.id,'Buyer explicitly confirmed receipt');
 RETURN true;
END $$;

CREATE FUNCTION public.finish_campaign_receipt(p_transaction_id uuid,p_buyer_id uuid,p_provider_escrow_id text,p_provider_status text,p_provider_completed_at timestamptz,p_environment text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.escrow_transactions; e public.campaign_sale_evidence; completion_time timestamptz;
BEGIN
 SELECT * INTO t FROM public.escrow_transactions WHERE id=p_transaction_id FOR UPDATE;
 SELECT * INTO e FROM public.campaign_sale_evidence WHERE transaction_id=p_transaction_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF t.buyer_id IS DISTINCT FROM p_buyer_id OR e.buyer_id IS DISTINCT FROM p_buyer_id THEN RAISE EXCEPTION 'Only the buyer may confirm receipt'; END IF;
 IF e.completed_at IS NOT NULL THEN RETURN true; END IF;
 IF e.receipt_confirmed_at IS NULL OR t.payment_provider IS DISTINCT FROM 'payluk' OR t.payluk_escrow_id IS DISTINCT FROM p_provider_escrow_id
   OR p_provider_status IS DISTINCT FROM 'COMPLETED' OR p_environment IS DISTINCT FROM e.environment
   OR t.status NOT IN ('paid','shipped','delivered','completed') THEN RAISE EXCEPTION 'Verified buyer release is required'; END IF;
 -- The provider time can recover a release whose local write failed, never a seller claim preceding receipt.
 completion_time:=coalesce(p_provider_completed_at,clock_timestamp());
 IF completion_time<e.receipt_confirmed_at-interval '1 second' OR completion_time>clock_timestamp()+interval '30 seconds' THEN
  RAISE EXCEPTION 'Provider completion time requires review'; END IF;
 UPDATE public.campaign_sale_evidence SET completed_at=completion_time,provider_verified_at=clock_timestamp(),provider_escrow_id=p_provider_escrow_id,provider_status=p_provider_status WHERE transaction_id=t.id;
 UPDATE public.escrow_transactions SET status='completed',completed_at=coalesce(completed_at,completion_time),updated_at=clock_timestamp()
 WHERE id=t.id AND status IN ('paid','shipped','delivered');
 INSERT INTO public.campaign_audit(campaign_id,actor_id,action,subject_id,reason) VALUES(e.campaign_id,p_buyer_id,'verified_completion',t.id,'Buyer receipt and provider release verified');
 RETURN true;
END $$;

-- Re-evaluate financial evidence on every read. No callbacks increment a score.
CREATE FUNCTION private.campaign_sales(p_campaign_id uuid,p_transaction_id uuid DEFAULT NULL) RETURNS TABLE(transaction_id uuid,business_id uuid,business_name text,buyer_id uuid,seller_id uuid,
 created_at timestamptz,completed_at timestamptz,environment text,qualified boolean,reason text,manual_hold boolean,review_required boolean,evidence jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH facts AS (
 SELECT e.*, b.name business_name,
  CASE
   WHEN e.environment<>'live' THEN 'test_payment'
   WHEN e.buyer_id=e.seller_id THEN 'self_purchase'
   WHEN t.id IS NULL OR t.item_type IS DISTINCT FROM 'catalog_item' OR t.item_id IS DISTINCT FROM e.item_id OR t.buyer_id IS DISTINCT FROM e.buyer_id
     OR t.seller_id IS DISTINCT FROM e.seller_id OR t.amount IS DISTINCT FROM e.amount OR t.created_at IS DISTINCT FROM e.order_created_at OR t.payment_provider IS DISTINCT FROM 'payluk'
     OR (e.provider_escrow_id IS NOT NULL AND t.payluk_escrow_id IS DISTINCT FROM e.provider_escrow_id) THEN 'source_changed'
   WHEN e.refund_confirmed_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.disputes d WHERE d.transaction_id=e.transaction_id AND coalesce(d.refund_amount,0)>0 AND d.status='resolved')
     OR t.status::text IN ('refunded','cancelled') THEN 'refunded_or_reversed'
   WHEN e.manual_hold THEN 'manual_review'
   WHEN EXISTS(SELECT 1 FROM public.payment_reconciliation_flags f WHERE f.transaction_id=e.transaction_id AND f.status='open') THEN 'reconciliation_pending'
   WHEN t.status='disputed' OR EXISTS(SELECT 1 FROM public.disputes d WHERE d.transaction_id=e.transaction_id AND d.status NOT IN ('resolved','closed')) THEN 'dispute_pending'
   WHEN b.id IS NULL OR b.owner_id IS DISTINCT FROM e.seller_id OR NOT b.is_active OR b.moderation_status IS DISTINCT FROM 'approved' THEN 'business_unavailable'
   WHEN p.status<>'approved' THEN 'participation_'||p.status
   WHEN e.order_created_at<p.approved_at OR e.order_created_at<c.starts_at OR e.order_created_at>=c.ends_at THEN 'order_outside_window'
   WHEN e.completed_at IS NULL THEN CASE WHEN e.receipt_confirmed_at IS NOT NULL THEN 'release_verification_pending' ELSE 'awaiting_buyer_completion' END
   WHEN e.completed_at<c.starts_at OR e.completed_at>=c.ends_at THEN 'completion_outside_window'
   WHEN t.status<>'completed' OR e.provider_status IS DISTINCT FROM 'COMPLETED' THEN 'release_verification_pending'
   ELSE 'qualified' END qualification_reason,
   jsonb_build_object('source',to_jsonb(t)-ARRAY['delivery_details','metadata'],'disputes',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.disputes d WHERE d.transaction_id=e.transaction_id),'[]'::jsonb),
    'flags',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.payment_reconciliation_flags f WHERE f.transaction_id=e.transaction_id),'[]'::jsonb)) financial_evidence
 FROM public.campaign_sale_evidence e JOIN public.sales_campaigns c ON c.id=e.campaign_id
 JOIN public.campaign_participations p ON p.id=e.participation_id
 LEFT JOIN public.escrow_transactions t ON t.id=e.transaction_id LEFT JOIN public.businesses b ON b.id=e.business_id
 WHERE e.campaign_id=p_campaign_id AND (p_transaction_id IS NULL OR e.transaction_id=p_transaction_id)
 ) SELECT transaction_id,business_id,business_name,buyer_id,seller_id,order_created_at,completed_at,environment,qualification_reason='qualified',qualification_reason,manual_hold,
 qualification_reason IN ('manual_review','reconciliation_pending','dispute_pending','source_changed','release_verification_pending','business_unavailable'),
 to_jsonb(facts) FROM facts;
$$;


CREATE TABLE public.campaign_order_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid NOT NULL REFERENCES public.campaign_sale_evidence(transaction_id),
 event text NOT NULL, observed_at timestamptz NOT NULL DEFAULT clock_timestamp(), source_hash text NOT NULL,
 UNIQUE(transaction_id,event,source_hash)
);
CREATE TABLE public.campaign_order_scores (
 transaction_id uuid PRIMARY KEY REFERENCES public.campaign_sale_evidence(transaction_id),
 qualified boolean NOT NULL, reason text NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.campaign_prize_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campaign_id uuid NOT NULL REFERENCES public.sales_campaigns(id),business_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('verification','payment')),status text NOT NULL,amount_kobo bigint,reference text,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 1000),actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='verification' AND status IN ('verified','needs_review','rejected') AND amount_kobo IS NULL AND reference IS NULL)
 OR (kind='payment' AND status='recorded' AND amount_kobo>0 AND length(trim(reference)) BETWEEN 1 AND 200))
);
CREATE UNIQUE INDEX campaign_prize_payment_once ON public.campaign_prize_records(campaign_id,business_id) WHERE kind='payment';
ALTER TABLE public.campaign_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_order_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_prize_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_order_events,public.campaign_order_scores,public.campaign_prize_records FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.campaign_order_events,public.campaign_prize_records TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.campaign_order_scores TO service_role;
-- Append-only event and prize records reuse the history guard's unconditional branch.
CREATE FUNCTION private.guard_campaign_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Campaign audit records are append-only'; END $$;
CREATE TRIGGER campaign_events_immutable BEFORE UPDATE OR DELETE ON public.campaign_order_events FOR EACH ROW EXECUTE FUNCTION private.guard_campaign_append_only();
CREATE TRIGGER campaign_prizes_immutable BEFORE UPDATE OR DELETE ON public.campaign_prize_records FOR EACH ROW EXECUTE FUNCTION private.guard_campaign_append_only();

CREATE FUNCTION private.campaign_suspicion(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(signal),'[]'::jsonb) FROM (
 SELECT 'repeat_buyer' signal WHERE EXISTS(SELECT 1 FROM public.campaign_sale_evidence e JOIN public.campaign_sale_evidence o ON o.business_id=e.business_id AND o.buyer_id=e.buyer_id AND o.transaction_id<>e.transaction_id WHERE e.transaction_id=p_id)
 UNION ALL SELECT 'closely_timed_orders' WHERE EXISTS(SELECT 1 FROM public.campaign_sale_evidence e JOIN public.campaign_sale_evidence o ON o.business_id=e.business_id AND o.buyer_id=e.buyer_id AND o.transaction_id<>e.transaction_id AND abs(extract(epoch FROM o.order_created_at-e.order_created_at))<60 WHERE e.transaction_id=p_id)
 UNION ALL SELECT 'buyer_is_participant_owner' WHERE EXISTS(SELECT 1 FROM public.campaign_sale_evidence e JOIN public.campaign_participations p ON p.owner_id=e.buyer_id AND p.campaign_id=e.campaign_id WHERE e.transaction_id=p_id)
 ) signals;
$$;

-- Only guarded server financial writers can report a confirmed refund/reversal.
-- Once recorded it cannot be cleared, even if a callback later says completed.
CREATE FUNCTION public.record_campaign_refund(p_transaction_id uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 UPDATE public.campaign_sale_evidence SET refund_confirmed_at=coalesce(refund_confirmed_at,clock_timestamp()) WHERE transaction_id=p_transaction_id;
END $$;

-- Audit changes at source mutation time, including automated changes. Read results
-- are always recalculated from evidence; this table is the audit checkpoint, not a score input.
CREATE FUNCTION private.refresh_campaign_score_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sale record; previous public.campaign_order_scores; row_value jsonb; target uuid; event_name text;
BEGIN
 -- A confirmed partial/full dispute refund permanently revokes this order's point.
 IF TG_TABLE_NAME='disputes' AND TG_OP<>'DELETE' THEN
  IF NEW.status='resolved' AND coalesce(NEW.refund_amount,0)>0 THEN
   UPDATE public.campaign_sale_evidence SET refund_confirmed_at=clock_timestamp()
   WHERE transaction_id=NEW.transaction_id AND refund_confirmed_at IS NULL;
  END IF;
 END IF;
 IF TG_TABLE_NAME IN ('escrow_transactions','disputes','payment_reconciliation_flags','campaign_sale_evidence') THEN
  row_value:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  target:=CASE WHEN TG_TABLE_NAME='escrow_transactions' THEN (row_value->>'id')::uuid ELSE (row_value->>'transaction_id')::uuid END;
  IF NOT EXISTS(SELECT 1 FROM public.campaign_sale_evidence WHERE transaction_id=target) THEN RETURN NULL; END IF;
 END IF;
 FOR sale IN SELECT s.* FROM public.sales_campaigns c CROSS JOIN LATERAL private.campaign_sales(c.id,target) s ORDER BY s.transaction_id LOOP
  SELECT * INTO previous FROM public.campaign_order_scores WHERE transaction_id=sale.transaction_id FOR UPDATE;
  IF NOT FOUND OR previous.qualified IS DISTINCT FROM sale.qualified OR previous.reason IS DISTINCT FROM sale.reason THEN
   INSERT INTO public.campaign_audit(campaign_id,action,subject_id,reason,before_state,after_state)
   SELECT e.campaign_id,'eligibility_changed',e.transaction_id,sale.reason,
    CASE WHEN previous.transaction_id IS NULL THEN NULL ELSE to_jsonb(previous) END,
    jsonb_build_object('qualified',sale.qualified,'reason',sale.reason)
   FROM public.campaign_sale_evidence e WHERE e.transaction_id=sale.transaction_id;
   INSERT INTO public.campaign_order_scores(transaction_id,qualified,reason) VALUES(sale.transaction_id,sale.qualified,sale.reason)
   ON CONFLICT(transaction_id) DO UPDATE SET qualified=EXCLUDED.qualified,reason=EXCLUDED.reason,updated_at=clock_timestamp();
  END IF;
 END LOOP;
 row_value:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='escrow_transactions' THEN
  target:=(row_value->>'id')::uuid;
  event_name:=CASE row_value->>'status' WHEN 'paid' THEN 'payment_received' WHEN 'shipped' THEN 'product_dispatched' WHEN 'disputed' THEN 'dispute_opened' WHEN 'cancelled' THEN 'payment_cancelled_or_refunded' ELSE 'order_state_'||(row_value->>'status') END;
 ELSIF TG_TABLE_NAME='campaign_sale_evidence' THEN
  target:=(row_value->>'transaction_id')::uuid;
  IF TG_OP='INSERT' THEN event_name:='order_created';
  ELSIF NEW.refund_confirmed_at IS DISTINCT FROM OLD.refund_confirmed_at THEN event_name:='refund_or_reversal_confirmed';
  ELSIF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN event_name:='payment_release_verified';
  ELSIF NEW.receipt_confirmed_at IS DISTINCT FROM OLD.receipt_confirmed_at THEN event_name:='buyer_confirmed_receipt';
  ELSE event_name:='manual_review_changed'; END IF;
 ELSIF TG_TABLE_NAME='disputes' THEN
  target:=(row_value->>'transaction_id')::uuid;
  event_name:=CASE WHEN (row_value->>'status') IN ('resolved','closed') THEN 'dispute_resolved' ELSE 'dispute_or_refund_requested' END;
 ELSIF TG_TABLE_NAME='payment_reconciliation_flags' THEN
  target:=(row_value->>'transaction_id')::uuid; event_name:='financial_reconciliation_changed';
 END IF;
 IF target IS NOT NULL AND EXISTS(SELECT 1 FROM public.campaign_sale_evidence WHERE transaction_id=target) THEN
  INSERT INTO public.campaign_order_events(transaction_id,event,source_hash) VALUES(target,event_name,md5(row_value::text)) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER campaign_evidence_changes AFTER INSERT OR UPDATE ON public.campaign_sale_evidence FOR EACH ROW EXECUTE FUNCTION private.refresh_campaign_score_history();
CREATE TRIGGER campaign_escrow_changes AFTER INSERT OR UPDATE OR DELETE ON public.escrow_transactions FOR EACH ROW EXECUTE FUNCTION private.refresh_campaign_score_history();
CREATE TRIGGER campaign_dispute_changes AFTER INSERT OR UPDATE OR DELETE ON public.disputes FOR EACH ROW EXECUTE FUNCTION private.refresh_campaign_score_history();
CREATE TRIGGER campaign_reconciliation_changes AFTER INSERT OR UPDATE OR DELETE ON public.payment_reconciliation_flags FOR EACH ROW EXECUTE FUNCTION private.refresh_campaign_score_history();
CREATE TRIGGER campaign_participation_changes AFTER INSERT OR UPDATE ON public.campaign_participations FOR EACH ROW EXECUTE FUNCTION private.refresh_campaign_score_history();
CREATE TRIGGER campaign_business_changes AFTER UPDATE OR DELETE ON public.businesses FOR EACH ROW EXECUTE FUNCTION private.refresh_campaign_score_history();

-- One SQL statement snapshot builds the public ranking and private own rank.
CREATE FUNCTION public.read_sales_campaign(p_actor uuid DEFAULT NULL,p_admin boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH c AS (SELECT * FROM public.sales_campaigns WHERE slug='small-businesses'),
 sales AS MATERIALIZED (SELECT s.* FROM c CROSS JOIN LATERAL private.campaign_sales(c.id) s),
 participants AS MATERIALIZED (
 SELECT p.*,b.name,coalesce(nullif(btrim(to_jsonb(b)->>'logo_url'),''),nullif(btrim(to_jsonb(b)->>'logo'),'')) logo_url,b.is_active,b.moderation_status,b.owner_id current_owner FROM public.campaign_participations p JOIN c ON c.id=p.campaign_id LEFT JOIN public.businesses b ON b.id=p.business_id
 ), counts AS (
 SELECT p.business_id,p.name,p.logo_url,count(s.transaction_id) FILTER(WHERE s.qualified)::integer total
 FROM participants p LEFT JOIN sales s ON s.business_id=p.business_id
 WHERE p.status='approved' AND p.is_active AND p.moderation_status='approved' AND p.current_owner=p.owner_id GROUP BY p.business_id,p.name,p.logo_url
 ), ranked AS (
 SELECT rank() OVER(ORDER BY total DESC)::integer rank,business_id,name,logo_url,total FROM counts
 ), entries AS (
 SELECT coalesce(jsonb_agg(jsonb_build_object('rank',rank,'businessId',business_id,'name',name,'logoUrl',logo_url,
 'profilePath','/businesses/'||business_id::text,'completedSales',total) ORDER BY total DESC,business_id),'[]'::jsonb) value FROM ranked
 ), awards AS (
 SELECT coalesce(jsonb_agg(jsonb_build_object('businessId',business_id,'amountKobo',share) ORDER BY business_id),'[]'::jsonb) value FROM (
  SELECT business_id, (50000000 / count(*) OVER()) + CASE WHEN row_number() OVER(ORDER BY business_id)<=50000000 % count(*) OVER() THEN 1 ELSE 0 END share
  FROM ranked WHERE rank=1 AND total>0
 ) winners
 ), source AS (
 SELECT md5(jsonb_build_object('rules',c.rules_version,'participants',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM participants p),'[]'::jsonb),
 'sales',coalesce((SELECT jsonb_agg(evidence ORDER BY transaction_id) FROM sales),'[]'::jsonb))::text) hash FROM c
 ), snapshot AS (
 SELECT coalesce(c.final_snapshot,jsonb_build_object('id',source.hash,'updatedAt',statement_timestamp(),'provisional',true,'entries',entries.value,'participantCount',jsonb_array_length(entries.value),'prizeAllocations',awards.value)) value,
 c.finalized_at IS NOT NULL AND c.final_source_hash IS DISTINCT FROM source.hash changed FROM c CROSS JOIN source CROSS JOIN entries CROSS JOIN awards
 ), public_result AS (
 SELECT jsonb_build_object('campaign',jsonb_build_object('id',c.id,'slug',c.slug,'title',c.title,'rulesVersion',c.rules_version,
 'status',CASE WHEN c.finalized_at IS NOT NULL THEN 'finalized' WHEN now()<c.starts_at THEN 'upcoming' WHEN now()<c.ends_at THEN 'active' ELSE 'review' END,
 'startsAt',c.starts_at,'endsAt',c.ends_at,'reviewEndsAt',c.review_ends_at,'timezone',c.timezone,'prizePoolNaira',c.prize_pool_naira,'integrityReviewRequired',snapshot.changed),
 'snapshot',snapshot.value||jsonb_build_object('entries',coalesce((SELECT jsonb_agg(value ORDER BY ord) FROM jsonb_array_elements(snapshot.value->'entries') WITH ORDINALITY a(value,ord) WHERE ord<=50),'[]'::jsonb))) value
 FROM c CROSS JOIN snapshot
 )
 SELECT public_result.value || CASE WHEN p_actor IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
  'participation',(SELECT jsonb_build_object('id',p.id,'businessId',p.business_id,'status',p.status,'approvedAt',p.approved_at,'reason',p.reason) FROM participants p WHERE p.owner_id=p_actor),
  'businesses',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'logoUrl',coalesce(nullif(btrim(to_jsonb(b)->>'logo_url'),''),nullif(btrim(to_jsonb(b)->>'logo'),''))) ORDER BY b.name,b.id)
    FROM public.businesses b WHERE b.owner_id=p_actor AND b.is_active AND b.moderation_status='approved' AND b.mode::text IN ('product','both')),'[]'::jsonb),
  'ownEntry',(SELECT a.value FROM snapshot CROSS JOIN LATERAL jsonb_array_elements(snapshot.value->'entries') a(value) JOIN participants p ON p.business_id::text=a.value->>'businessId' WHERE p.owner_id=p_actor),
  'snapshotId',snapshot.value->>'id','updatedAt',snapshot.value->'updatedAt') END
 || CASE WHEN p_admin AND EXISTS(SELECT 1 FROM public.users WHERE id=p_actor AND is_admin) THEN jsonb_build_object(
  'participants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'businessId',p.business_id,'ownerId',p.owner_id,'name',p.name,'status',p.status,'approvedAt',p.approved_at,'createdAt',p.created_at,'reason',p.reason) ORDER BY p.created_at DESC) FROM participants p),'[]'::jsonb),
  'sales',coalesce((SELECT jsonb_agg(jsonb_build_object('transactionId',s.transaction_id,'businessId',s.business_id,'businessName',s.business_name,'buyerId',s.buyer_id,'sellerId',s.seller_id,
   'createdAt',s.created_at,'completedAt',s.completed_at,'environment',s.environment,'qualified',s.qualified,'reason',s.reason,'manualHold',s.manual_hold,'reviewRequired',s.review_required,'suspicionSignals',private.campaign_suspicion(s.transaction_id),'events',coalesce((SELECT jsonb_agg(jsonb_build_object('event',ce.event,'observedAt',ce.observed_at) ORDER BY ce.observed_at) FROM public.campaign_order_events ce WHERE ce.transaction_id=s.transaction_id),'[]'::jsonb)) ORDER BY s.created_at DESC) FROM sales s),'[]'::jsonb),
  'audit',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'actorId',a.actor_id,'action',a.action,'subjectId',a.subject_id,'reason',a.reason,'createdAt',a.created_at) ORDER BY a.created_at DESC) FROM public.campaign_audit a JOIN c ON c.id=a.campaign_id),'[]'::jsonb),
  'prizeRecords',coalesce((SELECT jsonb_agg(jsonb_build_object('id',pr.id,'businessId',pr.business_id,'kind',pr.kind,'status',pr.status,'amountKobo',pr.amount_kobo,'reference',pr.reference,'reason',pr.reason,'actorId',pr.actor_id,'createdAt',pr.created_at) ORDER BY pr.created_at DESC) FROM public.campaign_prize_records pr JOIN c ON c.id=pr.campaign_id),'[]'::jsonb),
  'canFinalize',c.finalized_at IS NULL AND now()>=c.review_ends_at AND NOT EXISTS(SELECT 1 FROM sales WHERE review_required)
 ) ELSE '{}'::jsonb END
 FROM c CROSS JOIN snapshot CROSS JOIN public_result;
$$;

CREATE FUNCTION public.admin_sales_campaign(p_actor uuid,p_action text,p_subject uuid,p_reason text,p_expected_snapshot_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.sales_campaigns; p public.campaign_participations; e public.campaign_sale_evidence; before_value jsonb; after_value jsonb; preview jsonb; final_entries jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor AND is_admin) THEN RAISE EXCEPTION 'Admin access required'; END IF;
 IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'A recorded reason is required'; END IF;
 SELECT * INTO c FROM public.sales_campaigns WHERE slug='small-businesses' FOR UPDATE;
 IF c.finalized_at IS NOT NULL THEN RAISE EXCEPTION 'Final results are immutable; investigate any new review flag'; END IF;
 IF p_action IN ('approve','reject','suspend','disqualify') THEN
  SELECT * INTO p FROM public.campaign_participations WHERE id=p_subject AND campaign_id=c.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;
  IF p_action='approve' AND (clock_timestamp()>=c.ends_at OR NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=p.business_id AND owner_id=p.owner_id AND is_active AND moderation_status='approved' AND mode::text IN ('product','both'))) THEN
   RAISE EXCEPTION 'Business cannot be approved'; END IF;
  before_value:=to_jsonb(p);
  UPDATE public.campaign_participations SET status=CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' WHEN 'disqualify' THEN 'disqualified' ELSE 'suspended' END,
   reason=trim(p_reason),approved_at=CASE WHEN p_action='approve' THEN coalesce(approved_at,clock_timestamp()) ELSE approved_at END WHERE id=p.id RETURNING to_jsonb(campaign_participations.*) INTO after_value;
 ELSIF p_action IN ('hold','clear') THEN
  SELECT * INTO e FROM public.campaign_sale_evidence WHERE transaction_id=p_subject AND campaign_id=c.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign sale not found'; END IF;
  before_value:=to_jsonb(e);
  UPDATE public.campaign_sale_evidence SET manual_hold=p_action='hold',hold_reason=trim(p_reason) WHERE transaction_id=e.transaction_id RETURNING to_jsonb(campaign_sale_evidence.*) INTO after_value;
 ELSIF p_action='finalize' THEN
  -- Financial writers do not take the campaign lock. SHARE locks prevent any source
  -- mutation between the reviewed hash comparison and saving the final snapshot.
  -- Never wait while holding one source lock against an active financial writer.
  -- A busy source aborts this review attempt, which can be retried from a fresh preview.
  LOCK TABLE public.escrow_transactions,public.disputes,public.payment_reconciliation_flags,public.businesses,public.campaign_participations,public.campaign_sale_evidence IN SHARE MODE NOWAIT;
  preview:=public.read_sales_campaign(p_actor,true);
  IF NOT (preview->>'canFinalize')::boolean THEN RAISE EXCEPTION 'Review period or unresolved sales prevent finalization'; END IF;
  IF p_expected_snapshot_id IS NULL OR p_expected_snapshot_id IS DISTINCT FROM preview#>>'{snapshot,id}' THEN RAISE EXCEPTION 'Results changed; review the latest snapshot'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('rank',r.rank,'businessId',r.business_id,'name',r.name,'logoUrl',r.logo_url,
   'profilePath','/businesses/'||r.business_id::text,'completedSales',r.total) ORDER BY r.total DESC,r.business_id),'[]'::jsonb) INTO final_entries
  FROM (SELECT count(s.transaction_id) FILTER(WHERE s.qualified)::integer total,rank() OVER(ORDER BY count(s.transaction_id) FILTER(WHERE s.qualified) DESC)::integer rank,b.id business_id,b.name,coalesce(nullif(btrim(to_jsonb(b)->>'logo_url'),''),nullif(btrim(to_jsonb(b)->>'logo'),'')) logo_url
   FROM public.campaign_participations cp JOIN public.businesses b ON b.id=cp.business_id
   LEFT JOIN private.campaign_sales(c.id) s ON s.business_id=b.id WHERE cp.campaign_id=c.id AND cp.status='approved' AND b.is_active AND b.moderation_status='approved' AND b.owner_id=cp.owner_id
   GROUP BY b.id,b.name) r;
  before_value:=preview->'snapshot';
  after_value:=before_value||jsonb_build_object('entries',final_entries,'provisional',false,'updatedAt',clock_timestamp());
  UPDATE public.sales_campaigns SET final_snapshot=after_value,final_source_hash=p_expected_snapshot_id,finalized_at=clock_timestamp() WHERE id=c.id;
 ELSE RAISE EXCEPTION 'Unknown campaign action'; END IF;
 INSERT INTO public.campaign_audit(campaign_id,actor_id,action,subject_id,reason,before_state,after_state)
 VALUES(c.id,p_actor,p_action,p_subject,trim(p_reason),before_value,after_value);
 RETURN public.read_sales_campaign(p_actor,true);
END $$;


CREATE FUNCTION public.record_campaign_prize(p_actor uuid,p_business_id uuid,p_kind text,p_status text,p_reason text,p_amount_kobo bigint DEFAULT NULL,p_reference text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.sales_campaigns; allocation jsonb; saved public.campaign_prize_records;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor AND is_admin) THEN RAISE EXCEPTION 'Admin access required'; END IF;
 SELECT * INTO c FROM public.sales_campaigns WHERE slug='small-businesses' FOR UPDATE;
 IF c.finalized_at IS NULL OR (public.read_sales_campaign(p_actor,true)#>>'{campaign,integrityReviewRequired}')::boolean THEN RAISE EXCEPTION 'Reviewed final results are required'; END IF;
 SELECT value INTO allocation FROM jsonb_array_elements(c.final_snapshot->'prizeAllocations') WHERE value->>'businessId'=p_business_id::text;
 IF allocation IS NULL THEN RAISE EXCEPTION 'Business has no first-place prize allocation'; END IF;
 IF p_kind='payment' THEN
  IF p_amount_kobo IS DISTINCT FROM (allocation->>'amountKobo')::bigint THEN RAISE EXCEPTION 'Amount must match the approved kobo allocation'; END IF;
  IF (SELECT status FROM public.campaign_prize_records WHERE campaign_id=c.id AND business_id=p_business_id AND kind='verification' ORDER BY created_at DESC,id DESC LIMIT 1) IS DISTINCT FROM 'verified' THEN RAISE EXCEPTION 'Winner verification required'; END IF;
 END IF;
 INSERT INTO public.campaign_prize_records(campaign_id,business_id,kind,status,amount_kobo,reference,reason,actor_id)
 VALUES(c.id,p_business_id,p_kind,p_status,p_amount_kobo,p_reference,trim(p_reason),p_actor) RETURNING * INTO saved;
 INSERT INTO public.campaign_audit(campaign_id,actor_id,action,subject_id,reason,after_state) VALUES(c.id,p_actor,'prize_'||p_kind,p_business_id,trim(p_reason),to_jsonb(saved));
 RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION private.guard_campaign_append_only(),private.refresh_campaign_score_history(),private.campaign_suspicion(uuid),public.record_campaign_refund(uuid),public.record_campaign_prize(uuid,uuid,text,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.campaign_suspicion(uuid),public.record_campaign_refund(uuid),public.record_campaign_prize(uuid,uuid,text,text,text,bigint,text) TO service_role;

REVOKE ALL ON FUNCTION private.guard_campaign_history(),private.campaign_sales(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.campaign_sales(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.enroll_sales_campaign(uuid,uuid,text),public.capture_campaign_order(uuid,text),public.begin_campaign_receipt(uuid,uuid),public.finish_campaign_receipt(uuid,uuid,text,text,timestamptz,text),public.read_sales_campaign(uuid,boolean),public.admin_sales_campaign(uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_sales_campaign(uuid,uuid,text),public.capture_campaign_order(uuid,text),public.begin_campaign_receipt(uuid,uuid),public.finish_campaign_receipt(uuid,uuid,text,text,timestamptz,text),public.read_sales_campaign(uuid,boolean),public.admin_sales_campaign(uuid,text,uuid,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
