# Production release — 14 October 2026

Web and mobile release work is on `main`. The primary local folders are checked
out on `main`; user-owned agent files and mobile .gitignore changes were preserved.
The user is handling the IPA. No iOS build or store submission was started.

## Live website and Android APK

- Web PR 74 merged as `bec1bebfc38a30d6fde834b45b77e35968373fa5`.
  Vercel confirmed that exact main source READY at `https://app.yrdly.ng`.
- Web `098f6d99` adds main-branch CI verification. Its production deployment
  `dpl_DxFS6XopK1z2Lh8LqNgzJnELivj5` is READY. Runtime application code is
  unchanged from the validated release. Subsequent documentation/CI commits
  should be checked against live Vercel metadata before reporting their rollout.
- Mobile main `4efbf80d152c882ae34f290f696665bab1775976` includes video editing,
  full-frame feed media, credential/archive exclusions, signup contrast and the
  Android dex build-memory correction.
- Production APK build `51ca19d3-3d92-43b9-9593-911abd1c2da6` finished on
  14 October at 11:17 UTC from that exact mobile main source, profile `apk`.
  The downloadable artifact returned HTTP 200 (180,758,258 bytes).
  https://expo.dev/accounts/yrdly-ltd/projects/yrdly/builds/51ca19d3-3d92-43b9-9593-911abd1c2da6

## Backend cutover completed

Production Supabase is `yoiyqxtpmxnrrbqqidcs`; isolated QA remains
`jxgpvvehajxegeeozlnl`. Source control on main does not mean destructive or funded
regression tests should run against production.

A completed daily backup dated 13 October at 01:20:50 UTC and a private schema,
function, grant, RLS and storage snapshot were verified before the cutover. PITR
was unavailable; a restore rehearsal was not performed.

A brief maintenance deployment and temporary database write guards protected the
cutover. Fourteen selected migrations were applied individually with reviewed
hashes, followed by the explicit production-default grant correction. Never
blanket-push the migration directory, merge QA into production, or replay these
migrations. The QA baseline is not a production migration.

| Applied migration | Purpose |
| --- | --- |
| `20261010152102_bind_phone_verification_challenges` | Bind OTP attempts to authenticated challenges. |
| `20261011065344_reserve_paid_ticket_checkout` | Reserve capacity before paid checkout. |
| `20261011071619_reconcile_booking_checkout_ledger` | Bridge bookings and escrow ledger. |
| `20261011082302_protect_booking_checkout_schedule` | Guard booking checkout schedule. |
| `20261011153000_reconcile_payluk_dispute_allocations` | Persist and reconcile dispute allocations. |
| `20261011173901_enforce_paid_price_minimum` | Enforce paid-price minimum. |
| `20261011192107_payout_attempt_execution_safety` | Guard payout attempts and retries. |
| `20261009120100_launch_lockdown_a` | Shared data/financial permission lockdown. |
| `20261010142106_repair_message_guard_schema` | Match actual message schema. |
| `20261009120300_ticket_scanning_c` | Atomic authorised ticket scanning. |
| `20261010054000_private_chat_report_media` | Private chat/report storage. |
| `20261010145624_pin_function_search_paths` | Pin function search paths. |
| `20261012125707_scope_community_role_helper` | Scope role checks to the caller. |
| `20261012130109_community_submission_dismissal_and_duplicates` | Owner dismissal and submission uniqueness. |
| `20261013112556_revoke_submission_trigger_rpc_access` | Remove direct client grants inherited from production defaults. |

All **40 production database contracts passed again on 14 October**. The
temporary write guards are removed. Four matching Edge Functions are active:
`send-phone-otp` v21, `verify-phone-otp` v16, `send-push-notification` v16 and
`moderate-content` v8. Their custom authentication rejected anonymous requests
with 401/401/403/401. Their `verify_jwt: false` setting is intentional; request
bodies enforce the reviewed authentication paths. Production compromised-password
protection is enabled and was read back successfully.

The unsafe legacy `expire-stale-pending-escrow` database cron remains disabled;
`digest-reminders` is active. The one-off deployment initially held scheduled
money jobs. The subsequent main deployment restored the four tracked Vercel
schedules, including auto-release and event payouts; do not describe them as
still held. No broad financial cron was manually invoked.

Expected security-advisor notices remain for the deliberately narrow
`public_profiles` projection and reviewed caller-scoped privileged helpers.
Service-only tables intentionally have no client policies. Passing the release
contracts does not mean every advisory is absent.

## Verification and the tester's authentication report

- Mobile main CI `38552774128` passed typecheck, lint, 41 release tests and both
  Android/iOS JavaScript bundles. Local lint has 838 existing warnings, no errors.
- Nine auth/onboarding screens used dark light-mode text on fixed dark surfaces.
  All nine light-mode contrast cases failed before correction; all eighteen
  light/dark cases now pass against actual screen styles. New APK installation
  is required for the fix. See mobile `docs/auth-release.md`.
- The tester's APK `c078a366` is a QA build from `abd3f91`, not the new production
  APK. QA's public Google OAuth request reproduces `redirect_uri_mismatch`;
  production's branded callback reaches Google sign-in without that error.
- QA's missing native return URL was added and read back. Google's separate QA
  callback registration remains pending operator confirmation:
  `https://jxgpvvehajxegeeozlnl.supabase.co/auth/v1/callback`. Keep production's
  existing callback entries. This affects QA; the new production APK uses the
  accepted production callback.
- Production `/home` returned 200; anonymous payout-balance and ticket-scan
  requests returned 401. No financial writes were made by these smoke checks.
- Runtime web release CI `38387265519` passed. A later main CI attempt was
  rejected before running because the isolated QA environment only permitted
  the old audit branch. Main was added explicitly to that environment's branch
  allowlist; existing protections remain. Re-run the main workflow and
  retain its result separately from the earlier passing release.

## Payment evidence and remaining limits

The retained owned organiser fixture matured and completed through the actual
unchanged main service against **Payluk sandbox** on 14 October: gross NGN 2,500,
Yrdly commission NGN 75, proceeds NGN 2,376.50, withdrawal fee NGN 10.75 and bank
credit NGN 2,365.75. One claim and one transfer executed. Read-only provider
history confirmed exactly one successful withdrawal to the authorised account.
A repeat service call made no provider request. The exclusive attempt marker is
retained; never run the execution harness again.

The user previously confirmed a bank receipt for payout
`e8f06ce9-9dcc-4f47-a755-93a088bdbd0d`; it was not repeated. Historical production
payout `2b301876-80e3-4ce0-901d-68f771cf6717` remains pending without a provider
reference. Do not retry, delete or invent its outcome without reconciliation.

Still unverified: completed production Google account sign-in/session restart,
new-APK device rendering/autofill, user-built IPA, real native/browser video
export and audio/framing, real-device push and Crisp conversation/account switch.
The user skipped further video feature runtime checks. Earlier user-reported
Samsung A21s/iPhone 12 passes do not verify these newer builds. Paid-event
cancellation/refund automation remains support-assisted and lacks a funded
lifecycle test. Merchant dashboard commission removal is user-reported.

A previous raw EAS log filter exposed environment values. The user was informed
that the exposed Termii credential should be rotated. Avoid printing job/env
records or signed log URLs; extract only compiler-phase string messages and
redact known values. Maps keys remain unchanged at the user's instruction.

Private evidence lives in `.qa-artifacts/`, including production backup/schema
snapshots, the cutover state, combined 40-contract queries, organiser payout and
read-only reconciliation summaries. Credentials and private evidence must stay
out of source control. Older preflight documents are historical, not current
release status. Code rollback to the pre-lockdown runtime is unsafe after this
schema cutover; prefer a compatible forward fix and a deliberate restore plan.
