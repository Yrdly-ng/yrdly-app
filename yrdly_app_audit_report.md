# yrdly-app — Onboarding & Location Architecture Audit

> **READ-ONLY.** No files modified. Every finding cites exact file + line + pasted snippet.

---

## Section 1 — Onboarding Flow

### Step 1: Signup (`/login`)

**File:** `src/app/login/page.tsx`

**Flow on sign-up (L84–L108):**
```tsx
const { user: newUser, error: err } = await signUp(email, password, name, cleanUsername);
// …
if (newUser.email_confirmed_at) router.push('/home');
else router.push(`/onboarding/verify-email?email=${encodeURIComponent(email)}`);
```
Email + password + `name` + `username` collected. Routes to email verification unless Supabase already confirmed email (e.g. OAuth). Username uniqueness checked before `signUp` (L86–91).

**✅ Signup collects name + username and checks availability before insert.**

---

### Step 2: Email Verification (`/onboarding/verify-email`)

**File:** `src/app/onboarding/verify-email/page.tsx`

```tsx
// L49–54
const { error: err } = await supabase.auth.verifyOtp({
  email,
  token,
  type: 'signup',
});
// L60
router.push('/onboarding/verify-phone');
```

**✅ Email OTP verification uses `supabase.auth.verifyOtp` correctly.**
**⚠️ Back button at email verify step has no guard — partially-registered user can navigate backward.**

---

### Step 3: Phone Verification (`/onboarding/verify-phone`)

**File:** `src/app/onboarding/verify-phone/page.tsx`

```tsx
// L62
onClick={() => router.push(`/onboarding/verify-phone-otp?phone=${encodeURIComponent(phone)}`)}
// Skip button (L20):
onClick={() => router.push('/onboarding/profile?phoneSkipped=true')}
```

**⚠️ No Supabase call made from this screen.** Phone is passed via query string only. Whether the OTP is actually sent is deferred to `/onboarding/verify-phone-otp` — UNVERIFIED (file not read this session).

---

### Step 4: Profile + Location Setup (`/onboarding/profile`)

**File:** `src/app/onboarding/profile/page.tsx`

#### 🔴 GPS ignores real coordinates (L78–98):
```tsx
navigator.geolocation.getCurrentPosition(
  () => {
    setLocation('Victoria Island, Lagos');  // SUCCESS: hardcoded
    setSelectedLoc(true);
  },
  () => {
    setLocation('Victoria Island, Lagos');  // ERROR: same hardcoded value
  }
);
```
Both success and error callbacks are identical and hardcoded. Real coordinates from `pos.coords` are never used.

#### 🔴 Location save writes wrong schema (L135–142):
```tsx
await AuthService.updateUserProfile(user.id, {
  username: cleanHandle,
  bio: bio.trim(),
  avatar_url: avatarUrl,
  location: { city: location.trim() || 'Victoria Island', state: 'Lagos' } as any,
  onboarding_status: 'completed',
  profile_completed: true,
});
```
- `home_state`, `home_lga`, `home_ward`, `home_lat`, `home_lng`, `home_location_geom` → **never written**
- `state` hardcoded to `'Lagos'`
- Format is `{ city, state }` — not the canonical `{ state, lga, ward }` shape
- The autocomplete list is a hardcoded array (L14–42) — no Google Places, no `reverseGeocode`

#### ❌ Failed saves silently complete onboarding (L144–148):
```tsx
router.replace('/onboarding/welcome');
} catch {
  router.replace('/onboarding/welcome');  // catch = same destination, no error shown
}
```

---

### Step 5: Welcome (`/onboarding/welcome`)
**✅ Simple step-marker — no location data involved.**

---

### `OnboardingGuard`

**File:** `src/components/OnboardingGuard.tsx` (L30–38)

```tsx
switch (currentStep) {
  case 'email_verification': return '/onboarding/verify-email';
  case 'profile_setup':     return '/onboarding/profile';
  case 'welcome':           return '/onboarding/welcome';
  case 'tour':              return '/onboarding/tour';
  default:                  return '/home';
}
```
Guard enforces steps correctly. **However**, since `profile_completed: true` is written even on `catch`, a failed location save is still marked complete. User enters app with `home_*` fields null.

---

## Section 2 — Home Location Storage

| Field | Mobile | Web |
|-------|--------|-----|
| `home_state` | ✅ Written | ❌ Never |
| `home_lga` | ✅ Written | ❌ Never |
| `home_ward` | ✅ Written | ❌ Never |
| `home_lat` | ✅ Written | ❌ Never |
| `home_lng` | ✅ Written | ❌ Never |
| `home_location_geom` | ✅ POINT(lng lat) | ❌ Never |
| `location` JSON (legacy) | ⚠️ Still written (pre-fix) | ✅ Writes `{city, state}` — wrong shape |

**🔴 `LocationContext` reads exclusively from `profile.location`:**
```tsx
// src/contexts/LocationContext.tsx L39-43
const profileLocation = profile?.location as any;
const userState = profileLocation?.state || null;
const userLga = profileLocation?.lga || null;
const userWard = profileLocation?.ward || null;
```
Web-registered users always have `lga: null, ward: null`. All filtering is at state level.

---

## Section 3 — Active Location Filter

**File:** `src/contexts/LocationContext.tsx`

```tsx
// L80-87
const setGlobalFilter = useCallback((newFilter: LocationFilter | null) => {
  setActiveFilterRaw(newFilter);
  const payload: PersistedFilter = { filter: newFilter, timestamp: Date.now() };
  localStorage.setItem(GLOBAL_FILTER_STORAGE_KEY, JSON.stringify(payload));
}, []);
```

**✅ Active filter stored in `localStorage`. Never writes back to `users` table. Home location is never overwritten. Matches mobile intent.**
**⚠️ Default filter is `{ state, lga }` — ward always null because `home_ward` is never written by web onboarding.**

---

## Section 4 — Post Location Stamping

**File:** `src/hooks/use-posts.tsx` (L374–413)

```tsx
// L375
const userLocation = profile.location as { state?: string; lga?: string; ward?: string } | undefined;

let resolvedState = userLocation?.state || null;  // "Lagos" hardcoded for web users
let resolvedLga = userLocation?.lga || null;       // null for web users
let resolvedWard = userLocation?.ward || null;     // null for web users

if (evtGeopoint) {
  const geo = await reverseGeocode(lat, lng);
  // overrides above if geopoint present
}
// L406-410
...(postIdToUpdate ? {} : {
  state: resolvedState,
  lga: resolvedLga,
  ward: resolvedWard,
}),
```

**⚠️ General posts stamped with `location` JSON (legacy) — same issue as LocationContext. Web users get `state: "Lagos"`, `lga: null`, `ward: null`.**
**✅ Event posts with `evtGeopoint` override correctly via `reverseGeocode`.**

---

## Section 5 — Marketplace

**File:** `src/components/MarketplaceScreen.tsx` (L26–92)

```tsx
const filterState = activeFilter?.state;
const filterLga = activeFilter?.lga;
const filterWard = activeFilter?.ward;
// …
if (filterState) { query = query.eq('state', filterState); }
if (filterLga)   { query = query.eq('lga', filterLga); }
if (filterWard)  { query = query.eq('ward', filterWard); }
```
**✅ Marketplace feed correctly applies 3-level filter. Matches mobile pattern.**
**UNVERIFIED: No "Sell an Item" creation screen found in web app — may not exist yet.**

---

## Section 6 — Events

**File:** `src/components/EventsScreen.tsx` (L109–170)

**✅ Events feed uses `activeFilter` 3-level filter. Matches mobile.**
**UNVERIFIED: Event creation screen not read — location capture, `reverseGeocode` call, `lat`/`lng`/`location_geom` write not confirmed.**

---

## Section 7 — Map

**File:** `src/components/MapScreen.tsx`

#### ❌ Marketplace markers use legacy `event_location` field (L185–191):
```tsx
let postsQuery = supabase.from('posts').select('*')
  .in('category', ['For Sale', 'General'])
  .eq('is_sold', false)
  .not('event_location', 'is', null);   // <-- new posts have NULL event_location
// …
const loc = extract(typeof p.event_location === 'string' ? null : p.event_location);
```
Any For Sale post inserted via the new schema (`lat`/`lng`, `event_location = null`) is invisible on the map.

#### ❌ Map does not re-fetch when activeFilter changes (L197):
```tsx
}, [user?.id, profile?.location?.state]);
```
Only `profile.location.state` triggers re-fetch. Changing active filter has no effect. Mobile uses `[user, activeFilter?.lga, activeFilter?.state]`.

#### ⚠️ Businesses use legacy `location` JSON (L168-172):
```tsx
supabase.from('businesses').select('*').eq('is_active', true).not('location', 'is', null)
// …
const loc = extract(b.location);  // reads legacy JSON, ignores b.lat / b.lng
```

#### ⚠️ Events on map not filtered by activeFilter (L155–165):
```tsx
const { data: evts } = await supabase.from('events')…  // no state/lga filter
```
All published events returned globally — map shows events outside user's area.

#### ⚠️ Dead Firestore geopoint fallbacks still present (L144–150):
```tsx
if (loc.geopoint) return { lat: loc.geopoint.latitude, … };
if (loc.latitude && loc.longitude) return { lat: loc.latitude, … };
```
Mobile cleaned these up (this session). Web has not.

---

## Section 8 — Settings / Location Update

**File:** `src/app/(app)/settings/location/page.tsx` (L117–123)

```tsx
await updateProfile({
  location: {
    state: selectedState,
    lga: selectedLga,
    ward: selectedWard || undefined,
  },
});
```

**⚠️ Writes only `location` JSON — no `home_*` fields.** Mobile settings (post-fix M3) now writes only `home_*`. Web settings and mobile settings write to different columns.

---

## Full Findings Table

| # | Rating | File | Line(s) | Issue |
|---|--------|------|---------|-------|
| O1 | 🔴 | `onboarding/profile/page.tsx` | 82–97 | GPS ignores real coordinates — hardcodes Victoria Island Lagos |
| O2 | 🔴 | `onboarding/profile/page.tsx` | 135–142 | Zero `home_*` fields written — only `location: {city, state: 'Lagos'}` |
| O3 | 🔴 | `onboarding/profile/page.tsx` | 145–146 | Catch swallows error and routes to welcome — failed saves complete onboarding |
| O4 | ❌ | `onboarding/profile/page.tsx` | 12–42 | Hardcoded neighbourhood list — no Places API or reverseGeocode |
| O5 | ⚠️ | `onboarding/profile/page.tsx` | 139 | `state: 'Lagos'` hardcoded — non-Lagos users get wrong state |
| LC1 | 🔴 | `contexts/LocationContext.tsx` | 39–43 | Reads `profile.location` legacy JSON — `home_*` not checked |
| P1 | ⚠️ | `hooks/use-posts.tsx` | 375 | Post stamp reads `profile.location` not `home_*` |
| M1 | ❌ | `components/MapScreen.tsx` | 185–191 | Marketplace markers use `event_location` legacy field — new `lat`/`lng` posts invisible |
| M2 | ❌ | `components/MapScreen.tsx` | 197 | Map re-fetch ignores `activeFilter` — filter changes have no effect |
| M3 | ⚠️ | `components/MapScreen.tsx` | 168 | Businesses read `location` JSON — canonical `lat`/`lng` ignored |
| M4 | ⚠️ | `components/MapScreen.tsx` | 144–150 | Dead Firestore geopoint fallback chains |
| M5 | ⚠️ | `components/MapScreen.tsx` | 155–165 | Events not filtered by activeFilter — global results |
| S1 | ⚠️ | `settings/location/page.tsx` | 117–123 | Settings writes only `location` JSON — no `home_*` |

---

## Final Verdict

### `yrdly-app` Onboarding + Location Architecture
**→ NOT PRODUCTION READY**

3 critical bugs make onboarding broken for any user outside Lagos and leave the DB in an inconsistent state.

### Web / Mobile Parity
**→ DIVERGENT**

The two clients share a Supabase backend but are in different generations of the location schema. Web writes exclusively to the deprecated `location` JSON column; mobile writes to `home_*`. The `LocationContext` on web reads only from `location`. Map and filter behaviours diverge meaningfully. A mobile-registered user opening the web app will have the correct columns set but they won't be read; a web-registered user on mobile will have `home_*` null and may not see their neighbourhood at all.
