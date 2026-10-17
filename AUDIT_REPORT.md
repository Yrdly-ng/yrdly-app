# YRDLY web application audit

Date: 9 October 2026. Scope: `yrdly-app`, current `main` at `b38dccf24cc0f42a7bbd0cecf321272c89ac8434`, plus read-only inspection of its connected Supabase backend. Other applications and branches were not audited.

## Verdict and evidence limits

**Do not treat the current app as financially or security QA-approved.** The strongest problems are client-editable payment identity/financial state, ticket issuance without payment proof, payout false-success handling, inconsistent refund processing and broken scanner/schema integration.

**39 findings: 1 Critical, 31 High, 6 Medium, 1 Low.** There are **30 VERIFIED and 9 INFERRED** findings. Per the requested severity rule, findings involving money, permissions or data exposure are at least High; this includes inaccurate commission disclosure.

VERIFIED means the exact implementation/live configuration was read, a read-only query confirmed it, or an in-memory reproduction ran. It does **not** mean a proposed mutating reproduction was executed against real users. INFERRED identifies an operational consequence that still needs a development/payment-sandbox test. Suggested reproductions involving writes are instructions for an isolated test environment, not actions taken during this audit.

No fixes, commits, migrations, deployments, payment initiations, messages or notification sends were performed. The only requested deliverable is this report. Source and backend state were already present before the audit; the working tree was clean before report creation.

## Baseline — literal command output

The no-other-files rule prevents ordinary build/test commands from writing caches, generated files and browser artifacts. Installed executables were used with write-producing features disabled where possible. The exact requested plain `npx tsc --noEmit` and an unrestricted `next build` were not completed; the substitutions and restrictions are explicit below.

### Git

Commands: `git branch`, `git status`, `git log -1`. Exit 0.

```text
  feat/desktop-layout
  feat/responsiveness-pass
  feature/cloudflare-integration
* main
  paystack-integration
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
commit b38dccf24cc0f42a7bbd0cecf321272c89ac8434
Author: Oluwaferanmi-Dev <feranmioyelowo@gmail.com>
Date:   Fri Oct 9 16:08:31 2026 +0100

    fix: handle community join requests and add marketplace listing payment checks
```

### TypeScript

`.next/types` exists. It was not regenerated or deleted. Consequently this check includes the existing generated Next types; it cannot certify fresh generated types.

An initial `npx --no-install tsc --noEmit --incremental false` produced no output and was interrupted. The installed equivalent `./node_modules/.bin/tsc --noEmit --incremental false` completed with exit **0**, with empty stdout/stderr. Incremental writes were disabled to preserve the read-only requirement.

Literal compiler output:

```text
```

No TS2882 was observed. A normal incremental `npx tsc --noEmit` was not certified.

### Lint

Initial command: `pnpm exec next lint --no-cache`. Exit **1**. The package-manager wrapper attempted dependency maintenance and aborted; no dependency install was retried.

```text
[ERR_PNPM_META_FETCH_FAIL] GET https://registry.npmjs.org/pnpm: fetch failed

   ╭──────────────────────────────────────────╮
   │                                          │
   │   Update available! 11.2.2 → 12.10.1.    │
   │   Changelog: https://pnpm.io/v/12.10.1   │
   │     To update, run: pnpm add -g pnpm     │
   │                                          │
   ╰──────────────────────────────────────────╯

[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules directory due to no TTY

If you are running pnpm in CI, set the CI environment variable to "true", or set "confirmModulesPurge" to "false".
[ERROR] Command failed with exit code 1: pnpm install

pnpm: Command failed with exit code 1: pnpm install
    at getFinalError (file:///Users/macbook/.nvm/versions/node/v24.16.0/lib/node_modules/pnpm/dist/pnpm.mjs:29448:14)
    at makeError (file:///Users/macbook/.nvm/versions/node/v24.16.0/lib/node_modules/pnpm/dist/pnpm.mjs:31755:21)
    at getSyncResult (file:///Users/macbook/.nvm/versions/node/v24.16.0/lib/node_modules/pnpm/dist/pnpm.mjs:33599:10)
    at spawnSubprocessSync (file:///Users/macbook/.nvm/versions/node/v24.16.0/lib/node_modules/pnpm/dist/pnpm.mjs:33559:14)
    at execaCoreSync (file:///Users/macbook/.nvm/versions/node/v24.16.0/lib/node_modules/pnpm/dist/pnpm.mjs:33489:23)
    at callBoundExeca (file:///Users/macbook/.nvm/versions/node/v24.16.0/lib/node_modules/pnpm/dist/pnpm.mjs:36017:23)
    at boundExeca (file:///Users/macbook/.nvm/versions/node/v24.16.0/lib/node_modules/pnpm/dist/pnpm.mjs:35994:49)
    at sync (file:///Users/macbook/.nvm/versions/node/v24.16.0/lib/node_modules/pnpm/dist/pnpm.mjs:36149:14)
    at runPnpmCli (file:///Users/macbook/.nvm/versions/node/v24.16.0/lib/node_modules/pnpm/dist/pnpm.mjs:213263:5)
    at runDepsStatusCheck (file:///Users/macbook/.nvm/versions/node/v24.16.0/lib/node_modules/pnpm/dist/pnpm.mjs:214967:7)
```

Fallback command: `NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next lint --no-cache`. Exit **0**, **21 existing warnings**. Full combined stdout/stderr:

```text
`next lint` is deprecated and will be removed in Next.js 16.
For new projects, use create-next-app to choose your preferred linter.
For existing projects, migrate to the ESLint CLI:
npx @next/codemod@canary next-lint-to-eslint-cli .


./src/app/(app)/bookings/[bookingId]/page.tsx
42:6  Warning: React Hook useEffect has a missing dependency: 'fetchBooking'. Either include it or remove the dependency array.  react-hooks/exhaustive-deps

./src/app/(app)/communities/[id]/page.tsx
41:11  Warning: Using `<img>` could result in slower LCP and higher bandwidth. Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images. This may incur additional usage or cost from your provider. See: https://nextjs.org/docs/messages/no-img-element  @next/next/no-img-element
66:15  Warning: Using `<img>` could result in slower LCP and higher bandwidth. Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images. This may incur additional usage or cost from your provider. See: https://nextjs.org/docs/messages/no-img-element  @next/next/no-img-element

./src/app/(app)/communities/[id]/posts/[postId]/page.tsx
102:13  Warning: Using `<img>` could result in slower LCP and higher bandwidth. Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images. This may incur additional usage or cost from your provider. See: https://nextjs.org/docs/messages/no-img-element  @next/next/no-img-element
146:17  Warning: Using `<img>` could result in slower LCP and higher bandwidth. Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images. This may incur additional usage or cost from your provider. See: https://nextjs.org/docs/messages/no-img-element  @next/next/no-img-element

./src/app/(app)/communities/page.tsx
137:267  Warning: Using `<img>` could result in slower LCP and higher bandwidth. Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images. This may incur additional usage or cost from your provider. See: https://nextjs.org/docs/messages/no-img-element  @next/next/no-img-element
138:266  Warning: Using `<img>` could result in slower LCP and higher bandwidth. Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images. This may incur additional usage or cost from your provider. See: https://nextjs.org/docs/messages/no-img-element  @next/next/no-img-element
202:17  Warning: Using `<img>` could result in slower LCP and higher bandwidth. Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images. This may incur additional usage or cost from your provider. See: https://nextjs.org/docs/messages/no-img-element  @next/next/no-img-element

./src/app/(app)/community-review/page.tsx
64:31  Warning: Using `<img>` could result in slower LCP and higher bandwidth. Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images. This may incur additional usage or cost from your provider. See: https://nextjs.org/docs/messages/no-img-element  @next/next/no-img-element
67:34  Warning: Using `<img>` could result in slower LCP and higher bandwidth. Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images. This may incur additional usage or cost from your provider. See: https://nextjs.org/docs/messages/no-img-element  @next/next/no-img-element

./src/app/(app)/events/[id]/scan/page.tsx
158:6  Warning: React Hook useEffect has missing dependencies: 'startCameraScanner' and 'stopCameraScanner'. Either include them or remove the dependency array.  react-hooks/exhaustive-deps

./src/app/(app)/marketplace/create/page.tsx
74:6  Warning: React Hook useEffect has a missing dependency: 'locationAddress'. Either include it or remove the dependency array.  react-hooks/exhaustive-deps

./src/app/layout.tsx
70:9  Warning: Custom fonts not added in `pages/_document.js` will only load for a single page. This is discouraged. See: https://nextjs.org/docs/messages/no-page-custom-font  @next/next/no-page-custom-font

./src/app/onboarding/verify-email/page.tsx
75:6  Warning: React Hook useEffect has missing dependencies: 'filled', 'handleVerifyOtp', and 'verifying'. Either include them or remove the dependency array.  react-hooks/exhaustive-deps

./src/app/onboarding/verify-phone-otp/page.tsx
80:6  Warning: React Hook useEffect has missing dependencies: 'filled', 'handleVerifyOtp', and 'verifying'. Either include them or remove the dependency array.  react-hooks/exhaustive-deps

./src/components/CommentSection.tsx
277:8  Warning: React Hook useCallback has a missing dependency: 'scrollCommentsToBottom'. Either include it or remove the dependency array.  react-hooks/exhaustive-deps

./src/components/marketplace/MarketplaceScreen.tsx
131:6  Warning: React Hook useMemo has a missing dependency: 'CATEGORY_PILLS'. Either include it or remove the dependency array.  react-hooks/exhaustive-deps

./src/components/messages/MessagesScreen.tsx
287:6  Warning: React Hook useCallback has an unnecessary dependency: 'initialConvId'. Either exclude it or remove the dependency array.  react-hooks/exhaustive-deps

./src/components/posts/PostCard.tsx
360:6  Warning: React Hook useEffect has a missing dependency: 'activeIndex'. Either include it or remove the dependency array.  react-hooks/exhaustive-deps

./src/components/notifications/PushNotificationManager.tsx
106:8  Warning: React Hook useEffect has a missing dependency: 'subscribeUser'. Either include it or remove the dependency array.  react-hooks/exhaustive-deps

./src/hooks/use-posts.tsx
250:6  Warning: React Hook useEffect has a missing dependency: 'buildBaseQuery'. Either include it or remove the dependency array.  react-hooks/exhaustive-deps

info  - Need to disable some ESLint rules? Learn more here: https://nextjs.org/docs/app/api-reference/config/eslint#disabling-rules
```

### Next build

The package `build` script first runs `scripts/inject-sw-version.js`, which writes the service worker. That script was not run. The installed Next CLI's `build` entry was attempted inside an inline filesystem guard rejecting writes, with telemetry disabled. It exited **1** at its first filesystem write.

```text
   ▲ Next.js 15.5.18
   - Environments: .env.local
   - Experiments (use with caution):
     · optimizePackageImports


> Build error occurred
Error: PHASE_0_READ_ONLY: filesystem writes prohibited by audit instructions
    at deny ([stdin]:3:32)
    at fs.promises.<computed> [as mkdir] ([stdin]:5:284) {
  code: 'EROFS'
}
```

**Build-derived route count: unavailable.** This is an audit restriction failure, not evidence that application compilation fails.

Read-only source inventory, literal output:

```text
{"pages":107,"routeHandlers":53,"sourceEntries":160}
.next/types exists=true
test scripts={"test:e2e":"e2e run","test:e2e:smoke":"e2e run tests/smoke.e2e.ts"}
```

These are source entries, not a Next build route manifest. The 53 handlers comprise 52 API handlers and the auth callback; metadata routes are not represented by that count.

### Existing tests

The repository has `test:e2e` and `test:e2e:smoke`, configured in `e2e.config.ts`. The single checked-in smoke test, `tests/smoke.e2e.ts`, opens `/legal/privacy` and checks its heading.

**Existing E2E suite not run:** its configuration can start `pnpm run dev`, and Next/browser/test tooling writes generated files/artifacts. No test-suite output exists to paste; no passing-suite claim is made. Ad hoc payment/database scripts were inspected selectively and not run because they may mutate records or transfer money.

Safe additional checks used inline Node programs, existing TypeScript transpilation and mocked dependencies entirely in memory, without test files or network requests. Their literal output:

```text
withdrawToBank upstream=pending => success=true
withdrawToBank upstream=failed => success=true
withdrawToBank upstream=successful => success=true
event payout when Payluk success=false => COMPLETED
event payout released timestamp set=true, fallback calls=0
event payout ticket status filter=PAID
commission on NGN 1000=30
middleware host=localhost:9002 /login => https://yrdly.ng/
middleware host=preview.vercel.app /login => https://yrdly.ng/
middleware host=app.yrdly.ng /login => https://yrdly.ng/
callback backslash next => https://attacker.example
location after async home profile loads => All Nigeria, filter=null
```

```text
Payluk HMAC checks: valid accepted; changed body, malformed signature, missing signature and missing secret rejected. PASS
```

**Baseline separation:** no TypeScript errors or lint errors were observed with the read-only substitutions. Lint warnings/deprecation already exist. The pnpm wrapper/network failure and blocked build are environment/audit constraints. E2E and visual tests remain unexecuted. Nothing was fixed to make checks pass.

## Findings

References to live policies/functions below are observations from `pg_policies`, `pg_proc`, effective grants, trigger definitions, schema/defaults/constraints and indexes on the connected backend. Tracked migrations were compared with live definitions rather than assumed to have been applied.

| ID | Severity | Area | File:line | What's wrong | How to reproduce | VERIFIED or INFERRED | Suggested fix — not applied |
|---|---|---|---|---|---|---|---|
| F01 | Critical | Payment identity | [payluk-onboarding.ts:47](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/payments/payluk-onboarding.ts:47); [payluk-service.ts:513](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/payments/payluk-service.ts:513) | A self-editable `users.payluk_customer_id` is trusted immediately. Live self-UPDATE protects only `id`; the privilege trigger protects `is_admin`/`role`, not payment identity. Name-only recovery can also bind an unrelated customer's wallet. Withdrawals use this ID with the caller's bank details. | On an isolated backend, set your profile's provider ID to another merchant customer's ID, then inspect balance/withdrawal routing. No identity changes or withdrawals were attempted here. | VERIFIED | Make provider identity server-owned, unique and immutable to clients; bind recovery to verified identity, never name alone. Reconcile existing mappings. |
| F02 | High | User data exposure | [auth-service.ts:219](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/auth/auth-service.ts:219); live `pg_policies: public.users` | `Users can read all users` permits every authenticated user to SELECT all columns. Broad grants expose email, phone, provider IDs and location fields despite privacy preferences. | Inspect the policy `auth.role() = 'authenticated'` and column grants; use a second test user's REST session to request another profile's private fields in development. No private rows were dumped. | VERIFIED | Expose a minimal public profile view; restrict private profile and location columns to their owner and authorized services. |
| F03 | High | OTP / trust flags | [page.tsx:65](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/onboarding/verify-phone-otp/page.tsx:65); [auth-service.ts:283](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/auth/auth-service.ts:283) | Clients may directly set `phone_verified`, phone and other unguarded trust fields on their profile. The live phone trigger timestamps a flag change; it does not establish that Termii verified that number. | In development, UPDATE your own `phone_verified` without invoking OTP. Check that no INSERT/UPDATE trigger guards it. This write was not executed. | VERIFIED | Reserve verification flags and verified phone changes for the server OTP flow; derive identity from the verified provider response. |
| F04 | High | Escrow authorization | [escrow-service.ts:19](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/payments/escrow-service.ts:19); live `pg_policies: public.escrow_transactions` | INSERT and UPDATE allow `buyer_id = auth.uid() OR seller_id = auth.uid()` without column/state restrictions. Participants can fabricate financial amounts, completion state, counterparties and provider references; only an updated-at trigger exists. | Inspect live policies/triggers; in development attempt a direct REST update of a participant transaction's amount/status. No financial records were altered. | VERIFIED | Remove client financial writes; enforce transitions and immutable identities/amounts in transactional server operations and database guards. |
| F05 | High | Payout authorization | [route.ts:31](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/seller/payouts/request/route.ts:31); [payout-service.ts:207](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/payments/payout-service.ts:207) | Live self-ALL policies let sellers rewrite payout statuses/amounts/account links and mark their bank account verified. Manual withdrawal checks only an active account, not verification or cooling-off. Wallet balance also replaces the balance after pending reservations are deducted. | Inspect `seller_accounts` and `payout_requests` policies, their triggers, the active-account query and `availableBalance = wallet.mainBalance` at payout-service:71. Exercise forged verification/status/account links only in development. | VERIFIED | Make verification, payout state and account ownership server-controlled; enforce cooling-off and reserve available funds atomically. |
| F06 | High | Ticket forgery | [20261003030000_launch_security_hardening.sql:184](/Users/macbook/Documents/projects/YRDLY/yrdly-app/supabase/migrations/20261003030000_launch_security_hardening.sql:184); live `tickets_insert_own` | A buyer can INSERT their own `tickets` row with `status = 'PAID'` without payment proof. The update guard runs only BEFORE UPDATE; the insert trigger checks capacity, not payment. The live default status is PAID. | Inspect the INSERT policy `buyer_id = auth.uid()`, column defaults and triggers. On an isolated project insert a self-owned ticket for a paid tier without checkout. Not attempted live. | VERIFIED | Disallow client ticket issuance; issue free and paid tickets through server operations that verify tier, buyer, price and payment. |
| F07 | High | Refund webhook / inventory | [route.ts:501](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/webhooks/payluk/route.ts:501) | Refund handling writes `status: 'refunded'` and `refunded_at`; neither is supported by the live escrow schema. Errors are logged, then tickets/stock are changed and the webhook returns 200. Replays can repeatedly restore catalog quantity because the transaction never reaches the skip state. Completed/claimed handlers also use only `status != completed`, permitting replacement of cancelled/disputed states by delayed events. | Read-only enum cast rejects `refunded` with 22P02; metadata shows no `refunded_at`. Inspect the continuation after `updateError`. Replay signed fixture events against a development backend. | VERIFIED | Use canonical cancelled/refund-amount semantics and explicit allowed transitions; commit refund/inventory effects once, transactionally, and durably reconcile failures. |
| F08 | High | Event cancellation / refunds | [route.ts:53](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/events/cancel/route.ts:53) | The legacy active `/api/events/cancel` route cancels an event and all non-USED tickets without requesting refunds, checking payout state or recording refund amounts. It bypasses the safer `/api/events/[id]/cancel` flow. | As an organiser in development, call the legacy endpoint for a paid event. Inspect that it performs only event/ticket updates. No cancellation was invoked here; no current web caller was found. | VERIFIED | Remove the bypass or route it through the same refund and settlement workflow as the current cancellation endpoint. |
| F09 | High | Withdrawal result handling | [payluk-service.ts:1189](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/payments/payluk-service.ts:1189) | The condition accepts envelope status 200 even when `data.status` is pending or failed: `... \|\| verifyResponse.status === 200`. The seller ledger can report completed before bank success. | Actual service code was run with mocked provider replies. Both pending and failed produced `success=true`; literal results appear below. | VERIFIED | Require the provider's documented terminal success state; persist pending outcomes and reconcile them through status checks/webhooks. |
| F10 | High | Event payout result handling | [event-escrow-service.ts:189](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/events/event-escrow-service.ts:189) | The return value of `withdrawToBank` is ignored and `transferSuccess = true` is unconditional. Rejected withdrawals mark payouts COMPLETED and set `payout_released_at`, suppressing later attempts. | Actual service code with a mocked `{success:false}` Payluk result marked the payout COMPLETED, released the event and never called fallback. | VERIFIED | Inspect the result explicitly; persist the provider reference and confirmed terminal outcome before releasing the payout. |
| F11 | High | Event organiser earnings | [event-escrow-service.ts:115](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/events/event-escrow-service.ts:115) | Payout revenue includes only `status = 'PAID'`. Valid scanned tickets are USED and disappear from the sum; an all-scanned event returns without payout. | Inspect the status filter and early return at line 119; the mock captured the PAID-only query. Compare PAID and USED ticket earnings on a development fixture. | VERIFIED | Include all financially paid, non-refunded tickets independently of attendance state. |
| F12 | High | Event settlement routing | [route.ts:249](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/events/tickets/purchase/route.ts:249); [event-escrow-service.ts:175](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/events/event-escrow-service.ts:175) | Purchase defaults to Paystack and can attach a split subaccount; payout defaults to Payluk using different env variables and does not inspect prior split settlement. This can fund payouts from the wrong wallet or pay an already-settled organiser again. | Configure a development Paystack split purchase, then run matured payout processing with default payout configuration. Actual settlement timing/double payment was not tested. | INFERRED | Record the payment and settlement provider/mode per order; reconcile split settlements and pay only genuinely held, unsettled funds. |
| F13 | High | Withdrawal retry idempotency | [payluk-service.ts:1097](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/payments/payluk-service.ts:1097); [payout-service.ts:372](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/payments/payout-service.ts:372); [route.ts:42](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/seller/payouts/[payoutId]/retry/route.ts:42) | Each attempt creates timestamped provider references. A network error after provider acceptance becomes a failed payout, and the retry route creates another attempt without first reconciling the earlier reference. Duplicate bank debits are possible. | In a payment sandbox, accept verification then drop the response; retry the failed payout and compare provider transfers. This ambiguous-response scenario was not executed. | INFERRED | Persist a stable operation/reference before transfer; keep uncertain outcomes reserved and reconcile before allowing retry. |
| F14 | High | Checkout concurrency / stock | [route.ts:306](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/payment/initialize/route.ts:306); [route.ts:138](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/webhooks/paystack/route.ts:138) | The route relies on `idx_escrow_transactions_single_active_post`, but it is absent live. Parallel buyers can pass the availability read and reserve separate escrows. Catalog stock is also updated by read/modify/write rather than an atomic reservation/decrement. | SELECT of live indexes confirms no reservation uniqueness. Race two sandbox checkouts for one listing/last catalog unit; no checkouts or provider calls were made here. | INFERRED | Restore a validated single-listing reservation invariant; reserve catalog units transactionally with conditional stock updates. |
| F15 | High | Checkout retries / late payments | [route.ts:229](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/payment/initialize/route.ts:229); [route.ts:64](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/payment/webhook/route.ts:64) | A same-buyer retry cancels a local pending transaction without cancelling or reconciling its provider escrow. Late success events for cancelled transactions are skipped. Stale creation cleanup also uses original `created_at`, and final provider-details writes have no state condition. | In a sandbox, leave the first checkout payable, start a second, then pay the first or deliver a delayed event. Verify unmatched payments and concurrent finalization. Not run against real payments. | INFERRED | Reconcile provider state before replacement; use durable attempt states, actual lock timestamps and conditional finalization. |
| F16 | High | Marketplace deletion | [20261008105151_protect_paid_marketplace_listings.sql:13](/Users/macbook/Documents/projects/YRDLY/yrdly-app/supabase/migrations/20261008105151_protect_paid_marketplace_listings.sql:13) | The deployed BEFORE DELETE trigger compares text `tx.item_id` with UUID `OLD.id` and includes nonexistent escrow enum values `funds_held`/`refunded`. Its query fails before it can decide whether a post has been paid for. | Equivalent read-only SELECT expressions failed with 42883 (`text = uuid`) and 22P02 (`funds_held`). No DELETE was run. Test unpaid/paid deletion only in development. | VERIFIED | Use compatible ID types and actual enum states; validate both unpaid deletion and paid-listing protection. |
| F17 | High | Suspension / account enforcement | [user-suspension.ts:11](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/moderation/user-suspension.ts:11); [route.ts:42](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/admin/users/suspend/route.ts:42) | Suspension reads and admin writes reference missing `users` columns. The helper returns `{suspended:false}` on query error, and sign-in ignores the profile query error. The admin action cannot persist the intended ban. | Read-only SELECT of the requested columns failed with 42703; inspect the helper's fail-open return and admin update payload. No accounts were suspended. | VERIFIED | Align the account-state schema and guards; enforce suspension on server operations and handle lookup failure explicitly. |
| F18 | High | QR scanning | [route.ts:27](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/tickets/scan/route.ts:27); live `scan_ticket(text,uuid,uuid)` | The web scanner calls a deployed RPC referencing nonexistent `events.user_id`, causing a schema error. That SECURITY DEFINER overload is also executable by anon/authenticated, trusts `p_scanner_id` rather than `auth.uid()`, and lacks an atomic unused-ticket transition. Repairing only the missing column leaves authorization/race risks. | SELECT `user_id` from events failed with 42703. Read both scan overloads and grants. Do not invoke them live: they mutate tickets. Test organiser/non-organiser and simultaneous scans in development. | VERIFIED | Use one authenticated organiser-only, event-bound scan operation with an atomic PAID-to-USED transition and expiry/refund checks. |
| F19 | High | Social RPC impersonation | [20260912151500_toggle_post_like_rpc.sql:1](/Users/macbook/Documents/projects/YRDLY/yrdly-app/supabase/migrations/20260912151500_toggle_post_like_rpc.sql:1); [20260716000000_notification_grouping.sql:5](/Users/macbook/Documents/projects/YRDLY/yrdly-app/supabase/migrations/20260716000000_notification_grouping.sql:5) | Live SECURITY DEFINER `toggle_post_like`, `create_notification` and `remove_notification_actor` accept caller-supplied actor/recipient IDs without checking the authenticated actor; anon and authenticated have EXECUTE. Clients can impersonate likes and spoof/remove notifications across accounts. | Inspect `pg_get_functiondef` and effective EXECUTE privileges. Try cross-user RPC calls only on an isolated backend. No likes or notifications were changed. | VERIFIED | Derive actor identity from auth; authorize recipients/actions, restrict system notification creation, fix search paths and revoke inappropriate EXECUTE grants. |
| F20 | High | Push notification authorization | [index.ts:26](/Users/macbook/Documents/projects/YRDLY/yrdly-app/supabase/functions/send-push-notification/index.ts:26) | The deployed function accepts arbitrary `userId`/payload, uses service role to fetch subscriptions and sends without authenticating/authorizing the caller inside the function. Gateway JWT verification is enabled but does not establish permission to notify that recipient. | Read deployed version 15 and local source: no `getUser` or recipient authorization. Test a cross-user request with stubbed delivery in development; no push was sent. | VERIFIED | Authorize notification actions and recipients server-side; restrict service-only system pushes and reject arbitrary client payloads. |
| F21 | High | Safety alert permissions | [alert-service.ts:178](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/notifications/alert-service.ts:178); live `pg_policies: public.safety_alerts` | Any signed-in user can UPDATE any safety alert: both predicates are `auth.uid() IS NOT NULL`. INSERT checks ownership only, so callers may also submit an approved state instead of the UI's pending state. | Inspect policies and lack of a write guard; use two development accounts to attempt altering/approving another alert. No live alert changes were made. | VERIFIED | Restrict author edits to allowed fields and enforce moderation state server-side; reserve approval/global edits for moderators. |
| F22 | High | Storage write permissions | [storage-service.ts:280](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/media/storage-service.ts:280); live `pg_policies: storage.objects` | Broad post-images and chat-images UPDATE/DELETE policies lack owner checks; restrictive overlapping policies do not neutralize permissive ones. `Service upload brand-assets` permits public INSERT into that bucket. | Inspect bucket-only predicates and effective permissive policy union. Attempt overwrite/delete/upload using test objects in an isolated bucket; no objects were changed. | VERIFIED | Replace broad policies with owner/conversation authorization, restrict brand uploads to services and enforce bucket size/type limits. |
| F23 | High | Private media exposure | [storage-service.ts:309](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/media/storage-service.ts:309); [storage-service.ts:475](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/media/storage-service.ts:475) | Chat image/video and report buckets are public. Chat image SELECT is also allowed to all authenticated users, not just conversation members. Report records are private by RLS, but their attachments use public URLs. | Read `storage.buckets.public` and policies; code returns `getPublicUrl`. Verify unauthenticated access using a synthetic development attachment. No real media was downloaded. | VERIFIED | Use private buckets and authorized signed URLs for chat/report media; review already exposed objects and URLs. |
| F24 | High | Chat membership / integrity | [20261006174738_disable_group_messaging.sql:33](/Users/macbook/Documents/projects/YRDLY/yrdly-app/supabase/migrations/20261006174738_disable_group_messaging.sql:33); live `check_message_update_rules()` | A conversation participant may rewrite `participant_ids` as long as they remain a member, granting an outsider access to existing messages. Message UPDATE permits participants broadly, while the content guard protects only text/media_url, leaving sender/conversation identity unguarded. | Inspect policies and absence of a conversation identity trigger. On development conversations, add an outsider or attempt changing message sender identity. No messages/memberships were modified. | VERIFIED | Make conversation membership and message identity immutable except through explicit authorized operations; protect all content fields. |
| F25 | High | Ticket credential exposure | [route.ts:4](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/events/tickets/verify/route.ts:4); [ticket-service.ts:33](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/events/ticket-service.ts:33) | Unauthenticated POST verification returns ticket credentials for a valid Payluk reference, including existing `ticket_code`/`qr_data`; fresh fulfillment can return credentials too. Provider payment verification does not authorize possession of the buyer's ticket. | Read the unauthenticated POST and service return shapes. In a sandbox, verify a known paid reference without a buyer session and inspect the response. No real reference was submitted. | VERIFIED | Allow server fulfillment without disclosing credentials; require buyer/organiser authorization for ticket detail/QR responses. |
| F26 | High | Commission disclosure | [EventCreatorOnboarding.tsx:186](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/components/events/EventCreatorOnboarding.tsx:186); [MarketplaceCreatorOnboarding.tsx:182](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/components/marketplace/MarketplaceCreatorOnboarding.tsx:182) | Active event and marketplace onboarding says `Yrdly takes 5%` and `You keep 95%`, while canonical commission is 3%. HomeScreen, EventsScreen and MarketplaceScreen still render these components. | Read the literal copy and current callers; compare constants.ts:81/89. The arithmetic mock confirms NGN 30 commission on NGN 1,000. | VERIFIED | Generate fee disclosures from canonical constants and state which party pays each platform/provider fee. |
| F27 | High | Moderation enforcement | [route.ts:72](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/events/create/route.ts:72); live policies on `events`/`posts` | Event moderation is supplied by the caller. POSTing PUBLISHED skips the pending-to-DRAFT branch and sets moderation approved; event-owner database writes are similarly unrestricted. General posts SELECT is `true`, exposing withheld content through direct reads. The intentional web DRAFT behavior itself is correct. | Inspect creation status handling and public read/write policies; submit a synthetic flagged fixture directly in development instead of using the web moderation step. No content was published. | VERIFIED | Make moderation decisions and protected moderation fields server-owned; enforce visibility in database/public preview paths. |
| F28 | High | Public image fetch / SSRF | [route.ts:40](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/og/media/[postId]/route.ts:40) | A public OG handler reads user-controlled image/avatar URLs with service role, then performs unrestricted `fetch(src)` with no destination allowlist, redirect validation, byte cap or explicit fetch timeout. This is a server-side request and resource-exhaustion surface. | In development, point a synthetic post image to a controlled HTTP listener and invoke its OG route. Internal-network reachability and exploitation were not probed. | INFERRED | Allow only approved media origins/protocols; reject private destinations/redirects and bound fetch time, response size and image decoding. |
| F29 | High | Checkout latency | [payluk-onboarding.ts:108](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/payments/payluk-onboarding.ts:108); [payluk-service.ts:419](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/payments/payluk-service.ts:419) | Missing-ID recovery makes sequential phone/email lookups and can scan every customer page twice. There is no fixed approximately-12-call ceiling or request deadline. Slow recovery can exhaust a serverless request before checkout completes. | Mock a duplicate-customer response, unsuccessful lookups and many pages; measure total latency under the actual Vercel limit. Real 502s and deployment limits were not reproduced. | INFERRED | Use verified stable mappings, bounded lookups and explicit deadlines; move reconciliation out of the checkout request. |
| F30 | High | Dispute finalization types | [20261006165321_20261006110721_dispute_workflow_hardening.sql:385](/Users/macbook/Documents/projects/YRDLY/yrdly-app/supabase/migrations/20261006165321_20261006110721_dispute_workflow_hardening.sql:385) | Live `finish_dispute_resolution` assigns a text variable `v_new_status` to enum `escrow_transactions.status` without a cast. There is no registered text-to-enum assignment cast. Database finalization is likely to fail after provider settlement, leaving reconciliation required. | Read the function and pg_cast metadata; exercise the settlement/finalization sequence with provider mocks on a development backend. The mutating RPC was not called here. | INFERRED | Declare the variable as the enum type or cast explicitly, and validate finalization atomically before payment sandbox testing. |
| F31 | High | Event creation atomicity | [route.ts:139](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/events/create/route.ts:139) | If ticket-tier INSERT fails after event creation, the route only logs the error and still returns `success:true`. A published paid event can be left without purchasable tiers. | Inject a ticket-tier insertion error in a development/mock backend and inspect the success response. Exact error-handling lines were read; no events were inserted. | VERIFIED | Create the event and validated tiers atomically, or roll back the event and return an actionable failure. |
| F32 | High | Business booking payment forgery | [20261003030000_launch_security_hardening.sql:140](/Users/macbook/Documents/projects/YRDLY/yrdly-app/supabase/migrations/20261003030000_launch_security_hardening.sql:140); [booking-service.ts:326](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/bookings/booking-service.ts:326) | Booking INSERT checks only `customer_id = auth.uid()`. The payment/status guard runs only BEFORE UPDATE. A client can create its booking already confirmed/paid, bypassing the later payment-required confirmation check; live constraints do not validate payment proof. | Inspect INSERT policy, trigger event and constraints. In development insert a self-owned booking with a paid payment_status without checkout. No booking was created. | VERIFIED | Enforce server-assigned initial booking/payment state on INSERT, and keep payment state exclusively server-owned. |
| F33 | Medium | Preview authentication | [middleware.ts:20](/Users/macbook/Documents/projects/YRDLY/yrdly-app/middleware.ts:20); [supabase.ts:14](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/supabase/supabase.ts:14); [supabase-server.ts:28](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/supabase/supabase-server.ts:28) | Login/signup redirects run on every hostname. Non-local cookie defaults also force the production parent domain on preview hosts. The redirect was reproduced; preview browser cookie rejection was not tested. | In-memory middleware tests for localhost, preview and production all redirected to marketing. Inspect cookie defaults; verify a preview OAuth session in a browser. | VERIFIED | Scope marketing handoff and shared-domain cookies to intended production hosts; use host-only cookies elsewhere. |
| F34 | Medium | Auth callback redirect | [route.ts:8](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/auth/callback/route.ts:8) | The same-origin test accepts a slash followed by a backslash. WHATWG URL resolution treats `/\attacker.example/path` as an external host, and the callback redirects to it for a completed profile. | Node reproduced an external origin from this input using the exact safeNext predicate. A live OAuth redirect was not performed. | VERIFIED | Resolve first and require the resulting URL's origin to equal the app origin; reject backslashes and malformed paths. |
| F35 | Medium | Default LGA scoping | [LocationContext.tsx:55](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/contexts/LocationContext.tsx:55) | Initialization is locked before the async profile arrives. With no saved filter, a later home LGA does not become active and the label stays All Nigeria. The persisted timestamp is also never checked. | Actual provider code with mocked React hooks/localStorage reproduced null profile followed by a Lagos/Ikeja profile: `All Nigeria, filter=null`. | VERIFIED | Initialize after auth/profile readiness while preserving explicit user selections; scope persistence by user and honor expiration. |
| F36 | Medium | Marketplace/business chat migration | [supabase-chat-service.ts:43](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/supabase/supabase-chat-service.ts:43); [supabase-chat-service.ts:208](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/lib/supabase/supabase-chat-service.ts:208); [ConversationScreen.tsx:245](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/components/messages/ConversationScreen.tsx:245) | New marketplace conversations are created only in conversations, but sending first inserts chat_messages whose live FK requires item_chats; failure prevents the unified insert. Legacy message SELECT is sender-only. Business messages are dual-written and merged by distinct IDs, so the deduplication retains both copies. | Read active MarketplaceChatLayout callers, live FK/policies, and ConversationScreen's dual-write/ID merge. Exercise a fresh marketplace thread and reload a business thread in development. | VERIFIED | Use one canonical conversation/message store; migrate legacy data and use a shared message identity if compatibility writes remain. |
| F37 | Medium | Directions rate limiting | [route.ts:42](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/api/directions/eta/route.ts:42) | ETA rate limiting uses SELECT followed by UPDATE/INSERT, ignores database errors and loses increments under concurrency. It is database-backed, but the limit can be exceeded or fail open. | Use concurrent mocked/development requests at the limit and inject a limiter error. Live load/billing impact was not tested. | INFERRED | Use the existing atomic limiter pattern, handle errors explicitly and reject unauthorized resource consumption. |
| F38 | Medium | Production diagnostics | [next.config.mjs:53](/Users/macbook/Documents/projects/YRDLY/yrdly-app/next.config.mjs:53) | Production configuration enables `removeConsole` for all console methods while many payment/refund failures are recorded only with console.error/warn. Those diagnostic calls are expected to disappear from compiled code. | Inspect compiler configuration and critical error handlers. A completed production build and deployed log inspection were unavailable. | INFERRED | Retain error/warn or route failures to structured server monitoring with redaction and reconciliation alerts. |
| F39 | Low | Accessibility | [page.tsx:217](/Users/macbook/Documents/projects/YRDLY/yrdly-app/src/app/(app)/settings/withdraw/page.tsx:217) | The icon-only Back button has no text, aria-label or title. The shared Button does not supply an accessible name. | Inspect the rendered JSX and Button prop forwarding; verify the accessible name with a browser accessibility tree when available. | VERIFIED | Add an explicit accessible label to this button and audit other icon-only controls. |

F30 remains an inference because the finalization RPC mutates data and was not invoked. Its type assessment follows PostgreSQL's documented distinction between assignment casts and unknown string literals. [PostgreSQL value-storage conversion rules](https://www.postgresql.org/docs/current/typeconv-query.html).

## Area-by-area audit record

“Ran” below means read-only metadata/source inspection or the explicit in-memory checks above. No API request that creates/changes application data was used.

| Area | What I read | What I ran | Findings and what checked out |
|---|---|---|---|
| 1. Auth, sessions, OTP, admin | middleware; auth-service; browser/server Supabase clients; auth callback; protected app layout; OnboardingGuard; suspension/admin routes; deployed send-phone-otp v20 and verify-phone-otp v15 | Middleware/redirect mocks; SELECT user columns, RLS, privilege guard; read deployed function source | F01–F03, F17, F33–F34. API auth helper validates users through getUser; admin privilege fields have a database guard. Termii verification checks the provider response and writes its msisdn server-side, but direct profile writes defeat that trust boundary. Real email/SMS/OAuth delivery was not tested. |
| 2. Marketplace checkout / escrow | payment initialize/verify; transaction complete/claim; Payluk confirm/claim; escrow types/service; BuyButton; listing protection migration | SELECT enum, indexes, triggers, policies; payment/commission mocks; read-only predicate checks | F01, F04, F07, F09, F13–F16, F26, F29. Listings use posts, not marketplace_items. Checkout validates authenticated buyer, seller ownership and server-side price. Canonical commission is 3%; reservation and lifecycle safety are not complete. |
| 3. Refunds / disputes | dispute opening/evidence/admin resolution; ticket-refunds; both event cancellation endpoints; ticket refund; Payluk/Paystack webhook refund handlers; booking payments | SELECT live dispute function definitions, grants, types and constraints | F07–F08, F30. Claiming dispute resolutions locks rows, validates nonnegative amounts and exact allocation sum, and records an operation; those RPCs are service-only. Event refund initiation reserves tickets and preserves an uncertain-provider lock. Full settlement and credit receipt remain unverified. |
| 4. Withdrawals / payouts | payout-service; seller setup/account/balance/preview/request/retry; Payluk withdrawal; event payout service and cron | SELECT aggregate payout/account state; mocked pending/failed withdrawals and event rejection | F01, F05, F09–F13. payout_enabled false is not the current withdrawal gate. CAS guards protect processing the same payout concurrently, but uncertain retries and result handling remain unsafe. |
| 5. Events / tiers / tickets / QR | web create/manage/scan; events create/purchase/checkin/tickets/verify/refund/cancel handlers; event/ticket services; capacity and ticket guards | SELECT ticket defaults, constraints, indexes, scan RPC definitions/grants and event columns; payout query mock | F06–F12, F18, F25–F27, F30–F31. Sold-count updates enforce capacity atomically; paid fulfillment has an ordinal uniqueness index. The separate checkin endpoint correctly checks organiser, event, expiry/refund state and uses a conditional PAID-to-USED update. The web scanner uses the broken alternate path. |
| 6. Businesses / catalogs / orders / bookings | business/catalog payment paths; booking-service; booking-payments; checkout; reviews; quote/calendar/staff policies and guards | SELECT catalog/booking/quote RLS, constraints and guards; active caller searches | F04–F05, F07, F14, F26, F32, F36. Catalog writes require business ownership. Quote-estimate UPDATE guards prevent a customer editing provider estimates; booking UPDATE guards protect payment state. Initial booking INSERT is not equally protected. Paid booking cancellation is blocked for assisted refunds rather than silently reversing money. |
| 7. Social / chat / notifications | post likes; friendship context/hook; conversations and legacy chat services; unified ConversationScreen; notification services; deployed push function | SELECT social policies, unique/self constraints, message/community guards and callable RPC definitions/grants | F19–F24, F27, F36. friend_requests prevents self-requests and duplicate unordered pairs; followers prevents duplicate directed pairs. Full follow-backed friendship lifecycle, legacy synchronization and realtime delivery were not executed. Community likes verify actor/membership and use idempotent insert/delete. |
| 8. Location / LGA / wards | LocationContext; geocoding-service; location-filtered queries and post hooks; profile fields | Profile-arrival mock; SELECT schema/policies; source scoping searches | F02, F35. Coordinate matching uses nationwide Haversine distance against lga_wards, with a 50 km unmatched cutoff; Google text is not used as the authoritative ward identifier. Selected state/LGA filters are applied in queries. Boundary accuracy, GPS and home-location onboarding were not exercised on a device. |
| 9. API routes / webhooks | Source inventory of all 53 handlers; shared auth helper; admin/cron guards; both Payluk webhook handlers; Paystack webhook; public OG/verification handlers | Handler guard inventory; pure HMAC assertions; live grants/functions/indexes | F07–F08, F13–F15, F18–F20, F25, F27–F31, F37. Payluk and Paystack authenticate raw-body signatures; secret-protected cron/admin recovery routes fail closed when their secret is absent. Public ticket verification and image fetches need the restrictions described above. Signature validity alone is not lifecycle/replay correctness. |
| 10. Supabase security | Every live public base table's RLS flag/policies; effective anon/authenticated grants; callable public function signatures/security settings; relevant function bodies and triggers; all storage policies/bucket settings | SELECT-only catalog queries across 64 tables and storage; read-only deployed OTP/push source | F01–F08, F14, F16–F24, F27, F30, F32. All 64 base tables enable RLS, but several policies permit excessive operations. notification_stats is security_invoker. Dispute operation internals deny client access; private dispute-evidence storage checks parties/admin. No mutating RPC was invoked. |
| 11. Errors / env / limits / logging / performance / dead code | Error paths, placeholder env fallbacks, rate limit implementations, Payluk recovery, compiler config, test/build scripts; legacy caller searches | Safe env-name presence check; secret-pattern source scan; typecheck/lint; installed command attempts | F09–F10, F15, F29, F31, F36–F38. Payment limiting is atomic Postgres-backed and fails closed. Payluk request errors retain HTTP/envelope/body context. CreateEventDialog has no remaining source/callers. Provider latency, compiled production diagnostics and operational alerting remain unverified. |
| 12. UI / responsiveness / forms / accessibility | MainLayout/Sidebar/Topbar/BottomNav and width helpers; marketplace/business/event screens; event form; withdraw button; shared Button | Static breakpoint, form and loading/empty-state inspection; attempted browser connection | F26, F31, F33–F35, F39. Responsive classes, min-width safeguards and loading/empty states exist. No mobile/tablet/desktop rendering pass, keyboard pass or camera test completed. Browser connection failed with “privileged native pipe bridge is not available; browser-client is not trusted”. |

## Specific reported issues — verified disposition

1. **All-host marketing redirects: VERIFIED.** The middleware mock reproduced them on localhost, a preview hostname and production. Default shared-domain cookies add a separate preview-session obstacle. F33.
2. **Sequential onboarding: VERIFIED implementation; timeout consequence INFERRED.** Stored customer IDs return immediately. Recovery can scan an unbounded number of pages, so “up to approximately 12” is not a reliable ceiling. F29. **The reported loss of Payluk error detail is not current:** paylukRequest:72–77 includes HTTP status, envelope status, message and a bounded raw-body excerpt. Those excerpts should be sanitized before any client disclosure.
3. **September 7 wallet top-up/deposit retirement: could not independently verify.** No current src wallet top-up/deposit initiation was found. The deposit-success event string in payment/webhook is a recognized webhook event, not a deposit API call. The inspected wallet diagnostic script performs a wallet GET and was not run. Current account-level capability needs a provider notice and sandbox verification; the reported retirement is not treated as a fact. [Official Payluk documentation](https://docs.payluk.ng/introduction).
4. **payout_enabled false / Unauthorized: partly VERIFIED, reported causal link unsupported.** See exact gates and aggregates below. Current code does not use payout_enabled to authorize withdrawal. Paystack subaccount columns still have event split-payment consumers, so their presence alone is not a defect.
5. **In-memory payment rate limiting: not current.** payment/initialize calls consume_rate_limit, which performs an atomic Postgres upsert and is service-only. It persists across cold starts. ETA has a separate concurrency/error issue, F37.
6. **CreateEventDialog writing posts: no remaining implementation/caller found.** Current event creation writes events/ticket_tiers; a legacy event read fallback in event-service does not constitute a write bug.
7. **Moderation-flagged web event withheld as DRAFT: correct intentional behavior.** Web passes PENDING_MODERATION; events/create:78–80 maps it to DRAFT/pending. F27 concerns bypassing server enforcement, not this intentional withholding.
8. **Pre-launch wipe / missing seed content: not flagged.** Empty business/event/marketplace data is not evidence of a defect. Category lookup has an explicit static fallback. A legacy canReviewBooking query references reviews, but no current caller was found; it was not treated as a broken active review flow.

### Exact current withdrawal gates

At src/app/api/seller/payouts/request/route.ts:8–11:

```ts
const { data: { user }, error: authError } = await getAuthenticatedUser(request);

if (authError || !user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

The helper validates a Bearer token if supplied; otherwise it validates the cookie session through getUser. The remaining request gates are positive amount, minimum NGN 1,000, an active seller account and amount within the server-computed available balance. **There is no payout_enabled gate.** Manual request also lacks the verification/cooling-off checks noted in F05.

The retry endpoint additionally requires an explicit Bearer header at src/app/api/seller/payouts/[payoutId]/retry/route.ts:10–21; cookie-only retry requests receive Unauthorized before ownership checking. This explains one reproducible code path to that message, not the unobserved historical production incident.

Read-only live aggregate snapshot:

```json
{"seller_accounts":11,"payout_disabled":11,"completed_payouts":4,"failed_payouts":33,"pending_payouts":1,"failed_unauthorized":0,"failed_access_denied":0}
```

“Completed” here is a database status, not proof of bank receipt, particularly given F09–F10. The snapshot contains no stored failed-payout reason matching Unauthorized/Access denied. A failing request's HTTP response, token/session validation outcome and provider trace are needed to attribute the historical failure precisely.

## Checked and clean — bounded conclusions

- **Canonical marketplace storage:** current listing/checkout paths use posts with marketplace categories; no marketplace_items dependency was found.
- **Canonical commission constants/math:** marketplace and event constants resolve to 0.03; the arithmetic mock returned NGN 30 on NGN 1,000. Stale user-facing copy remains F26.
- **API session validation:** getAuthenticatedUser validates the user through Supabase Auth for Bearer and cookie requests; it does not authorize APIs solely from a client session object.
- **Admin role escalation protection:** the live user trigger guards client changes to is_admin/role. Examined admin routes check administrative authority.
- **Webhook signatures:** Payluk raw-body SHA-512 HMAC passed valid/tampered/malformed/missing-input checks; the Paystack handler uses raw-body HMAC and timing-safe comparison with a length/format guard.
- **Payment rate limit persistence:** the live consume_rate_limit upsert is atomic, service-only and fails closed in payment initialization.
- **Ticket capacity counter:** the live sold trigger increments only while below capacity and handles PAID/USED versus inactive states; ticket issuance authorization is separately broken in F06.
- **Paid ticket fulfillment deduplication:** live uniqueness on payment reference plus ticket ordinal, and duplicate-lookup handling, protect repeated ticket inserts on the examined legitimate fulfillment paths.
- **Alternative event check-in endpoint:** events/checkin validates organiser, event, expiry, active/refund state, then conditionally changes PAID to USED. This is a source-level assessment, not a physical scan certification.
- **Event refund initiation safety:** ticket-refunds reserves the complete ticket set before requesting a refund and retains the lock if provider acceptance is uncertain. The individual organiser refund endpoint blocks payouts already started/released and rejects unsupported multi-ticket partial refunds.
- **Dispute resolution claim controls:** service-only RPC grants, row locks, administrative checks, exact allocation totals and operation reuse are present. Finalization type compatibility and external settlement remain unverified/F30.
- **Private dispute evidence:** the bucket is private and policies restrict evidence to transaction parties/admin; unrelated clients are not granted general access.
- **Quote estimate updates:** the live guard reserves estimates to providers and limits customer transitions; a broad policy alone was not mistaken for an exploit where the trigger supplies the missing checks.
- **Booking updates:** the live UPDATE guard protects booking identity/payment state and provider-only confirmation/completion. INSERT is separately exposed, F32.
- **Business catalog/calendar/staff management:** examined write policies require business ownership; business review policies reject an owner's self-review.
- **Legacy friend-request constraints:** self-requests and duplicate unordered pairs are rejected; directed follower pairs are unique. This does not certify all follow/legacy state synchronization.
- **Community membership/moderation guards:** active membership and actor checks exist on examined community content/like paths; membership UPDATE guards prevent ordinary members promoting themselves.
- **Owner-scoped private records:** examined bookmark, push-subscription/token and user-block policies scope those records to their owner. notification_stats uses invoker security rather than bypassing notification RLS.
- **Coordinate-based geocoding:** Haversine matching against lga_wards is present; selected location filters reach content queries. F35 concerns default initialization.
- **Loading/empty states and UI primitives:** examined marketplace/event/business screens have loading and empty states; shared buttons have focus styles and suitable base dimensions. Rendered responsiveness and accessible names are not certified.
- **Source secret scan:** no embedded credential pattern was found in the inspected src scan; environment values were neither printed nor included in this report.

## Database inspection coverage

All **64 live public base tables** have RLS enabled. Every policy was read, including service-only/default-deny tables; broad SQL grants were inspected together with policies and triggers. “RLS enabled” is not a security verdict.

```text
admin_sessions, alerts, availability_exceptions, booking_payments, bookings,
business_favorites, business_messages, business_reviews, business_staff, businesses,
catalog_items, chat_messages, comment_likes, comment_reports, comments,
communities, community_comment_likes, community_comments, community_invites,
community_join_requests, community_memberships, community_post_likes, community_posts,
conversations, dispute_resolution_operations, disputes, escrow_transactions,
event_bookmarks, event_payouts, events, followers, friend_requests, item_chats,
lga_wards, marketing_rate_limits, messages, moderation_queue, my_tickets,
notifications, payout_requests, post_bookmarks, post_reports, posts,
provider_availability, push_subscriptions, quote_messages, quote_requests,
rate_limits, reports, safety_alerts, seller_accounts, service_offerings,
service_staff_assignments, sms_delivery_logs, strike_appeals, ticket_tiers, tickets,
transactions, typing_status, user_blocks, user_push_tokens, user_reviews, users,
verification_documents
```

The security_invoker notification_stats view was inspected separately. Source references to categories and legacy reviews have no matching live public table; category fallback and absence of an active legacy review caller prevent treating these as demonstrated launch failures. Dormant admin_sessions/marketing helper surfaces were inspected at the policy level, but no current authentication flow using admin_sessions was found. All storage bucket settings/policies and relevant effective function EXECUTE privileges were read; only security-relevant function bodies and referenced guards were examined in detail.

Read-only SQL failures that anchor the schema findings:

```text
42703: users suspension columns do not exist
42703: events.user_id does not exist
22P02: invalid input value for enum escrow_status: "refunded"
42883: operator does not exist: text = uuid
22P02: invalid input value for enum escrow_status: "funds_held"
```

This last block is an evidence index, not a substitute for the full baseline command output above. Schema inspection also confirmed escrow_transactions has no refunded_at or item_title column.

## Could not verify

- **Fresh production build and build route count:** needs permission for generated build/cache files in a separate writable checkout. No conclusion about deployability follows from the guarded build failure.
- **Existing E2E smoke test and broader browser flows:** need a writable test environment and working browser bridge; no existing suite passed during this audit.
- **Rendered UI at mobile/tablet/desktop widths:** needs browser checks at representative widths such as 375, 768 and 1440 px, with authenticated fixtures. Overflow, virtual keyboard, focus order, screen-reader output and real camera behavior remain unverified.
- **Real signup/login/password recovery/OAuth/session refresh:** needs controlled test accounts, working email/SMS delivery and production/preview cookie configuration. No real email or OTP was sent.
- **Payment-provider transaction semantics:** needs Payluk/Paystack sandboxes covering success, pending, rejection, accepted-then-timeout, retries, late/reordered/replayed webhooks, dispute splits and final refunds. The audit's mocks establish local code behavior, not provider bank-credit behavior.
- **Historical 502/Unauthorized incidents:** needs timestamps, request IDs, sanitized responses and provider/server traces. Current code/config evidence does not prove the reported historical cause.
- **Provider wallet retirement/account permissions:** needs the merchant-specific September notice and read-only provider capability confirmation. No funding/deposit/withdrawal request was made.
- **Organiser settlement and event completion scheduling:** needs actual provider settlement mode, split-account records, Vercel cron settings and the deployed process that marks events COMPLETED. Source payout code alone does not establish that jobs run or which funds have settled.
- **Adversarial RLS/storage/RPC execution:** live policies/grants/definitions were verified, but cross-user writes, forged tickets, altered profiles and media operations were deliberately not attempted. Needs an isolated backend with at least buyer, seller, outsider and admin fixtures.
- **Production environment parity:** local env presence was checked by variable name only. Locally absent referenced names include CRON_SECRET, EVENT_TICKET_PAYMENT_PROVIDER, PAYMENT_PROVIDER, NEXT_PUBLIC_PAYMENT_PROVIDER, NEXT_PUBLIC_VAPID_PUBLIC_KEY and PAYLUK_WEBHOOK_SECRET; several are optional/fallbacks. This is not evidence those variables are missing on Vercel/Supabase. Deployment env values, SMS secrets, allowed origins, provider dashboard registrations and delivery settings were not exposed or certified.
- **Realtime, push and browser service worker behavior:** needs test subscriptions and controlled notifications; no messages, notifications or pushes were sent.
- **GPS/ward boundary quality and load performance:** needs real location/device fixtures and network/performance measurement; Haversine implementation review does not establish geographic data accuracy.
- **Mobile parity and wiped content:** other codebases were not read for parity; missing seed/old user data was not treated as a defect. Production user journeys and historical money reconciliation remain unverified.

## Top 10 things to fix before the next wave

1. **Lock down payment identity and private profiles** — F01–F03. Remove client control of provider IDs/verification flags, replace name-only recovery, and restrict private user data.
2. **Protect financial records at the database boundary** — F04–F06, F32. Block forged escrow/payout state, unverified bank accounts, unpaid tickets and paid-looking booking inserts.
3. **Correct payout success handling and ambiguous retries** — F09–F10, F13. Pending/rejected results must never become completed; uncertain transfers need reconciliation before retry.
4. **Unify refund/cancellation and webhook lifecycle handling** — F07–F08, F30. Align enum/schema types, remove the no-refund cancellation path, prevent state regression and replayed inventory effects.
5. **Reconcile organiser settlement** — F11–F12. Include USED ticket revenue and distinguish split-settled Paystack payments from funds awaiting payout.
6. **Restore atomic checkout/stock reservation and safe replacement** — F14–F15. Validate the missing live uniqueness invariant and resolve late provider payments before replacing attempts.
7. **Repair and secure QR scanning; close ticket credential disclosure** — F18, F25. Use one authenticated atomic scan path and buyer-authorized ticket responses.
8. **Close public/overbroad social and storage permissions** — F19–F24, F27–F28. Restrict RPC/push actors, alert approval, chat membership, media ownership/private reads and public server-side image fetching.
9. **Repair suspension and listing deletion** — F16–F17. Fix live schema/type mismatches and verify enforcement with controlled accounts/listings.
10. **Complete launch validation and correct user-facing behavior** — F26, F29, F31, F33–F39. Correct 5% disclosures, partial event success, preview auth and default LGA; bound checkout recovery, then run a fresh build, E2E, payment sandbox and device/accessibility pass.

No implementation changes were applied. Audit stops at this report.

