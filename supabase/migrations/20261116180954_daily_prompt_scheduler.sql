-- Existing Supabase Cron handles frequent catch-up calls without requiring
-- Vercel's paid frequent-cron feature. The endpoint independently checks flags,
-- editorial approval, explicit consent, time window and durable reservations.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='dispatch-daily-prompts') THEN
    PERFORM cron.unschedule('dispatch-daily-prompts');
  END IF;
END $$;
SELECT cron.schedule('dispatch-daily-prompts','*/15 17-18 * * *', $job$
  SELECT net.http_get(
    url := 'https://app.yrdly.ng/api/cron/daily-prompts',
    headers := jsonb_build_object('Authorization','Bearer ' || (
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name='daily_prompt_cron_secret_nov16' LIMIT 1
    )),
    timeout_milliseconds := 240000
  )
  WHERE EXISTS (SELECT 1 FROM vault.secrets WHERE name='daily_prompt_cron_secret_nov16');
$job$);
-- Activate only after the deployed endpoint accepts the dedicated credential.
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='dispatch-daily-prompts'), active := false);
