# Implementation Plan & Architectural Strategy: Creation & Edit Flow Parity Migration (Mobile -> Web)

## Overview & Architectural Goals
This plan details the full migration of **Post**, **Listing (For Sale / Giveaway)**, and **Event** creation and edit flows in `yrdly-app` (web) from modal/dialog patterns to full-page routes. 
`yrdly-mobile` is the strict design and behavioral source of truth. All new and updated web pages will enforce full responsiveness across Mobile Web (< 768px), Tablet (768px - 1024px), and Desktop (> 1024px) viewports.

---

## 1. Decision Inventory & Route Mapping

| Content Type | Action | Web Route | Source of Truth File (`yrdly-mobile`) | Replaces Old Web Component/Route |
| :--- | :--- | :--- | :--- | :--- |
| **Event** | Create | `/events/create` | `src/app/create-event.tsx` | `CreateEventDialog.tsx` & `NewEventForm.tsx` |
| **Event** | Manage/View | `/events/[id]/manage` | `src/app/events/[id]/manage.tsx` | `CreateEventDialog.tsx` (edit mode) |
| **Listing** | Create | `/marketplace/create` | `src/app/create-for-sale.tsx` | `CreateItemDialog.tsx` |
| **Listing** | Edit | `/marketplace/edit/[itemId]` | `src/app/marketplace/edit/[id].tsx` | Existing `src/app/(app)/marketplace/edit/[itemId]/page.tsx` |
| **Post** | Create | `/posts/create` | `src/app/create-post.tsx` | `CreatePostDialog.tsx` |
| **Post** | Edit | *REMOVED* | *N/A (Mobile has no post edit)* | `CreatePostDialog.tsx` (edit mode) |

### Component Retirement & Deletion Strategy
The old dialog components and duplicate forms will be retired and deleted once the full-page routes and wiring updates are complete:
- **`src/components/CreatePostDialog.tsx`** → DELETE
- **`src/components/CreateItemDialog.tsx`** → DELETE
- **`src/components/CreateEventDialog.tsx`** → DELETE
- **`src/components/events/NewEventForm.tsx`** → DELETE
- **`src/components/CreateMenuOverlay.tsx`** → KEEP, but update `onPost`, `onListing`, and `onEvent` handlers to execute `router.push(...)` instead of opening dialog states.

---

## 2. Detailed Page Specifications & Responsive Layout Strategy

### A. Event Creation (`/events/create`)
- **Route File**: `src/app/(app)/events/create/page.tsx`
- **Steps**:
  1. **Basic Info**: Title, dynamic category (via `useCategories` hook or `/api/categories`), description textarea.
  2. **Date & Time**: Start date/time, end date/time (with validation: end > start).
  3. **Location**: Venue vs. Online toggle.
     - *Online*: Link input (`online_link`).
     - *Venue*: Google Places address lookup resolving `address`, `lat`, `lng`, `ward`, `lga`, `state`.
  4. **Tickets**: Dynamic tier array (Name, Free/Paid toggle, Price ₦, Capacity limit).
     - **Payout Gate**: Before enabling paid tiers or completing step 3, fetch `GET /api/seller/setup-account` and check `!!res?.account` (matching `src/app/create-event.tsx` in `yrdly-mobile` exactly). If `false` and a paid ticket tier is present, show inline warning banner + "Link Bank Account" button redirecting to `/profile/payout-settings` (or `/settings/payouts`).
  5. **Photos**: Multi-image file picker with cover selection badge and image removal.
  6. **Review & Publish**: Full summary preview card + visibility toggle (`public` vs `friends`). Submits to `/api/events/create`.
- **Success States**:
  - **Published**: Green check badge, "Event Published!", redirect to `/events/[id]`.
  - **Sent for Moderation**: Orange clock badge, "Sent for Moderation", message explaining admin review.
- **Responsive Layout Strategy**:
  - **Mobile (< 768px)**: Single column wizard with step dots at top and fixed bottom navigation bar (Back / Next / Publish).
  - **Tablet & Desktop (≥ 768px)**: 2-column layout. Left column (w-3/5) contains step form card; Right column (w-2/5) contains sticky Live Event Card Preview updating in real-time.

---

### B. Event Management Dashboard (`/events/[id]/manage`)
- **Route File**: `src/app/(app)/events/[id]/manage/page.tsx`
- **Features** (Ported from `src/app/events/[id]/manage.tsx`):
  - Organizer-only access check (`organizer_id === user.id`).
  - Read-only Event Summary Banner (Banner image, Title, Date, Venue/Link).
  - **KPI Metrics Cards**: Total Tickets Sold, Revenue (₦), Scanned Tickets count.
  - **Ticket Buyer Roster**: Searchable list of issued tickets showing Buyer Name, Tier Name, Amount Paid, Purchase Date, and Scan Status ("Scanned" vs "Not scanned").
  - **Ticket Scanner Trigger**: Button to launch ticket scanner (`/events/[id]/scan`).
- **Responsive Layout Strategy**:
  - **Mobile**: Stacked 1-column layout. Metric cards in a 2x2 grid.
  - **Desktop**: 3-column top metric row + full-width data table for ticket roster.

---

### C. Listing / For Sale Creation (`/marketplace/create`)
- **Route File**: `src/app/(app)/marketplace/create/page.tsx`
- **Steps**:
  1. **Type & Photos**: For Sale vs Giveaway toggle. Multi-image file uploader (up to 10 photos) with cover image badge.
  2. **Details**: Title, Price ₦ (disabled and set to 0 if Giveaway), Condition selector (`New`, `Like New`, `Good`, `Fair`, `Poor`), Sub-category chip selector (Electronics, Fashion, Vehicles, etc. from `MARKETPLACE_CATEGORIES`).
     - **Database Field Mapping**: The form writes TWO separate fields to the `posts` table, matching `src/app/create-for-sale.tsx` in `yrdly-mobile` exactly:
       - `category`: Set to `"Giveaway"` (if Giveaway toggle active) or `"For Sale"` (if For Sale active).
       - `sub_category`: Set to the selected category chip (e.g. `"Electronics"`, `"Fashion"`). These MUST NOT be merged into a single field.
  3. **Description & Location**: Detailed description, Google Places venue search resolving address, lat/lng, LGA, Ward, State.
  4. **Review & Publish**: Listing preview card + Visibility toggle (`public` vs `friends`).
- **Success States**: Distinct Published vs Moderation Pending screens.
- **Responsive Layout Strategy**:
  - **Mobile**: Step-by-step wizard.
  - **Desktop**: Side-by-side split screen (Form controls on left, sticky Marketplace Card preview on right).

---

### D. Listing Editing (`/marketplace/edit/[itemId]`)
- **Route File**: `src/app/(app)/marketplace/edit/[itemId]/page.tsx`
- **Features** (Ported from `src/app/marketplace/edit/[id].tsx`):
  - Owner-only authorization check.
  - Photos management (existing images from Supabase storage + new image uploads, cover image selection, image deletion).
  - Field updates: Title, Price ₦, Category (`category` + `sub_category`), Condition, Description, Location search.
  - **Delete Listing Action**: Destructive button opening a confirmation AlertDialog calling listing deletion API.
- **Responsive Layout Strategy**:
  - **Mobile & Desktop**: Max-width container (`max-w-3xl mx-auto`) with sectioned card containers and sticky header save bar.

---

### E. Post Creation (`/posts/create`)
- **Route File**: `src/app/(app)/posts/create/page.tsx`
- **Features** (Ported from `src/app/create-post.tsx`):
  - User avatar header + text composer textarea.
  - Category locked strictly to `"General"` (Category selection dropdown removed from composer).
  - Media Attachments: Image picker (up to 10 photos) **AND Video picker** (up to 3 videos, max 40MB each) with upload progress indicator.
  - Visibility toggle (`public` vs `friends`).
  - Submits to `createPost` handler in `usePosts`.
- **Success States**: Distinct Published vs Moderation Pending screens.
- **Responsive Layout Strategy**:
  - **Mobile**: Full-screen modal-like page container.
  - **Desktop**: Centered card overlay style (`max-w-2xl mx-auto mt-6`) with rich media grid preview.

---

## 3. Wiring & Invocation Refactoring Mapping

| File Path | Lines to Modify | Change Description |
| :--- | :--- | :--- |
| `src/components/CreateMenuOverlay.tsx` | L123-142 | Update `onPost`, `onListing`, `onEvent` handlers to invoke `router.push('/posts/create')`, `router.push('/marketplace/create')`, and `router.push('/events/create')`. |
| `src/components/layout/MainLayout.tsx` | L53-56, L347-369 | Remove `postDialogOpen`, `listingDialogOpen`, `eventDialogOpen` state variables and remove `<CreatePostDialog>`, `<CreateItemDialog>`, `<CreateEventDialog>` JSX renders. |
| `src/components/PostCard.tsx` | L53-54, L688-698 | Remove `CreateEventDialog` and `CreatePostDialog` imports & JSX renders. Update edit action: for listings navigate to `/marketplace/edit/${id}`; for events navigate to `/events/${id}/manage`. Remove post edit trigger. |
| `src/components/PostDetailView.tsx` | L36-37, L390-414 | Remove `CreateEventDialog` and `CreatePostDialog` imports & renders. Update event manage link to `/events/${id}/manage`. |
| `src/components/EventsScreen.tsx` | L32, L128, L622 | Update "Create Event" button to navigate to `/events/create`. Remove `CreateEventDialog` import & render. |
| `src/components/HomeScreen.tsx` | L8-10, L212-260 | Remove `CreatePostDialog`, `CreateItemDialog`, `CreateEventDialog` imports & renders. Update FAB create actions to navigate to `/posts/create`, `/marketplace/create`, `/events/create`. |
| `src/components/EmptyFeed.tsx` | L3, L49-60 | Update "Create Post" button to navigate to `/posts/create`. Remove `CreatePostDialog` render. |
| `src/components/marketplace/MarketplaceCreatorOnboarding.tsx` | L86 | Update `onContinue` to route to `/marketplace/create`. |
| `src/components/MarketplaceScreen.tsx` | L5, L256-263 | Update "Create Listing" button to navigate to `/marketplace/create`. Remove `CreateItemDialog` render. |

---

## 4. Technical Ambiguities & Open Questions

1. **Location Resolution & Google Places**:
   - *Question*: `LocationInput.tsx` currently wraps react-hook-form. For full parity with mobile's location resolution (`address`, `lat`, `lng`, `ward`, `lga`, `state`), should we enhance `LocationInput` to pass structured address components, or extract a lightweight `useGooglePlaces` hook?
   - *Resolution*: Enhance `LocationInput` with an `onLocationSelect` callback returning `{ address, lat, lng, ward, lga, state }` so it can be cleanly reused across Event, Listing, and Edit pages without duplicate API calls.

2. **Payout Account Verification**:
   - *Question*: How should web verify if a user has a linked payout account before allowing paid ticket tiers?
   - *Resolution*: Call `GET /api/seller/setup-account` and check `!!res?.account` (matching `src/app/create-event.tsx` in `yrdly-mobile` exactly). If `false` and a paid ticket tier is present, show inline warning banner + "Link Bank Account" button redirecting to `/profile/payout-settings` (or `/settings/payouts`).

3. **Video Upload Storage & Bucket Name**:
   - *Question*: What is the exact Supabase Storage bucket name used for post videos?
   - *Resolution*: **CONFIRMED: `'post-videos'`**. Verified in `yrdly-mobile`'s `StorageService.uploadPostVideo` (`src/lib/storage-service.ts` line 296) and `yrdly-app`'s `use-posts.tsx` line 604 (`supabase.storage.from('post-videos')`). Web video uploads will upload directly to bucket `'post-videos'` under path `${userId}/${Date.now()}.${ext}`.

---

## 5. Phased Execution Plan (Single-Action Rule Compliant: Max 2 File Edits Per Step)

### Phase 1: Shared Helper & Location Enhancements
- **Step 1.1**: Update `src/components/LocationInput.tsx` to support structured location callbacks (`lat`, `lng`, `ward`, `lga`, `state`).

### Phase 2: Post Creation Route (`/posts/create`)
- **Step 2.1**: Create `src/app/(app)/posts/create/page.tsx` (Port `create-post.tsx` with text, image, video upload to `'post-videos'`, visibility, and 2 success states).

### Phase 3: Listing Creation & Edit Routes
- **Step 3.1**: Create `src/app/(app)/marketplace/create/page.tsx` (Port `create-for-sale.tsx` with multi-step wizard, Giveaway toggle, writing `category` + `sub_category`, location, condition).
- **Step 3.2**: Refactor `src/app/(app)/marketplace/edit/[itemId]/page.tsx` (Port `src/app/marketplace/edit/[id].tsx` with photo management and delete confirmation).

### Phase 4: Event Creation & Management Routes
- **Step 4.1**: Rebuild `src/app/(app)/events/create/page.tsx` (Port `create-event.tsx` with 6 steps, payout gate via `GET /api/seller/setup-account`, dynamic tiers, 2 success states).
- **Step 4.2**: Create `src/app/(app)/events/[id]/manage/page.tsx` (Port `manage.tsx` with event metrics, ticket buyer roster, and scanner link).

### Phase 5: Navigation & Component Wiring Updates
- **Step 5.1**: Modify `src/components/CreateMenuOverlay.tsx` to route `onPost`, `onListing`, `onEvent` to new full-page routes.
- **Step 5.2**: Modify `src/components/layout/MainLayout.tsx` to remove old dialog states and dialog renders.
- **Step 5.3**: Modify `src/components/HomeScreen.tsx` and `src/components/EmptyFeed.tsx` to navigate to new creation routes.
- **Step 5.4**: Modify `src/components/EventsScreen.tsx` and `src/components/MarketplaceScreen.tsx` to navigate to new creation/manage routes.
- **Step 5.5**: Modify `src/components/PostCard.tsx` and `src/components/PostDetailView.tsx` to remove dialog triggers and update manage/edit links.
- **Step 5.6**: Modify `src/components/marketplace/MarketplaceCreatorOnboarding.tsx` to route to `/marketplace/create`.

### Phase 6: Legacy Component Cleanup & Verification
- **Step 6.1**: Delete obsolete dialog components: `src/components/CreatePostDialog.tsx` & `src/components/CreateItemDialog.tsx`.
- **Step 6.2**: Delete obsolete event components: `src/components/CreateEventDialog.tsx` & `src/components/events/NewEventForm.tsx`.
- **Step 6.3**: Run `npm run build` to verify clean TypeScript compilation without broken imports.
