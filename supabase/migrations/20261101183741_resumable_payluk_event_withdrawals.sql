-- Additive, service-only checkpoints. Applying this migration requires separate authorization.
ALTER TABLE public.payluk_event_withdrawals
 ADD COLUMN processing_token uuid,
 ADD COLUMN processing_until timestamptz,
 ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN bank_fingerprint text,
 ADD COLUMN transfer_started_at timestamptz;
ALTER TABLE public.payluk_event_allocations
 ADD COLUMN release_status text NOT NULL DEFAULT 'queued' CHECK(release_status IN ('queued','claiming','released','review')),
 ADD COLUMN released_at timestamptz;
-- Prior ambiguous submissions have no bank snapshot/checkpoints and require review.
UPDATE public.payluk_event_withdrawals SET status='review',updated_at=now() WHERE status IN ('reserved','submitting') AND provider_reference IS NULL;
CREATE TABLE public.payluk_event_worker_clock (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), next_allowed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.payluk_event_worker_clock(id) VALUES(true);
ALTER TABLE public.payluk_event_worker_clock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payluk_event_worker_clock FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.payluk_event_worker_clock TO service_role;
CREATE FUNCTION public.lease_payluk_event_withdrawal(p_reference text,p_owner uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.payluk_event_withdrawals%ROWTYPE; clock_at timestamptz;
BEGIN
 SELECT * INTO w FROM public.payluk_event_withdrawals WHERE reference=p_reference AND organizer_id=p_owner FOR UPDATE;
 IF NOT FOUND OR w.domain<>'test' OR w.status NOT IN ('reserved','submitting','pending')
 OR w.next_attempt_at>now() OR w.processing_until>now() THEN RETURN NULL; END IF;
 SELECT next_allowed_at INTO clock_at FROM public.payluk_event_worker_clock WHERE id=true FOR UPDATE;
 IF clock_at>now() THEN RETURN NULL; END IF;
 UPDATE public.payluk_event_worker_clock SET next_allowed_at=now()+interval '2 minutes' WHERE id=true;
 UPDATE public.payluk_event_withdrawals SET processing_token=p_token,processing_until=now()+interval '2 minutes',
 next_attempt_at=now()+interval '1 minute',status=CASE WHEN status='reserved' THEN 'submitting' ELSE status END,updated_at=now()
 WHERE id=w.id RETURNING * INTO w;
 RETURN to_jsonb(w);
END $$;
CREATE FUNCTION public.checkpoint_payluk_event_release(p_withdrawal uuid,p_token uuid,p_transaction uuid,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.payluk_event_withdrawals WHERE id=p_withdrawal AND processing_token=p_token AND processing_until>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_status NOT IN ('claiming','released','review') THEN RAISE EXCEPTION 'invalid_release_checkpoint'; END IF;
 UPDATE public.payluk_event_allocations SET release_status=p_status,released_at=CASE WHEN p_status='released' THEN now() ELSE released_at END
 WHERE withdrawal_id=p_withdrawal AND transaction_id=p_transaction
 AND (release_status='queued' OR (release_status='claiming' AND p_status IN ('released','review')));
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.lease_payluk_event_withdrawal(text,uuid,uuid),public.checkpoint_payluk_event_release(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lease_payluk_event_withdrawal(text,uuid,uuid),public.checkpoint_payluk_event_release(uuid,uuid,uuid,text) TO service_role;
