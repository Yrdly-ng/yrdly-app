# Yrdly App — Complete Technical Reference

> **Last updated:** March 2026  
> **Stack:** Next.js 15 (App Router, Turbopack) · Supabase · Paystack · Tailwind CSS · TypeScript

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
| Payments | Paystack (hosted standard checkout) |
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
│   │   │   │   ├── redirect/         # Loading spinner → Paystack
│   │   │   │   ├── verify/           # Paystack callback → API verify
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
│   │   │       ├── initialize/route.ts   # ★ Creates escrow + Paystack link
│   │   │       └── verify/route.ts       # ★ Verifies Paystack + marks PAID
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
│   │   ├── paystack-service.ts       # Paystack helper (server-only)
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

### Listing an Item
1. User taps **+** → "Sell an Item" → `CreateItemDialog`
2. Fills in title, description, price, photos, condition, location
3. Item is saved to `posts` table with `category = 'For Sale'`
4. Item appears in `/marketplace` grid

### Buying an Item — Escrow Flow

```
Buyer taps "Buy Now" on a listing
  ↓
BuyButton opens Stitch Order Summary sheet
  Shows: item, seller, item price, 3% fee, total
  ↓
Buyer taps "Pay Securely"
  ↓
POST /api/payment/initialize (server-side)
  - Validates availability
  - Creates escrow_transactions row (PENDING status)
  - Calls Paystack /transaction/initialize API
  - Returns hosted checkout link
  ↓
/payment/redirect (loading screen, then redirects to Paystack)
  ↓
Buyer completes payment on Paystack hosted page
  ↓
Paystack redirects to /payment/verify?tx_ref={id}
  ↓
/payment/verify page calls POST /api/payment/verify
  - Verifies payment with Paystack
  - Updates escrow status → PAID
  - Marks item as is_sold = true
  ↓
Redirects to /payment/escrow-confirmation
  Shows: success, 4-step escrow timeline
```

### After Payment

| Actor | Action | Route |
|---|---|---|
| Seller | Marks item as sent (3-point checklist) | `/transactions/[id]/mark-sent` |
| Buyer | Confirms receipt or raises dispute | `/transactions/[id]/confirm-receipt` |
| Buyer | Raises dispute with reason + evidence | `/transactions/[id]/dispute` |
| System | Auto-releases funds after 48h if no action | (cron job — pending) |
| Buyer | Leaves star review | `/transactions/[id]/review` |
| Seller | Views payout confirmation | `/payment/success` |

### Escrow Statuses

```
PENDING → PAID → SHIPPED → DELIVERED → COMPLETED
                         ↘ DISPUTED
```

### Commission
- Currently **3%** of item price, added on top (buyer pays item + fee)
- Configured in `/api/payment/initialize` as `Math.round(price * 0.03)`
- **To change the rate:** Update this constant — a `platform_config` DB table is planned for dynamic config

---

## 8. Payment Flow

### Files Involved

| File | Role |
|---|---|
| `src/components/escrow/BuyButton.tsx` | UI sheet + calls `/api/payment/initialize` |
| `src/app/api/payment/initialize/route.ts` | Creates escrow row + Paystack link (server-side) |
| `src/app/(app)/payment/redirect/page.tsx` | Auto-redirect loading screen |
| `src/app/(app)/payment/verify/page.tsx` | Receives Paystack callback, triggers API verify |
| `src/app/api/payment/verify/route.ts` | Verifies payment + updates DB |
| `src/app/(app)/payment/escrow-confirmation/page.tsx` | Success state shown to buyer |
| `src/app/(app)/payment/success/page.tsx` | Payout confirmation + review |

### Paystack Integration
- **Mode:** Test mode (keys in `.env.local`)
- **Method:** Paystack Standard (hosted checkout page)
- **Test Card:** `4084 0840 8408 4081` · Expiry `any future date` · CVV `123` · PIN `any`
- **Redirect URL:** `{APP_URL}/payment/verify?tx_ref={transactionId}`

---

## 9. Environment Variables

### `.env` (committed, public-safe)
```env
NEXT_PUBLIC_SUPABASE_URL=https://yoiyqxtpmxnrrbqqidcs.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_APP_URL=http://localhost:9002
```

### `.env.local` (never commit — contains secrets)
```env
# Supabase admin — bypasses RLS for server-side writes
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # Project Settings → API → service_role

# Paystack test keys
PAYSTACK_PUBLIC_KEY=pk_test_...
PAYSTACK_SECRET_KEY=sk_test_...

# Webhook secret — must match Paystack dashboard → Webhooks
PAYSTACK_WEBHOOK_SECRET=your_secret_here

# App URL — update to https://... in production
NEXT_PUBLIC_APP_URL=http://localhost:9002
```

> ⚠️ **Critical:** `SUPABASE_SERVICE_ROLE_KEY` must **only** be used in `src/app/api/**` routes via `supabaseAdmin`. Never import `supabase-admin.ts` from any client component or page.

---

## 10. Database Schema

### Key Tables

#### `posts`
Stores all content: community posts, marketplace items, events.
```sql
id          uuid PK
user_id     uuid → users
category    text  -- 'For Sale', 'Event', 'Community', etc.
title       text
text        text
description text
price       numeric
image_urls  text[]
image_url   text
is_sold     boolean default false
event_location jsonb
timestamp   timestamptz
created_at  timestamptz
```

#### `escrow_transactions`
Core marketplace transaction table.
```sql
id              uuid PK
item_id         uuid → posts
buyer_id        uuid → users
seller_id       uuid → users
amount          numeric  -- item price
commission      numeric  -- platform fee
total_amount    numeric  -- amount + commission
seller_amount   numeric  -- amount - commission
status          text     -- PENDING/PAID/SHIPPED/DELIVERED/COMPLETED/DISPUTED/CANCELLED
payment_method  text
payment_reference text   -- Paystack tx ref
delivery_details  jsonb
dispute_reason  text
paid_at         timestamptz
shipped_at      timestamptz
delivered_at    timestamptz
completed_at    timestamptz
dispute_resolved_at timestamptz
created_at      timestamptz
updated_at      timestamptz
```

#### `users` / `profiles`
User identity and profile data.

#### `conversations` / `messages`
Chat system. Marketplace conversations link to a specific `item_id`.

#### `payout_accounts` *(planned)*
Seller bank account details for automated payouts.
```sql
id              uuid PK
user_id         uuid → users
bank_name       text
account_number  text
account_name    text  -- Verified by Paystack
paystack_subaccount_id text
is_default      boolean
created_at      timestamptz
```

### RLS Policy Notes
- The `escrow_transactions` table has RLS enabled
- **Anon client** (used in browser/pages) can only read rows where `buyer_id` or `seller_id` = the current user
- **Service role client** (`supabaseAdmin`) bypasses RLS — only used in `/api/**` routes

---

## 11. API Routes

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/payment/initialize` | Creates escrow + Paystack hosted link |
| `POST` | `/api/payment/verify` | Verifies Paystack payment, marks transaction PAID |
| `POST` | `/api/user-status` | Online/last-seen tracking |

### `POST /api/payment/initialize`
**Body:**
```json
{
  "itemId": "uuid",
  "buyerId": "uuid",
  "sellerId": "uuid",
  "price": 4000,
  "buyerEmail": "buyer@email.com",
  "buyerName": "Ade",
  "itemTitle": "iPhone 12",
  "sellerName": "Caleb"
}
```
**Response:**
```json
{
  "success": true,
  "paymentLink": "https://checkout.paystack.com/...",
  "transactionId": "uuid"
}
```

### `POST /api/payment/verify`
**Body:** `{ "txRef": "uuid-here" }`  
**Response:** `{ "success": true, "transactionId": "uuid", "amount": 4120 }`

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
- [ ] Run the database migrations (tables listed in §10)
- [ ] Copy your Supabase URL + anon key → `.env`
- [ ] Copy your Supabase service role key → `.env.local`
- [ ] Add your Paystack test keys → `.env.local`
- [ ] Set `NEXT_PUBLIC_APP_URL` in `.env.local`
- [ ] Set `PAYSTACK_WEBHOOK_SECRET` in both `.env.local` and the Paystack dashboard

---

## 14. Known Limitations & Next Steps

### Pending Implementation
| Feature | Status | Notes |
|---|---|---|
| Dispute submission (backend) | 🟡 UI done, placeholder | Wire to a `disputes` table |
| Review submission (backend) | 🟡 UI done, placeholder | Wire to `reviews` table |
| Add payout account (backend) | 🟡 UI done, placeholder | Paystack Resolve Account API + `payout_accounts` table |
| 48h auto-release | 🔴 Not started | Requires Supabase Edge Function + pg_cron |
| Commission from DB | 🔴 Hardcoded at 3% | Add `platform_config` table |
| Delivery tracking | 🔴 Not started | Face-to-face only for now |
| Location filtering (LGA/ward) | 🔴 Not started | Core to the "local first" vision |
| Paid boosts | 🔴 Not started | Separate Paystack payment flow |
| Push notifications | 🔴 Not started | Service worker registered, not sending |
| Seller subaccounts (Paystack) | 🔴 Not started | Needed for automated payouts |

### Known Issues
- `profile/payouts` page is **109 kB** — needs code splitting or lazy loading
- `use-posts.tsx` has a redundant `useCallback` dependency (lint warning)
- Dispute image uploads need Supabase Storage bucket configured before use

### Architecture Decisions Made
- **All payment calls go through API routes** — the Paystack secret key is never sent to the browser
- **`supabaseAdmin` only in `/api/**`** — using it in a page component would expose the service role key in the client bundle
- **Escrow happens client-to-escrow-to-seller** — we never send money anywhere automatically until the buyer confirms
- **No delivery service** — the platform facilitates meeting/handover; it does not own the delivery leg
