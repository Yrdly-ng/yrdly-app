# Web App Desktop Layout Redesign Plan (P1 - P4)

## Revision 1

---

## Task A: Empirical Verification & Codebase Audit

### 1. Git State & Clean Tree Verification
- `git branch -a` output:
  ```
    feat/responsiveness-pass
    feature/cloudflare-integration
  * main
    paystack-integration
    remotes/origin/HEAD -> origin/main
    remotes/origin/daniel-update
    remotes/origin/escrow-release-reconciliation
    remotes/origin/feat/responsiveness-pass
    remotes/origin/fix-payluk-release-flow
    remotes/origin/fix-withdraw-authorization
    remotes/origin/jason-dev
    remotes/origin/main
    remotes/origin/paystack-integration
  ```
- **Finding**: No open Phase 5 or create-flow branches found. Working tree is clean on `main`.

### 2. BottomNav `onCreateMenu` & FAB Check
- **Full File**: `/Users/macbook/Development/projects/yrdly-app/src/components/layout/BottomNav.tsx`
- **FAB Implementation** (Lines 61–69):
  ```tsx
  {onCreateMenu && (
    <button
      onClick={onCreateMenu}
      aria-label="Create"
      className="relative -translate-y-3 flex items-center justify-center w-12 h-12 rounded-full bg-[#82DB7E] text-black font-extrabold shadow-lg shadow-black/20 transition-transform duration-150 active:scale-90"
    >
      <Plus size={26} weight="bold" />
    </button>
  )}
  ```
- **Finding**: `onCreateMenu` is called when the center FAB Plus button is clicked. In `MainLayout.tsx` (Line 350), passing `() => setCreateMenuOpen(false)` is **inverted**. It will be fixed in a standalone commit.

### 3. Topbar Triggers & Controls Check
- **`onSearch` & `onCreate`**: Declared as props in `TopbarProps`, but **NOT** rendered or destructured anywhere in `Topbar.tsx` JSX.
- **Location Pill**: Rendered via `<LocationChip />` (Line 62), wired to `LocationContext` to display active LGA/State filter and trigger location modal.
- **Map Pin Button**: Wrapped in `<Link href="/map">` (Line 99), navigating to `/map`.

### 4. Git History Audit for `handleToggleFollow`
- Command: `git log --oneline -S"handleToggleFollow" -- src/components/ProfileScreen.tsx`
- Result commit: `e193fff5` (*refactor: update top navigation and synchronize web app with mobile design*).
- **Finding**: Commit `e193fff5` removed the mobile/web action bar from `ProfileScreen.tsx` to match the new design, leaving `handleToggleFollow` and `friendship` declared in script logic but unreferenced in JSX.

### 5. `globals.css` Token Audit
- `--c-card` and `--c-border` **DO exist** in `src/app/globals.css`:
  - `:root` (Light): `--c-card: #FFFFFF;`, `--c-border: #E4E4E7;` (Lines 120, 125)
  - `.dark` (Dark): `--c-card: #121212;`, `--c-border: #27272A;` (Lines 132, 136)

### 6. Grid & Column Classes Audit Across Screen Components
- **`BusinessesScreen.tsx`**: `grid grid-cols-2 gap-3.5 mt-2` (L226, L270).
- **`EventsScreen.tsx`**: `grid grid-cols-1 sm:grid-cols-3 gap-3` (L216), `grid grid-cols-1 md:grid-cols-2 gap-4` (L226, L442).
- **`ExploreScreen.tsx`** (`src/app/(app)/explore/page.tsx`): `w-full min-h-full px-4 md:px-6 pt-4 pb-10` (L88).
- **`MessagesScreen.tsx`** (`ConversationScreen.tsx`): `w-full h-full p-0`.

### 7. `HomeScreen.tsx` Layout `lg:` Breakpoint Usage
- Line 361: `grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_500px]`
- Line 362: `lg:mx-0`
- Line 480: `hidden lg:block relative`
- (`xl:` is not used anywhere in `HomeScreen.tsx`).

---

## Task B: Implementation Plan (P1 – P4)

### 1. Goals & Non-Goals

#### Goals
- Redesign desktop (>=1024px / `lg`) layout across the web app.
- Introduce 4 width tiers in `MainLayout` (`narrow`, `default`, `wide`, `full`).
- Replace top navigation header on desktop (>=1024px) with a left sidebar shell (`Sidebar.tsx`).
- Restructure Profile page on desktop (>=1440px) with a 2-column layout and dedicated `RightRail`.
- Implement desktop (>=1024px) master-detail split view for Settings.

#### Non-Goals
- Mobile (<768px) and Tablet (768px–1023px) layouts must NOT change.
- Mobile navigation (`BottomNav`) and feature parity remain untouched.
- No changes to public/auth pages outside `src/app/(app)`.

---

### 2. Available Desktop Content Width Math

Formula: `Available Content Width = Viewport Width - Sidebar (256px) - Outer Padding (48px)`

| Viewport Width | Sidebar | Outer Padding | Available Content Width |
|---|---|---|---|
| **1024px (`lg`)** | 256px | 48px | **720px** |
| **1280px (`xl`)** | 256px | 48px | **976px** |
| **1440px (`min-[1440px]`)** | 256px | 48px | **1136px** |
| **1536px (`2xl`)** | 256px | 48px | **1232px** |

#### Viewport Behavior Matrix

| Page / Route | 1024px (`lg`) | 1280px (`xl`) | 1440px (`min-[1440px]`) | 1536px (`2xl`) |
|---|---|---|---|---|
| **Home** | 720px feed (Right col hidden) | 976px feed (Right col hidden) | 1136px feed (Right col hidden) | 1232px grid (feed ~782px + right col 400px) |
| **Profile** | 720px profile col | 976px profile col | 1136px grid (main profile ~748px + RightRail 340px) | 1232px grid (main profile ~844px + RightRail 340px) |
| **Businesses** | 720px (2-col grid) | 976px (3-col grid) | 1136px (3 or 4-col grid) | 1232px (4-col grid) |
| **Events** | 720px (2-col grid) | 976px (3-col grid) | 1136px (3-col grid) | 1232px (4-col grid) |
| **Explore** | 720px tab content | 976px tab content | 1136px tab content | 1232px tab content |
| **Messages** | 768px edge-to-edge chat | 1024px edge-to-edge chat | 1184px edge-to-edge chat | 1280px edge-to-edge chat |

---

### 3. Phase Breakdown & Scope Matrix

| Phase | Description | Files in Scope | Files NOT to Touch |
|---|---|---|---|
| **P1** | Width Tiers in `MainLayout` | `src/components/layout/MainLayout.tsx`, `src/lib/layout-utils.ts` (new) | `Topbar.tsx`, `BottomNav.tsx`, inner page screens |
| **P2** | Desktop Sidebar Shell (>=1024px) | `src/components/layout/Sidebar.tsx` (new), `src/components/layout/MainLayout.tsx`, `src/components/layout/Topbar.tsx`, `src/components/HomeScreen.tsx`, `src/components/NotificationsDropdown.tsx`, `src/components/ProfileDropdown.tsx`, `src/components/AppHeader.tsx`, `src/app/(app)/my-tickets/page.tsx`, `src/app/(app)/profile/purchases/page.tsx`, `src/app/(app)/profile/sold-items/page.tsx`, `src/app/(app)/transactions/page.tsx`, `src/app/(app)/transactions/[transactionId]/page.tsx` | Mobile components, inner page max-widths |
| **P3** | Profile Restructure + Per-Page Right Rail | `src/components/ProfileScreen.tsx`, `src/components/RightRail.tsx` (new), `src/app/(app)/profile/page.tsx`, `src/app/(app)/profile/[userId]/page.tsx` | `HomeScreen.tsx` |
| **P4** | Settings Master-Detail on Desktop | `src/app/(app)/settings/layout.tsx` (new), `src/components/SettingsScreen.tsx`, `src/lib/layout-utils.ts`, `src/components/layout/MainLayout.tsx` | `/profile/payouts` |

---

### 4. Phase 1: Width Tiers in `MainLayout`

#### Width Tier Helper (`src/lib/layout-utils.ts`)
```ts
export type WidthTier = 'narrow' | 'default' | 'wide' | 'full';

export function getPageWidthTier(pathname: string): WidthTier {
  if (
    pathname.startsWith('/settings') ||
    pathname.startsWith('/payment') ||
    pathname.startsWith('/verify-phone') ||
    pathname === '/profile/payout-settings'
  ) {
    return 'narrow'; // max-w-xl (576px)
  }

  if (
    (pathname.startsWith('/marketplace') && pathname !== '/marketplace/create') ||
    (pathname.startsWith('/profile') &&
      pathname !== '/profile/purchases' &&
      pathname !== '/profile/sold-items' &&
      pathname !== '/profile/payout-settings') ||
    pathname.startsWith('/my-listings') ||
    pathname.startsWith('/disputes')
  ) {
    return 'wide'; // max-w-5xl (1024px)
  }

  if (pathname.startsWith('/admin')) {
    return 'full'; // w-full
  }

  return 'default'; // max-w-2xl (672px)
}
```

#### P1 Visibly Changes Table Per Route

| Route | Pre-P1 Wrapper Class | Post-P1 Wrapper Class | Visible Impact |
|---|---|---|---|
| `/settings/*`, `/payment*`, `/verify-phone*`, `/profile/payout-settings` | `max-w-[680px] lg:max-w-[660px]` | `max-w-xl` (576px) | Slightly cleaner, narrower column on desktop |
| `/profile`, `/profile/[userId]`, `/profile/payouts` | `max-w-[680px] lg:max-w-[660px]` | `max-w-5xl` (1024px) | **Major Expansion**: Profile expands into wide 1024px column on desktop |
| `/marketplace`, `/marketplace/[id]`, `/my-listings`, `/disputes*` | `max-w-[680px] lg:max-w-[660px]` | `max-w-5xl` (1024px) | **Major Expansion**: Cards expand into wide 1024px layout |
| `/notifications`, `/friend-requests`, `/network*`, `/alerts`, `/bookmarks`, `/community`, `/tickets`, `/my-tickets`, `/posts/*`, `/transactions*`, `/profile/purchases`, `/profile/sold-items`, `/marketplace/create` | `max-w-[680px] lg:max-w-[660px]` | `max-w-2xl` (672px) | Standardized 672px column width |
| `/admin` | `max-w-[680px] lg:max-w-[660px]` | `w-full` | Admin dashboard expands full-width |

---

### 5. Phase 2: Desktop Sidebar Shell (>=1024px)

#### Sidebar Component (`src/components/layout/Sidebar.tsx`)
- Rendered on desktop (`hidden lg:flex fixed left-0 top-0 bottom-0 w-64 flex-col border-r border-[var(--c-border)] bg-[var(--c-card)] p-4 z-40`).
- Hidden on chat and map pages (`!isChatPage && !isMapPage`).
- Renders:
  1. Brand Logo (`YRDLY`) & Location Chip (`LocationChip`)
  2. Navigation Links (Home, Explore, Messages with unread badge, Profile, Settings)
  3. "+ Create" Action Button
  4. Bottom Action Bar: Search button, Notifications button (with unread badge), User Avatar & Profile menu trigger.

#### `HomeScreen.tsx` Right Column Shift
To prevent the main feed column from being squished below ~600px on 1024px / 1280px viewports:
- File: `/Users/macbook/Development/projects/yrdly-app/src/components/HomeScreen.tsx`
- Class replacements:
  - Line 361: `grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_400px]` (was `lg:grid-cols-[minmax(0,1fr)_500px]`)
  - Line 362: `2xl:mx-0` (was `lg:mx-0`)
  - Line 480: `hidden 2xl:block relative` (was `hidden lg:block relative`)

#### Dropdown Re-Anchoring
- **`NotificationsDropdown.tsx`**: Anchor using `lg:left-[272px] lg:right-auto lg:bottom-16 lg:top-auto` when triggered from sidebar bottom bar.
- **`ProfileDropdown.tsx`**: Anchor using `lg:left-[272px] lg:right-auto lg:bottom-16 lg:top-auto` when triggered from sidebar bottom bar.

#### Appended Sticky Offset Table

| File Path | Line | Existing Offset Class | Appended Offset Class (P2) |
|---|---|---|---|
| `MainLayout.tsx` | 266 | `pt-[64px] md:pt-[84px]` | `pt-[64px] md:pt-[84px] lg:pt-0 lg:pl-64` (applied only when not chat/map) |
| `MainLayout.tsx` | 275 | `h-[calc(100dvh-64px)] md:h-[calc(100dvh-84px)]` | `h-[calc(100dvh-64px)] md:h-[calc(100dvh-84px)] lg:h-[100dvh]` |
| `MainLayout.tsx` | 281 | `sticky top-[64px] md:top-[84px]` | `sticky top-[64px] md:top-[84px] lg:top-4` |
| `Topbar.tsx` | 46 | `h-[64px] md:h-[84px]` | Append `lg:hidden` to Topbar container |
| `AppHeader.tsx` | 22 | `sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))]` | `sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] lg:top-0` |
| `my-tickets/page.tsx` | 60, 92 | `sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))]` | `sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] lg:top-0` |
| `purchases/page.tsx` | 112, 142 | `sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))]` | `sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] lg:top-0` |
| `sold-items/page.tsx` | 118, 148 | `sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))]` | `sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] lg:top-0` |
| `transactions/page.tsx` | 133 | `sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))]` | `sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] lg:top-0` |
| `transactions/[id]/page.tsx` | 305 | `sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))]` | `sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] lg:top-0` |

---

### 6. Phase 3: Profile Restructure & Per-Page Right Rail

#### Profile Desktop Layout Restructure (`ProfileScreen.tsx`)
- Outer container: `w-full grid grid-cols-1 min-[1440px]:grid-cols-[minmax(0,1fr)_340px] gap-6`.
- Main column Quick Access: `min-[1440px]:hidden` (renders in main column when `<1440px`).
- `<RightRail />`: `hidden min-[1440px]:block` (renders in right column when `>=1440px`). Controlled via CSS so only one Quick Access is visible.

#### Dedicated Right-Rail Component (`src/components/RightRail.tsx`)
- Renders:
  1. **Quick Access Widget** (My Tickets, My Events, Store, My Listings).
  2. **Suggested Neighbors Widget**: Scoped query fetching users from `users` table: `select('id, name, username, avatar_url, bio')`, `.eq('home_lga', currentUser.home_lga)`, `.neq('id', currentUser.id)`, excluding users already followed.
  3. **Upcoming Local Events Widget**: `getPublishedEvents({ lga: userLga, limit: 5 })`.
- **Navigation Handlers**: Preserve existing followers/following navigation (`/network/[userId]?mode=followers`).
- **No "Share Profile" button**.

#### Decision for User Review: Follow / Unfollow Button
- **Context**: Commit `e193fff5` removed the action bar containing the Follow button on other users' profiles, while `handleToggleFollow` remains in `ProfileScreen.tsx` script logic.
- **Decision Option A**: Re-add a compact "Follow" / "Following" button in the Profile Identity block next to the user's handle when viewing `isOwnProfile={false}`.
- **Decision Option B**: Leave identity block as-is (matching current mobile parity).

---

### 7. Phase 4: Settings Master-Detail on Desktop

#### Desktop Master-Detail Architecture
- Create `/src/app/(app)/settings/layout.tsx`:
  - Renders master setting categories list on left (hidden below `lg`).
  - Renders `{children}` on right.
  - At `>=lg`, index route `/settings` automatically redirects to `/settings/profile`.
  - Sub-page back arrows in settings components get `lg:hidden`.
- **Scope**: Add `src/lib/layout-utils.ts` and `src/components/layout/MainLayout.tsx` to P4 scope.

#### Payout Settings Handling Strategy
- **Recommendation (Link-Out)**: Keep `/profile/payout-settings` at its existing route. Add a link item inside the Settings "Commerce" menu section pointing to `/profile/payout-settings`. On desktop, it renders cleanly in the `narrow` width tier.

---

### 8. Standalone Commit Note: BottomNav FAB Fix
- **Standalone Commit**: Fix `onCreateMenu` handler in `MainLayout.tsx` (Line 350) from `() => setCreateMenuOpen(false)` to `() => setCreateMenuOpen(true)`. Placed in a separate commit pending user approval.

---

### 9. Known Gap (Out of Scope)
- **Viewport Gap (768px – 1023px `md` to `<lg`)**: On viewports between 768px and 1023px, `BottomNav` is hidden (`md:hidden`) and `Topbar` navigation links are hidden (`hidden lg:flex`). Navigation during this range occurs via Topbar action icons or browser navigation.

---

### 10. Verification & User Manual Checklist

#### Antigravity Automated Verification
1. `npx tsc --noEmit` (Must return 0 errors).
2. Grep search verification for unexpected layout class conflicts.

#### User Manual Viewport Testing Checklist
For each completed phase, user verifies in browser across 6 target viewports:
- [ ] `375px` (Mobile)
- [ ] `768px` (Tablet / `md`)
- [ ] `1024px` (Desktop / `lg`)
- [ ] `1280px` (Wide Desktop / `xl`)
- [ ] `1440px` (Desktop Large / `min-[1440px]`)
- [ ] `1536px` (Ultra Wide / `2xl`)
