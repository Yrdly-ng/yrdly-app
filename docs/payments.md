# Payments

Payluk is the only payment provider in `yrdly-app`. Marketplace, business and event checkouts use Payluk escrow. Bank lists, account verification and withdrawals also use Payluk. Event checkout has no provider selection or fallback to another gateway.

## Configuration

- `PAYLUK_SECRET_KEY`: server-only API and webhook-signature key. Test keys select staging; live keys select production.
- `NEXT_PUBLIC_PAYLUK_PUBLIC_KEY`: publishable key for the inline checkout SDK.
- `NEXT_PUBLIC_APP_URL`: application return URL.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only database access.
- `CRON_SECRET`: authenticated scheduled tasks.

Use project-specific Supabase credentials and test Payluk keys in the ignored `.env.qa`. Never commit keys. Production and preview deployment settings must be updated separately when publishing the matching code.

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

Before continuing live QA, publish this branch, configure Payluk credentials/webhook for the target environment, and test purchase, ticket issuance, escrow release, organizer payout and refund reconciliation against an isolated Supabase project. Local mocked tests do not establish that provider settlement succeeds.

## Local removal verification — 10 October 2026

- VERIFIED: no retired gateway references remain in active source, scripts, tests or current application documentation. Historical migrations, audit evidence and vendor API references retain their original content.
- VERIFIED: `node --test tests/audit-security.test.cjs` passes all 108 mocked regression checks, including checkout, verification, signed ticket webhooks, payout uncertainty and support-review refund guards.
- VERIFIED: `tsc --noEmit` passes after Next.js regenerates route types. The initial pre-build check found stale generated types for the deleted routes; those errors disappeared after rebuilding.
- VERIFIED: `next lint` exits successfully with 19 existing warnings.
- VERIFIED: `npm run build` exits successfully and lists 173 routes. The app-paths manifest contains no retired gateway endpoints and includes `/api/seller/banks`.
- VERIFIED: obsolete local gateway credentials were removed without displaying values; Payluk credentials were preserved. No secrets were added to tracked files.
- Not verified: live Payluk settlement, bank delivery and browser interaction. No production database mutation, provider transaction, Git push or deployment was performed for this removal.
