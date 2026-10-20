# Nearby discovery and Explore communities

Nearby previously selected other people from the private `users` table. The
`users_private_read` policy permits ordinary users to read only themselves;
excluding the viewer therefore produced no discovery results. Supabase errors
were also discarded and appeared as empty results. The public profile view,
already used by mobile, provides the discovery fields without private user data.

The web screen now reads `public_profiles`, honors the global location selection,
filters undiscoverable/blocked/followed profiles, and reports retryable failures.
Circle and Nearby loading are independent; requests have cancellation and a
12-second deadline. No schema or access-policy changes are required.

Explore > Discover owns Nearby, Communities and My circle. The selected mode is
in the URL, including `/explore?tab=discover&mode=communities`. The community
directory is embedded, retains its search across discovery-mode switches and
pauses its subscriptions/polling while hidden. Legacy `/community` and
`/communities` pages redirect into Explore. Community detail/post routes remain
available at their existing URLs.

Validation: actual-screen tests cover public discovery, request failure/retry,
signed-out state, privacy/runtime payloads, location scope, stale cancellation,
timeout, circle-failure isolation and inline community navigation. Run
`pnpm test:explore`. A read-only live public-profile query succeeded. Chrome
fixture checks at 390×844 and 1440×900 verified visible Nearby results, inline
Communities, browser Back and no horizontal overflow. The reported customers'
specific sessions were not available for direct replay.
