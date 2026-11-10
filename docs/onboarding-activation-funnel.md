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
