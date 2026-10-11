# Release verification — 11 October 2026

This document supersedes older completion estimates. A passing mocked test is
not evidence that a payment settled or that production has the matching code.

## Current verification checkpoint

Latest fully green application CI is `95986e40` / run `38168350267`: 281 unit tests,
seven paid-ticket DB checks, nine booking DB checks, nine split-allocation DB
checks, 11 minimum-price DB checks, seven browser scenarios, build, typecheck,
lint, OTP/push/API security and smoke. The matching dedicated QA deployment is
READY at https://yrdly-app-qa.vercel.app. The latest build lists 176 routes,
including the generated not-found route (177 raw app-manifest entries).
Evidence: https://github.com/Yrdly-ng/yrdly-app/actions/runs/38168350267

Funded booking passed all 15 checks: principal 1,234.56, buyer 3% 37.04,
total 1,271.60, Payluk 24.69, seller 1,209.87, merchant exactly 37.04.
Real callbacks synchronize both booking ledgers; retries and delivery are
idempotent. Safe evidence: `payluk-booking-summary.json`. Funded records retained.

Current price/bank-code batch: 266 unit tests, 11 real minimum-price database checks,
nine split-allocation database checks, nine booking DB checks, seven ticket DB
checks and 24 rollback assertions PASS. Typecheck/lint/build PASS (18 pre-existing
lint warnings). The approved NGN 1,200 minimum is enforced for paid listings,
catalog, tickets and booking payments/deposits, preserving free flows.
Both new migrations are applied ONLY to isolated QA. Responsive minimum-price
checks passed at 375, 768 and 1440 pixels; nine screenshots were captured and
representative listing, deposit and ticket screenshots were visually inspected.
Hosted funded split verification passed all 16 checks on `fabe5458`:
gross ruling 1,250/1,250; Payluk pool 2,450; actual seller credit 1,225 and buyer
credit 1,300, including the refundable 75 additional fee. Admin retries and signed
split-event replays preserved one settlement and a sold listing. An initial
network failure created no resolution operation, as verified by a read-only QA
query before retrying. Safe evidence: `payluk-split-summary.json`.
Local Playwright cannot install Chromium on this laptop's macOS 12; the browser
evidence comes from Linux CI.

Five real bank preview checks passed: bank-list code, controlled-beneficiary
verification, NGN 1,000 net quoted fee 10.75, below-net-minimum rejection, and
NGN 1,010.75 debit budget fitting NGN 1,000+10.75. Only unpaid intents staged;
Those preview checks executed no payout. Subsequent provider-test withdrawal
evidence is reported separately below. Beneficiary details are retained privately.

Subsequent hosted bank linking reproduced a separate blocker: the current
provider-list code was rewritten by the application, and Payluk returned
`Unknown bank code: 100004`; account setup returned HTTP 422. Account resolution,
preview and withdrawal now preserve provider bank codes verbatim. Three new
regressions pass (266 total unit tests); typecheck, lint and build also pass
(18 existing lint warnings). Full CI passed and the matching QA deployment is
READY. The corrected live-bank code reached Payluk, which then reported its
three-per-day sandbox cap on live-bank name enquiries. The provider explicitly
suggested test code `001`; a separate enquiry resolved a synthetic beneficiary.
Authenticated linking and preview with that beneficiary passed. The first payout
failed before verification: HTTP 429 at create-intent. The database row is failed,
its provider history is empty and the wallet is unchanged. This exposed redundant
provider lookups: a normal hosted request consumed approximately 12 provider calls
against Payluk's documented 10/minute key limit. The follow-up reduces the normal
path to seven, records a durable pre-submission/submitted marker, uses fresh intent
references for retries, and compares the observed reference/status under the
seller lock before requeueing. Legacy or submitted uncertainty remains blocked;
missing history alone never authorizes a retry. The new migration was applied only
to isolated QA; all 25 rollback database assertions passed. Matching full CI,
local build/typecheck/lint and QA deployment passed on `95986e40`. One reviewed
retry of the same original payout completed successfully: provider transfer
1,189.25 + fee 10.75 = wallet debit 1,200. Exactly one ledger row and one successful
provider withdrawal match. All four provider-test payout checks passed; safe
evidence is `payluk-bank-withdrawal-provider-test-summary.json`. The original
pre-execution failure was reconciled using its precise create-intent HTTP 429,
empty reference history and unchanged wallet before marking that one owned QA
row as unsubmitted. Other legacy rows were not changed. No live-bank receipt is
claimed.
This reduces one request's overhead; it does not establish concurrency capacity
across all customers/apps sharing the provider key.
The original controlled beneficiary is preserved
separately. No bank details or credentials were added to tracked files.

A separate organizer-maturity ticket escrow is funded and deliberately held:
all 10 preparation/funding checks passed, including the real callback, consumed
capacity reservation and signed replay safety. Advertised price 2,500, organizer
commission 75, provider fee 48.50 and held organizer proceeds 2,376.50 match.
The event ends at 21:46:57 Lagos time on 11 October; its 24-hour application gate
opens after 21:46:57 on **12 October 2026**. Recheck no earlier than 21:47 Lagos
time, and also confirm the provider claim window before execution. The escrow
remains ONGOING; no manual delivery, claim or organizer bank payout was sent.
Evidence: `payluk-ticket-maturity-summary.json`. Dedicated QA cron schedules
remain disabled; this is a prepared real-time claim test, not proof that a
scheduled job has run. Preserve the funded ledger and never repeat funding.

QA security advisors were rechecked after the payout-attempt migration. No new
money/RPC warnings appeared. Existing definer-view/function grant warnings, deliberately
service-only tables without client policies and leaked-password protection
remain tracked under the release requirements below. The current batch does
not establish production readiness or 100% completion.

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
- A rollback-only SQL regression initially passed 24 assertions covering inventory,
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
- Linux CI passed the build, typecheck, lint, 197 regression tests, seven live
  paid-ticket reservation checks, 20 live OTP
  checks, seven live
  push authorization tests, 50 signed-in API/security checks, five browser
  scenarios and the existing smoke suite. The browser scenarios cover six
  protected routes at 375, 768 and 1440 pixels, wait for loaded content and
  assert visible navigation. Nineteen screenshots were captured; representative
  loaded mobile, tablet and desktop screenshots were visually reviewed.
  Evidence: https://github.com/Yrdly-ng/yrdly-app/actions/runs/38123126286
- Vercel access works. A separate `yrdly-app-qa` project was configured with the
  isolated database and Payluk sandbox keys. It deployed revision `8847e6e6`
  successfully at https://yrdly-app-qa.vercel.app. No production environment
  variables, scheduled jobs or application data were copied into this project.
  Public login, authenticated/unauthenticated checkout guards and unsigned
  webhook rejection passed against the hosted application.
- Four real hosted marketplace checkout checks passed on `7e22af52`: database
  price instead of a tampered client price, exactly 3% commission, binding each
  verified synthetic phone to its existing Payluk customer, and retry reuse of
  the same unpaid transaction/escrow. The provider principal, additional fee and
  escrow-specific seller proceeds matched the application. Cleanup passed.
  This exercised application-driven lookup/binding of existing sandbox customers.
- On hosted revision `cbe1d7c4`, fresh checkout created both previously absent
  provider customers. Real provider reads verified their confirmed email and
  verified synthetic phone bindings. Retry reused one unpaid transaction/token;
  principal, 3% commission and escrow-specific proceeds matched. These payment
  profiles explicitly seed phone trust; actual SMS verification was tested separately.
- Thirteen resumable marketplace lifecycle checks passed using Payluk's hosted
  Checkout SDK and its staging test bank. A direct escrow payment collected
  NGN 2,575 without a deposit/top-up. The SDK verified payment and the real
  provider callback marked the transaction paid and listing sold before any
  application verification request or direct database payment write. Two locally
  signed funding-event replays preserved one payment and added no notifications.
  Seller confirmation was forbidden; buyer confirmation and its repeat passed.
  Provider completion, the seller wallet increase and application earnings all
  matched NGN 2,375: principal 2,500 less the returned escrow fee 125. The app's
  additional 3% charge is 75. The separate merchant-ledger inspection below
  exposed duplicate commission despite the correct seller-proceeds calculation.
  An attempted withdrawal correctly required a
  bank account; successful bank payout is not established by this check.
  Funded QA ledger records and synthetic payment identities are retained for
  reconciliation; they are never deleted as though no funds moved.
  Documentation: https://docs.payluk.ng/guides/payluk-test-bank
- Sixteen funded event-ticket lifecycle checks passed on hosted revision
  `582f041e`. The buyer paid the advertised 2,500; provider principal was 2,425,
  Yrdly's merchant credit was exactly 75, Payluk's returned fee was 48.50 and
  the organizer wallet increased by 2,376.50. The actual provider callback
  issued one paid ticket and funding replays issued no extras. A non-organizer
  and a forged code were rejected; simultaneous organizer scans returned 200
  and 409, consuming the ticket once. Seller confirmation was forbidden;
  buyer confirmation and its repeat completed exactly once. Marketplace payout
  balance excluded this ticket income. The event and tier were explicitly seeded;
  this does not prove paid-event creation, paid-checkout reservation races,
  automatic maturity claims or bank payout. Funded evidence is retained.
- The new paid-ticket reservation flow passed all 17 funded sandbox checks on
  `8847e6e6`: retry reused the same saved provider escrow, funding consumed the
  reserved seat and issued one ticket, concurrent scans consumed it once, and
  buyer confirmation settled the expected organizer proceeds and single 3% fee.
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
  was a separate check from Supabase Auth delivery.
- A real QA Auth signup initially returned HTTP 500. QA Auth logs identified
  SMTP authentication failure (535). Updating only the isolated project's SMTP
  password from the local QA Resend key made signup return HTTP 200; Resend
  reported its confirmation email delivered. The QA site URL and redirect
  allowlist were corrected to stay on the dedicated QA application.
- A real QA password-recovery request was accepted, its email was delivered,
  and its link returned a PKCE code to the hosted callback. This exposed the
  incomplete-onboarding redirect bug recorded below. On corrected hosted
  revision `83eacf42`, all seven recovery checks passed: request acceptance,
  provider delivery, PKCE callback, arrival at password reset before onboarding,
  password update, login with the new password and rejection of the old password.
- A fresh real signup email code verified successfully, established a session,
  and was rejected when replayed. These checks used the authorized destination
  and actual delivered messages, without logging codes or email links. Both
  temporary Auth delivery fixtures were cleaned. This establishes email/API/HTTP
  behavior; an interactive signup/reset browser walkthrough remains separate.
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
- The first expanded CI run passed all 149 unit tests and all 20 OTP checks,
  then failed saving evidence because `.qa-artifacts` did not exist on a fresh
  runner. The harness now creates its evidence directory before running. A new
  complete CI run then passed after this correction (linked above).

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
10. **VERIFIED by hosted checkout:** simultaneous buyer/seller permission
    updates returned Payluk HTTP 423 and made checkout return HTTP 502. The
    marketplace route now sends those updates sequentially under its existing
    deadline. All four hosted checkout checks subsequently passed on `7e22af52`.
11. **VERIFIED against Payluk sandbox:** escrow verification by escrow ID
    returned HTTP 400, while the same escrow's payment token returned HTTP 200.
    Checkout retry, both delivery timeout-recovery paths and the legacy payment
    callback now use payment tokens; confirm-payment continues using escrow IDs.
    The diagnostic unpaid escrow was deleted successfully.
12. **VERIFIED by exact source:** delivery completion overwrote a sale's
    `seller_amount` with the seller's aggregate wallet balance when lower.
    New marketplace checkouts now record principal minus that escrow's Payluk
    seller fee; completion preserves the recorded amount. Regression tests
    check fee accounting and prevent wallet reads from rewriting proceeds.
    New funded marketplace proceeds subsequently matched the released provider
    wallet credit. Historical production proceeds still need reconciliation.
13. **VERIFIED by hosted recovery:** a valid password-reset callback sent an
    account without a phone number to `/onboarding/verify-phone`. Local regression
    cases also reproduced the failure with a missing or incomplete profile.
    Authenticated callbacks now honor `/reset-password` before onboarding checks;
    other destinations still require onboarding and external destinations remain
    rejected. All six new callback tests passed.
14. **VERIFIED by hosted first checkout:** Payluk returns HTTP 400 with status
    `false` and `No customer found with the provided phone` for an unused phone.
    The application treated that expected absence as an API failure, returning
    HTTP 502 before creating the buyer/seller. The service now recognizes only
    that exact absence response; validation, auth, lock and server failures still
    fail closed. Seven added regressions cover these boundaries and creation
    from the confirmed Auth email/verified phone. Fresh hosted checkout, provider
    identity checks and retry reuse subsequently passed on `cbe1d7c4`.
15. **VERIFIED by hosted first checkout:** after the missing-phone correction,
    concurrent buyer/seller customer creation returned Payluk HTTP 423 and the
    app returned HTTP 502. Customer creation is now sequenced, alongside the
    previously sequenced permission writes. The fresh hosted checkout passed.
    Provider reads in the test harness also encountered the documented shared
    10-request/minute limit; bounded read-only backoff now paces those checks.
16. **VERIFIED, High, corrected in sandbox configuration:** the completed sandbox sale's merchant ledger
    contains both a `commission` credit of NGN 75 and a `delivery` credit of NGN
    75, each referencing this exact escrow. For a 2,500 principal this pays Yrdly
    6%, while the canonical application commission is 3%. Payluk's returned
    escrow fee already includes the configured merchant commission, and the app
    also applies its own additional fee in `src/app/api/payment/initialize/route.ts`.
    The user removed the dashboard's extra merchant commission. A new sandbox
    escrow now returns fee 50 (2%) while retaining the app's additional fee 75
    (3%). A new funded sale then passed all 14 lifecycle checks: the buyer paid
    2,575, seller received 2,450, and the merchant ledger credited exactly 75 as
    the additional fee and zero extra commission. The same escrow token linked
    each merchant entry to this purchase. The sandbox now collects exactly one
    canonical 3% Yrdly commission. Live merchant configuration remains a separate
    release check. Do not represent the earlier 125 escrow fee as entirely
    Payluk revenue. Current documentation explains the fee components:
    https://docs.payluk.ng/concepts/fees-and-settlement
17. **VERIFIED, High:** an actual funded dispute's refund returned HTTP 202 and
    required reconciliation. Its retained provider error was HTTP 400:
    `sellerAmount and buyerAmount are only valid on a SPLIT resolution`.
    Both full refunds and full releases sent one of those invalid fields. The
    route and service now send allocation fields only for `SPLIT`; three
    provider-contract regression cases pass. On hosted revision `d06c83ab`, the
    rejected operation was checked against the provider's still-investigating
    escrow, then reconciled through the authenticated admin API before one
    corrected retry. All 16 funded refund checks passed: outsider/admin gates,
    buyer dispute, one seller reply, duplicate rejection, refund completion and
    retry idempotency. The transaction is cancelled and listing available again.
    The gross refund allocation is 2,500; the actual buyer wallet credit is 2,450
    (2,500 principal minus this older escrow's non-refundable 125 fee plus the
    refunded additional fee 75). Provider state is `REFUNDED`. These are sandbox
    funds; the original fee was fixed when this escrow was created before the
    dashboard commission correction. No funded ledger records were deleted.
18. **VERIFIED by local reproduction:** booking checkout still created buyer
    and seller customers concurrently. A modeled provider lock reproduced HTTP
    423, using the same failure already observed in real marketplace onboarding.
    Booking onboarding is now sequenced. Its regression passes; a real funded
    booking flow remains separate from this mocked reproduction.
19. **VERIFIED by local reproduction:** marketplace commission rounded to whole
    naira. A price of 1,234.56 produced commission 37 instead of 37.04. Commission
    and buyer total now round to two decimal places. Two fractional-price route
    regressions pass, including 2,001.11 and 1,234.56. Hosted revision `e17d9755`
    initialized the 1,234.56 catalog purchase at the correct buyer total of
    1,271.60. The subsequent funded catalog flow passed all 14 checks on
    `9262a9da`: buyer payment 1,271.60, Yrdly commission 37.04, Payluk fee 24.69,
    seller release 1,209.87, one inventory reservation and one merchant credit.
20. **VERIFIED, High, by hosted checkout and local reproduction:** reserving the
    last catalog unit correctly sets quantity to zero and `in_stock` to false,
    but the same buyer's next initialization returned HTTP 400 before checking
    their existing pending escrow. They could not resume checkout. The route
    now checks the caller's existing reservation before fresh availability.
    Three regressions cover unpaid retry, funded reconciliation and rejection
    of a new buyer when stock is exhausted. Full CI passed. Hosted retry reused
    the same unpaid escrow; real payment callback, replay, buyer delivery,
    wallet/earnings reconciliation and merchant settlement all passed afterward.
21. **VERIFIED, High, by exact source and modeled provider contract:** event
    checkout recorded a 3% commission but did not assign it to Payluk. Its payout
    path merely subtracted 3% from the intended bank withdrawal. With dashboard
    merchant commission zero, this did not transfer Yrdly's intended fee. The
    user confirmed that organizers pay the 3%, preserving the advertised price.
    New ticket checkout uses principal = advertised total minus 3%, with that
    3% assigned as the merchant additional fee. Buyer total remains unchanged.
    Actual provider fees reduce organizer proceeds separately. Verification and
    refund handling distinguish gross ticket price from the provider principal;
    legacy orders keep their old interpretation and require payout reconciliation.
    Full CI and all 16 funded ticket checks pass. Actual buyer payment, organizer
    wallet credit and merchant ledger match the new fee allocation above.
22. **VERIFIED, High, by exact source and modeled release/withdrawal cases:**
    event payout did not release ticket escrows before bank withdrawal and used
    gross minus 3% instead of the order's actual proceeds. The corrected path
    verifies each order, claims only provider-releasable funds, confirms release
    after a timeout and uses recorded net proceeds without a second commission
    deduction. Held, disputed, legacy and mismatched orders block new withdrawal.
    Ended published events are now included in the matured-event query; the
    old query required `COMPLETED`, with no matching event-completion writer
    found in this application. Local pending/timeout/held/legacy regressions pass.
    Real claim-window and bank payout behavior remain separate release gates.
23. **VERIFIED on sandbox, High:** booking checkout builds a URL under
    `staging.api.payluk.ng/escrow/` (`src/lib/booking-payments.ts:72`), and the
    booking page redirects the buyer there (`src/app/(app)/bookings/[bookingId]/page.tsx:192`).
    A read-only HTTP request using an owned completed sandbox escrow token
    returned 404 HTML with no redirect. This establishes failure of that legacy
    sandbox URL, not a completed end-to-end booking test or failure of the live
    `payluk.ng` URL. Booking needs the documented inline Checkout SDK path and
    a fresh funded booking verification. The current patch replaces that URL
    with the inline SDK and explicit buyer verification/cancellation. Its review
    shows the base payment, 3% Yrdly fee and exact total before opening payment.
    The new hosted booking lifecycle passed15 checks, including commission and wallet settlement.
24. **VERIFIED, High, by source and live QA database tests:** paid checkout
    previously created provider escrows before recording the order and did not
    reserve ticket capacity. New checkout atomically records its order and seats
    before provider calls, uses a single setup claim, persists the provider token
    before fee setup and reuses the same unpaid order on retry. Uncertain setup
    remains held with a reconciliation flag. The service-only reservation table
    and RPCs are installed only on QA by `reserve_paid_ticket_checkout`.
    Seven real concurrent database checks and eight rollback-only SQL checks pass,
    including competing buyers, duplicate setup claims, atomic fulfillment,
    in-flight/unknown setup protection and unprivileged access denial. Local
    cancellation tests cover read failure, unknown deletion and paid-order
    protection. The event UI verifies payment before showing success and uses
    safe cancellation on SDK close. Full CI passed with 197 regression tests on
    `5d59b5ce`, after fixing the clean-runner evidence directory in the harness.
    All 17 hosted funded reservation checks passed on `8847e6e6`.
25. **VERIFIED, High, by source and live QA database tests:** booking checkout
    created provider escrows before recording an order, allowed a deposit type
    override on a full-payment service, omitted collection of the application's
    3% commission and kept proceeds outside the shared seller earnings ledger.
    New checkouts lock and price the booking from its service/accepted quote,
    record one common-ledger order before provider calls, claim setup once and
    retain uncertain provider outcomes for reconciliation. Linked booking state
    updates atomically with the escrow ledger; released net proceeds enter seller
    earnings. Legacy payment rows remain distinguishable and require review.
    Nine real database checks and 225 local unit regressions pass. The migrations
    are installed on QA only. Actual commission and wallet settlement passed
    all 15 hosted funded booking checks on092a98bd.
26. **VERIFIED, High, by CI browser failure and live database API reproduction:**
    booking detail, provider booking lists and confirmation used an ambiguous
    customer/profile relationship. Supabase returned `PGRST201`, preventing the
    booking detail/payment review from loading. All three queries now explicitly
    select `bookings_customer_id_fkey`; the corrected live query returns HTTP 200.
    The booking page fetch also has stable hook dependencies. Full CI38132275104 passed, including the booking review browser test at375/768/1440.
27. **VERIFIED, High, by exact source, live QA database checks and funded sandbox
    settlement:** admin split rulings used gross buyer/seller shares directly as
    Payluk's fee-adjusted pool, and finalization retained the original seller
    proceeds. Resolution now stores an immutable proportional plan, verifies the
    actual provider settlement and atomically records actual seller proceeds.
    Gross rulings remain separately visible. Unknown outcomes remain held for
    reconciliation. Nine real DB checks, unit regressions and all 16 hosted
    split lifecycle checks passed on `fabe5458`; buyer/seller wallet deltas were
    1,300/1,225 on a 2,500 order. Admin retries and signed split replays were safe.
28. **VERIFIED, High, by provider quote and money-boundary regressions:** the bank
    minimum applies to the net transfer, so a 1,000 debit budget with a 10.75 fee
    cannot withdraw 1,000. The service now checks integer-kobo net amounts before
    submitting a below-minimum transfer and validates authoritative intent quotes.
    The user-approved 1,200 paid-price policy is enforced in forms, APIs and QA
    database guards, including independently payable booking deposits. Free flows
    remain available. Eleven real price DB checks and responsive browser checks
    passed. Partial refunds/splits can still leave small residual balances;
    the selling-price buffer is not a universal withdrawal guarantee.
29. **VERIFIED, High, by hosted account linking and provider logs:** a stale
    hardcoded bank-code map rewrote the provider's current OPay code `999992`
    into `100004`. Payluk rejected the rewritten code, so authenticated account
    setup returned HTTP 422 even though the direct provider beneficiary check
    passed. The same map existed in preview and withdrawal. All three now pass
    provider-list codes unchanged. Three regressions cover resolution, preview
    and execution with the staging code, a numeric bank code and an opaque code.
    Historical accounts with codes the current provider does not accept need
    re-verification; no stored beneficiary or bank code is silently rewritten.
30. **VERIFIED, High, by hosted failure and request-path regression:** one seller
    payout repeated identity/wallet checks across the request, reservation and
    executor, reaching Payluk's 10/minute key limit before creating its intent.
    The recorded HTTP 429 happened before verification; provider history is
    empty and the wallet unchanged. Normal execution now takes seven provider
    calls, retaining a fresh authoritative execution wallet check. A durable
    pre-submission marker permits retrying known unsubmitted failures; unknown
    submitted/legacy attempts stay held. Requeue compares reference/status under
    the seller lock and every attempt gets fresh intent references. All 281 unit
    tests and 25 rollback DB assertions pass. Matching full CI/deployment passed
    on `95986e40`, and the reviewed same-row retry completed: provider net 1,189.25,
    fee 10.75 and wallet debit 1,200, with one successful withdrawal. Concurrent
    load across the shared provider key still requires a capacity/rate-limit strategy.

The customer/permission lock, missing-customer, token-addressing, recovery and
escrow-proceeds fixes passed full CI on `cbe1d7c4`. The hosted fresh-customer,
funded-payment, callback/replay, delivery and seller-proceeds checks passed.
The refund and booking fixes passed full CI with 171 tests on `d06c83ab`, and
that revision is ready on the dedicated QA deployment. The dashboard commission
correction passed the new funded merchant-ledger assertion. The funded full
refund passed all 16 checks. Commission precision passed full CI with 173 tests
on `e17d9755`. The catalog retry correction passed full CI with 176 tests and
the funded hosted flow on `9262a9da`. The organizer-paid ticket commission and
release corrections passed full CI with 185 regression tests, typecheck and lint
(the same 19 existing warnings) on `582f041e`. That exact revision is ready on
the dedicated QA deployment. The funded ticket flow passed all 16 checks on that
revision; automatic maturity claim and bank payout remain unverified.
The paid-ticket reservation batch then passed full CI on `5d59b5ce` and all 17
funded hosted checks on `8847e6e6`. The booking ledger/SDK batch passed full CI and matching QA deployment on092a98bd, followed by 15 funded lifecycle checks.

The minimum-price and split-allocation batch passed full CI on `fabe5458`,
followed by all 16 funded split checks against the matching READY QA deployment.

The manual harness `qa-scripts/payluk-lifecycle.mjs` explicitly separates
preparation, funding, delivery, dispute, reconciliation and refund operations.
Use `inspect` for the retained refund scenario or `inspect commission` for the
post-dashboard-correction sale, or `inspect split` for the split settlement.
Its evidence contains private sessions and is
ignored by Git. It refuses live keys and ambiguous duplicate transfers. Never
clean up these funded records as though they were unpaid fixtures.

## Remaining release requirements

- Confirm the live merchant dashboard also has zero additional merchant
  commission. A new funded sandbox ledger verified the app's single 3% charge;
  the staging result does not prove the live account setting.
- Complete automatic event maturity claims and live-bank receipt. The synthetic
  provider-test bank withdrawal now passed all four checks, including the same-row
  retry and actual wallet debit. That does not prove a live bank received money.
  Marketplace full refund and funded split resolution passed above;
  other refund paths remain separate requirements.
  Funded catalog and ticket purchase/release, paid initialization retries and
  competing last-seat reservations passed above. Booking collection, commission and settlement now passed the hosted funded test.
  An authenticated read-only request does not establish these outcomes.
  The sandbox callback is configured and an unpaid-escrow callback was accepted;
  Funded marketplace payment and delivery completion are verified above;
  other financial outcomes remain separate gates.
  Deprecated wallet top-up/deposit is not a test path.
- Verify interactive Auth signup/reset browser flows, OAuth redirects and actual
  device/browser push. Signup email OTP verification/replay and the real hosted
  password recovery flow passed separately above. The current push authorization test intentionally sends
  to a fixture without subscribed devices. Basic application email and Termii
  OTP delivery are verified separately above.
- Review outstanding Supabase security advisors. `public_profiles` deliberately
  exposes a restricted projection of private profiles; its definer-view warning
  requires an explicit design decision, not blind conversion to an invoker view.
  Eleven inspected function search paths were pinned in Staging; subsequent
  advisors no longer reported these warnings and the 24 money assertions passed
  again. Service-only tables deliberately have no client policies.
  The remaining grant notices cover 13 trigger-returning functions and seven
  explicit RPCs. Exact RPC definitions were inspected; five rollback checks passed
  for anonymous identity helpers, guarded community mutations and rejection of a
  direct trigger call. The moderator-role helper accepts arbitrary IDs and needs
  a visibility decision for private communities. This review does not establish
  every authenticated community role transition. Leaked-password
  protection is not enabled. Lint passes with 18 existing warnings.
- Paid event refunds/cancellation are still support-assisted. Automated refund
  completion is not established.
- Deploy matching web code, verify shared-backend mobile compatibility, then
  apply restrictive production migrations and deploy corrected Edge Functions.
  Staging success does not imply production is secured or released.
  Include the additive OTP challenge migration before replacing both OTP
  functions. Remove retired provider environment entries only with the matching
  web release; the deployed production version has not been replaced.
  Read-only inspection confirmed the current mobile source directly updates
  `escrow_transactions` (`src/lib/escrow-service.ts:89`) and scans tickets using
  direct `tickets` updates (`src/app/events/scan.tsx:111`). Those paths conflict
  with the proposed server-only policies; matching mobile changes are required
  before applying the restrictive migrations to the shared production backend.

No claim of 100% release completion is made while these requirements remain.

## Repeating checks

Local credentials belong only in ignored `.env.qa` (mode 600). Never print or
commit that file or `qa-seed-output.json`.

```sh
node qa-scripts/seed.mjs
node --test tests/audit-security.test.cjs
node qa-scripts/ticket-reservation-regression.mjs
node qa-scripts/booking-checkout-regression.mjs
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
Use `qa-scripts/vercel-qa.mjs source` to refresh committed QA deployment source
without rewriting the already configured QA environment variables.

`qa-scripts/payluk-checkout.mjs existing` tests provider-customer lookup/binding;
`fresh` tests new customer creation. Both target only hosted QA and unpaid sandbox
escrows, clean their temporary application fixtures, and never establish real
phone verification for their synthetic payment profiles.

`qa-scripts/payluk-lifecycle.mjs` is an explicit manual, resumable sandbox test.
Its `prepare`, `fund` and `complete` operations use only the allowlisted QA project,
test keys and Payluk test-bank rail. It retains funded ledger fixtures and refuses
duplicate or uncertain transfers. Sensitive evidence remains in ignored mode-600
artifacts and is not uploaded by CI. Do not run fixture cleanup against its funded
records. `new-refund`, `dispute` and `resolve` exercise a separate funded refund.

Auth delivery tests require the explicitly authorized destination and local
QA-only Resend credentials. `qa-scripts/auth-settings.mjs inspect` reports only
configuration booleans; `repair` changes only QA SMTP credentials/redirects.
Run `qa-scripts/auth-delivery.mjs signup` then `confirm` promptly, as email codes
expire. `qa-scripts/auth-recovery.mjs run` checks real delivered recovery links,
PKCE, the hosted callback and password replacement for that owned QA account.
`qa-scripts/auth-delivery.mjs cleanup` removes only that fixture, refusing content,
tickets or financial rows. Email links, OTPs, passwords and session cookies stay
out of console output and public CI artifacts. Delivery tests are manual; they
do not email the recipient on every CI run.
