# moderate-content

Canonical source recovered from the deployed function, then corrected during
isolated QA. Supports verified user JWTs and backend service/secret keys.
User calls use the shared database rate limiter. Requests and provider calls
have size/time limits; provider failure withholds approval.

Public images are inspected without moving or deleting their storage objects.
Only the authenticated owner's `pending-moderation` paths may be promoted or
quarantined, and source removal requires successful copying. Chat, report and
other private buckets are forbidden. Backend pending-image requests must pass
the trusted originating `userId` explicitly.

Deploy to Staging first with `verify_jwt = false`; the handler verifies both
authentication modes itself. The platform JWT guard rejects modern API keys.

```sh
supabase functions deploy moderate-content --project-ref jxgpvvehajxegeeozlnl --no-verify-jwt
```

Requires `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET` as function secrets.
Do not log these values, signed image URLs or provider response bodies.
Coordinate production deployment with web and shared mobile compatibility.
