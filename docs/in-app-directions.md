# In-app directions: first release

Approved scope: route planning within Yrdly on web and mobile. Voice guidance,
background location tracking, live turn-by-turn navigation, and automatic
rerouting are outside this release.

## User flow

- Marketplace listings, offline events, business profiles and non-friend map
  previews offer Get directions. Entry points open the Yrdly map using
  `destinationType` and `destinationId`, including destinations outside the
  currently selected area or the map's initial result limits.
- Opening this directions flow is the user's route request. Merely browsing
  pins does not calculate routes. The map displays the destination photo,
  title and permitted address, with a route line, distance, estimated duration,
  driving/walking selection and text instructions.
- Use the current device location after permission, or let the user choose a
  different starting address. Permission denial does not prevent manual starts.
- Changing the destination, starting point or travel mode cancels/invalidates old
  requests. Leaving directions removes the line and restores map browsing.
- Keep View listing/event/business available. Marketplace users can return to
  the listing to ask the seller for the agreed pickup point.

## Destination accuracy and access

The server resolves a content type and ID using the authenticated user's access,
not arbitrary destination coordinates supplied by the caller. Hidden, inactive,
unpublished, archived or online destinations do not acquire a route through this
feature. Friend locations are not routable.

Marketplace routing uses its public ward/LGA area and explicitly says it is an
approximate area; it never exposes a seller's private precise coordinates or
address. Event/business coordinates may be exact when the public record supplies
them, otherwise public-address resolution stays labelled approximate as needed.
Missing coordinates/address produce a useful unavailable state, not a fabricated
destination. Google attribution and any provider route warnings remain visible.

## Server contract

`GET /api/directions/destination?type=...&id=...` resolves destination metadata.
`POST /api/directions/route` accepts
`{destination: {type, id}, origin: {lat, lng}, mode: "driving" | "walking"}`.
Destination types are `marketplace`, `event`, `legacy-event`, and `business`.

Destination fields: `type`, `id`, `title`, `address`, `lat`, `lng`, `approximate`,
optional `image`, and `href`. Route fields: `destination`, `mode`,
`overview_polyline`, `distance_meters`, `duration_seconds`,
`steps: [{instruction, distance_meters, duration_seconds}]`, and `warnings`.
Provider HTML must be converted to safe text. Credentials stay server-only;
auth, rate limits and request deadlines apply. Billing and the enabled/restricted
map provider credentials remain deployment prerequisites.

The web server uses `GOOGLE_DIRECTIONS_API_KEY` for the Google Directions API
(Legacy) and `GOOGLE_MAPS_SERVER_API_KEY` for Geocoding API/Places API. Restrict
these server credentials to their respective APIs; do not use the browser map
key. The existing Google map display keys remain separate. Confirm billing and
Directions API availability on the target project before release. No database
migration is required. Mobile uses its existing web API base URL and needs the
web endpoints deployed before its release.

Run `pnpm test:directions` in either app to check the feature without calling
Google. Live device/GPS and provider integration still require a release check
with billing enabled.

## Agreed test targets and review baselines

1. Directions endpoints and destination resolution: access, privacy, location
   accuracy, modes, provider failures and response sanitization.
2. Detail actions: the correct destination opens in Yrdly with no external map
   launch; online/unlocated entries are handled appropriately.
3. Map flow: route display, starting point and travel mode changes, stale-request
   cancellation, empty/error states, approximate-area guidance and cleanup.

Review the web changes against `cca2170e` and mobile changes against `5c16802`.
Use red/green tests at these public interfaces and perform the final two-axis
standards/spec review before committing. No deployment is included in this skill
invocation.

## Implementation validation

- Web: 21 directions tests passed, TypeScript and the production Next.js build passed.
  The actual directions panel was checked in Chrome at 390×844 and 1440×900 with
  fixture responses; both layouts fit and allowed scrolling to attribution and
  the detail/contact action.
- Mobile: all 196 unit tests passed, including seven directions tests; TypeScript
  passed. Native device interaction and visual QA remain release checks.
- The web full suite passed 459/460 tests. The existing payment test
  `stored Payluk identity with a different phone is rejected without remapping`
  expects a generic error message while the unchanged payment module returns its
  specific identity-mismatch error. Neither payment file changed for this work.
- Live routing/GPS checks require working Google billing. This implementation
  does not enable billing, deploy web changes, or start native builds.

Final review: Standards — 0 material findings. Spec — 1 moderation-access
finding fixed with an explicit approval check and regression test; 0 outstanding.
