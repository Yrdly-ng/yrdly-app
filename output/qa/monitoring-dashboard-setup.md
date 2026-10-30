# YRDLY monitoring dashboards

Updated 30 October 2026.

## Published in PostHog

- [App and Web Overview](https://us.posthog.com/project/590527/dashboard/2280569)
- [Mobile Usage](https://us.posthog.com/project/590527/dashboard/2277126)
- [Web Usage](https://us.posthog.com/project/590527/dashboard/2280570)

All 25 insight tiles were executed successfully after saving. Existing mobile insights were reused and retained. Four principal metric definitions were saved in the Data Catalog as **proposed**, not approved. The starter dashboard was left unchanged.

The dashboards cover observed active users by Android/iOS/web, daily and weekly activity, popular screens/pages, app builds, OS versions, mobile device models, browsers, web device types, selected home states, messages, business saves and weekly retention. Testers are included. Dates use the project's UTC timezone. Current periods and recent retention cohorts are incomplete.

Counts describe observed analytics identities, not downloads or all registered accounts. Signed-in UUIDs can be deduplicated across platforms. Memory-only anonymous identities can count a returning visitor again. Users who use multiple platforms can appear in multiple platform groups. The overview's combined period count uses a native distinct aggregation, not a sum of daily users.

## Telemetry release

Release authorized by the user on 30 October 2026. Mobile commit `076375d` is pushed to main. The web changes are included with this handoff commit; pushing main starts the Vercel deployment.

- [Android APK build](https://github.com/Yrdly-ng/yrdly-mobile/actions/runs/41028261406)
- [iOS IPA build](https://github.com/Yrdly-ng/yrdly-mobile/actions/runs/41028284176)

The native workflows retain the push-registration fix, Firebase validation, native Google Maps secrets and missing-key checks. Build completion and device installation are separate from starting these runs.

- Home state comes from the authenticated user's own profile, never the Explore filter, IP lookup, GPS, LGA or address.
- Only Nigerian states/FCT are accepted. Nasarawa/Nassarawa and FCT aliases are normalized.
- Home-state context clears when signing out, switching accounts or resolving authentication. A mismatched profile is ignored.
- Mobile sends bounded model/manufacturer/device-type values and an explicit platform; it never sends the device's personal name.
- Web retains bounded SDK browser, OS and device-type metadata.
- Web analytics stop transmitting if identity reset fails; the next account's state cannot be attributed to the previous account.

State, device-model and browser charts currently show missing metadata. They start populating after the telemetry changes are released and users generate new events. Historical metadata cannot be reconstructed from existing events. Checkout and refund events have not yet arrived in this project's recent event schema; payment conversions/revenue are not inferred from unrelated activity.

Validation: 13 web telemetry tests and 17 mobile telemetry tests passed; web/mobile TypeScript checks and targeted ESLint checks passed. No database migration is required.

## Sentry

Existing health views are linked inside the PostHog dashboards:

- [Mobile Session Health](https://yrdly-ltd.sentry.io/dashboard/9844051/)
- [Frontend Session Health](https://yrdly-ltd.sentry.io/dashboard/9844039/)
- [Unresolved issues](https://yrdly-ltd.sentry.io/issues/?query=is%3Aunresolved&statsPeriod=14d)

`monitoring-sentry-dashboard.json` is a prepared custom dashboard request body. It has **not** been created or validated against Sentry's dashboard write API. It covers both YRDLY projects over 14 days, across all environments, with errors, affected identified users, issues, releases, OS, unhandled mobile errors and screen tags. Missing OS/screen/user metadata must not be interpreted as no errors. Error event counts are not an app-wide crash rate.

The connected Sentry tools can read dashboards but expose no dashboard creation operation. No local `SENTRY_AUTH_TOKEN` is currently configured. An attempt using the protected GitHub Actions credential returned HTTP 403 (permission denied): [dashboard publication attempt](https://github.com/Yrdly-ng/yrdly-mobile/actions/runs/41028258411). The mobile repository now has an idempotent manual `Publish Sentry monitoring dashboard` workflow; it reads back and verifies the saved dashboard, and never exposes the credential. To finish publishing, provide a locally stored Sentry API token with dashboard permissions, or update the protected CI secret; do not paste it in chat or commit it. The documented create endpoint is `POST https://us.sentry.io/api/0/organizations/yrdly-ltd/dashboards/`. Review the prepared body, validate it through the authenticated API, read the created dashboard back, and record its URL here. Check for an existing matching title before retrying a failed request.

References: [Sentry dashboard create API](https://docs.sentry.io/api/dashboards/create-a-new-dashboard-for-an-organization/), [PostHog dashboards](https://posthog.com/docs/api/dashboards), [PostHog insights](https://posthog.com/docs/api/insights).
