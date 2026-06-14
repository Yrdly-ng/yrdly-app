<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog into the Yrdly app. The critical fix was creating `instrumentation-client.ts` at the project root — PostHog was imported and called throughout the codebase but `posthog.init()` was never invoked, so all client-side events were silently dropped. Six new events were added to cover gaps in server-side and client-side tracking, user identification was extended to cover Google OAuth callbacks, and a five-insight dashboard was created in PostHog.

## Changes summary

| Area | Change |
|---|---|
| `instrumentation-client.ts` (new) | Calls `posthog.init()` — the missing initialization. Uses the `/ingest` reverse proxy already configured in `next.config.mjs`. Sets `capture_pageview: false` since `PostHogPageView` handles it manually. Enables `capture_exceptions: true`. |
| `src/hooks/use-supabase-auth.tsx` | Added `posthog.identify()` in the `onAuthStateChange` handler to identify users after Google OAuth redirects and on session restore. |
| `.env.local` | Confirmed `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` are set to the correct values. |

## Events added

| Event | Description | File |
|---|---|---|
| `event_created` | Server-side: fired when a user creates a new event (DRAFT or PUBLISHED). Properties: `event_id`, `title`, `category`, `status`, `has_paid_tiers`, `ticket_tier_count`. | `src/app/api/events/create/route.ts` |
| `dispute_opened` | Client-side: fired when a user submits the Open Dispute form. Properties: `transaction_id`, `dispute_reason`, `has_evidence`. | `src/components/disputes/OpenDisputeDialog.tsx` |
| `review_submitted` | Client-side: fired when a user submits a business review after a transaction. Properties: `business_id`, `transaction_id`, `rating`, `has_comment`. | `src/components/reviews/SubmitReviewDialog.tsx` |
| `ticket_checked_in` | Server-side: fired when an organizer scans and checks in a ticket holder. Properties: `event_id`, `ticket_id`, `tier_name`. | `src/app/api/events/checkin/route.ts` |
| `ticket_refunded` | Server-side: fired when an organizer issues a manual ticket refund. Properties: `ticket_id`, `event_id`, `amount`. | `src/app/api/events/tickets/refund/route.ts` |
| `free_item_claimed` | Server-side: fired when a buyer claims a free marketplace item. Properties: `item_id`, `transaction_id`, `seller_id`. | `src/app/api/marketplace/claim/route.ts` |

## Previously existing events (no changes needed)

`user_signed_up`, `user_signed_in`, `google_sign_in_initiated`, `user_signed_out`, `marketplace_item_clicked`, `marketplace_seller_messaged`, `payment_initialized`, `payment_verified`, `payment_verification_failed`, `ticket_purchased`, `event_published`, `event_cancelled`

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/469812/dashboard/1710932)
- [Marketplace Purchase Funnel](https://us.posthog.com/project/469812/insights/PNVDPOAY)
- [Event Ticketing Funnel](https://us.posthog.com/project/469812/insights/OQ1j3kpZ)
- [New User Signups](https://us.posthog.com/project/469812/insights/lOCno9mS)
- [Key Business Activity](https://us.posthog.com/project/469812/insights/mcwEMFvJ)
- [Disputes & Reviews Trend](https://us.posthog.com/project/469812/insights/cCai4OJE)

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-nextjs-app-router/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
