<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Yrdly app. PostHog was already partially integrated (provider + pageview tracking), so the wizard migrated the initialization to `instrumentation-client.ts` (the recommended approach for Next.js 15.3+), removed the `useEffect`-based init from `PostHogProvider`, added `capture_exceptions: true` for error tracking, and configured a reverse proxy. A server-side client (`posthog-node`) was installed and wired into four critical API routes. User identification and sign-out reset were added to the auth flows.

| Event | Description | File |
|---|---|---|
| `user_signed_up` | Fired when a user creates a new email/password account. Calls `posthog.identify()` with the new user's ID and email. | `src/app/login/page.tsx` |
| `user_signed_in` | Fired when a user signs in with email/password. Calls `posthog.identify()` with user ID and email. | `src/app/login/page.tsx` |
| `google_sign_in_initiated` | Fired when a user clicks the Google sign-in button. | `src/app/login/page.tsx` |
| `user_signed_out` | Fired before sign-out; followed by `posthog.reset()` to clear the identity. | `src/hooks/use-supabase-auth.tsx` |
| `marketplace_item_clicked` | Fired when a user clicks a marketplace listing. Properties: `item_id`, `item_title`, `item_price`. | `src/app/(app)/marketplace/page.tsx` |
| `marketplace_seller_messaged` | Fired when a user opens a chat with a seller. Properties: `item_id`, `item_title`, `item_price`, `seller_id`. | `src/app/(app)/marketplace/page.tsx` |
| `payment_verified` | Fired on the client when marketplace payment verification succeeds. Properties: `transaction_id`, `amount`, `tx_ref`. | `src/app/(app)/payment/verify/page.tsx` |
| `payment_verification_failed` | Fired on the client when payment verification fails. Properties: `error`, `tx_ref`. | `src/app/(app)/payment/verify/page.tsx` |
| `payment_initialized` | Server-side: fired when an escrow payment link is successfully created. Properties: `transaction_id`, `item_id`, `amount`, `currency`, `seller_id`. | `src/app/api/payment/initialize/route.ts` |
| `ticket_purchased` | Server-side: fired when a free ticket is issued or a paid ticket payment link is created. Properties: `ticket_id`/`tx_ref`, `event_id`, `tier_id`, `tier_name`, `amount`, `is_free`. | `src/app/api/events/tickets/purchase/route.ts` |
| `event_published` | Server-side: fired when an organizer publishes a draft event. Properties: `event_id`. | `src/app/api/events/[id]/publish/route.ts` |
| `event_cancelled` | Server-side: fired when an organizer cancels an event and refunds are triggered. Properties: `event_id`, `tickets_refunded`, `refund_errors`. | `src/app/api/events/[id]/cancel/route.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/1649209)
- [Sign-up total (last 30 days)](/insights/VOZSNQJI)
- [User sign-ups and sign-ins](/insights/rP5iXxZ4)
- [Payments over time](/insights/oJWz16t5)
- [Marketplace purchase funnel](/insights/CQAkv3mi)
- [Event publishing and ticket sales](/insights/JADfGgft)

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-nextjs-app-router/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
