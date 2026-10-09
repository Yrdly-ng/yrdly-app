-- Harden paths identified during the staging QA code review.

-- A request counter must be consumed atomically across concurrent app instances.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_user_id uuid,
  p_endpoint text,
  p_max_requests integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  allowed boolean;
BEGIN
  IF p_user_id IS NULL OR p_endpoint IS NULL OR p_max_requests < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit parameters';
  END IF;

  INSERT INTO public.rate_limits (user_id, endpoint, request_count, window_start)
  VALUES (p_user_id, p_endpoint, 1, now())
  ON CONFLICT (user_id, endpoint) DO UPDATE
    SET request_count = CASE
          WHEN public.rate_limits.window_start IS NULL
            OR public.rate_limits.window_start <= now() - make_interval(secs => p_window_seconds)
          THEN 1
          ELSE public.rate_limits.request_count + 1
        END,
        window_start = CASE
          WHEN public.rate_limits.window_start IS NULL
            OR public.rate_limits.window_start <= now() - make_interval(secs => p_window_seconds)
          THEN now()
          ELSE public.rate_limits.window_start
        END
  RETURNING request_count <= p_max_requests INTO allowed;

  RETURN allowed;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_rate_limit(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(uuid, text, integer, integer) TO service_role;

-- Give each ticket in a payment a stable ordinal so webhook retries cannot
-- insert the same purchase tickets twice, including simultaneous deliveries.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS purchase_ticket_index integer;

WITH numbered_tickets AS (
  SELECT id,
         row_number() OVER (PARTITION BY payment_tx_ref ORDER BY created_at, id) - 1 AS ticket_index
  FROM public.tickets
  WHERE payment_tx_ref IS NOT NULL
)
UPDATE public.tickets AS ticket
SET purchase_ticket_index = numbered_tickets.ticket_index
FROM numbered_tickets
WHERE ticket.id = numbered_tickets.id
  AND ticket.purchase_ticket_index IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_payment_purchase_ordinal
  ON public.tickets (payment_tx_ref, purchase_ticket_index)
  WHERE payment_tx_ref IS NOT NULL AND purchase_ticket_index IS NOT NULL;

-- A single event may have at most one payout record, even when cron workers race.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_payouts_one_per_event
  ON public.event_payouts (event_id);

-- Set hard Storage limits and require report uploads to be under the caller's
-- own folder. The browser also validates files for faster feedback.
UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
WHERE id = 'reports';

DROP POLICY IF EXISTS "Authenticated users can upload report images" ON storage.objects;
CREATE POLICY "Users can upload report images to their folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'reports'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Report rows are private to their reporter and admins; only admins can
-- review, update, or delete other users' submissions.
DROP POLICY IF EXISTS "Users can create reports" ON public.reports;
DROP POLICY IF EXISTS "Users can view their own reports" ON public.reports;
DROP POLICY IF EXISTS "Users can insert own reports" ON public.reports;
DROP POLICY IF EXISTS "Users can view own reports or admins all" ON public.reports;
DROP POLICY IF EXISTS "Admins can update reports" ON public.reports;
CREATE POLICY "Users can insert own reports"
  ON public.reports FOR INSERT TO authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND (reporter_id IS NULL OR reporter_id = auth.uid())
    AND (user_id IS NOT NULL OR reporter_id IS NOT NULL)
  );
CREATE POLICY "Users can view own reports or admins all"
  ON public.reports FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR reporter_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin OR u.role = 'admin'))
  );
CREATE POLICY "Admins can update reports"
  ON public.reports FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin OR u.role = 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin OR u.role = 'admin')));

DROP POLICY IF EXISTS "Users can create post reports" ON public.post_reports;
DROP POLICY IF EXISTS "Users can view post reports" ON public.post_reports;
DROP POLICY IF EXISTS "Users can delete post reports" ON public.post_reports;
CREATE POLICY "Users can insert own post reports"
  ON public.post_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "Reporters and admins can view post reports"
  ON public.post_reports FOR SELECT TO authenticated
  USING (
    reporter_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin OR u.role = 'admin'))
  );
CREATE POLICY "Admins can update post reports"
  ON public.post_reports FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin OR u.role = 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin OR u.role = 'admin')));
CREATE POLICY "Admins can delete post reports"
  ON public.post_reports FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin OR u.role = 'admin')));

DROP POLICY IF EXISTS "Users can create comment reports" ON public.comment_reports;
DROP POLICY IF EXISTS "Users can view comment reports" ON public.comment_reports;
DROP POLICY IF EXISTS "Users can delete comment reports" ON public.comment_reports;
CREATE POLICY "Users can insert own comment reports"
  ON public.comment_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "Reporters and admins can view comment reports"
  ON public.comment_reports FOR SELECT TO authenticated
  USING (
    reporter_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin OR u.role = 'admin'))
  );
CREATE POLICY "Admins can update comment reports"
  ON public.comment_reports FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin OR u.role = 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin OR u.role = 'admin')));
CREATE POLICY "Admins can delete comment reports"
  ON public.comment_reports FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin OR u.role = 'admin')));
