# Yrdly Marketplace

Yrdly is a next-generation local community marketplace and social hub. It connects neighbors through a robust escrow payment system, social feed, and robust events tracking.

## Features

- **Secure Marketplace (Escrow):** Buyers can purchase goods through Payluk escrow. Delivery confirmation or a provider-approved claim releases funds before a bank payout is attempted.
- **Social & Community Feed:** Neighbors can interact, chat, send requests, and RSVP to local events.
- **Dynamic Dispute Resolution:** Escrow holds allow users to raise disputes directly connected to transactions via the platform API.

## Development

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) (or 9002) with your browser to see the result.

## Production Configuration

Yrdly relies on several critical third-party integrations:
- **Supabase**: Backend-as-a-Service, database logic, and storage.
- **Payluk**: The only payment provider for marketplace, business and event escrow, bank verification and payouts.
- **Vercel Cron**: Scheduled auto-release webhooks for shipped marketplace orders.

Ensure to map out all required `.env` values mapping DSNs, Public Keys, and the `CRON_SECRET` before deploying.

## Launch payment and database checks

Reconcile the reviewed migrations against the target Supabase project and validate them in an isolated development project before rollout. Local and live migration versions differ; do not run a blanket migration push. Deploy matching application code before the restrictive audit guards and private-storage switch described in `AUDIT_FIX_STATUS.md`.

Set `PAYLUK_SECRET_KEY`, `NEXT_PUBLIC_PAYLUK_PUBLIC_KEY` (for inline checkout), `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` in the deployment environment. All paid checkouts use Payluk; there is no provider selector. Register the signed webhook at `/api/webhooks/payluk`. Use `/api/seller/banks` and `/api/seller/resolve-account` for payout account setup.

Before accepting live payments, test a booking checkout and signed Payluk payment event, a Payluk ticket purchase and signed escrow refund events, a marketplace delivery confirmation and bank payout, and a community post approval in staging. Paid bookings and paid event tickets require support-assisted refund handling; their cancellation routes will not report a refund until the provider flow is resolved.
Paid event cancellations and partial or multi-ticket refunds require support-assisted Payluk escrow resolution. Free tickets can be cancelled directly. See [the payment integration guide](docs/payments.md) for rollout boundaries and verification status.
