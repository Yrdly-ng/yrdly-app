# Monitoring fixes — 29 October 2026

## Changes

- Android native Maps key reaches the react-native-maps plugin; Android/iOS workflows reject missing keys. Each CI build has its own native build number.
- Notification/community Realtime subscriptions use distinct lifecycle channel names and ignore late callbacks after cleanup.
- Catalog and event contact store their IDs in conversation context instead of the marketplace post foreign key. Catalog chat creation/update entry points have database and callback regression coverage.
- Notification actor failures return a recoverable response and report a bounded operation. The reviewed migration preserves the existing notification constraint and admits seven persisted booking/quote/appeal action types.
- PostHog accepts bounded error categories and ticket, booking, refund-request and withdrawal-request funnel signals. Client confirmation signals can repeat and are not the authoritative financial ledger; request events do not mean refunds/transfers have completed.
- Web replay is masked and limited to explicit public discovery/detail route templates. Unknown, nested private and payment routes stop recording. Mobile replay is limited to selected discovery screens with text-input/image/sandbox masking and network/log capture disabled.
- A configured PostHog recorder replaces Sentry mobile replay to avoid two native recorders. Consequently home/auth/chat crashes require fresh crash stacks or device reproduction rather than replay coverage.
- Android Sentry Gradle symbol uploads are enabled without uploading native source files. Existing iOS symbol upload configuration remains in place.

## Validation

- Web: production Next.js build and TypeScript passed; 20 targeted monitoring/notification/contact tests passed; lint has no errors (one existing hook warning).
- Mobile: TypeScript passed; monitoring/crash tests passed; seven actual business messaging tests passed, plus the flow mapping test. Native Maps and symbol-plugin tests passed. Targeted lint has warnings but no errors.
- Migration passed a local Postgres-compatible regression fixture, was applied to the linked database, and is recorded separately in migration history.
- The linked security-advisor CLI check failed to connect using its temporary database role. It did not produce an advisor verdict; no clean security-advisor result is claimed.

## Still unconfirmed

Sentry MOBILE-D (Fabric parent conflict), MOBILE-E (TECNO Android 11 SIGABRT), MOBILE-B/iOS layout hangs, and APP-3 (older minified browser exception) lack a reproducible app-code cause. Keep them unresolved. Subscription fixes may remove a trigger but do not prove native crash resolution. Reproduce on the new native builds and inspect fresh symbolicated reports. Live PostHog capture/replay delivery must also be checked after users open the deployed clients; local SDK tests do not prove production ingestion.
