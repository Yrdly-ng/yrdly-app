# Push delivery setup

The mobile app requests an Expo push token and stores it in `user_push_tokens`.
The `send-push-notification` Edge Function writes native deliveries to
`push_notification_deliveries`; the outbox worker sends them, checks Expo
receipts, and retries temporary failures.

## Supabase rollout

1. Apply `20261017001637_track_push_delivery_attempts.sql` to the target project.
2. Deploy both functions with JWT verification disabled. Each function validates
   the service role key in its request handler:

   ```sh
   supabase functions deploy send-push-notification --no-verify-jwt
   supabase functions deploy process-push-notification-outbox --no-verify-jwt
   ```

3. In the Supabase SQL editor, create or update Vault secrets using the target
   project's URL and service role key. Never commit these values:

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<service-role-key>', 'service_role_key');
   ```

   If either secret already exists, update it through the Supabase Vault dashboard.

4. Confirm `pg_cron` and `pg_net` are enabled and verify the scheduled
   `process-push-notification-outbox` job exists in `cron.job`. The migration
   always schedules the job; its request becomes a no-op until both Vault
   secrets exist. If the job is missing, re-run the migration's unschedule and
   schedule statements after creating the secrets.
5. Treat this as a release gate: send a push to a real test device and verify a row moves from `queued` through
   `awaiting_receipt` to `delivered` in `push_notification_deliveries`; also
   verify an invalid token is removed and an opted-out recipient is skipped.

## EAS Android builds

`google-services.json` is generated locally from `GOOGLE_SERVICES_JSON` or
`GOOGLE_SERVICES_JSON_BASE64` by `app.config.js`. Configure one of those EAS
environment variables for the build profile, using the Firebase Android config
for the app's Android package. Keep the JSON file out of git. The CodeMagic
secret is not automatically available to EAS; configure it separately in EAS.
