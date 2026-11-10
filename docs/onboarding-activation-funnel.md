# YRDLY onboarding activation and D1–D7 retention

## Scope
Web only until the Android/iOS public launch. Events are emitted by the existing privacy-restricted PostHog client using the Supabase authenticated UUID; no email, phone, username, message content, coordinates, or URL parameters are captured. Filter `app_environment = production` and `app_platform = web` to exclude internal preview/testing.

## Event contract
| Event | Trigger | Counting guidance |
| --- | --- | --- |
| `onboarding_profile_completed` | Profile persistence succeeds after neighborhood selection. | Unique authenticated users; start of the activation funnel (not total signups). |
| `onboarding_home_reached` | An onboarded user opens `/home`, once per browser page lifecycle. | Funnel step after profile completion, even if the user visits another destination first. |
| `onboarding_meaningful_action` | Successful community post creation or business chat message persistence. | Funnel step; `action_type` is `community_post` or `business_message`; do not count attempted actions. |
| `onboarding_active_visit` | Fully onboarded, authenticated user returns to the app; once per browser page lifecycle per user. | Retention return event. Multiple tabs can generate additional events, but unique-user counting prevents inflated users. |

These events are *not* sent for anonymous visits. The `onboarding_home_reached` event is an authenticated home view, not necessarily the first home view ever; for new-user activation use it **after** `onboarding_profile_completed` in a sequential funnel.

## PostHog reports to configure after deployment and confirming ingestion

### A: Onboarding activation funnel
1. Open **Product analytics > Funnels**.
2. Ordered events: `onboarding_profile_completed` -> `onboarding_home_reached` -> `onboarding_meaningful_action`.
3. Counting: **unique users**, conversion window **7 days** (or longer if you also want slower activation); funnel mode **ordered**.
4. Event filter: `app_platform = web`, `app_environment = production`; use dates from this release onward. Optional breakdown: `action_type` on step 3.
5. Name: **YRDLY — New user activation (profile → home → action)**.

This explicitly measures conversion *from completed profile setup*; it does **not** measure account-created → completion drop-off. For the complete signup funnel, introduce a trusted account-created event after Supabase signup confirmation, with verification status understood.

### B: Seven-day return retention
1. Open **Product analytics > Retention**.
2. Start event: `onboarding_profile_completed` (newly-onboarded users only).
3. Return event: `onboarding_active_visit`.
4. Set retention period to **daily**, first **7 days**, aggregate by **unique persons**; inspect **days 1–7 after onboarding**, excluding day 0.
5. Apply the same `app_platform = web` and `app_environment = production` filters.
6. Name: **YRDLY — Onboarded users D1–D7 retention**.

A seven-day rolling return rate means the share who came back *at least once* during days 1–7. Standard daily retention charts usually show a separate return rate for **each individual day**, not this seven-day union; do not report the day-7 cell alone as "returned within seven days." Use a 7-day unbounded retention aggregation (if supported), or a person-based distinct count of users with at least one return between 24 and 168 hours after first completion, divided by eligible completed users. Exclude recent cohorts without a complete 7-day observation window.

### C: Weekly monitoring
Save both insights to an **Onboarding & Retention** dashboard. Add a trend of unique `onboarding_profile_completed` users and a trend of unique `onboarding_meaningful_action` users. Do not show a percentage until the full eligibility window has elapsed.

## QA acceptance
- Verify each event appears in PostHog Live Events with `app_platform=web` and `app_environment=preview` in test deployment, and no PII in event properties.
- Create a fresh test account, verify email, skip phone, select location, and confirm profile-completed then home-reached ordering.
- Verify deep-link signup opens its original destination, and home event only fires on /home.
- Verify successful community post and successful business chat message capture a single meaningful-action event; failed sends should never count.
- Verify a returning authenticated browser session emits `onboarding_active_visit`, but logged-out visitors do not.
- Run `pnpm test:telemetry`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` before merge. No production deployment is performed by this pull request.

## Limitations
Existing users without a new `onboarding_profile_completed` event will not enter the new-user activation funnel, as intended. Users whose signup finished before deployment cannot be retroactively attributed. Anonymous browsing is not included. PostHog's memory-only identity resets on reload for anonymous users, but authenticated UUIDs link recognized return sessions.

## QA environment verification — 10 November 2026

- Existing staging Supabase project reference: `jxgpvvehajxegeeozlnl`.
- Restored 8,798 public ward reference records from the production reference catalog to the isolated staging `lga_wards` table; verified 8,798 distinct state/LGA/ward triples.
- The feature branch's Vercel Preview configuration explicitly uses staging URL and staging publishable key. `SUPABASE_SERVICE_ROLE_KEY` is deliberately nonfunctional on this feature branch, preventing privileged server calls during public UX smoke tests.
- QA preview instrumentation is disabled to avoid contaminating production PostHog metrics. Verify ingestion on production only after signed-off release, or use a separate nonproduction PostHog project with its own key.
- The Supabase Staging branch status remains `MIGRATIONS_FAILED`; its migration history is materially different from production. Do **not** reset, rebase or mark migrations applied without examining the specific failed migration and preserving staging test data.
- A passing build and public-browser smoke test are not equivalent to an authenticated end-to-end test. Test the full signup/verification flow using a dedicated QA backend and controlled test accounts before promotion.

## Verified QA flows — 10 November 2026

- Latest onboarding code / build was validated on Vercel's staging-isolated Preview.
- Browser signup with an isolated synthetic account reached `/onboarding/verify-email`. The connection trace contacted **only** the Supabase Staging host.
- A controlled mailbox **received** an actual YRDLY confirmation email containing a six-digit code. Delivery was verified; automated submission of that real code was prevented by the test environment's safety check, so an OTP-exchange pass is **not claimed**.
- A separate synthetic account was confirmed **directly in the staging database**, then tested using a real browser with the new login-bootstrap fix. It successfully navigated through `/onboarding/profile`, selected Lagos → Ikeja, clicked `Explore my neighbourhood`, and returned to `/marketplace`, preserving `next`.
- Database inspection confirmed the profile was persisted with `profile_completed=true`, `onboarding_status=completed`, `tour_completed=true`, and Lagos/Ikeja location. This does not attest that the user submitted an actual email OTP.
- Both synthetic QA accounts were deleted from Supabase Staging afterward. Temporary local QA credentials were cleared.

### Remaining Supabase migration repair

- Existing persistent `Staging` branch is usable for the application flow, but the management status remains `MIGRATIONS_FAILED`.
- Its custom QA baseline has 35 recorded migrations, versus 107 recorded production migrations. Several migrations overlap by function but have different versions; applying production migrations blindly or re-marking versions as applied would be unsafe.
- Supabase's supported recovery is to correct the migration sources and rebuild a **clean** branch. A new branch incurs additional billed compute; the current quoted rate was **US$0.01344/hour**. The Supabase tool requires **specific cost approval**, which has not been provided. Do not create a billed branch or reset/delete staging without that approval and a data preservation plan.
- Do not merge this draft PR into production on the basis of a mock OTP or a green build alone.

## Root-cause reproduction: fresh Supabase branch (10 November 2026)

A temporary branch `onboarding-qa-clean-20261110` was created with explicit user approval at **US$0.01344/hour**. Its initialization failed with `MIGRATIONS_FAILED` and only migration `20260708000000_create_rate_limits` was recorded.

The branch's Postgres logs report **`relation "public.posts" does not exist`** when the next migration, `20260713105005_migrate_legacy_events.sql`, executes a query from `public.posts`. The branch does not have `public.users` or `public.lga_wards` either.

**Root cause:** The source migration history is not self-bootstrapping. It assumes a pre-existing base schema, so simply recreating or rebasing Staging cannot repair it. Marking historical migrations applied or creating an empty `posts` placeholder would conceal the problem rather than produce a valid QA database.

**Required engineering repair before future clean-branch creation:**
1. Identify and version the original foundational DDL/schema baseline (tables, types, extension setup, constraints, RLS, functions, policies, triggers and grants), preserving object dependencies.
2. Test a fresh database from that baseline followed by every incremental migration in chronological order, and reconcile any version collisions or migrations that assumed existing production data.
3. Put the reproducible clean-db migration test into CI, and then rebuild an isolated QA branch from the verified migration sequence.
4. Compare effective schemas and security policies against the existing QA branch before switching application previews; do not migrate existing test fixtures or auth records without an explicit plan.
5. Never apply an untested baseline to the live YRDLY database.

The temporary failed branch contained no user data and was **deleted after diagnosis** to avoid continued hourly billing. Existing `Staging` and production branches remain unchanged.

**Authentication test scope:** A controlled QA mailbox received a genuine six-digit signup code, but the secure browser tool rejected forwarding that code into the test session. Do not claim successful code submission. The separate post-confirmation real-browser test verified profile setup, saved location and deep-link navigation.
