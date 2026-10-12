# Production release checkpoint — 12 October 2026

The requested production release is authorized, but its technical prerequisites
are not satisfied. Do not merge PR 74 while that merge would automatically
deploy code against missing database contracts. Production has not been changed
by this preflight. This document records release dependencies, not a request for
another general approval.

## Verified production preflight

`qa-scripts/production-preflight.sql` was executed read-only through Supabase
against production `yoiyqxtpmxnrrbqqidcs` and isolated QA `jxgpvvehajxegeeozlnl`.
All 35 database contract checks pass in QA; all 35 are absent from production.
These are prerequisites of this release, not 35 new independent audit findings.
The 12 October rerun includes caller-scoped community role lookup and removal of
client EXECUTE grants on trigger-only functions. Safe evidence:
`.qa-artifacts/release-preflight-20261012-yoiyqxtpmxnrrbqqidcs.json` and
`.qa-artifacts/release-preflight-20261012-jxgpvvehajxegeeozlnl.json`.

- Production lacks ticket checkout reservations, booking ledger bridge columns,
  phone verification challenges, dispute allocation persistence and the five
  argument payout retry RPC/attempt marker.
- Profile privacy, server-only financial guards, paid-price guards and private
  chat/report buckets are installed in QA only.
- Production has zero duplicate customer-mapping groups, zero unfulfilled
  legacy ticket checkouts and zero resolved split settlements caught by the
  split migration's historical guard at this checkpoint.
- One historical payout remains pending: `2b301876-80e3-4ce0-901d-68f771cf6717`,
  NGN 970, requested 17 September 2026. It has no recorded provider, reference
  or provider transaction ID. This does not prove that a transfer did or did not
  occur. Do not retry, delete or mark it paid/failed without reconciliation.
- The accessible Vercel production target still serves `b38dccf24cc0f42a7bbd0cecf321272c89ac8434`.
  All eight inspected required environment variable names are configured.
  Sensitive values are unavailable through the metadata API: an empty returned
  sensitive value is not evidence of missing configuration. The provider key,
  backend target and cron credentials still require deployment-time validation.
  The retired provider variables remain for the currently deployed old runtime;
  remove them only with the matching Payluk-only release.

Safe local evidence: `.qa-artifacts/release-yoiyqxtpmxnrrbqqidcs.json`,
`.qa-artifacts/release-jxgpvvehajxegeeozlnl.json` and
`.qa-artifacts/production-preflight.json`. These contain no credential values.

## Shared-client compatibility blocks database lockdown

Mobile branch `fix/coordinated-release-oct-2026` now addresses the source
compatibility gaps found in the initial inspection: server-only financial and
notification mutations, atomic ticket scanning, public profile projections,
authorized friend locations, server moderation and signed private chat/report
media. It also aligns paid-price forms and bank/withdrawal interfaces with the
Payluk-only server contracts. Mobile `7efc430a` passes CI typecheck/lint, 12
contract tests and Android/iOS JavaScript bundle compilation; 44 live profile/API
contracts pass against QA. Draft PR: https://github.com/Yrdly-ng/yrdly-mobile/pull/8.
Web `812854bc` passes the full workflow, including 62 live API/security assertions;
its exact Vercel preview passes five smoke checks. Native UI/payment/device tests
and distribution still need verification.

Editing mobile source alone does not update installed clients. Establish the
released mobile version/update mechanism, ship and verify compatible clients,
and account for older installed versions before revoking shared database access.
The user has authorized mobile updates and the coordinated release. Technical
compatibility and rollout checks remain release gates.

Mobile's current `app.config.js` has no Expo Updates runtime/channel setup and
`package.json` does not include `expo-updates`. An OTA rollout is therefore not
established by this repository configuration. Verify the actual installed build
and distribution path before assuming existing clients can receive these fixes.

## Migration dependencies and release sequence

Never blanket-push the local migration directory or merge the QA database into
production. Production and QA have different histories. The QA baseline is not
a production migration; it must never be replayed there.

Four additive prerequisites are already installed in production under different
versions: `public_profiles_a` (20261010051306), `money_fixes_b` (20261010051311),
`checkout_reliability_d` (20261010051316) and `payout_reservations` (20261010051323).
Inspect live definitions again before selecting further migrations.

| Migration | Required coordination |
| --- | --- |
| `20261010152102_bind_phone_verification_challenges.sql` | Install before replacing both OTP Edge Functions; check mobile OTP compatibility. |
| `20261011065344_reserve_paid_ticket_checkout.sql` | Reconcile old unfulfilled links; release with reservation-aware checkout/fulfillment. |
| `20261011071619_reconcile_booking_checkout_ledger.sql` | Install bridge/RPC before enabling new booking checkout. |
| `20261011082302_protect_booking_checkout_schedule.sql` | Follows booking bridge; verify shared booking callers. |
| `20261011153000_reconcile_payluk_dispute_allocations.sql` | Reconcile historical splits; coordinate replacement finalizer with allocation-aware server code. |
| `20261011173901_enforce_paid_price_minimum.sql` | Follows ticket/booking RPCs; verify compatible paid-price forms in shared clients. |
| `20261011192107_payout_attempt_execution_safety.sql` | Replaces the three-argument retry RPC; freeze/drain old payout calls during coordinated cutover. |
| `20261009120100_launch_lockdown_a.sql` | Apply only after matching web and compatible shared clients are deployed and verified. |
| `20261010142106_repair_message_guard_schema.sql` | Follows lockdown; prevents assuming the optional message content column exists. |
| `20261009120300_ticket_scanning_c.sql` | Revoke legacy scan RPCs only after scanner callers are compatible. |
| `20261010054000_private_chat_report_media.sql` | Follows lockdown and compatible signing/renderers; review unmapped storage objects first. |
| `20261010145624_pin_function_search_paths.sql` | Reinspect live function bodies; apply after function replacements so pins persist. |
| `20261012125707_scope_community_role_helper.sql` | Follows the shared security definitions; restricts the helper to its caller and removes trigger RPC/anonymous mutation grants. Eight real QA tests passed. |

Prepare the exact migration/cutover/rollback bundle and validate a matching
production build before promotion. A routine code rollback is insufficient after
the old payout RPC or client permissions have been removed. Keep payment writes
paused through any incompatible schema/server cutover. Re-run the read-only
contract and unprivileged authorization checks after installation, then verify
web, shared-client and webhook behavior before enabling scheduled money jobs.

## Financial and external verification still required

- The retained funded organizer ticket cannot be claimed before **12 October
  2026, 21:47 Lagos time**, subject to a fresh provider-window check. QA cron
  schedules are disabled; no background job will execute it automatically.
  Scope the test to that owned event; do not invoke a broad payout job against
  all retained funded fixtures.
- Sandbox withdrawal success is not evidence of live-bank receipt.
- Independently confirm zero extra merchant commission on the live dashboard.
- QA leaked-password protection is enabled and a compromised-password signup
  was rejected before creating an account. Enable and verify the matching
  production Auth setting during the coordinated release.
- PR 74 still has a failing check from an old inaccessible Vercel team; the actual
  current project's exact preview is READY and smoke-tested. Resolve ownership
  of the stale integration without falsifying its status. This session's browser
  bridge is unavailable; the CLI account cannot manage that old team.
- Paid-event refunds/cancellation remain support-assisted. Automated whole-event
  and partial-ticket refunds have not passed a funded lifecycle test.
- Verify real-device push and real Google consent/callback completion. Browser
  request-construction tests are separate evidence from a Google login.
- Seven Payluk calls for one normal withdrawal do not establish throughput for
  concurrent customers across all applications sharing a 10/minute key.

Keep PR 74 in draft until its actual release gates are satisfied. Green QA
checks establish QA behavior; they do not install production prerequisites.
