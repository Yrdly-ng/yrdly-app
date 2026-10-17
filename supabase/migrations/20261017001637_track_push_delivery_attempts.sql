CREATE TABLE public.push_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  dedupe_key text NOT NULL,
  notification_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'awaiting_receipt', 'delivered', 'failed', 'skipped')),
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_ticket_id text,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key, device_id)
);

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE INDEX idx_push_deliveries_due
  ON public.push_notification_deliveries (next_attempt_at, created_at)
  WHERE status IN ('queued', 'awaiting_receipt');

ALTER TABLE public.push_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.push_notification_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.claim_push_notification_deliveries(p_limit integer DEFAULT 100)
RETURNS SETOF public.push_notification_deliveries
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH due AS (
    SELECT id
    FROM public.push_notification_deliveries
    WHERE (status = 'queued' OR (status = 'sending' AND last_attempt_at < now() - interval '10 minutes'))
      AND next_attempt_at <= now()
      AND expires_at > now()
      AND attempt_count < 5
    ORDER BY next_attempt_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 500)
  )
  UPDATE public.push_notification_deliveries AS delivery
  SET status = 'sending',
      attempt_count = delivery.attempt_count + 1,
      last_attempt_at = now(),
      updated_at = now()
  FROM due
  WHERE delivery.id = due.id
  RETURNING delivery.*;
$$;

REVOKE ALL ON FUNCTION public.claim_push_notification_deliveries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_notification_deliveries(integer) TO service_role;

-- Configure project_url and service_role_key in Supabase Vault before enabling this cron job:
-- SELECT vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
-- SELECT vault.create_secret('<service-role-key>', 'service_role_key');
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'process-push-notification-outbox';

SELECT cron.schedule(
  'process-push-notification-outbox',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/process-push-notification-outbox',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb
    )
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url')
      AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key');
  $$
);
