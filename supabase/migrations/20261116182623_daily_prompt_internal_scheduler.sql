-- Keep machine-to-machine notification work inside Supabase. The website's
-- Cloudflare browser protection must not be disabled for scheduled jobs.
CREATE TABLE IF NOT EXISTS public.notification_campaigns (
  name text PRIMARY KEY CHECK(name='daily_prompt'),
  enabled boolean NOT NULL DEFAULT false,
  scope text NOT NULL DEFAULT 'testers' CHECK(scope IN ('testers','all')),
  tester_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_campaigns FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.notification_campaigns TO service_role;
INSERT INTO public.notification_campaigns(name) VALUES('daily_prompt') ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='dispatch-daily-prompts') THEN
    PERFORM cron.unschedule('dispatch-daily-prompts');
  END IF;
END $$;
SELECT cron.schedule('dispatch-daily-prompts','*/15 17-18 * * *',$job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url' LIMIT 1)
      || '/functions/v1/dispatch-daily-prompts',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) WHERE EXISTS(SELECT 1 FROM vault.secrets WHERE name='project_url')
      AND EXISTS(SELECT 1 FROM vault.secrets WHERE name='service_role_key');
$job$);
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='dispatch-daily-prompts'),active:=false);
