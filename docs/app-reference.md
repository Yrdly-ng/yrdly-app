# Yrdly App — Complete Technical Reference

> **Payment sections updated:** October 2026 (other sections retain their earlier reference context)
> **Stack:** Next.js 15 (App Router, Turbopack) · Supabase · Payluk · Tailwind CSS · TypeScript

---

## Table of Contents

1. [What is Yrdly?](#1-what-is-yrdly)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Design System](#4-design-system)
5. [Authentication](#5-authentication)
6. [Core Features](#6-core-features)
7. [Marketplace & Escrow](#7-marketplace--escrow)
8. [Payment Flow](#8-payment-flow)
9. [Environment Variables](#9-environment-variables)
10. [Database Schema](#10-database-schema)
11. [API Routes](#11-api-routes)
12. [Key Files Reference](#12-key-files-reference)
13. [Running the App](#13-running-the-app)
14. [Known Limitations & Next Steps](#14-known-limitations--next-steps)

---

## 1. What is Yrdly?

Yrdly is a **hyper-local community marketplace and social platform** for Nigerian neighbourhoods. Users can:

- Buy and sell physical items via **escrow-protected transactions**
- Post community updates, events, and local news
- Discover businesses in their area
- Chat with neighbours and sellers
- Browse content filtered by their **LGA or ward**

### Core Principles
- **Safety first** — all marketplace purchases go through escrow; funds are only released when the buyer confirms receipt
- **Local by default** — content is filtered to your immediate area; you expand outward by choice
- **Commission model** — Yrdly takes a configurable fee (currently 3%) on each successful transaction
- **Free listings, paid boosts** — listing an item is always free; sellers can pay to boost visibility

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS + inline Stitch design tokens |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password + OAuth) |
| Realtime | Supabase Realtime (chat messages) |
| Storage | Supabase Storage (images, dispute evidence) |
| Payments | Payluk escrow (inline SDK / hosted checkout) |
| Deployment | Vercel (planned) |
| Fonts | Raleway · Plus Jakarta Sans · Work Sans · Pacifico · Jersey 25 |

---

## 3. Project Structure

```
yrdly-app/
├── src/
│   ├── app/
│   │   ├── (app)/                    # All authenticated app routes
│   │   │   ├── home/                 # Feed / neighbourhood posts
│   │   │   ├── marketplace/          # Item listings grid
│   │   │   │   └── [itemId]/         # Item detail + BuyButton
│   │   │   ├── payment/
│   │   │   │   ├── redirect/         # Loading spinner → Payluk
│   │   │   │   ├── verify/           # Payluk callback → API verify
│   │   │   │   ├── escrow-confirmation/  # "Payment Secured!" screen
│   │   │   │   └── success/          # Payout success + review prompt
│   │   │   ├── transactions/
│   │   │   │   ├── [transactionId]/  # Transaction detail page
│   │   │   │   │   ├── mark-sent/    # Seller: checklist → confirm sent
│   │   │   │   │   ├── confirm-receipt/  # Buyer: confirm or dispute
│   │   │   │   │   ├── dispute/      # Raise a dispute
│   │   │   │   │   └── review/       # Leave a star review
│   │   │   ├── messages/             # DM + marketplace chat
│   │   │   ├── map/                  # Dark-mode map view
│   │   │   ├── events/               # Community events
│   │   │   ├── businesses/           # Local business directory
│   │   │   ├── profile/
│   │   │   │   ├── payouts/          # Seller payout accounts
│   │   │   │   │   └── add/          # Add bank account
│   │   │   │   ├── purchases/        # Buyer order history
│   │   │   │   └── sold-items/       # Seller listing history
│   │   │   ├── settings/             # App settings
│   │   │   └── notifications/        # Notification centre
│   │   ├── api/
│   │   │   └── payment/
│   │   │       ├── initialize/route.ts   # ★ Creates escrow + Payluk link
│   │   │       └── verify/route.ts       # ★ Verifies Payluk + marks PAID
│   │   ├── auth/callback/            # Supabase OAuth callback
│   │   ├── onboarding/               # Welcome → Tour → Profile setup
│   │   ├── login/ signup/            # Auth screens
│   │   └── layout.tsx                # Root layout (viewport, fonts)
│   ├── components/
│   │   ├── escrow/
│   │   │   └── BuyButton.tsx         # ★ Order Summary sheet + payment
│   │   ├── marketplace/
│   │   │   └── MarketplaceItemDetail.tsx
│   │   ├── events/EventDetail.tsx
│   │   ├── ui/                       # Shadcn-style primitives (dialog, etc.)
│   │   ├── CreatePostDialog.tsx
│   │   ├── CreateItemDialog.tsx
│   │   ├── CreateBusinessDialog.tsx
│   │   └── SearchDialog.tsx
│   ├── lib/
│   │   ├── supabase.ts               # Anon client (browser-safe)
│   │   ├── supabase-admin.ts         # ★ Service-role client (API routes only)
│   │   ├── escrow-service.ts         # Escrow CRUD (uses anon client)
│   │   ├── payluk-service.ts         # Payluk helper (server-only)
│   │   ├── transaction-status-service.ts  # Status transitions
│   │   ├── item-tracking-service.ts  # Availability checks
│   │   └── designTokens.ts           # Stitch design system tokens
│   ├── hooks/
│   │   ├── use-supabase-auth.ts
│   │   └── use-toast.ts
│   └── types/
│       ├── escrow.ts                 # EscrowStatus enum + interfaces
│       └── index.ts                  # Post, Profile, etc.
├── docs/
│   ├── app-reference.md              # ← This file
│   └── marketplace-implementation.md # Detailed escrow/marketplace spec
├── .env                              # Supabase keys (public safe)
├── .env.local                        # Secret keys (never commit)
└── public/
```

---

## 4. Design System

### Stitch Dark-Mode Tokens

The entire app is locked to dark mode. These are the core tokens:

| Token | Value | Usage |
|---|---|---|
| Background | `#101418` | Page backgrounds |
| Surface | `#1d2025` | Cards, sheets |
| Surface High | `#272a2f` | Inputs, elevated cards |
| Accent Green | `#388E3C` | Buttons, borders, CTAs |
| Green Light | `#82DB7E` | Text on dark, icons |
| Muted | `#bfcab9` | Secondary text |
| Dim | `#899485` | Tertiary text, labels |

### Typography

| Font | Use |
|---|---|
| **Jersey 25** | Yrdly wordmark |
| **Pacifico** | Screen headings |
| **Raleway** | Body, labels, buttons |
| **Plus Jakarta Sans** | Bold CTAs |
| **Work Sans** | General body text |

### Mobile Rules
- Viewport: `maximum-scale=1, user-scalable=no` — prevents iOS auto-zoom
- All inputs: `font-size: 16px` minimum (prevents iOS zoom on focus)
- All interactive elements: `touch-action: manipulation` (removes 300ms tap delay)

---

## 5. Authentication

- **Provider:** Supabase Auth (email/password)
- **Session:** Persisted in browser via Supabase's built-in session management
- **Hook:** `useAuth()` from `src/hooks/use-supabase-auth.ts` gives `{ user, profile, loading }`
- **Protected Routes:** Middleware redirects unauthenticated users to `/login`
- **Onboarding Flow:** New users go through `/onboarding/welcome` → `/onboarding/tour` → `/onboarding/profile`

---

## 6. Core Features

### Feed (Home)
- Shows posts from neighbours sorted by recency
- Post types: text updates, events, marketplace items, community alerts
- Users can react, comment, and share

### Map View (`/map`)
- Custom dark Mapbox/Google Maps style
- Glassmorphism header overlay
- Item pins for nearby marketplace listings

### Businesses (`/businesses`)
- Local business directory
- Business owners can claim/create their profile via `CreateBusinessDialog`
- Each business has a catalog of items/services

### Events (`/events`)
- Community event listings with date, location, and RSVP
- Event detail sheet with full info

### Chat (`/messages`)
- DM conversations between users
- Marketplace-specific conversations auto-created when a buyer contacts a seller
- Realtime via Supabase Realtime subscriptions

### Notifications (`/notifications`)
- In-app notification centre
- Triggered by: new messages, transaction status changes, disputes

---

## 7. Marketplace & Escrow

Marketplace listings use `posts` (`For Sale` / `Giveaway`); business catalog listings use `catalog_items`. The authenticated server derives buyer, seller and price, reserves inventory and creates a Payluk escrow. The browser uses the Payluk inline SDK when configured, with a hosted checkout link as fallback.

Payment verification and signed webhooks commit local payment/inventory state through the database. Escrow transitions include pending, paid, shipped, delivered, completed, disputed and cancelled. Refund amounts are recorded separately; never infer a refund solely from a cancelled status.

The canonical commission is 3%, defined in `src/lib/constants.ts`. Marketplace checkout adds the platform commission as an additional fee; event commission is deducted at organizer payout. Reconcile provider fees and actual settlement in the sandbox before launch changes.

## 8. Payment Flow

Payluk is the only payment provider. See [payments.md](payments.md) for the current integration and remaining live verification.

| File | Role |
|---|---|
| `src/lib/payluk-service.ts` | Server-side Payluk API requests |
| `src/lib/payluk-onboarding.ts` | Customer identity and onboarding |
| `src/components/escrow/BuyButton.tsx` | Marketplace checkout |
| `src/app/api/payment/initialize/route.ts` | Reserves marketplace order and initializes escrow |
| `src/app/api/payment/verify/route.ts` | Buyer-authorized Payluk verification |
| `src/app/api/events/tickets/purchase/route.ts` | Free tickets or paid Payluk escrow |
| `src/lib/ticket-service.ts` | Payment verification and idempotent ticket issuance |
| `src/app/api/webhooks/payluk/route.ts` | Signed payment and escrow events |
| `src/lib/event-escrow-service.ts` | Organizer bank payouts with persisted attempt references |

Paid event refunds and cancellations require support-assisted Payluk escrow resolution. The API keeps paid tickets unchanged until the refund is confirmed. Free tickets can be cancelled directly. Unknown historical payment providers require reconciliation and are never silently relabelled.

## 9. Environment Variables

Keep credentials in ignored environment files and deployment settings. An isolated QA environment must use its own Supabase project credentials and test payment keys.

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<public-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-key>
NEXT_PUBLIC_APP_URL=http://localhost:9002
PAYLUK_SECRET_KEY=<server-only-test-or-live-key>
NEXT_PUBLIC_PAYLUK_PUBLIC_KEY=<publishable-key-for-inline-checkout>
CRON_SECRET=<server-only-cron-secret>
```

The Payluk secret key selects staging or production. Webhook signatures use that environment's secret key. Configure `/api/webhooks/payluk` in the provider dashboard. No payment-provider selector is used.

## 10. Database Schema

| Tables | Purpose |
|---|---|
| `posts`, `catalog_items` | Marketplace and business listings |
| `escrow_transactions` | Buyer/seller amounts, provider, payment token and escrow ID, lifecycle |
| `disputes`, `dispute_resolution_operations` | Dispute amounts and durable resolution attempts |
| `events`, `ticket_tiers`, `tickets` | Events, capacity and buyer tickets |
| `seller_accounts`, `payout_requests`, `event_payouts` | Verified bank details and persisted payout attempts |
| `users`, `public_profiles` | Private account state and scoped public profile data |
| `conversations`, `messages` | Membership-scoped messaging |

Check migration files and live schema before database changes. Historical migrations are retained; the shared backend has version drift and unapplied audit guards. Do not run a blanket migration push against production. Browser access depends on grants and RLS; service-role credentials belong only in server code.

## 11. API Routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/payment/initialize` | Marketplace Payluk checkout |
| POST | `/api/payment/verify` | Verify the authenticated buyer's transaction |
| POST | `/api/events/tickets/purchase` | Event ticket checkout |
| POST | `/api/events/tickets/verify` | Verify tickets and return minimal identifiers |
| POST | `/api/events/tickets/refund` | Cancel a free ticket; paid refunds require support |
| POST | `/api/events/[id]/cancel` | Cancel an event after any paid refunds are resolved |
| GET | `/api/seller/banks` | Authenticated Payluk bank list |
| GET/POST | `/api/seller/resolve-account` | Payluk account-name resolution |
| GET/POST | `/api/seller/setup-account` | Read/link the authenticated seller's bank account |
| POST | `/api/webhooks/payluk` | HMAC-SHA512 signed provider events |

For exact request and response shapes, read each route. Treat browser callback success as a prompt to verify server-side; it is not proof that funds moved.

---

## 12. Key Files Reference

| File | Purpose |
|---|---|
| `src/lib/supabase.ts` | Browser Supabase client (anon key) |
| `src/lib/supabase-admin.ts` | Server Supabase client (service role) |
| `src/lib/designTokens.ts` | Stitch design system colour/font tokens |
| `src/lib/escrow-service.ts` | Escrow CRUD operations |
| `src/lib/transaction-status-service.ts` | `confirmShipped`, `confirmDelivered`, etc. |
| `src/components/ui/dialog.tsx` | Radix dialog with `hideClose` prop |
| `src/components/escrow/BuyButton.tsx` | Full Order Summary sheet + payment init |
| `src/app/layout.tsx` | Root layout — viewport meta (iOS zoom fix) |
| `src/app/globals.css` | Global CSS — touch-action, font-size fixes |
| `docs/marketplace-implementation.md` | Detailed escrow/commission/payout roadmap |

---

## 13. Running the App

```bash
# Install dependencies
npm install

# Start dev server (port 9002)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

**Dev URL:** http://localhost:9002

### First-Time Setup Checklist
- [ ] Create a Supabase project
- [ ] Reconcile and validate required database migrations in an isolated development project
- [ ] Copy your Supabase URL + anon key → `.env`
- [ ] Copy your Supabase service role key → `.env.local`
- [ ] Add your Payluk test keys → `.env.local`
- [ ] Set `NEXT_PUBLIC_APP_URL` in `.env.local`
- [ ] Configure `/api/webhooks/payluk` in the Payluk dashboard; signatures use `PAYLUK_SECRET_KEY`

---

## 14. Known Limitations & Next Steps

Read `AUDIT_FIX_STATUS.md` for the audit rollout status. Local fixes are not a production end-to-end certification. Remaining gates include GitHub publishing access, an isolated Supabase QA project, deployed database/security guards, browser verification and real Payluk sandbox payment, escrow release, bank payout and refund reconciliation.

Paid bookings and event ticket refunds use support-assisted Payluk resolution. Historical migrations and shared database compatibility columns remain until a separately reviewed database cleanup. Do not remove historical financial records or rewrite applied migrations.
