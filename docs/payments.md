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
reconciliation. Funded verification of this event change remains pending.

Booking commission collection remains a separate open verification requirement.

## Routes and safeguards

- Marketplace: `/api/payment/initialize` and `/api/payment/verify`.
- Event tickets: `/api/events/tickets/purchase` and `/api/events/tickets/verify`.
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
keys. Funded marketplace purchase, delivery and full dispute refund have passed
using Payluk's [test bank](https://docs.payluk.ng/guides/payluk-test-bank), without
wallet top-up/deposit. Funded ledger fixtures are retained. Current evidence and
remaining event, booking, payout and production requirements are in
[QA_RESULTS.md](../QA_RESULTS.md). Local mocked tests do not establish provider
settlement.

## Local removal verification — 10 October 2026

- VERIFIED: no retired gateway references remain in active source, scripts, tests or current application documentation. Historical migrations, audit evidence and vendor API references retain their original content.
- VERIFIED: `node --test tests/audit-security.test.cjs` passes all 108 mocked regression checks, including checkout, verification, signed ticket webhooks, payout uncertainty and support-review refund guards.
- VERIFIED: `tsc --noEmit` passes after Next.js regenerates route types. The initial pre-build check found stale generated types for the deleted routes; those errors disappeared after rebuilding.
- VERIFIED: `next lint` exits successfully with 19 existing warnings.
- VERIFIED: `npm run build` exits successfully and lists 173 routes. The app-paths manifest contains no retired gateway endpoints and includes `/api/seller/banks`.
- VERIFIED: obsolete local gateway credentials were removed without displaying values; Payluk credentials were preserved. No secrets were added to tracked files.
- Not verified: live Payluk settlement, bank delivery and browser interaction. No production database mutation, provider transaction, Git push or deployment was performed for this removal.
