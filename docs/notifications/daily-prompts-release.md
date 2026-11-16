# Daily questions and opt-in reminders

The web and native clients use `/api/daily-prompts` for the current approved question, and authenticated `/api/daily-prompts/responses` for moderated, public answers in the viewer's home state/LGA. Both directions of user blocking are enforced. Normal posts remain unchanged when no question is attached.

Questions are curated in `/admin/daily-prompts`. Only server-verified administrators can create drafts, edit, approve or pause them. Drafts are never automatically published. `DAILY_PROMPTS_ENABLED=true` is required to display questions. The database independently enforces the Lagos date, 7 AM opening, public General category and immutable response context.

Supabase Cron invokes the service-authenticated `dispatch-daily-prompts` Edge Function at 17:00 UTC (6 PM Nigeria), with 15-minute catch-up attempts through 18:45 UTC. This is an internal Supabase job: the public website's Cloudflare Bot Fight Mode blocks machine requests and is left unchanged. Vercel Hobby does not support the frequent cron expression, so it is not configured as a Vercel cron.

The service-only `notification_campaigns` row controls `enabled`, `scope` (`testers` or `all`) and `tester_ids`. It defaults disabled with an empty tester cohort. `DAILY_PROMPT_PUSH_ENABLED=false` in an Edge Function remains an unconditional emergency stop; otherwise the database control is authoritative. The dispatcher, sender and outbox independently enforce this control and recipient cohort. Every recipient must explicitly enable `notification_settings.dailyPrompts`. The Next.js cron route remains a compatibility/manual endpoint with its existing environment switches, but no scheduled job calls it.

The service-only recipient RPC excludes existing reservations before pagination, so bounded retries make progress. The ledger reserves each user/question once, and uncertain provider handoffs are not automatically replayed. `submitted` means provider acceptance, not confirmed device delivery. Reminder expiration is the end of the Nigerian day.

Validation: execute `tests/daily-prompt-database.sql` only on staging; all fixtures roll back. Run daily prompt/dispatch/routing unit tests, typecheck, lint, production compilation and browser smoke tests. Check production RLS/grants and migrations separately. No approved production question or campaign is created by these migrations.

Android delivery remains a separate release gate: APK #72's exact `google_api_key` resource was rejected by Firebase Installations with HTTP 400 / `API_KEY_INVALID` on 16 November 2026. Project, sender and app ID match the configured YRDLY app. A valid Android client configuration and a newly installed APK must pass registration and receipt/tap tests before Android delivery can be called verified. Do not rotate server credentials or remove API restrictions based solely on the historical `FIS_AUTH_ERROR` message.
