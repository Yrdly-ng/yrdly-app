-- Apply after the 2026100302 group-conversation migration.
-- The client may request moderation, but only database policy decides what is public.

-- Booking checkout now records the escrow identity used by signed Payluk events.
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS payluk_escrow_id text,
  ADD COLUMN IF NOT EXISTS payluk_payment_token text;
CREATE UNIQUE INDEX IF NOT EXISTS booking_payments_payluk_escrow_id_key
  ON public.booking_payments(payluk_escrow_id) WHERE payluk_escrow_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS booking_payments_payluk_payment_token_key
  ON public.booking_payments(payluk_payment_token) WHERE payluk_payment_token IS NOT NULL;

-- One automatic payout record per completed marketplace transaction.
ALTER TABLE public.payout_requests ADD COLUMN IF NOT EXISTS transaction_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS payout_requests_transaction_id_key
  ON public.payout_requests(transaction_id) WHERE transaction_id IS NOT NULL;

-- Customers must not be able to write their own estimate through the Data API.
DROP POLICY IF EXISTS "customer crud own quotes" ON public.quote_requests;
CREATE POLICY "customer read own quotes" ON public.quote_requests FOR SELECT TO authenticated
  USING (customer_id = auth.uid());
CREATE POLICY "customer create own quotes" ON public.quote_requests FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());
CREATE POLICY "customer update own quotes" ON public.quote_requests FOR UPDATE TO authenticated
  USING (customer_id = auth.uid()) WITH CHECK (customer_id = auth.uid());
CREATE POLICY "customer delete draft quotes" ON public.quote_requests FOR DELETE TO authenticated
  USING (customer_id = auth.uid() AND status IN ('pending', 'rejected', 'expired', 'cancelled'));

CREATE OR REPLACE FUNCTION public.guard_quote_request_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id uuid := auth.uid();
  provider_id uuid;
BEGIN
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  SELECT owner_id INTO provider_id FROM public.businesses WHERE id = NEW.business_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.customer_id IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'Invalid quote customer'; END IF;
    NEW.status := 'pending';
    NEW.estimated_price := NULL;
    NEW.estimated_duration_minutes := NULL;
    NEW.estimate_notes := NULL;
    NEW.expires_at := NULL;
    NEW.converted_booking_id := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Quote identity cannot be changed';
  END IF;

  IF actor_id = OLD.customer_id THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'converted_booking_id', 'updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'converted_booking_id', 'updated_at']) THEN
      RAISE EXCEPTION 'Only the provider may change a quote estimate';
    END IF;
    IF (OLD.status = 'estimated' AND NEW.status IN ('accepted', 'rejected'))
       OR (OLD.status IN ('pending', 'estimated') AND NEW.status = 'cancelled') THEN
      IF NEW.converted_booking_id IS DISTINCT FROM OLD.converted_booking_id THEN
        RAISE EXCEPTION 'Cannot link a booking in this status';
      END IF;
    ELSIF OLD.status = 'accepted' AND NEW.status = 'converted'
       AND NEW.converted_booking_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.bookings b
                   WHERE b.id = NEW.converted_booking_id AND b.quote_id = OLD.id
                     AND b.customer_id = actor_id) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Invalid quote status transition';
    END IF;
  ELSIF actor_id = provider_id THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'estimated_price', 'estimated_duration_minutes', 'estimate_notes', 'expires_at', 'updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'estimated_price', 'estimated_duration_minutes', 'estimate_notes', 'expires_at', 'updated_at'])
       OR OLD.status NOT IN ('pending', 'estimated') OR NEW.status <> 'estimated'
       OR NEW.estimated_price IS NULL OR NEW.estimated_price < 1000 THEN
      RAISE EXCEPTION 'Provider may only submit a valid estimate';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not allowed to change this quote';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_quote_request_write ON public.quote_requests;
CREATE TRIGGER tr_guard_quote_request_write
BEFORE INSERT OR UPDATE ON public.quote_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_quote_request_write();

-- Booking payment state is set by the signed payment webhook, not by browsers.
CREATE OR REPLACE FUNCTION public.guard_booking_payment_and_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id uuid := auth.uid();
  provider_id uuid;
  requires_payment boolean;
BEGIN
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  SELECT owner_id INTO provider_id FROM public.businesses WHERE id = OLD.business_id;
  IF actor_id IS DISTINCT FROM OLD.customer_id AND actor_id IS DISTINCT FROM provider_id THEN
    RAISE EXCEPTION 'Only the booking parties may change this booking';
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id THEN
    RAISE EXCEPTION 'Booking identity and payment state cannot be changed by a user';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status NOT IN ('confirmed', 'completed', 'no_show', 'cancelled', 'late_cancelled')
       OR (NEW.status = 'confirmed' AND OLD.status <> 'requested')
       OR (NEW.status IN ('completed', 'no_show') AND OLD.status <> 'confirmed')
       OR (NEW.status IN ('cancelled', 'late_cancelled') AND OLD.status NOT IN ('requested', 'confirmed')) THEN
      RAISE EXCEPTION 'Invalid booking status transition';
    END IF;
    IF NEW.status IN ('cancelled', 'late_cancelled')
       AND OLD.payment_status IN ('deposit_paid', 'fully_paid', 'escrow_held', 'escrow_released') THEN
      RAISE EXCEPTION 'Paid booking cancellation requires assisted refund';
    END IF;
    IF NEW.status IN ('confirmed', 'completed') AND actor_id IS DISTINCT FROM provider_id THEN
      RAISE EXCEPTION 'Only the provider may confirm or complete a booking';
    END IF;
    IF NEW.status = 'confirmed' THEN
      SELECT (deposit_required OR requires_full_payment OR escrow_enabled)
        INTO requires_payment FROM public.service_offerings WHERE id = OLD.service_id;
      IF (requires_payment OR OLD.quote_id IS NOT NULL)
         AND OLD.payment_status NOT IN ('deposit_paid', 'fully_paid', 'escrow_held', 'escrow_released') THEN
        RAISE EXCEPTION 'Payment is required before confirming this booking';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_booking_payment_and_status ON public.bookings;
CREATE TRIGGER tr_guard_booking_payment_and_status
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.guard_booking_payment_and_status();

-- Ticket inserts and capacity changes must commit in the same transaction.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS refund_status text,
  ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_refund_status_launch_check') THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_refund_status_launch_check
      CHECK (refund_status IS NULL OR refund_status IN
        ('initiating', 'pending', 'processing', 'needs-attention', 'failed', 'processed'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_ticket_client_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id uuid := auth.uid();
  v_organizer_id uuid;
BEGIN
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.refund_status IS DISTINCT FROM OLD.refund_status
     OR (to_jsonb(NEW) - ARRAY['status', 'scanned_at', 'scanned_by', 'checked_in', 'checked_in_at', 'is_used', 'is_archived', 'updated_at']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status', 'scanned_at', 'scanned_by', 'checked_in', 'checked_in_at', 'is_used', 'is_archived', 'updated_at']) THEN
    RAISE EXCEPTION 'Ticket payment and identity fields cannot be changed by a user';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT organizer_id INTO v_organizer_id FROM public.events WHERE id = OLD.event_id;
    IF actor_id IS DISTINCT FROM v_organizer_id OR OLD.status <> 'PAID'
       OR NEW.status <> 'USED' OR OLD.refund_status IS NOT NULL THEN
      RAISE EXCEPTION 'Only the organizer may check in an active ticket';
    END IF;
  ELSIF actor_id IS DISTINCT FROM OLD.buyer_id OR
        (to_jsonb(NEW) - ARRAY['is_archived', 'updated_at']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['is_archived', 'updated_at']) THEN
    RAISE EXCEPTION 'Only the ticket holder may archive this ticket';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_ticket_client_update ON public.tickets;
CREATE TRIGGER tr_guard_ticket_client_update
BEFORE UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_client_update();

CREATE OR REPLACE FUNCTION public.adjust_ticket_tier_sold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  was_active boolean;
  is_active boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    is_active := NEW.status IN ('PAID', 'USED');
  ELSIF TG_OP = 'UPDATE' THEN
    was_active := OLD.status IN ('PAID', 'USED');
    is_active := NEW.status IN ('PAID', 'USED');
    IF NEW.status = 'USED' AND OLD.status IS DISTINCT FROM NEW.status AND OLD.refund_status IS NOT NULL THEN
      RAISE EXCEPTION 'Ticket has a refund request and cannot be checked in';
    END IF;
    IF NEW.tier_id IS DISTINCT FROM OLD.tier_id THEN
      RAISE EXCEPTION 'Ticket tier cannot be changed';
    END IF;
    IF was_active = is_active THEN RETURN NEW; END IF;
  ELSE
    was_active := OLD.status IN ('PAID', 'USED');
  END IF;

  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND was_active AND NOT is_active) THEN
    IF was_active THEN
      UPDATE public.ticket_tiers SET sold = greatest(0, coalesce(sold, 0) - 1)
      WHERE id = OLD.tier_id;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF is_active THEN
    UPDATE public.ticket_tiers SET sold = coalesce(sold, 0) + 1
    WHERE id = NEW.tier_id AND (capacity IS NULL OR coalesce(sold, 0) < capacity);
    IF NOT FOUND THEN RAISE EXCEPTION 'ticket_tier_sold_out'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Reconcile counters from existing active tickets before enabling the trigger.
UPDATE public.ticket_tiers tier SET sold = (
  SELECT count(*) FROM public.tickets t
  WHERE t.tier_id = tier.id AND t.status IN ('PAID', 'USED')
);
DROP TRIGGER IF EXISTS tr_adjust_ticket_tier_sold ON public.tickets;
CREATE TRIGGER tr_adjust_ticket_tier_sold
BEFORE INSERT OR UPDATE OF status, tier_id OR DELETE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.adjust_ticket_tier_sold();

-- Supabase projects with opt-in Data API grants need these explicit privileges.
GRANT SELECT, INSERT, UPDATE ON public.communities TO authenticated;
GRANT SELECT ON public.communities TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_posts TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.community_post_likes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_comments TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.community_comment_likes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.community_join_requests TO authenticated;

DROP POLICY IF EXISTS "comm_comments_update_mod" ON public.community_comments;
CREATE POLICY "comm_comments_update_mod" ON public.community_comments FOR UPDATE TO authenticated USING (
  public.is_community_mod_or_admin(community_id, auth.uid())
);

-- Pending and rejected content must not be readable through the Data API.
DROP POLICY IF EXISTS "comm_posts_select" ON public.community_posts;
CREATE POLICY "comm_posts_select" ON public.community_posts FOR SELECT TO authenticated USING (
  (moderation_status = 'approved' OR author_id = auth.uid()
   OR public.is_community_mod_or_admin(community_id, auth.uid()))
  AND EXISTS (SELECT 1 FROM public.community_memberships m
              WHERE m.community_id = community_posts.community_id
                AND m.user_id = auth.uid() AND m.status = 'active')
);
DROP POLICY IF EXISTS "comm_comments_select" ON public.community_comments;
CREATE POLICY "comm_comments_select" ON public.community_comments FOR SELECT TO authenticated USING (
  (moderation_status = 'approved' OR author_id = auth.uid()
   OR public.is_community_mod_or_admin(community_id, auth.uid()))
  AND EXISTS (SELECT 1 FROM public.community_posts p
              WHERE p.id = community_comments.post_id
                AND (p.moderation_status = 'approved' OR p.author_id = auth.uid()
                     OR public.is_community_mod_or_admin(community_comments.community_id, auth.uid())))
  AND EXISTS (SELECT 1 FROM public.community_memberships m
              WHERE m.community_id = community_comments.community_id
                AND m.user_id = auth.uid() AND m.status = 'active')
);

DROP POLICY IF EXISTS "comm_post_likes_insert" ON public.community_post_likes;
CREATE POLICY "comm_post_likes_insert" ON public.community_post_likes FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.community_posts p
    JOIN public.community_memberships m ON m.community_id = p.community_id
    WHERE p.id = post_id AND p.moderation_status = 'approved'
      AND m.user_id = auth.uid() AND m.status = 'active'
  )
);
DROP POLICY IF EXISTS "comm_comment_likes_insert" ON public.community_comment_likes;
CREATE POLICY "comm_comment_likes_insert" ON public.community_comment_likes FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.community_comments c
    JOIN public.community_posts p ON p.id = c.post_id
    JOIN public.community_memberships m ON m.community_id = c.community_id
    WHERE c.id = comment_id AND c.moderation_status = 'approved'
      AND p.moderation_status = 'approved'
      AND m.user_id = auth.uid() AND m.status = 'active'
  )
);

-- RLS checks which row may be updated. This trigger also checks which columns may change.
CREATE OR REPLACE FUNCTION public.guard_community_membership_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
BEGIN
  -- Internal maintenance and service-role operations do not carry a user JWT.
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  -- The existing auto-join trigger changes memberships while updating a user profile.
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.community_id IS DISTINCT FROM OLD.community_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
     OR NEW.is_auto_joined IS DISTINCT FROM OLD.is_auto_joined THEN
    RAISE EXCEPTION 'Membership identity and origin cannot be changed';
  END IF;

  SELECT role INTO actor_role FROM public.community_memberships
  WHERE community_id = OLD.community_id AND user_id = actor_id AND status = 'active';

  IF actor_id = OLD.user_id AND actor_role NOT IN ('moderator', 'admin') THEN
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Members may only change their notification preferences';
    END IF;
  ELSIF actor_role IN ('moderator', 'admin') THEN
    IF actor_id = OLD.user_id AND
       (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status) THEN
      RAISE EXCEPTION 'Moderators cannot change their own role or status';
    END IF;
    IF actor_role = 'moderator' AND
       (NEW.role = 'admin' OR OLD.role = 'admin') AND
       (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status) THEN
      RAISE EXCEPTION 'Only an admin may change an admin membership';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not allowed to update this membership';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_community_membership_update ON public.community_memberships;
CREATE TRIGGER tr_guard_community_membership_update
BEFORE UPDATE ON public.community_memberships
FOR EACH ROW EXECUTE FUNCTION public.guard_community_membership_update();

-- A browser can call PostgREST directly, so its moderation_status is untrusted.
ALTER TABLE public.community_posts ALTER COLUMN moderation_status SET DEFAULT 'pending';
ALTER TABLE public.community_comments ALTER COLUMN moderation_status SET DEFAULT 'pending';

CREATE OR REPLACE FUNCTION public.guard_community_content()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id uuid := auth.uid();
  is_mod boolean;
  post_community_id uuid;
BEGIN
  IF actor_id IS NULL THEN RETURN NEW; END IF;

  -- Counter updates made by trusted database triggers are not author edits.
  IF TG_TABLE_NAME = 'community_posts' AND TG_OP = 'UPDATE' THEN
    IF pg_trigger_depth() > 1 AND
       (to_jsonb(NEW) - ARRAY['comment_count', 'updated_at']) =
       (to_jsonb(OLD) - ARRAY['comment_count', 'updated_at']) THEN
      RETURN NEW;
    END IF;
    IF current_setting('yrdly.community_like_count_update', true) = 'on' AND
       (to_jsonb(NEW) - ARRAY['like_count', 'updated_at']) =
       (to_jsonb(OLD) - ARRAY['like_count', 'updated_at']) THEN
      RETURN NEW;
    END IF;
  END IF;

  is_mod := public.is_community_mod_or_admin(NEW.community_id, actor_id);

  IF TG_TABLE_NAME = 'community_comments' THEN
    SELECT community_id INTO post_community_id FROM public.community_posts WHERE id = NEW.post_id;
    IF post_community_id IS DISTINCT FROM NEW.community_id THEN
      RAISE EXCEPTION 'Comment must belong to its post community';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.author_id IS DISTINCT FROM actor_id THEN
      RAISE EXCEPTION 'Author must be the signed-in user';
    END IF;
    NEW.moderation_status := 'pending';
    NEW.created_at := now();
    IF TG_TABLE_NAME = 'community_posts' THEN
      NEW.is_pinned := false;
      NEW.like_count := 0;
      NEW.comment_count := 0;
    ELSE
      NEW.like_count := 0;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'community_posts' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.community_id IS DISTINCT FROM OLD.community_id
       OR NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Post identity cannot be changed';
    END IF;
    IF NOT is_mod THEN
      IF NEW.is_pinned IS DISTINCT FROM OLD.is_pinned
         OR NEW.like_count IS DISTINCT FROM OLD.like_count
         OR NEW.comment_count IS DISTINCT FROM OLD.comment_count
         OR NEW.moderation_status IS DISTINCT FROM OLD.moderation_status THEN
        RAISE EXCEPTION 'Only moderators may change post state';
      END IF;
      IF NEW.content IS DISTINCT FROM OLD.content
         OR NEW.image_urls IS DISTINCT FROM OLD.image_urls
         OR NEW.video_urls IS DISTINCT FROM OLD.video_urls THEN
        NEW.moderation_status := 'pending';
      END IF;
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.post_id IS DISTINCT FROM OLD.post_id
       OR NEW.community_id IS DISTINCT FROM OLD.community_id
       OR NEW.author_id IS DISTINCT FROM OLD.author_id
       OR NEW.parent_comment_id IS DISTINCT FROM OLD.parent_comment_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Comment identity cannot be changed';
    END IF;
    IF NOT is_mod THEN
      IF NEW.like_count IS DISTINCT FROM OLD.like_count
         OR NEW.moderation_status IS DISTINCT FROM OLD.moderation_status THEN
        RAISE EXCEPTION 'Only moderators may change comment state';
      END IF;
      IF NEW.content IS DISTINCT FROM OLD.content THEN
        NEW.moderation_status := 'pending';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_community_post ON public.community_posts;
CREATE TRIGGER tr_guard_community_post
BEFORE INSERT OR UPDATE ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.guard_community_content();

DROP TRIGGER IF EXISTS tr_guard_community_comment ON public.community_comments;
CREATE TRIGGER tr_guard_community_comment
BEFORE INSERT OR UPDATE ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION public.guard_community_content();

-- The database queues every new community item, including direct API writes.
CREATE OR REPLACE FUNCTION public.queue_community_content_for_moderation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.moderation_status = 'pending' THEN
    INSERT INTO public.moderation_queue
      (content_id, table_name, user_id, status, reason, text_content)
    VALUES (NEW.id, TG_TABLE_NAME, NEW.author_id, 'pending', 'community_review', NEW.content);
  ELSIF TG_OP = 'UPDATE' AND NEW.moderation_status = 'pending' AND
        (OLD.moderation_status IS DISTINCT FROM NEW.moderation_status
         OR OLD.content IS DISTINCT FROM NEW.content) THEN
    INSERT INTO public.moderation_queue
      (content_id, table_name, user_id, status, reason, text_content)
    VALUES (NEW.id, TG_TABLE_NAME, NEW.author_id, 'pending', 'community_review', NEW.content);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_queue_community_post ON public.community_posts;
CREATE TRIGGER tr_queue_community_post
AFTER INSERT OR UPDATE ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.queue_community_content_for_moderation();

DROP TRIGGER IF EXISTS tr_queue_community_comment ON public.community_comments;
CREATE TRIGGER tr_queue_community_comment
AFTER INSERT OR UPDATE ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION public.queue_community_content_for_moderation();

-- The caller may only toggle its own like on an approved post in a joined community.
CREATE OR REPLACE FUNCTION public.community_toggle_post_like(
  p_post_id uuid, p_user_id uuid, p_action text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  post_community_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Cannot change another user''s like';
  END IF;
  IF p_action NOT IN ('like', 'unlike') THEN
    RAISE EXCEPTION 'Invalid like action';
  END IF;
  SELECT community_id INTO post_community_id FROM public.community_posts
  WHERE id = p_post_id AND moderation_status = 'approved';
  IF post_community_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.community_memberships
    WHERE community_id = post_community_id AND user_id = auth.uid() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Post is not available to this member';
  END IF;

  IF p_action = 'like' THEN
    INSERT INTO public.community_post_likes(post_id, user_id)
    VALUES (p_post_id, auth.uid()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.community_post_likes
    WHERE post_id = p_post_id AND user_id = auth.uid();
  END IF;
  PERFORM set_config('yrdly.community_like_count_update', 'on', true);
  UPDATE public.community_posts
  SET like_count = (SELECT count(*) FROM public.community_post_likes WHERE post_id = p_post_id),
      updated_at = now()
  WHERE id = p_post_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.community_toggle_post_like(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_toggle_post_like(uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
