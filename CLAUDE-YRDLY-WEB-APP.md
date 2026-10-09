# Yrdly Main Product App

## Product context

Yrdly is a neighbourhood social network and local marketplace focused on Nigerian communities. This is the primary authenticated web product, deployed at `app.yrdly.ng`. People use it to connect with neighbours, share local posts, discover businesses and events, list or buy items, message one another, and manage bookings and transactions. Marketplace payments, event tickets, bookings, and disputes involve provider and database state; treat those flows as sensitive and trace the full lifecycle before editing them.

The sibling `yrdly` repository is the public marketing website. `yrdly-mobile` is the Expo client and shares many product concepts, service modules, and a copy of the Supabase migrations. Each directory is an independent project with its own dependencies and Git history. Do not assume a change here automatically updates the other clients.

## Stack and commands

- Next.js 15 App Router, React 19, TypeScript, Tailwind CSS, and Supabase (Postgres, Auth, Realtime, Storage).
- Integrations in the codebase include Paystack, Payluk escrow, Resend email, Crisp support chat, Google Maps, Vercel analytics, and push notifications. Confirm the relevant feature's current provider and configuration in code before changing it.
- Run commands from this directory: `pnpm dev` (port 9002), `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test:e2e:smoke`.
- `pnpm build` runs `scripts/inject-sw-version.js` before Next.js build. Use the package manifest as the source for current scripts.

## Code map

- `src/app/(app)/`: signed-in product routes, including home/feed, marketplace, map, businesses, communities, events, messages, bookings, notifications, profile, settings, transactions, and admin screens.
- `src/app/api/`: server endpoints for checkout, payment verification and webhooks, payouts, bookings, events, disputes, tickets, notifications, and scheduled jobs.
- `src/components/`: feature UI grouped into marketplace, escrow, events, messages, disputes, reviews, onboarding, settings, and shared UI.
- `src/lib/`: Supabase clients and feature services. Relevant areas include `escrow-service`, `booking-service`, `event-service`, `dispute-service`, `marketplace-listing-service`, `notification-service`, `paystack-service`, and `payluk-service`.
- `src/hooks/`, `src/contexts/`, and `src/types/`: client state and shared domain types.
- `supabase/migrations/`: ordered database changes, including RLS policies, RPCs, triggers, and integrity/safety controls. `supabase/functions/`: deployed Edge Functions.
- `docs/`: technical references and payment design artifacts. Some documents are older than current code; compare them with the implementation and migrations.
- `public/` and `scripts/`: PWA assets/service worker and maintenance/development scripts.

## Current product areas

- **Neighbourhood social:** local feed, posts, comments, reactions, follows/friend connections, communities, alerts, and moderation/reporting.
- **Marketplace:** listings and giveaways, seller/business catalogs, buyer/seller messaging, order status, reviews, and escrow-protected payments.
- **Payments and trust:** Paystack and Payluk integrations, booking checkout, seller payouts, transaction history, disputes, evidence, and safety/admin workflows.
- **Bookings and businesses:** local service providers, service catalogs, availability, quotes, staff, booking management, and payment state.
- **Events:** event creation and discovery, tickets, payment, check-in/scanning, cancellation, and payout-related workflows.
- **Account and engagement:** Supabase authentication, onboarding, phone verification, location-based discovery, notifications/push, saved content, and settings.

This is a map of code areas, not a promise that every flow is enabled for every user or provider. Check the route, server handler, service, and database rules for the specific feature.

## Important implementation rules

- For any payment, refund, escrow, booking, ticket, payout, or dispute change, trace client UI → API route/service → provider webhook or callback → database migration/RLS/trigger. Preserve idempotency, authorization, and valid state transitions.
- Treat Supabase migrations as production-impacting. Inspect related policies, triggers, functions, and both web/mobile copies. Never run database wipe or destructive scripts against production; use a development project for database validation.
- Keep service-role keys and payment/email secrets server-side. Browser code should use the anon client and must not bypass RLS.
- Use the established services in `src/lib/` rather than duplicating provider or database logic in components. Check existing types and error-message helpers.
- Make route and UI changes consistent with existing responsive layouts, authentication/onboarding guards, and Yrdly design tokens.
- If a feature is shared with mobile, inspect `yrdly-mobile` and coordinate the equivalent change there when the task calls for parity. The clients are separate implementations, not a shared component package.
- Use `docs/app-reference.md` for orientation only. It contains historical architecture details and may not match the current route structure, payment provider, or design system.

## Product model and architecture

Yrdly is a local network built around people, neighbourhoods, and nearby commerce in Nigeria. A user's state/LGA/ward and profile shape discovery across the feed, marketplace, businesses, events, and map. People connect socially, trade with neighbours, book local services, and attend events. Trust, safety, moderation, and payments support those interactions.

This is a Next.js monolith with client screens, Supabase browser/server helpers, API route handlers, and database-side security/business logic. It is not REST-only: many reads/writes call Supabase directly using the user's session and rely on RLS; provider secrets and sensitive money/state transitions belong in trusted API routes using server credentials. Identify which pattern a feature uses before changing it.

### Core domain records

- Supabase `auth.users` is the identity. `public.users` is the Yrdly profile keyed by that identity; it holds display name, username, location, verification, role, and product preferences. Auth context exposes both `user` and `profile`.
- `posts` stores general social content and many marketplace listings (often category `For Sale`). Older events may also be represented as posts. Deletion can affect likes, comments, saves, notifications, reports, moderation rows, and transaction links.
- Normalized events use `events`, `ticket_tiers`, `tickets`, and payment/payout state. `src/lib/event-service.ts` retains a fallback for legacy event posts.
- Business/service commerce uses `businesses`, `catalog_items`, `service_offerings`, staff, availability schedules/exceptions, `quote_requests`, and `bookings`.
- `escrow_transactions` is separate from the listed item: it tracks buyer/seller, amount/fees, item type and ID, provider references, payment/delivery timestamps, status, and dispute state.
- Conversations/messages, notifications, community memberships/posts, reports, moderation queue, reviews, and safety alerts provide supporting social/trust features.
- The complete schema and invariants live in `supabase/migrations/` and functions as well as TypeScript types. Types do not replace RLS/database validation.

## End-to-end user journeys

### Authentication and onboarding

1. Sign-in/sign-up screens and OAuth callback live under `src/app/login`, `src/app/onboarding`, and `src/app/auth/callback`.
2. `src/hooks/use-supabase-auth.tsx` wraps `AuthService`; it restores the Supabase identity, loads or creates the corresponding `users` profile, watches profile changes with Realtime, and exposes auth/profile/loading and phone OTP actions.
3. The signed-in surface is `src/app/(app)/`; its layout and `OnboardingGuard` control profile setup and verification.
4. `middleware.ts` restricts signup by country when geo headers are available and redirects `/login` and `/signup` to the marketing website. Inspect it before changing auth destinations.

Start with `src/lib/auth-service.ts`, `src/hooks/use-supabase-auth.tsx`, `src/app/(app)/layout.tsx`, `src/components/OnboardingGuard.tsx`, onboarding screens, and `src/app/auth/callback/route.ts`.

### Feed, communities, and chat

- Feed: `src/app/(app)/home/page.tsx`, `src/hooks/use-posts.tsx`, and `src/components/PostCard.tsx`/post detail components. Posts can be text, media, local events, alerts, or for-sale items; trace category/type assumptions before modifying a shared post surface.
- Communities: screens under `src/app/(app)/communities`, service `src/lib/community-service.ts`. Community creation/submission, approval, membership/join requests, community posts/comments/likes, and moderation are represented separately from ordinary feed posts. Migrations define approval and RLS behavior.
- Messaging: `src/app/(app)/messages`, `src/components/messages`, and `src/lib/supabase-chat-service.ts`. Realtime message events, conversation state, unread counts, and push notifications may involve triggers/Edge Functions in addition to screen code.
- Alerts, reports, moderation, and admin actions use dedicated routes/services. A hidden button or client role check is not an authorization boundary.

### Marketplace: list, buy, deliver, resolve

1. A seller creates or edits a listing using marketplace screens/components; ordinary items are typically `posts` rows, while business products use `catalog_items` related to a business owner.
2. Buyers browse `src/app/(app)/marketplace` and item detail screens. Messaging/contact creates or opens a marketplace conversation; buying starts checkout.
3. Checkout calls `POST /api/payment/initialize`. The trusted server checks the session, item/seller and eligibility, calculates the amount, creates/reuses transaction state, and initializes the configured provider. Its response can carry a Paystack checkout link or Payluk token and a transaction ID.
4. Provider redirects/callbacks and signed webhooks are reconciled by server code into `escrow_transactions` and, where needed, listing/catalog inventory state. A client redirect or SDK success callback alone does not prove payment.
5. Seller shipment/delivery actions and buyer receipt confirmation advance the transaction. The buyer can dispute instead; evidence, admin decisions, provider updates, and reconciliation all affect that lifecycle.
6. Completion may trigger reviews, notifications, and seller payout. Bank setup, payout, refund, and dispute operations have distinct routes and service methods.

Trace `src/components/escrow/*`, `/api/payment/initialize`, `/api/payment/verify`, payment/provider webhooks, `/api/payluk/*`, `/api/disputes/*`, `/api/transactions/*`, and `src/lib/{escrow-service,transaction-status-service,paystack-service,payluk-service,dispute-service}.ts`. There are both Paystack and Payluk implementations; check the current provider selection and live code instead of relying on older prose.

**Do not remove a paid listing as ordinary cleanup.** Inspect `escrow_transactions`, item type, and paid/provider status. The listing guard and migration `20261008105151_protect_paid_marketplace_listings.sql` protect paid marketplace items; retain both application and database enforcement when changing delete flows.

### Businesses, quotes, and bookings

1. Business owners configure a business profile, product catalog, service offerings, active staff, recurring weekly availability, and date-specific availability exceptions.
2. Customers choose a service, optional staff member, date, and time. `BookingService.getAvailableSlots` considers offering duration, weekly hours, blackout/custom hours, and existing non-cancelled bookings.
3. A customer request, business confirmation/decline, cancellation, completion, no-show, payment, and review are related but distinct state transitions. Deposit/full-payment flags and escrow settings on the service affect checkout requirements. Cancellation windows and no-show strikes affect trust eligibility.
4. A quote may be approved and converted to a booking. `POST /api/bookings/checkout` performs conversion/booking creation with server-side operations; inspect rollback/idempotency behavior to avoid duplicate booking rows.
5. Main routes live under `src/app/(app)/bookings` and business management routes. `src/lib/booking-service.ts`, `quote-service.ts`, `staff-service.ts`, API handlers, and migrations implement availability and state rules.

### Events, tickets, and check-in

1. Organizers create an event and ticket tiers via event UI and `POST /api/events/create`; visibility and publication status control discovery.
2. `src/lib/event-service.ts` loads published events/tier data and attendee previews, and supports legacy event posts. Event pages are under `src/app/(app)/events`; organizer views also appear in `my-events`.
3. Paid ticket purchase/verification uses ticket/payment API routes and provider webhooks. Ticket status and `ticket_tiers.sold` capacity counts must remain consistent; migrations include capacity/integrity guards.
4. Organizer scan/check-in validates ticket ownership/status and persists check-in. Cancellation, refund, payout, and scheduled reminders use distinct API/cron flows.

For ticket changes trace event screens, `src/lib/event-service.ts`, `/api/events/*`, `/api/tickets/*`, payment webhook routes, and relevant migrations. Do not confuse this with the public website's separate email/QR registration flow.

### Notifications, trust, and administration

An action can write an in-app `notifications` row through `src/lib/notification-service.ts`, a server route, or a database trigger. Push delivery is a separate path involving device subscriptions and `supabase/functions/send-push-notification`. Also check `src/lib/notification-routing.ts` when a notification opens a screen. Preserve deduplication, actor grouping, unread state, and deep-link semantics.

Disputes, content reports, moderation, appeals, safety alerts, and admin tools are spread across user-facing screens, `/api` handlers, services, RLS policies, RPCs, and migrations. Enforce permissions server/database side and preserve audit fields/state transitions.

## Who owns what across the three projects

| Responsibility | Owner |
|---|---|
| Marketing, newsletter/contact, editorial, public previews | `yrdly` |
| Authenticated product web screens and trusted payment/provider APIs | `yrdly-app` |
| Native screens, permissions, mobile push, native auth/deep links | `yrdly-mobile` |
| Shared product records, RLS, triggers, RPCs | Supabase schema/functions, with migration copies in app repos |
| Payment confirmation | Verified provider event/callback processed by trusted server code and persisted in database |

The web and mobile migration folders are copied, not generated from one package. For shared schema behavior, compare both copies and update app-specific Edge Functions when needed. Some product actions are direct Supabase calls while payment uses the web server; do not assume mobile owns every backend step.

## How Claude Code should investigate a change

1. Start at the requested route and follow it to components, hooks, and services. Determine whether data is queried directly from Supabase or through a Next API route.
2. Search callers using the affected table, API path, status, or service method. Trace adjacent states, not only the screen named in the task.
3. For money, booking, event, or trust changes, inspect the server handler, provider webhook, migration/RLS/trigger, and mobile flow as applicable.
4. Keep authorization and amounts server/database authoritative. Preserve idempotency and concurrency protections, especially around payment, capacity, booking slots, and deletion.
5. Check `git status` first and preserve existing in-progress changes. The three projects are independent Git repositories with separate lockfiles and deploy configuration.

## Commands and operational cautions

- Run from this directory: `pnpm dev` (port 9002), `pnpm typecheck`, `pnpm lint`, `pnpm build`, and configured E2E smoke command when requested.
- `pnpm build` updates the service worker version before building.
- `pnpm db:wipe` is destructive. Never run it against production. Validate migrations with a development Supabase project and inspect RLS/functions/triggers alongside them.
- Keep service-role, payment, and email secrets on server-only paths. Do not print or commit local environment values.
