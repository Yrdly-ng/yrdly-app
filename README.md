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
- **Paystack**: Payment gateway powering split transactions and automated payouts.
- **Vercel Cron**: Scheduled auto-release webhooks for shipped marketplace orders.

Ensure to map out all required `.env` values mapping DSNs, Public Keys, and the `CRON_SECRET` before deploying.

## Launch payment and database checks

Apply `supabase/migrations/20261003030000_launch_security_hardening.sql` manually **before** deploying the matching application code, during a quiet period for ticket sales. It depends on the earlier community, quote, and booking migrations. Test it against a development Supabase project first. The migration adds Payluk booking escrow IDs, automatic payout IDs, and database guards for community moderation, quote estimates, booking payment status, and ticket capacity. It reconciles `ticket_tiers.sold` from active tickets.

Set `PAYLUK_SECRET_KEY`, `PAYSTACK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` in the deployment environment. Paid event tickets use Paystack by default; `EVENT_TICKET_PAYMENT_PROVIDER=payluk` is optional but requires a support process for Payluk escrow refunds. Register the signed Payluk webhook at `/api/webhooks/payluk` and the Paystack webhook at `/api/webhooks/paystack`.

Before accepting live payments, test a booking checkout and signed Payluk payment event, a Paystack ticket purchase and both `refund.processed` and `refund.failed` webhooks, a marketplace delivery confirmation and bank payout, and a community post approval in staging. Paid bookings and existing Payluk tickets require support-assisted refund handling; their cancellation routes will not report a refund until the provider flow is resolved.
Individual tickets from a multi-ticket payment also require support-assisted refunds; event cancellation requests one refund for that payment as a group.
