# Implementation Plan: Event Ticketing System

## Goal
The goal of this implementation plan is to build a full-featured **Event Ticketing System** for Yrdly from the ground up, allowing users to discover, create, and attend local events. 

Key objectives include:
1. **Event Creation & Ticketing:** Allow organizers to create free or paid events with multiple ticket tiers (e.g., Early Bird, VIP), complete with capacity limits.
2. **Secure Payments (Escrow):** Integrate Flutterwave to process ticket purchases. Just like the marketplace, funds are held safely in escrow and only released to the organizer 24-48 hours after the event successfully concludes.
3. **Digital Tickets & Check-in:** Generate unique QR codes for every ticket purchased, send them to attendees via beautifully designed confirmation emails (using Brevo), and provide organizers with a dashboard and scanner to check people in at the door.
4. **Automated Payouts & Refunds:** Set up a scheduled Vercel Cron Job to automatically trigger Flutterwave payouts to event creators. If an event is cancelled, the system will automatically handle processing full refunds to all ticket buyers.

This document outlines the end-to-end technical blueprint for implementing this system in Yrdly, following the established marketplace escrow patterns.

## User Review Required

> [!IMPORTANT]
> **Cron Job Execution**: The cron job to release payouts requires a dedicated API route (e.g., `/api/cron/process-event-payouts`) that will be pinged by Vercel Cron. I will set up the API route and the `vercel.json` configuration for it. You will need to ensure the `CRON_SECRET` environment variable is set in your Vercel project to secure this endpoint.
>
> **QR Code Generation**: I will use a library like `qrcode` to generate data URLs for the ticket QR codes and include them in the Brevo emails and the My Tickets UI. I will add `qrcode` as a dependency.
>
> Please review the plan below and approve to begin execution.

## Proposed Changes

### 1. Database Schema (Supabase Migration)

I will create a new Supabase migration file (e.g., `[timestamp]_create_events_schema.sql`) to define the following tables with strict Row Level Security (RLS) policies:

#### [NEW] `events`
Stores core event details.
- **Columns**: `id`, `creator_id` (refs `users`), `title`, `description`, `cover_image_url`, `location`, `ward`, `lga`, `state`, `start_datetime`, `end_datetime`, `status` (draft/pending_review/published/cancelled/completed), `is_free`, `total_capacity`, `promoted` (default false), `created_at`, `updated_at`.
- **RLS**: Public read for published events. Only creators can update their events.

#### [NEW] `event_ticket_tiers`
Stores pricing and capacity for different ticket types.
- **Columns**: `id`, `event_id`, `name` (e.g., Regular, VIP), `price` (in kobo), `quantity_available`, `quantity_sold`, `description`, `created_at`.
- **RLS**: Public read. Creators can insert/update for their events.

#### [NEW] `event_tickets`
Represents an individual purchased ticket.
- **Columns**: `id`, `tier_id`, `event_id`, `buyer_id`, `ticket_code` (unique, human-readable), `qr_data`, `status` (active/used/refunded/cancelled), `purchased_at`.
- **RLS**: Buyers can view their own tickets. Creators can view and update (check-in) tickets for their events.

#### [NEW] `event_transactions`
Handles the escrow flow mirroring `escrow_transactions`.
- **Columns**: `id`, `event_id`, `ticket_id`, `buyer_id`, `creator_id`, `amount_kobo`, `commission_kobo`, `flutterwave_tx_ref`, `flutterwave_tx_id`, `status` (pending/escrow_held/completed/refunded), `payout_released_at`, `created_at`.
- **RLS**: Buyers can view their transactions. Creators can view their earnings.

*Note: Types for these tables will be added to `src/types/index.ts` or a new `src/types/events.ts`.*

---

### 2. Services & Constants

#### [MODIFY] `src/lib/constants.ts`
- Add `EVENT_CONSTANTS` containing the 2% commission rate (`COMMISSION_RATE: 0.02`) and auto-release hours (`AUTO_RELEASE_HOURS: 24`).

#### [NEW] `src/lib/event-service.ts`
- Encapsulate DB logic for creating events, fetching events by radius, fetching ticket tiers, generating QR codes, and managing attendee lists.

#### [NEW] `src/lib/event-escrow-service.ts`
- Mirror `escrow-service.ts` to handle event transactions, including creating transactions, updating statuses, and processing event payouts via `PayoutService` and `FlutterwaveService`.

#### [MODIFY] `src/lib/brevo-service.ts`
- Ensure the `ticketConfirmation` template logic correctly triggers after a successful verify, passing the generated QR code.

---

### 3. API Routes (Payment & Escrow)

All routes will implement rigorous server-side Supabase authentication checks.

#### [NEW] `src/app/api/events/create/route.ts`
- Validates auth. Creates `events` and `event_ticket_tiers` records.
- Sets status to `pending_review`.

#### [NEW] `src/app/api/events/tickets/purchase/route.ts`
- Validates auth. Ensures tickets are available.
- Creates an `event_transactions` record (status: `pending`).
- Initializes Flutterwave payment with a split payload linking to the creator's subaccount. Returns payment link.

#### [NEW] `src/app/api/events/tickets/verify/route.ts`
- Verifies FLW transaction.
- Creates `event_tickets` record (generates unique `ticket_code` and QR data URL).
- Updates transaction status to `escrow_held`.
- Fires Brevo email with the `ticketConfirmation` template.

#### [NEW] `src/app/api/events/tickets/refund/route.ts`
- Handles individual ticket refunds initiated by the creator.

#### [NEW] `src/app/api/events/[id]/cancel/route.ts`
- Marks event as `cancelled`. Triggers bulk refunds for all associated `escrow_held` transactions.

#### [NEW] `src/app/api/events/[id]/attendees/route.ts`
- Returns secure list of attendees (only for event creator).

#### [NEW] `src/app/api/events/checkin/route.ts`
- Validates a `ticket_code` or `qr_data` payload. Marks ticket as `used`.

#### [NEW] `src/app/api/cron/process-event-payouts/route.ts`
- Secured via standard Vercel Cron headers.
- Finds `event_transactions` in `escrow_held` where `events.end_datetime` < 24 hrs ago.
- Iterates through transactions and triggers payout processing, marking them `completed`.

---

### 4. Pages & UI Components

#### [NEW] `src/app/(app)/events/page.tsx`
- Discover events page. Integrates with the user's location to show nearby events. Filters for free/paid.

#### [NEW] `src/app/(app)/events/create/page.tsx`
- Multi-step wizard:
  1. Basic details (Title, Description, Location, Image).
  2. Ticket Tiers (Dynamic form to add Regular, VIP, etc.).
  3. Review & Submit.

#### [NEW] `src/app/(app)/events/[id]/page.tsx`
- Public detail page. Displays event info, location map, and a ticket purchase module.
- "Manage Event" button visible only to the creator.

#### [NEW] `src/app/(app)/events/[id]/manage/page.tsx`
- Organizer Dashboard.
- Shows total revenue, tickets sold by tier, and attendee list.
- Check-in tool: Camera scanner (using `html5-qrcode` or similar) and manual code input.

#### [NEW] `src/app/(app)/my-tickets/page.tsx`
- Lists the user's purchased tickets.
- Click to view the full digital ticket with QR code for scanning at the door.

## Verification Plan

### Automated/Backend Verification
- Test all API routes using Postman or local scripts to ensure RLS and Auth checks block unauthorized access.
- Simulate the Flutterwave webhook/redirect flow to verify ticket creation and escrow state updates.
- Test the Vercel cron route manually via API call with a mocked auth header to verify payout processing logic.

### Manual Verification
- Walk through the event creation flow as a user.
- Purchase a ticket as a different user.
- Verify the receipt of the Brevo email with the QR code.
- View the ticket in `/my-tickets`.
- Access the organizer dashboard as the creator and manually check-in the purchased ticket.
