# Release verification — 10 October 2026

This document supersedes older completion estimates. A passing mocked test is
not evidence that a payment settled or that production has the matching code.

## Verified

- An isolated persistent Supabase Staging branch is available:
  `jxgpvvehajxegeeozlnl`. Production is `yoiyqxtpmxnrrbqqidcs`.
- Staging now contains the production public schema, RLS, grants, storage bucket
  definitions and realtime publications. No production application rows, Auth
  accounts, storage files or cron schedules were copied. Five synthetic QA
  accounts and explicit fixtures were seeded.
- The three pending restrictive migrations were applied to Staging only.
  Private profile reads, server-managed trust fields, financial writes and
  ticket scanning are protected. Chat and report buckets are private there.
- A rollback-only SQL regression passed 24 assertions covering inventory,
  payments, refunds, disputes, ticket capacity, payout reservations and money
  RPC authorization. These exercise the database, not Payluk settlement.
- Live signed-in HTTP/REST tests passed profile privacy, trust-field attacks,
  safe public-profile joins, concurrent likes, chat permissions, message edits,
  read receipts, private media, free checkout, concurrent single-use scanning
  and concurrent last-ticket purchases. The harness cleans its own runtime
  fixtures and saves a credential-free result in `.qa-artifacts/`.
- A real Payluk sandbox `GET /v1/countries` returned HTTP/provider status 200.
  Only sandbox credentials are allowed by the QA launch scripts.
- A real sandbox contract test then created two synthetic customers, set buyer
  and seller permissions, created an unpaid escrow, applied and verified a
  3% additional fee, and deleted that escrow. Eight provider operations and the
  state/amount assertions passed. No funds were collected or transferred.
- The push Edge Function deployed to Staging passed seven real authorization
  and payload tests. Backend keys work; publishable keys and user JWTs fail.
- GitHub CLI has write-capable access. QA-only credentials were encrypted in
  the `yrdly-qa` GitHub environment, restricted to `fix/audit-oct-2026`.
- Linux CI passed the build, typecheck, lint, 130 regression tests, seven live
  push authorization tests, 50 signed-in API/security checks, five browser
  scenarios and the existing smoke suite. The browser scenarios cover six
  protected routes at 375, 768 and 1440 pixels, wait for loaded content and
  assert visible navigation. Nineteen screenshots were captured; representative
  loaded mobile, tablet and desktop screenshots were visually reviewed.
  Evidence: https://github.com/Yrdly-ng/yrdly-app/actions/runs/38062580693
- Vercel access works. A separate `yrdly-app-qa` project was configured with the
  isolated database and Payluk sandbox keys. It deployed revision `711ec2a9`
  successfully at https://yrdly-app-qa.vercel.app. No production environment
  variables, scheduled jobs or application data were copied into this project.
  Public login, authenticated/unauthenticated checkout guards and unsigned
  webhook rejection passed against the hosted application.
- Four hosted webhook checks passed: a correctly signed unknown synthetic
  event, its replay, a tampered body and a missing signature. These were locally
  signed diagnostic requests, not callbacks delivered by Payluk.
- After the Payluk test callback was configured, creating another unpaid
  sandbox escrow triggered a real POST to the hosted webhook. Vercel request
  logs recorded HTTP 200 after escrow creation; no diagnostic POST was sent
  during that capture. The SDK's sandbox checkout-session endpoint also returned
  HTTP 201 with a session. The unpaid escrow was deleted successfully. These
  checks establish callback delivery and session creation, not payment funding.
- A diagnostic application email was accepted by Resend, reported delivered
  by the provider and confirmed received by the authorized recipient. This
  does not establish Supabase Auth signup/password-reset email delivery.
- Real Termii SMS delivery and verification succeeded. After hardening the OTP
  functions, a second real SMS challenge verified for its requesting QA account,
  was marked consumed, and a repeated verification was rejected.
- Live Sightengine checks allowed safe text, flagged profanity, preserved a safe
  public image and promoted a safe pending image. The promoted/preserved image
  bytes matched the uploaded fixture. Both storage fixtures were removed.
- The newly hardened QA OTP functions passed 20 deployed HTTP/REST checks
  without sending additional SMS, plus 10 rollback-only SQL assertions for
  ownership, phone binding, expiry, attempt limits, uniqueness, replay and grants.
  Concurrent requests allowed only one account to verify the same phone and
  consumed one challenge only once; the temporary profile changes were restored.
  The expanded local unit/regression suite passed all 149 tests.

## Regressions found and corrected during QA

1. **VERIFIED:** the staged message guard referenced `NEW.content`, absent from
   the actual schema. Legitimate edits and read receipts failed. The corrected
   guard passed both legitimate operations and unauthorized-edit tests.
2. **VERIFIED by exact deployed source:** moderation validated every caller
   with `auth.getUser()`, excluding backend service identities used by the new
   server routes. The corrected Staging function accepts backend keys and
   validates user sessions separately.
3. **VERIFIED by exact deployed source:** image moderation copied files to a
   destination and deleted the source without checking copy success, including
   a public file copied to its own bucket/path. It also accepted arbitrary
   private source buckets under admin credentials. The corrected function
   inspects public images without moving them, forbids private sources, and
   promotes only owned pending images after a successful copy. Regression
   tests cover copy failure, ownership, foreign hosts and private buckets.
4. **VERIFIED:** the QA seed used a nonexistent transaction column, a null
   required item ID, and inconsistent sold-listing fields. Seeding now succeeds
   against the real schema. Synthetic ledger rows remain explicitly tagged
   `qa_seed`; they are not represented as Payluk wallet funds.
5. **VERIFIED:** image configuration recognized only the production storage
   hostname. The configured Supabase host is now recognized for isolated QA.
6. **VERIFIED by browser:** Settings nested a main landmark inside the shared
   application main landmark. Settings wrappers now preserve the shared main.
7. **VERIFIED by HTTP:** a nonnumeric ticket quantity returned HTTP 500. Strict
   request validation now rejects invalid quantities and attendee details with
   HTTP 400 before querying inventory or contacting a payment provider.
8. **VERIFIED by browser screenshot and exact CSS:** at 768–1023 pixels, the
   bottom navigation was hidden before the desktop sidebar appeared. Matching
   the navigation breakpoint and bottom padding restored tablet navigation;
   loaded browser checks and reviewed screenshots passed.
9. **VERIFIED by exact deployed source:** OTP verification called Termii before
   authenticating the caller and had no owner-bound challenge or persistent
   send limit. New QA functions authenticate first, enforce database-backed
   limits, store requester/phone/expiry, bound attempts and atomically consume
   successful challenges. Live cross-account/replay tests and a real Termii
   verification passed. Production has not received this change yet.

## Remaining release requirements

- Test application-driven Payluk customer onboarding, checkout funding, signed callback
  delivery/replay, delivery confirmation, settlement, refunds and withdrawals.
  An authenticated read-only request does not establish these outcomes.
  The sandbox callback is configured and an unpaid-escrow callback was accepted;
  callbacks for funded payments and financial state changes remain unverified.
  Deprecated wallet top-up/deposit is not a test path.
- Verify Supabase Auth signup/reset email delivery, OAuth redirects and actual
  device/browser push. The current push authorization test intentionally sends
  to a fixture without subscribed devices. Basic application email and Termii
  OTP delivery are verified separately above.
- Review outstanding Supabase security advisors. `public_profiles` deliberately
  exposes a restricted projection of private profiles; its definer-view warning
  requires an explicit design decision, not blind conversion to an invoker view.
  Eleven inspected function search paths were pinned in Staging; subsequent
  advisors no longer reported these warnings and the 24 money assertions passed
  again. Service-only tables deliberately have no client policies. Remaining
  function-grant warnings need context-specific review; leaked-password
  protection is not enabled. Lint passes with 19 existing warnings.
- Paid event refunds/cancellation are still support-assisted. Automated refund
  completion is not established.
- Deploy matching web code, verify shared-backend mobile compatibility, then
  apply restrictive production migrations and deploy corrected Edge Functions.
  Staging success does not imply production is secured or released.
  Include the additive OTP challenge migration before replacing both OTP
  functions. Remove retired provider environment entries only with the matching
  web release; the deployed production version has not been replaced.

No claim of 100% release completion is made while these requirements remain.

## Repeating checks

Local credentials belong only in ignored `.env.qa` (mode 600). Never print or
commit that file or `qa-seed-output.json`.

```sh
node qa-scripts/seed.mjs
node --test tests/audit-security.test.cjs
node scripts/qa-payluk-sandbox.mjs
node qa-scripts/edge-regression.mjs
node qa-scripts/otp-regression.mjs
node qa-scripts/run-app.mjs build
pnpm typecheck
pnpm lint
node qa-scripts/run-app.mjs start
# In a second terminal:
node qa-scripts/live-regression.mjs
pnpm exec playwright test --config=playwright.qa.config.ts
```

Run `qa-scripts/database-regression.sql` only on the allowlisted QA project. It
also refuses databases containing non-QA Auth accounts and rolls back fixtures.
Do not use a blanket migration push: historic production migration versions
differ from local draft names. Apply reviewed changes individually in order.
`qa-scripts/otp-database-regression.sql` uses the same isolation guard and rollback.

`qa-scripts/sync-function-secrets.mjs` configures only QA Termii/Sightengine
secrets. `qa-scripts/vercel-qa.mjs configure` and `deploy` target only the separate
QA project, archive committed source, and disable scheduled jobs in that copy.
Neither uploads delivery destinations, local environment files or QA artifacts.
