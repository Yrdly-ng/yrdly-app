# PROJECT HANDOFF & CONTEXT EXPORT: SERVICE PROVIDER BOOKING (PHASES 1–4 Complete)

> **Destination Tool**: Cline (with DeepSeek-v4-Pro)  
> **Projects**: `yrdly-mobile` & `yrdly-app`  
> **Database Project ID**: `yoiyqxtpmxnrrbqqidcs` (Supabase Postgres)  
> **Phase 4 Status**: 4A Multi-Staff ✅ 4B Payments ✅ 4C Quotes→Checkout ✅ 4D Appeals ✅ — Verified 2026-09-30  

---

## 1. Feature Architecture Overview

The **Service Provider Booking System** enables service businesses (e.g. barbers, beauty, consultants) on Yrdly to create service offerings, configure working schedules & blackout dates, accept booking requests, track attendance strikes, and receive reviews tied strictly to completed bookings.

### Core Architecture Principles
1. **Source of Truth**: `yrdly-mobile` is the UX and domain model source of truth. `yrdly-app` provides 1:1 web parity with responsive desktop/tablet layouts.
2. **Booking Flow**:
   - `createBooking()` creates a request in state `'requested'` (no auto-accept; requires provider manual confirmation).
   - Provider confirms request -> `'confirmed'`.
   - Provider completes appointment -> `'completed'`.
3. **Cancellation Cutoff Rule**:
   - `CANCELLATION_WINDOW_HOURS = 5`
   - Cancellations within 5 hours of `appointment_time` are marked `'late_cancelled'` and issue a strike against the cancelling party.
4. **Strike & Flag Enforcement (Friction Model)**:
   - `NO_SHOW_FLAG_THRESHOLD = 3`
   - When a customer or provider reaches 3 active strikes, `is_flagged = true`.
   - Flagged customers trigger an explicit warning banner on incoming requests for providers.
   - Flagged providers display a warning notice to customers during booking and are deprioritized in search results via `.order('is_flagged', { ascending: true })`.
   - **No hard blocks or account suspensions exist**.
5. **Trailing 90-Day Auto-Clear Logic**:
   - `evaluateActiveFlagStatus()` counts active strikes in trailing 90 days:
     - `late_cancelled`: evaluated via `cancelled_at >= 90 days ago`
     - `no_show`: evaluated via `appointment_time >= 90 days ago`
   - If active strikes drop below 3, `is_flagged` automatically resets to `false`.
6. **Review Gating**:
   - Reviews can ONLY be submitted against a `bookings` record with `status === 'completed'`.
   - `business_reviews` has a database-level `UNIQUE(booking_id)` constraint preventing concurrent or duplicate review submissions per booking.

---

## 2. Database Schema (Supabase Live Project `yoiyqxtpmxnrrbqqidcs`)

### Enums
- `business_mode`: `'product' | 'service' | 'both'`
- `booking_status`: `'requested' | 'confirmed' | 'completed' | 'cancelled' | 'late_cancelled' | 'no_show'`
- `strike_type_enum`: `'late_cancellation' | 'no_show'`
- `strike_party_enum`: `'customer' | 'provider'`

### Tables & Key Columns
- **`businesses`**:
  - `mode`: `business_mode` (default `'product'`)
  - `no_show_count`: `integer`
  - `late_cancellation_count`: `integer`
  - `is_flagged`: `boolean`
- **`users`**:
  - `no_show_count`: `integer`
  - `late_cancellation_count`: `integer`
  - `is_flagged`: `boolean`
- **`service_offerings`**:
  - `id` (UUID, PK), `business_id` (FK), `name`, `description`, `duration_minutes` (int), `price` (numeric), `price_is_from` (bool), `category`, `is_active` (bool).
- **`provider_availability`**:
  - `id` (UUID), `business_id` (FK), `day_of_week` (0-6), `start_time` (time), `end_time` (time), `is_available` (bool).
- **`availability_exceptions`**:
  - `id` (UUID), `business_id` (FK), `date` (date), `is_blackout` (bool), `custom_start_time`, `custom_end_time`, `reason`.
- **`bookings`**:
  - `id` (UUID), `customer_id` (FK -> users), `business_id` (FK -> businesses), `service_id` (FK -> service_offerings), `appointment_time` (timestamptz), `end_time` (timestamptz), `status` (`booking_status`), `notes`, `cancelled_by` (UUID), `cancelled_at` (timestamptz), `strike_type` (`strike_type_enum`), `strike_party` (`strike_party_enum`), `reminder_24h_sent` (bool), `reminder_2h_sent` (bool).
- **`business_reviews`**:
  - Added `booking_id` (UUID FK -> bookings) with `UNIQUE(booking_id)` constraint.

### Applied Migration Files
- `yrdly-mobile/supabase/migrations/20260923000000_service_provider_booking.sql`
- `yrdly-mobile/supabase/migrations/20260923000001_add_booking_id_unique_review.sql`
- `yrdly-app/supabase/migrations/20260923000002_phase4a_multi_staff.sql` — `business_staff`, `service_staff_assignments`, `staff_id` on provider_availability/availability_exceptions/bookings + partial UNIQUE legacy `WHERE staff_id IS NULL` + staff `WHERE staff_id IS NOT NULL` (8 indexes verified)
- `yrdly-app/supabase/migrations/20260923000003_phase4b_payments.sql` — `payment_status_enum`/`payment_type_enum`, `service_offerings` deposit/escrow columns, `bookings.payment_status`, `booking_payments` (payluk_reference UNIQUE, escrow_hold)
- `yrdly-app/supabase/migrations/20260923000004_phase4c_quotes.sql` — `quote_requests`/`quote_messages`, `bookings.quote_id`, `quote_status` enum + RLS + `updated_at` trigger
- `yrdly-app/supabase/migrations/20260923000005_phase4d_appeals.sql` — `strike_appeals`, `users.is_admin/role` idempotent + RLS policies
- Fixes applied live via `supabase__apply_migration`: `fix_uq_provider_availability_partial` + `fix_uq_legacy_drop_v2` (drops legacy non-partial `uq_business_day`/`uq_business_date` constraints that blocked per-staff design — see 2026-09-30 incident: `2BP01` constraint-drops, not index-drops)

---

## 3. Full File Index & Key Functions

### `yrdly-app` (Web Parity - Next.js 15)
- `src/lib/booking-service.ts`:
  - `NO_SHOW_FLAG_THRESHOLD = 3`, `CANCELLATION_WINDOW_HOURS = 5`
  - `getAvailableSlots(businessId, serviceId, dateString, staffId?)`: slot computation in 30-min steps per-staff aware; `getProviderAvailability(businessId, staffId?)` / `setProviderAvailability(..., staffId?)` use partial-index conflict keys.
  - `createBooking()`, `confirmBooking()`, `declineBooking()`, `cancelBooking()`, `markBookingNoShow()`, `completeBooking()` — now carry `staffId`/`quoteId`, payment guards pending.
  - `evaluateActiveFlagStatus(targetId, party)`: airtight per-status 90-day timestamp strike auto-clear.
  - `canReviewBooking(bookingId, userId)`: checks status === 'completed' and single review per booking.
- `src/lib/staff-service.ts` [NEW 4A]: `listStaff`, `createStaff`, `updateStaff`, `deactivateStaff`, `setServiceStaff`/`getServiceStaff` via `service_staff_assignments`.
- `src/lib/booking-payments.ts` [NEW 4B]: `computeDepositAmount`, `createCheckoutForBooking` (Payluk `/v1/payment/intent`, `bk_{bookingId}_{type}_{ts}` reference, `booking_payments` + `payluk_checkout_url`), `handlePaylukWebhookEvent` (idempotent `deposit_paid|fully_paid|escrow_held`), `verifyHmac` (hex+base64).
- `src/lib/quote-service.ts` [NEW 4C]: `createQuoteRequest`, `listCustomerQuotes`/`listBusinessQuotes`, `submitEstimate`, `convertQuoteToBooking` (spawns booking linked via `quote_id`), `listMessages`/`sendMessage`.
- `src/lib/appeal-service.ts` [NEW 4D]: `createAppeal`, `listMyAppeals`/`listAllAppeals`, `reviewAppeal` (approve decrements counts + `evaluateActiveFlagStatus`), `listFlaggedUsers`/`listFlaggedBusinesses`.
- `src/lib/admin-guard.ts` [NEW 4D]: `requireAdmin` checks `is_admin`/`role` or `app_metadata.role=admin`.
- `src/lib/notification-triggers.ts`:
  - `onBookingRequested()`, `onBookingConfirmed()`, `onBookingCancelled()`, `onBookingNoShow()`.
- `src/lib/review-service.ts`:
  - `canUserReviewBooking()`, `submitBookingReview()`.
- `src/hooks/use-bookings.ts`: React hooks for offerings, availability (per-staff), slots (per-staff), and bookings.
- `src/components/SearchDialog.tsx`: Search query with `.order('is_flagged', { ascending: true })`.
- `src/app/(app)/businesses/[businessId]/manage-services/page.tsx`: Service offerings CRUD UI.
- `src/app/(app)/businesses/[businessId]/manage-availability/page.tsx`: Weekly schedule & blackout editor UI — now per-staff tabs.
- `src/app/(app)/bookings/create/page.tsx`: Booking request creation UI with slot grid + staff selector + provider flag warning notice.
- `src/app/(app)/bookings/page.tsx`: Bookings Dashboard (Upcoming / History tabs).
- `src/app/(app)/bookings/[bookingId]/page.tsx`: Booking details page with flag banners, action buttons, and completed review CTA.
- `src/app/api/bookings/checkout/route.ts` [NEW 4B/C]: `POST` with Bearer — resolves `bookingId` or `quoteId` (converts quote→booking if needed), computes amount from `service_offerings`, creates `booking_payments` via `createCheckoutForBooking`.
- `src/app/api/payluk/webhook/route.ts` [NEW 4B]: `POST` HMAC-verified (`x-payluk-signature`, hex+base64), idempotent `handlePaylukWebhookEvent`, returns `200 {received:true}`.
- `src/app/(app)/admin/appeals/page.tsx` [NEW 4D]: Admin appeals queue (approve/reject) gated via `AppealService`.

### `yrdly-mobile` (Mobile - React Native / Expo)
- `src/lib/booking-service.ts`: Parity mobile booking service layer.
- `src/hooks/use-bookings.ts`: Parity mobile hooks.
- `src/screens/ManageServicesScreen.tsx`: Mobile service offerings manager.
- `src/screens/ManageScheduleScreen.tsx`: Mobile schedule & blackout editor.
- `src/screens/CreateBookingScreen.tsx`: Mobile booking request creation screen.
- `src/screens/BookingsListScreen.tsx`: Mobile bookings dashboard.
- `src/screens/BookingDetailScreen.tsx`: Mobile booking details screen.
- `supabase/functions/check-booking-reminders/index.ts`: Edge Function checking and dispatching 24h & 2h push notification reminders.

---

## 4. Current Build & Test Status

- **Type Check (`npx tsc --noEmit`)**: EXIT:0 (2026-09-30 re-verified; 0 errors).
- **Next.js Production Build (`pnpm run build`)**: `pnpm run build` compiled 100% successfully (all routes static/dynamic compiled cleanly).
- **JSX Escaping**: Verified and fixed `react/no-unescaped-entities` in `bookings/[bookingId]/page.tsx` and `manage-services/page.tsx`.
- **Phase 4 Smoke (2026-09-30 live `yoiyqxtpmxnrrbqqidcs`, service-role)**:
  - Checkout: `booking_payments` `bk_{id}_deposit_{ts}` inserted `deposit_pending` ok; Payluk `/v1/payment/intent` returned 404 (no live customer — expected; `payluk_checkout_url` remains null, `payluk_reference` created for webhook flow). Booking `df8c6907-28a7-47b8-aa17-956532e9c733` (Vellora Studios, 1000 NGN deposit).
  - Webhook: HMAC hex+base64 both `verifyHmac=true`; `handlePaylukWebhookEvent {payluk_reference: 'bk_*', status:'paid'}` → `deposit_paid` on `booking_payments`+`bookings`; 2nd call idempotent `skip:deposit_paid` — `paid_at` unchanged.
  - Escrow: `escrow_hold=true` branch → `escrow_held` correctly.
  - Quote→Checkout: `quote_requests f467775a-...` `pending` → booking `0a367446-...` `converted` with `quote_id` FK; checkout + `paid` webhook ok.
  - DB indexes: 8/8 verified (`uq_provider_availability_business_day_legacy WHERE staff_id IS NULL`, `uq_provider_availability_business_staff_day WHERE staff_id IS NOT NULL`, etc.); legacy `uq_business_day/date` constraints dropped via `fix_uq_legacy_drop_v2`.
  - API `POST /api/bookings/checkout` + `POST /api/payluk/webhook` both present: Bearer auth via `getAuthenticatedUser`, quoteId conversion (4C), HMAC verification with fallback headers.

---

## 5. Summary of What Is OUT OF SCOPE (Do NOT Build)
- Hard account suspensions or automatic transaction blocking — friction model only (appeals just revert counts/flags, booking status preserved).
- Post-Phase-4: Phase1-3 scaffold sync to `yrdly/` (yrdly/lib still minimal — tracked in `yrdly/working.md`), EAS builds.

## 6. Phase 4 Completion Log (2026-09-30)
| Track | Scope | Status | Evidence |
|---|---|---|---|
| 4A Multi-Staff | `business_staff`, `service_staff_assignments`, per-staff availability/slots/bookings | ✅ Verified | Partial indexes 8/8, `staff-service.ts`, `booking-service` staffId args |
| 4B Payments | `booking_payments`, Payluk deposit/full/escrow checkout + webhook | ✅ Verified | `booking-payments.ts`, checkout route + webhook route, HMAC hex/base64 + idempotency smoke |
| 4C Quotes | `quote_requests`/`quote_messages`, quote→booking conversion → checkout | ✅ Verified | `quote-service.ts`, checkout `quoteId` branch, quote `f467775a` → booking `0a367446` live |
| 4D Appeals | `strike_appeals`, admin approve/reject + flag re-evaluation | ✅ Verified | `appeal-service.ts` + `admin-guard.ts` + `admin/appeals/page.tsx`, 90-day auto-clear preserved |
| Fix | Legacy `uq_business_day/date` blocker | ✅ Resolved | `fix_uq_legacy_drop_v2` `ALTER TABLE DROP CONSTRAINT` success — `2BP01` root cause documented |
