# True-distance Nearby implementation plan

## Goal

Replace Nearby's state/LGA proxy with opt-in, short-lived device location and a server-side radius query shared by the mobile and web apps. Never return another user's raw coordinates.

## Scope

1. **Database and access control (`yrdly-app/supabase/`)**
   - Add a private PostGIS-backed presence table keyed by user, with a geography point, update time, and expiry time.
   - Add authenticated RPCs to update only the caller's presence, query discoverable users within a bounded radius, and clear the caller's presence.
   - Deny direct client reads of all presence rows. The query RPC returns profile fields and an approximate distance band only; it filters expired rows, self, non-discoverable users, and existing blocks.
   - Add a scheduled cleanup or equivalent expiry strategy if needed; expired rows must never be returned even if cleanup has not run.

2. **Mobile (`yrdly-mobile/`)**
   - Use Expo foreground location only when the user enters Nearby or explicitly enables Nearby presence. No background tracking.
   - Add explicit Nearby opt-in, radius choices, permission-denied handling, and an opt-out/clear-presence action. Keep the existing `share_location` preference semantics unchanged until verified.
   - Replace the state/LGA directory query with the secure RPC and preserve existing search, mutuals, sellers, blocking, and pagination behavior.

3. **Web (`yrdly-app/`)**
   - Use browser geolocation only after the user opens Nearby and explains the purpose; provide denial/unavailable states and an opt-out action.
   - Call the same presence/query RPCs and remove state/LGA matching as the Nearby source of truth.

4. **Validation and rollout**
   - Add SQL/RPC and client tests for radius boundaries, expired presence, consent, self-exclusion, discoverability, and privacy (no coordinate fields returned).
   - Run the focused mobile and web tests, typechecks, and lint for changed files.
   - Apply the migration to a development Supabase project first. Production migration/deployment remains a separate rollout step.

## Open implementation detail

Use a short TTL (initial proposal: 30 minutes), refreshed only while Nearby is actively open. Radius options can start at 5, 10, and 25 km, with a server-enforced maximum. Confirm exact UI labels and TTL during implementation if existing product conventions dictate different values.
