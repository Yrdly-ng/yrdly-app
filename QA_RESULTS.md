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
- The push Edge Function deployed to Staging passed seven real authorization
  and payload tests. Backend keys work; publishable keys and user JWTs fail.
- GitHub CLI has write-capable access. QA-only credentials were encrypted in
  the `yrdly-qa` GitHub environment, restricted to `fix/audit-oct-2026`.

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

## Remaining release requirements

- Finish the Linux browser workflow: real UI login, protected pages, organizer
  scanning screen and screenshots at 375, 768 and 1440 pixels.
- Test real Payluk customer onboarding, checkout funding, signed callback
  delivery/replay, delivery confirmation, settlement, refunds and withdrawals.
  An authenticated read-only request does not establish these outcomes.
- Verify real OTP/email delivery and device/browser push with controlled test
  destinations. The current push authorization test intentionally sends to a
  fixture without subscribed devices.
- Review outstanding Supabase security advisors. `public_profiles` deliberately
  exposes a restricted projection of private profiles; its definer-view warning
  requires an explicit design decision, not blind conversion to an invoker view.
  Function search-path warnings remain to be assessed.
- Paid event refunds/cancellation are still support-assisted. Automated refund
  completion is not established.
- Staging's moderation request is now authorized but returned HTTP 503
  (`Moderation unavailable`); successful live Sightengine moderation is not yet
  verified. Configure its QA function secrets and retest safe/flagged content.
- Deploy matching web code, verify shared-backend mobile compatibility, then
  apply restrictive production migrations and deploy corrected Edge Functions.
  Staging success does not imply production is secured or released.

No claim of 100% release completion is made while these requirements remain.

## Repeating checks

Local credentials belong only in ignored `.env.qa` (mode 600). Never print or
commit that file or `qa-seed-output.json`.

```sh
node qa-scripts/seed.mjs
node --test tests/audit-security.test.cjs
node scripts/qa-payluk-sandbox.mjs
node qa-scripts/edge-regression.mjs
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
