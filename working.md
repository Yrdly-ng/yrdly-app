# Phase 3 — Service Provider Booking: Hardening & Trades Support (Working Plan)

> [!WARNING]
> **PRECONDITION CHECK**: Phases 1 & 2 must be live and stable for at least one full review cycle. Confirm with **Oluwaferanmi** before proceeding with code changes. Do not assume Phase 3 is greenlit automatically.

---

## 1. Scope Breakdown & Architecture Decisions

### Item 1: Flag Enforcement Beyond Warnings (`is_flagged = true`)
- **Context**: Currently, flags only emit warnings or soft indicators.
- **Proposed Mechanism Options**:
  - **Option A (Recommended)**:
    - *Flagged Customers*: Booking requests require explicit manual provider confirmation before holding time slots/escrow.
    - *Flagged Providers*: Deprioritized in search/feed rankings via dynamic RPC sorting penalty, and displayed with a trust warning badge on their profile.
  - **Option B**:
    - *Flagged Customers*: Strictly blocked from creating new booking requests.
    - *Flagged Providers*: Temporarily suspended from accepting new bookings.
- **Action Needed**: Explicit product sign-off required on enforcement rules before implementing.

---

### Item 2: Request-and-Quote Flow for Trades (Plumbers, Electricians, Mechanics)
- **Context**: Trades require custom quotes rather than fixed-price appointments.
- **Architectural Approach Recommendation**:
  - **Option A (Separate `quote_requests` table - Recommended)**:
    - Clean separation of quote negotiation (job details, photos, candidate pricing quotes) from confirmed scheduled appointments (`bookings`).
    - Once a quote is accepted by the customer, it automatically transitions/spawns a confirmed `booking` record linked to escrow.
  - **Option B (Layering states on `bookings` table)**:
    - Add states `quote_requested`, `quote_sent`, `quote_accepted`, `quote_declined` directly to `bookings.status`.
    - Downside: Bloats `bookings` schema with nullable quote text, array of photo URLs, and temporary proposed prices.

---

### Item 3: Provider Service Area (Travel Trades)
- **Context**: Mobile service providers who travel to customers.
- **Mechanism**:
  - Reuse PostGIS spatial indexing (`location_geom` geography column on `businesses`) and `lga_wards` table.
  - Add `service_radius_km` (integer) or `service_ward_ids` (uuid[]) to provider profile / business settings.
  - Extend PostGIS RPC `search_providers_by_location` to match `st_dwithin(provider_location, customer_location, service_radius_km * 1000)`.

---

### Item 4: Multi-Staff Businesses (Salons, Clinics, Studios)
- **Context**: Allows multiple staff members under a single business entity with individual schedules.
- **Scope Confirmation Required**:
  - Option A: Single-provider model (default Phase 1/2 behavior).
  - Option B: Introduce `staff_members` table with `business_id`, `name`, `avatar_url`, and staff-level availability schedules.
- **Action Needed**: Confirm if multi-staff is explicitly in scope for Phase 3 before writing code.

---

### Item 5: Gated Reviews (`completed` bookings only)
- **Context**: Prevent unverified or cancelled reviews.
- **Implementation**:
  - Enforce Postgres RLS policy and trigger on `reviews` / `business_reviews` table requiring an existing `booking_id` where `status = 'completed'` and `customer_id = auth.uid()`.

---

## 2. Hard Stop Checkpoints

1. **Stop for Approval**: Halt immediately after presenting `working.md` until explicit user sign-off.
2. **Flag Enforcement & Multi-Staff Confirmation**: Do not write code for Items 1 and 4 until specific decisions are confirmed.
3. **Diff Review & File Batching**: Batch edits in 3-4 files per step with full diffs shown.
4. **Git Policy**: No `git commit` or `git push` without diff review and explicit approval.
5. **Build Policy**: No EAS builds under any circumstances.

---

## 3. Next Steps
Waiting for user sign-off on:
1. Precondition greenlight from Oluwaferanmi.
2. Decision on Flag Enforcement mechanism (Option A vs B).
3. Table strategy for Quote Flow (`quote_requests` table vs `bookings` state layering).
4. Confirmation on Multi-Staff scope inclusion.
