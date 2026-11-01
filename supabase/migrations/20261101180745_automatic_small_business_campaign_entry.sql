-- Automatically include every eligible Businessplace product business.
-- This changes participation, not the evidence required to count a completed sale.
BEGIN;

ALTER TABLE public.campaign_participations
  ALTER COLUMN status SET DEFAULT 'approved';
ALTER TABLE public.campaign_participations
  DROP CONSTRAINT IF EXISTS campaign_participations_campaign_id_owner_id_key;

-- Enrollment/approval is no longer a campaign concept. Existing eligible
-- directory businesses are backfilled, and a trigger keeps new ones included.
DROP TRIGGER IF EXISTS campaign_participation_immutable ON public.campaign_participations;
DROP FUNCTION IF EXISTS public.enroll_sales_campaign(uuid,uuid,text);

CREATE OR REPLACE FUNCTION private.sync_small_business_campaign_business()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE campaign public.sales_campaigns;
BEGIN
  SELECT * INTO campaign FROM public.sales_campaigns
    WHERE slug='small-businesses' AND finalized_at IS NULL;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.is_active AND NEW.moderation_status='approved'
     AND NEW.mode::text IN ('product','both') AND NEW.owner_id IS NOT NULL
     AND NEW.created_at<campaign.ends_at THEN
    INSERT INTO public.campaign_participations(campaign_id,business_id,owner_id,status,rules_version,accepted_at,created_at,approved_at)
    VALUES(campaign.id,NEW.id,NEW.owner_id,'approved',campaign.rules_version,campaign.starts_at,NEW.created_at,campaign.starts_at)
    ON CONFLICT(campaign_id,business_id) DO UPDATE
      SET owner_id=EXCLUDED.owner_id,status='approved',rules_version=campaign.rules_version,
          approved_at=campaign.starts_at,reason=NULL;
  ELSE
    UPDATE public.campaign_participations SET status='suspended',reason='Business is not currently eligible for Businessplace'
      WHERE campaign_id=campaign.id AND business_id=NEW.id AND status='approved';
  END IF;
  RETURN NEW;
END $$;

-- The business write may be authenticated; only this private trigger may write the service-only campaign tables.
REVOKE ALL ON FUNCTION private.sync_small_business_campaign_business() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER small_business_campaign_auto_entry
AFTER INSERT OR UPDATE OF owner_id,is_active,moderation_status,mode ON public.businesses
FOR EACH ROW EXECUTE FUNCTION private.sync_small_business_campaign_business();

INSERT INTO public.campaign_participations(campaign_id,business_id,owner_id,status,rules_version,accepted_at,created_at,approved_at)
SELECT c.id,b.id,b.owner_id,'approved',c.rules_version,c.starts_at,b.created_at,c.starts_at
FROM public.sales_campaigns c CROSS JOIN public.businesses b
WHERE c.slug='small-businesses' AND c.finalized_at IS NULL
  AND b.owner_id IS NOT NULL AND b.is_active AND b.moderation_status='approved'
  AND b.mode::text IN ('product','both') AND b.created_at<c.ends_at
ON CONFLICT(campaign_id,business_id) DO UPDATE
  SET owner_id=EXCLUDED.owner_id,status='approved',rules_version=EXCLUDED.rules_version,
      approved_at=EXCLUDED.approved_at,reason=NULL;

-- Participation status is maintained automatically from directory eligibility,
-- never decided by a campaign application or admin approval.
CREATE OR REPLACE FUNCTION private.guard_campaign_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
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
 ELSIF TG_TABLE_NAME='sales_campaigns' THEN
  IF (to_jsonb(NEW)-ARRAY['final_snapshot','final_source_hash','finalized_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['final_snapshot','final_source_hash','finalized_at'])
    OR OLD.finalized_at IS NOT NULL THEN RAISE EXCEPTION 'Campaign rules and finalized results are immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;

-- Rebuild the one authoritative read with all current eligible businesses.
CREATE OR REPLACE FUNCTION public.read_sales_campaign(p_actor uuid DEFAULT NULL,p_admin boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH c AS (SELECT * FROM public.sales_campaigns WHERE slug='small-businesses'),
 sales AS MATERIALIZED (SELECT s.* FROM c CROSS JOIN LATERAL private.campaign_sales(c.id) s),
 participants AS MATERIALIZED (
  SELECT p.*,b.name,coalesce(nullif(btrim(to_jsonb(b)->>'logo_url'),''),nullif(btrim(to_jsonb(b)->>'logo'),'')) logo_url,
   b.is_active,b.moderation_status,b.owner_id current_owner,b.mode::text business_mode
  FROM public.campaign_participations p JOIN c ON c.id=p.campaign_id
  LEFT JOIN public.businesses b ON b.id=p.business_id
 ),
 counts AS (
  SELECT p.business_id,p.name,p.logo_url,count(s.transaction_id) FILTER(WHERE s.qualified)::integer total
  FROM participants p LEFT JOIN sales s ON s.business_id=p.business_id
  WHERE p.status='approved' AND p.is_active AND p.moderation_status='approved'
    AND p.business_mode IN ('product','both') AND p.current_owner=p.owner_id
  GROUP BY p.business_id,p.name,p.logo_url
 ),
 ranked AS (SELECT rank() OVER(ORDER BY total DESC)::integer rank,business_id,name,logo_url,total FROM counts),
 entries AS (SELECT coalesce(jsonb_agg(jsonb_build_object('rank',rank,'businessId',business_id,'name',name,'logoUrl',logo_url,
  'profilePath','/businesses/'||business_id::text,'completedSales',total) ORDER BY total DESC,business_id),'[]'::jsonb) value FROM ranked),
 awards AS (SELECT coalesce(jsonb_agg(jsonb_build_object('businessId',business_id,'amountKobo',share) ORDER BY business_id),'[]'::jsonb) value FROM (
  SELECT business_id,(50000000/count(*) OVER())+CASE WHEN row_number() OVER(ORDER BY business_id)<=50000000%count(*) OVER() THEN 1 ELSE 0 END share
  FROM ranked WHERE rank=1 AND total>0) winners),
 source AS (SELECT md5(jsonb_build_object('rules',c.rules_version,'participants',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM participants p), '[]'::jsonb),
  'sales',coalesce((SELECT jsonb_agg(evidence ORDER BY transaction_id) FROM sales),'[]'::jsonb))::text) hash FROM c),
 snapshot AS (SELECT coalesce(c.final_snapshot,jsonb_build_object('id',source.hash,'updatedAt',statement_timestamp(),'provisional',true,
  'entries',entries.value,'participantCount',jsonb_array_length(entries.value),'prizeAllocations',awards.value)) value,
  c.finalized_at IS NOT NULL AND c.final_source_hash IS DISTINCT FROM source.hash changed FROM c CROSS JOIN source CROSS JOIN entries CROSS JOIN awards),
 public_result AS (SELECT jsonb_build_object('campaign',jsonb_build_object('id',c.id,'slug',c.slug,'title',c.title,'rulesVersion',c.rules_version,
  'status',CASE WHEN c.finalized_at IS NOT NULL THEN 'finalized' WHEN now()<c.starts_at THEN 'upcoming' WHEN now()<c.ends_at THEN 'active' ELSE 'review' END,
  'startsAt',c.starts_at,'endsAt',c.ends_at,'reviewEndsAt',c.review_ends_at,'timezone',c.timezone,'prizePoolNaira',c.prize_pool_naira,'integrityReviewRequired',snapshot.changed),
  'snapshot',snapshot.value||jsonb_build_object('entries',coalesce((SELECT jsonb_agg(value ORDER BY ord) FROM jsonb_array_elements(snapshot.value->'entries') WITH ORDINALITY a(value,ord) WHERE ord<=50),'[]'::jsonb))) value
  FROM c CROSS JOIN snapshot)
 SELECT public_result.value || CASE WHEN p_actor IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
  'businesses',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'logoUrl',coalesce(nullif(btrim(to_jsonb(b)->>'logo_url'),''),nullif(btrim(to_jsonb(b)->>'logo'),''))) ORDER BY b.name,b.id)
   FROM public.businesses b WHERE b.owner_id=p_actor AND b.is_active AND b.moderation_status='approved' AND b.mode::text IN ('product','both')),'[]'::jsonb),
  'ownEntries',coalesce((SELECT jsonb_agg(a.value ORDER BY (a.value->>'rank')::integer) FROM snapshot CROSS JOIN LATERAL jsonb_array_elements(snapshot.value->'entries') a(value)
    JOIN participants p ON p.business_id::text=a.value->>'businessId' WHERE p.owner_id=p_actor AND p.current_owner=p.owner_id),'[]'::jsonb),
  'snapshotId',snapshot.value->>'id','updatedAt',snapshot.value->'updatedAt') END
 || CASE WHEN p_admin AND EXISTS(SELECT 1 FROM public.users WHERE id=p_actor AND is_admin) THEN jsonb_build_object(
  'participants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'businessId',p.business_id,'ownerId',p.owner_id,'name',p.name,'status',p.status,'createdAt',p.created_at) ORDER BY p.created_at DESC) FROM participants p),'[]'::jsonb),
  'sales',coalesce((SELECT jsonb_agg(jsonb_build_object('transactionId',s.transaction_id,'businessId',s.business_id,'businessName',s.business_name,'buyerId',s.buyer_id,'sellerId',s.seller_id,
   'createdAt',s.created_at,'completedAt',s.completed_at,'environment',s.environment,'qualified',s.qualified,'reason',s.reason,'reviewRequired',s.review_required,
   'suspicionSignals',private.campaign_suspicion(s.transaction_id),'events',coalesce((SELECT jsonb_agg(jsonb_build_object('event',ce.event,'observedAt',ce.observed_at) ORDER BY ce.observed_at)
   FROM public.campaign_order_events ce WHERE ce.transaction_id=s.transaction_id),'[]'::jsonb)) ORDER BY s.created_at DESC) FROM sales s),'[]'::jsonb),
  'audit',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'actorId',a.actor_id,'action',a.action,'subjectId',a.subject_id,'reason',a.reason,'createdAt',a.created_at) ORDER BY a.created_at DESC) FROM public.campaign_audit a JOIN c ON c.id=a.campaign_id),'[]'::jsonb),
  'prizeRecords',coalesce((SELECT jsonb_agg(jsonb_build_object('id',pr.id,'businessId',pr.business_id,'kind',pr.kind,'status',pr.status,'amountKobo',pr.amount_kobo,'reference',pr.reference,'reason',pr.reason,'actorId',pr.actor_id,'createdAt',pr.created_at) ORDER BY pr.created_at DESC) FROM public.campaign_prize_records pr JOIN c ON c.id=pr.campaign_id),'[]'::jsonb),
  'canFinalize',c.finalized_at IS NULL AND now()>=c.review_ends_at AND NOT EXISTS(SELECT 1 FROM sales WHERE review_required)
 ) ELSE '{}'::jsonb END
 FROM c CROSS JOIN snapshot CROSS JOIN public_result;
$$;

-- Admin monitoring is read-only during the campaign. Keep the function available
-- only for final review/prize actions, not enrollment decisions or score edits.
REVOKE ALL ON FUNCTION public.read_sales_campaign(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_campaign(uuid,boolean) TO service_role;

COMMIT;
