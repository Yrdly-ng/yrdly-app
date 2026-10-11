# Yrdly QA handoff

Updated: 2026-10-08

## Goal and authorized scope

Continue the staging-only QA work in `yrdly-app`. The user authorized a read-only code review of checklist sections A, B, D, and F, then asked for the locally fixable issues to be fixed. Do not use production data or live payment credentials. Do not print or copy secret values from `.env.qa` or other environment files.

The original QA instructions are in `yrdly-qa-agent-prompt.md`; the checklist is `yrdly-qa-checklist.xlsx`.

## Current state

- Static review of sections A, B, D, and F was delivered in the conversation. The principal findings are summarized below.
- Local code fixes and a new migration are in the working tree; they have not been deployed or applied to Supabase.
- The QA seed and cleanup scripts exist under `qa-scripts/`.
- Seed was attempted twice and stopped at the first Auth `listUsers` request because DNS could not resolve the staging Supabase hostname (`ENOTFOUND`). No Supabase writes were made. The incomplete `qa-seed-output.json` was removed. No QA accounts were created.
- `.env.qa` is gitignored and targets the user's staging branch. Never display its values. It contains staging credentials and generated QA account email/password settings.
- No payment-provider request was made.

## Local fixes made

- `src/app/api/payment/initialize/route.ts`: compare the listing's actual owner to submitted `sellerId`; use an atomic `consume_rate_limit` database function rather than a read/increment sequence.
- `src/lib/ticket-service.ts`: assign each ticket in a payment a stable ordinal and recover from a concurrent duplicate insert.
- `src/lib/event-escrow-service.ts`: exclude tickets with an active refund from event payout totals and handle a payout reservation uniqueness conflict.
- `src/app/api/events/tickets/refund/route.ts`: refuse refunds when an event payout is pending, processing, or complete.
- `src/app/(app)/events/[id]/manage/page.tsx`: use the refund-aware event cancellation route.
- `src/lib/storage-service.ts`: limit report images to supported image types and 5 MB, and upload into the user's own folder.
- `src/lib/moderation-admin.ts` and `src/app/(app)/admin/moderation/page.tsx`: add a post-report queue with resolve/dismiss actions.
- `supabase/migrations/20261008143000_harden_qa_review_paths.sql`: add atomic rate limiting, ticket idempotency and event payout uniqueness, report upload limits/folder policy, and reporter/admin-only report table policies.

The Supabase CLI's `migration new` command was attempted but failed while trying to write telemetry under `/Users/macbook/.supabase`, outside the writable workspace. The timestamped migration was therefore created directly in the repository. It has not been applied or checked against the staging schema.

## Verification performed

- `./node_modules/.bin/tsc --noEmit` — passed.
- `git diff --check` — passed.
- `pnpm typecheck` — could not run because the pnpm wrapper attempted a registry request and aborted while trying to purge the modules directory. The installed local TypeScript compiler passed instead.
- No database migration, live request, payment flow, concurrency test, or browser test was run.

## Main review findings

- **SC-03:** marketplace payment initialization accepted the caller's seller ID without comparing it to the post owner; fixed locally. The original report policies also allowed broad reads/deletes; tightened in the new migration.
- **SC-07:** report storage lacked server-side size/type limits and owner-folder restriction; addressed in code and migration. The reports bucket remains public-read.
- **SC-08:** payment rate limiting was persisted but non-atomic; addressed with a database function.
- **TP-04:** sequential ticket webhook retries were handled, but simultaneous duplicates could race; addressed with a per-payment ticket ordinal and unique index.
- **EP-07:** event payout lookup/insert could race; addressed with a unique event payout index and conflict handling.
- **ER-07:** refund route did not check event payout state; addressed locally.
- **EV-06 / ER-03:** event management used the legacy cancellation route, which cancelled tickets without refunds or buyer notifications; switched to refund-aware route.
- **PO-11 / SF-02:** post reports were submitted but absent from the admin review queue; queue added and report-table policies tightened.
- **WD-05:** route code rejects withdrawals below ₦1,000 before payout processing. Staging reproduction remains unverified.
- **PF-05:** no dedicated admin alert path was found for payment/webhook failures; not fixed in this pass.
- **PO-03 / TP-03 and notification delivery findings:** staging reproduction/root cause remains outstanding.

## Next steps

1. Restore DNS/network access from the execution environment to the staging Supabase project. The expected project ref in the seed guard is `fytjezqtkdwsrkazlyfm`; the script refuses any other project.
2. Before applying the migration, inspect the staging schema and check for duplicate event payout rows. The unique index can fail if duplicate rows already exist.
3. Apply the migration to staging and verify the function, indexes, storage limits, and RLS policies.
4. Run `node qa-scripts/seed.mjs`; confirm it creates the five QA accounts and requested event/listing/sale fixtures. It writes IDs to `qa-seed-output.json` and account credentials to ignored `.env.qa`.
5. Verify the seeded balances and fixtures, then run the staging request/concurrency/payment checks using test mode only. Clean up with `node qa-scripts/cleanup.mjs` when finished.
6. Reproduce PO-03, TP-03, and notification failures. Do not infer their root cause from spreadsheet notes alone.

For browser/payment testing, the staging app URL and test-mode provider configuration must be available in the staging deployment. Configure provider webhooks to the staging HTTPS app endpoints, not production. No secret values need to be added to this handoff.

## Working tree caution

The workspace already had user changes before these fixes. Preserve them and review `git status` before editing. Pre-existing modified files included the community and listing pages, marketplace screen, `PostCard`, `PostDetailView`, `use-posts`, and `community-service`; pre-existing untracked items included `CLAUDE-YRDLY-WEB-APP.md`, `src/lib/marketplace-listing-service.ts`, `supabase/migrations/20261008105151_protect_paid_marketplace_listings.sql`, the QA prompt, and the checklist. The fixes listed above added more modified/untracked files.

Security note: an earlier tool output exposed credentials while inspecting environment files, and a pre-existing reviewer-account script was found to contain a hardcoded service-role key. That script has now been deleted as part of the provider removal. The user said they plan to rotate keys later; deletion does not rotate credentials or erase Git history. Do not repeat any values; rotation still needs confirmation.
