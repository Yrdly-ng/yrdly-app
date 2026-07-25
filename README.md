# Yrdly Marketplace

Yrdly is a next-generation local community marketplace and social hub. It connects neighbors through a robust escrow payment system, social feed, and robust events tracking.

## Features

- **Secure Marketplace (Escrow):** Buyers can purchase goods via Paystack Split Payments. Funds are held in escrow and only released upon successful receipt, accompanied by an automated 48-hour auto-release cron.
- **Social & Community Feed:** Neighbors can interact, chat, send requests, and RSVP to local events.
- **Dynamic Dispute Resolution:** Escrow holds allow users to raise disputes directly connected to transactions via the platform API.
- **Sentry Monitoring:** Fully integrated with complete production SDK telemetry, active session replays, and component-level error routing.

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
- **Sentry**: Distributed application error tracking.
- **Vercel Cron**: Scheduled auto-release webhooks for shipped marketplace orders.

Ensure to map out all required `.env` values mapping DSNs, Public Keys, and the `CRON_SECRET` before deploying.
