# Authenticated address lookup

The optional `/api/maps/[...path]` endpoint supports the existing Google Places
Autocomplete/Details REST format and reverse geocoding. It requires a validated
Supabase user (cookie or bearer), rejects suspended users, restricts endpoints and
parameters, uses the persistent per-user rate limiter (60 requests per minute),
and bounds upstream calls to five seconds. Provider errors and key-bearing URLs
are not returned or logged. Google attribution remains in the existing inputs.

Routing is **disabled by default**. Existing keys and address lookup remain in
use until this separate rollout has passed QA. No key rotation is required just
to retain this code, and no keys should be revoked while older mobile clients
still depend on them.

Activation order:

1. Configure `GOOGLE_MAPS_SERVER_API_KEY` on the web server with access to
   Geocoding and Places API (Legacy). This is a server-only variable; never use
   a `NEXT_PUBLIC_` or `EXPO_PUBLIC_` prefix. The currently configured Directions
   key was rejected for both APIs during the 13 October 2026 local check; it is
   not silently reused. Places API (New) is a different request format.
2. Deploy the web endpoint to QA and verify owned bearer and cookie sessions,
   address suggestions, selection/details, GPS lookup, country handling, expired
   sessions, rate limits and upstream failures. The existing
   `consume_rate_limit` database function must already be installed.
3. Enable `NEXT_PUBLIC_MAPS_PROXY_ENABLED=true` for the web QA build and
   `EXPO_PUBLIC_MAPS_PROXY_ENABLED=true` for a new mobile QA build. Both flags
   are evaluated at build time. Keep them unset in production until those
   builds pass. Expo web cross-origin proxy access is not configured; this is
   for the Next.js web app and native mobile apps.
4. Release the endpoint before enabling either client in production. Turn a
   flag off and rebuild to restore the original integration; enabled clients
   do not silently retry provider errors using a public key.

The mobile adapter preserves the original autocomplete behavior when disabled.
When enabled, it attaches the current user's token, follows refresh/logout events,
disables input without a matching signed-in identity and clears suggestions on
account switches. It routes all eight existing address inputs through one helper.
Web Places JavaScript widgets and native map rendering continue to use their
existing public keys; the optional web change affects GPS reverse geocoding only.
Driving directions and ETA calculation are unchanged.
