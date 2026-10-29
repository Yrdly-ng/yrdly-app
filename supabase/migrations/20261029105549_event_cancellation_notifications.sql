-- Cancellation, ticket invalidation and durable notifications commit together.
-- Each channel/destination is independent so retrying email never resends a sent push.
CREATE TABLE public.event_cancellation_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  event_title text NOT NULL,
  attendee_name text NOT NULL,
  start_time timestamptz,
  event_location text NOT NULL,
  email text,
  channel text NOT NULL CHECK (channel IN ('push','email')),
  recipient_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','review')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  locked_until timestamptz,
  first_attempt_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, channel, recipient_key),
  CHECK ((channel = 'push' AND email IS NULL AND recipient_key = buyer_id::text)
    OR (channel = 'email' AND email IS NOT NULL AND recipient_key = email AND email = lower(btrim(email)) AND email <> ''))
);
CREATE INDEX event_cancellation_deliveries_due_idx
  ON public.event_cancellation_deliveries (retry_at)
  WHERE status IN ('pending','processing');
ALTER TABLE public.event_cancellation_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_cancellation_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_cancellation_deliveries TO service_role;
COMMENT ON TABLE public.event_cancellation_deliveries IS 'Private immutable cancellation recipient snapshots with durable per-channel delivery progress. No refund is initiated by this queue.';

-- The existing BEFORE trigger locks the tier and accounts for sold/reserved seats.
-- Checking the event afterwards preserves that lock order and closes the free
-- ticket race between the HTTP availability check and ticket insertion.
CREATE FUNCTION public.guard_active_ticket_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('PAID','USED') THEN
    PERFORM 1 FROM public.events WHERE id = NEW.event_id AND status = 'PUBLISHED' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ticket_event_unavailable'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_active_ticket_event AFTER INSERT ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.guard_active_ticket_event();
REVOKE ALL ON FUNCTION public.guard_active_ticket_event() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.cancel_event_with_notifications(p_event_id uuid, p_organizer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_buyer record;
  v_notification uuid;
  v_already_cancelled boolean;
  v_notifications integer := 0;
  v_new_buyers uuid[] := ARRAY[]::uuid[];
BEGIN
  -- Match ticket issuance's tier -> event order, then lock tickets before checks.
  PERFORM 1 FROM public.ticket_tiers WHERE event_id = p_event_id ORDER BY id FOR UPDATE;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'event_not_found'; END IF;
  IF p_organizer_id IS NULL OR v_event.organizer_id IS DISTINCT FROM p_organizer_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'event_cancellation_forbidden';
  END IF;
  v_already_cancelled := v_event.status = 'CANCELLED';
  PERFORM 1 FROM public.tickets WHERE event_id = p_event_id ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE event_id = p_event_id AND status = 'USED') THEN
    RAISE EXCEPTION 'event_cancellation_checked_in_tickets';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE event_id = p_event_id AND status = 'PAID' AND coalesce(amount_paid,1) <> 0) THEN
    RAISE EXCEPTION 'event_cancellation_paid_tickets';
  END IF;

  UPDATE public.tickets SET status = 'REFUNDED', refund_status = 'processed', updated_at = now()
  WHERE event_id = p_event_id AND status = 'PAID' AND amount_paid = 0;
  IF NOT v_already_cancelled THEN
    -- Retains guard_paid_event_cancellation as a second database-level safeguard.
    UPDATE public.events SET status = 'CANCELLED', updated_at = now() WHERE id = p_event_id;
  END IF;

  -- Including refunded tickets reaches paying attendees after their refunds have
  -- cleared. A repeated explicit cancel also repairs pre-rollout missing notices.
  FOR v_buyer IN
    SELECT DISTINCT t.buyer_id, coalesce(nullif(btrim(u.name),''),'Guest') AS name
    FROM public.tickets t JOIN public.users u ON u.id = t.buyer_id
    WHERE t.event_id = p_event_id AND t.status = 'REFUNDED'
    ORDER BY t.buyer_id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.event_cancellation_deliveries
      WHERE event_id = p_event_id AND channel = 'push' AND recipient_key = v_buyer.buyer_id::text) THEN
      INSERT INTO public.notifications(user_id,type,title,message,sender_id,related_id,related_type,data)
      VALUES (v_buyer.buyer_id,'event_cancelled','Event cancelled',
        '“' || v_event.title || '” has been cancelled. Open your tickets for details.',
        p_organizer_id,p_event_id,'event',jsonb_build_object('eventId',p_event_id,'eventTitle',v_event.title,'url','/my-tickets'))
      RETURNING id INTO v_notification;
      INSERT INTO public.event_cancellation_deliveries
        (event_id,buyer_id,notification_id,event_title,attendee_name,start_time,event_location,channel,recipient_key)
      VALUES (p_event_id,v_buyer.buyer_id,v_notification,v_event.title,v_buyer.name,v_event.start_time,
        coalesce(nullif(v_event.location_address,''),nullif(v_event.state,''),'See event details'),'push',v_buyer.buyer_id::text);
      v_notifications := v_notifications + 1;
      v_new_buyers := array_append(v_new_buyers,v_buyer.buyer_id);
    END IF;
  END LOOP;

  -- One email per normalized attendee address; fall back to the account email
  -- only when that buyer has no attendee addresses. DISTINCT ON picks a stable
  -- snapshot if different buyers used the same address for their tickets.
  INSERT INTO public.event_cancellation_deliveries
    (event_id,buyer_id,notification_id,event_title,attendee_name,start_time,event_location,email,channel,recipient_key)
  SELECT p_event_id,r.buyer_id,d.notification_id,v_event.title,r.name,v_event.start_time,
    coalesce(nullif(v_event.location_address,''),nullif(v_event.state,''),'See event details'),r.email,'email',r.email
  FROM (
    SELECT DISTINCT ON (email) buyer_id,name,email FROM (
      SELECT t.buyer_id,coalesce(nullif(btrim(t.attendee_name),''),nullif(btrim(u.name),''),'Guest') AS name,
        lower(btrim(t.attendee_email)) AS email
      FROM public.tickets t JOIN public.users u ON u.id = t.buyer_id
      WHERE t.event_id = p_event_id AND t.status = 'REFUNDED' AND nullif(btrim(t.attendee_email),'') IS NOT NULL
      UNION ALL
      SELECT DISTINCT t.buyer_id,coalesce(nullif(btrim(u.name),''),'Guest'),lower(btrim(u.email))
      FROM public.tickets t JOIN public.users u ON u.id = t.buyer_id
      WHERE t.event_id = p_event_id AND t.status = 'REFUNDED' AND nullif(btrim(u.email),'') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.tickets x WHERE x.event_id = p_event_id AND x.buyer_id = t.buyer_id
          AND x.status = 'REFUNDED' AND nullif(btrim(x.attendee_email),'') IS NOT NULL)
    ) recipients ORDER BY email,buyer_id,name
  ) r JOIN public.event_cancellation_deliveries d
    ON d.event_id = p_event_id AND d.channel = 'push' AND d.recipient_key = r.buyer_id::text
  WHERE r.buyer_id = ANY(v_new_buyers)
  ON CONFLICT (event_id,channel,recipient_key) DO NOTHING;

  RETURN jsonb_build_object('success',true,'alreadyCancelled',v_already_cancelled,
    'refundsRequested',0,'notificationsQueued',v_notifications);
END $$;
REVOKE ALL ON FUNCTION public.cancel_event_with_notifications(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_with_notifications(uuid,uuid) TO service_role;
