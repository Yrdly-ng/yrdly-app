# Payments

Payluk is the only payment provider in `yrdly-app`. Marketplace, business and event checkouts use Payluk escrow. Bank lists, account verification and withdrawals also use Payluk. Event checkout has no provider selection or fallback to another gateway.

## Configuration

- `PAYLUK_SECRET_KEY`: server-only API and webhook-signature key. Test keys select staging; live keys select production.
- `NEXT_PUBLIC_PAYLUK_PUBLIC_KEY`: publishable key for the inline checkout SDK.
- `NEXT_PUBLIC_APP_URL`: application return URL.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only database access.
- `CRON_SECRET`: authenticated scheduled tasks.

Use project-specific Supabase credentials and test Payluk keys in the ignored `.env.qa`. Never commit keys. Production and preview deployment settings must be updated separately when publishing the matching code.

For marketplace and catalog checkout through `/api/payment/initialize`, Yrdly's
canonical 3% is the buyer's additional fee. Set Payluk's optional dashboard
merchant commission to zero to avoid charging Yrdly commission twice. Payluk's
own merchant escrow fee is separate and charged to the seller. Use the returned
escrow fee to record seller proceeds; do not assume an aggregate wallet balance
is the proceeds of one sale. Commission and totals are rounded to kobo.

The official fee references are [Payluk fees](https://payluk.ng/help/fees) and
[fees and settlement](https://docs.payluk.ng/concepts/fees-and-settlement).
The 11 October sandbox sale verified a 2,500 principal, 75 Yrdly fee, 50 Payluk
fee, 2,575 buyer payment and 2,450 seller credit. This does not verify live
dashboard settings. Funded catalog checkout also verified a 1,234.56 principal,
37.04 Yrdly commission, 24.69 provider fee and 1,209.87 seller credit.

Event tickets preserve the advertised price, as confirmed by the user. Their
Payluk principal is the ticket total minus Yrdly's 3%; the same 3% is assigned as
the merchant additional fee. The buyer pays the advertised total, and the
organizer receives the principal minus the returned Payluk fee. Gross ticket
prices remain in the application ledger. A server-managed fee-mode marker
distinguishes these new orders from historical tickets. Organizer payout must
confirm the ticket escrows are released and use their actual net proceeds;
commission is not deducted again at withdrawal. Legacy orders require
reconciliation. Sixteen funded sandbox checks verified an advertised/buyer
price of 2,500, Yrdly credit of 75, returned Payluk fee of 48.50 and organizer
wallet credit of 2,376.50. Ticket issuance, idempotent replays and simultaneous
single-use scans passed. Automatic maturity claims and bank payouts remain
separate requirements.

Paid ticket checkout reserves seats atomically before creating its provider
escrow. Retries reuse the order; a single setup claim prevents duplicate escrow
creation. Reservations last 15 minutes, but expiry alone never releases a seat:
the application must first confirm deletion of its unpaid provider link. One
expired reservation is reconciled when that tier is checked out again. Buyers
can cancel unpaid checkout; paid or uncertain outcomes remain held for review.
The service-only reservation migration must ship with its matching web code.
Reconcile any legacy unfulfilled paid-ticket checkout before applying it.

Booking checkout uses the inline SDK and the same buyer-paid 3% additional fee
as marketplace/catalog checkout. A service-only RPC locks the booking, enforces
its configured payment type and computes its service/accepted-quote price before
creating one common escrow-ledger order. A single setup claim prevents duplicate
provider creation. Unknown provider outcomes remain reserved for review.
The booking payment and booking status synchronize atomically with that ledger;
released actual net proceeds enter seller earnings. The buyer verifies payment
and confirms service receipt; provider completion alone does not release funds.
Unpaid checkout is deleted at the provider before cancellation permits a new
order. Legacy unlinked payment rows are not relabelled or replaced automatically.
Deploy `reconcile_booking_checkout_ledger` with its matching web code. QA database
and funded booking checks pass: principal 1,234.56, Yrdly 37.04, Payluk 24.69 and
seller 1,209.87, with 15 lifecycle checks including real callbacks and idempotent
delivery.

## Minimum paid prices and bank withdrawals

Paid listings, catalog items, service prices, booking deposits/estimates and
paid ticket tiers start at NGN 1,200. Free giveaways, free tickets and free or
quote-only services remain available. Forms and APIs check money precision and
the database guards new prices and relevant edits. Booking deposits must reach
the minimum independently; full payment/escrow takes priority over unused deposit
settings. Historical prices and paid ledgers are not rewritten; new checkout
reservations require the minimum and authoritative current prices.

This price buffer is not a guarantee after a partial refund or split dispute.
Small residual balances may need later earnings. The provider BANK minimum is
still NGN 1,000 net of its fee, separate from Yrdly's selling-price policy.
A real sandbox quote on 11 October returned NGN 10.75 for a NGN 1,000 bank transfer;
a NGN 1,010.75 debit budget therefore fits that quoted transfer. Fees are quoted
at withdrawal time, not hardcoded. The preview harness verified the controlled
beneficiary and staged intents only; no outbound bank transfer was executed.

Withdrawal preview and execution first quote the NGN 1,000 bank minimum, then
stage the requested wallet deduction minus the returned fee. Quoting the entire
wallet deduction as a bank amount can fail at intent creation because Payluk
checks that amount plus its fee against the wallet. An exact minimum quote is
reused; other requests use at most two more intents to account for a changed fee.
Only a final intent whose bank amount and fee fit both the reserved deduction and
available funds can be verified. Rejected or unstable quotes stop before execution;
they do not trigger a transfer retry. Mocked regressions cover a NGN 1,176 budget
with both NGN 1,176 and NGN 1,185.25 available, enforcing fee-inclusive balances
when each intent is created. These tests do not establish live bank settlement.

Bank codes come from Payluk's current bank list and pass unchanged through
account verification, preview and withdrawal. Hardcoded code translation caused
a verified sandbox linking failure and has been removed. Historical bank
accounts with unsupported codes require re-verification using the current list.
The manual `qa-scripts/payluk-bank-withdrawal.mjs` separates preparation,
single-attempt execution and read-only inspection. It requires the isolated QA
project and sandbox keys, retains payout references and refuses an uncertain
second attempt. Sandbox provider success does not prove receipt by a live bank.
Payluk's staging response also enforces a three-per-day cap on live-bank name
enquiries and suggests test code `001`. That code resolved a synthetic beneficiary
even though it is absent from the general bank list. The optional `provider-test`
mode uses this separately verified fixture; the controlled beneficiary is kept
separately. This is a QA fixture exception, not a production bank-code fallback.

A normal seller withdrawal uses seven provider requests, including identity
validation, reservation wallet lookup, a final execution wallet check, two fee
intents and verification. Payluk's key-wide 10/minute limit still applies across
concurrent customers and applications; this is not a load-capacity guarantee.
The request no longer repeats balance lookups in each layer.

Each attempt stores `execution_stage=preparing` and a fresh reference before
provider work; the exact final intent and `submitted` marker are saved before
verification. A failed preparing attempt may retry the same ledger row. Submitted,
processing and legacy attempts require definitive provider reconciliation;
empty history is uncertain. Requeue compares the observed status and reference
inside the seller lock, so stale concurrent proof cannot restart a newer attempt.
The payout-attempt migration changes the requeue RPC signature and must be
coordinated with the matching server release. Apply and test it in QA first.

The matching QA deployment passed a reconciled provider-test withdrawal on
11 October: NGN 1,189.25 net plus NGN 10.75 fee, exactly NGN 1,200 wallet debit.
The original intent-creation rate-limit failure never executed; one reviewed
retry reused its payout ledger row with a fresh attempt. One successful provider
withdrawal and its beneficiary, fee and wallet delta matched. These sandbox
results do not verify receipt at the controlled live bank.

## Dispute allocations

Admin buyer/seller shares divide the original gross price. The application
allocates Payluk's fee-adjusted pool proportionally and stores that immutable
plan before requesting resolution. Non-refundable provider escrow fees are
excluded from the pool; refundable additional fees are credited separately.
The gross ruling remains in disputes.refund_amount/seller_amount, while
provider_settlement records actual buyer credit and seller proceeds. Only
verified provider settlement finalizes the dispute and updates withdrawable
seller_amount. Unknown outcomes stay held for reconciliation; callbacks and
replays cannot release stock or credit proceeds twice.

For an equal gross split of NGN 2,500 with NGN 50 Payluk fee and NGN 75 refundable
additional fee, the expected actual allocation is NGN 1,225 seller and NGN 1,300
buyer (including the additional fee). All 16 funded sandbox split checks passed
against the matching QA deployment, including actual wallet credits, admin retry
and signed webhook replays. Database and unit tests also pass. The additive QA
migration must ship with its matching application handlers.

## Routes and safeguards

- Marketplace: `/api/payment/initialize` and `/api/payment/verify`.
- Event tickets: `/api/events/tickets/purchase` and `/api/events/tickets/verify`.
- Bookings: `/api/bookings/checkout`, `/api/bookings/verify` and `/api/bookings/cancel-checkout`.
- Bank setup: `/api/seller/banks`, `/api/seller/resolve-account`, `/api/seller/setup-account`.
- Signed events: `/api/webhooks/payluk` (the existing `/api/payluk/webhook` alias remains compatible).
- Unknown historical providers fail closed; records are not relabelled or paid through a different provider.
- Payment verification uses the Payluk payment token, checks paid status and amount, and retains buyer authorization.
- Withdrawals retain their stored intent reference and pending outcome until confirmed; a timeout does not authorize a new payout.

Paid event refunds, partial ticket refunds and event cancellations with paid tickets require support-assisted Payluk escrow resolution. The API returns a conflict without marking those tickets refunded. Free tickets can be cancelled directly. This existing limitation remains; removal of a provider is not evidence that automated refund settlement passed.

The old profile payout-add page redirects to `/settings/payout-settings`, which uses actual bank verification and persistence.

## Database and deployment

Applied migrations are immutable history. They can still contain retired provider names and compatibility columns. The backend is shared with other applications; historical rows and columns have not been destructively removed. Production changes must follow matching application deployment and development-project validation. Do not run a blanket migration push: local and live migration versions differ.

The dedicated QA deployment uses an isolated Supabase branch and Payluk test
keys. Funded marketplace, catalog, booking and ticket purchase/release, and
marketplace full dispute refund and split resolution have passed
using Payluk's [test bank](https://docs.payluk.ng/guides/payluk-test-bank), without
wallet top-up/deposit. Funded ledger fixtures are retained. Current evidence and
remaining event, payout and production requirements are in
[QA_RESULTS.md](qa/QA_RESULTS.md). Local mocked tests do not establish provider
settlement.

## Local removal verification — 10 October 2026

- VERIFIED: no retired gateway references remain in active source, scripts, tests or current application documentation. Historical migrations, audit evidence and vendor API references retain their original content.
- VERIFIED: `node --test tests/audit-security.test.cjs` passes all 108 mocked regression checks, including checkout, verification, signed ticket webhooks, payout uncertainty and support-review refund guards.
- VERIFIED: `tsc --noEmit` passes after Next.js regenerates route types. The initial pre-build check found stale generated types for the deleted routes; those errors disappeared after rebuilding.
- VERIFIED: `next lint` exits successfully with 19 existing warnings.
- VERIFIED: `npm run build` exits successfully and lists 173 routes. The app-paths manifest contains no retired gateway endpoints and includes `/api/seller/banks`.
- VERIFIED: obsolete local gateway credentials were removed without displaying values; Payluk credentials were preserved. No secrets were added to tracked files.
- Not verified: live Payluk settlement, bank delivery and browser interaction. No production database mutation, provider transaction, Git push or deployment was performed for this removal.
