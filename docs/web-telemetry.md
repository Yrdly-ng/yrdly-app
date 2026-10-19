# Web telemetry

Yrdly uses `posthog-js` for browser product analytics and `@sentry/nextjs` for browser, Node.js and Edge error reporting. The web Sentry project is `yrdly-ltd/yrdly-app`; mobile keeps its separate project. PostHog uses the same project and Supabase user UUID as mobile, with `app_platform: web` distinguishing events.

## Configuration

Use a Node version supported by the pinned Sentry SDK (20.19–21, 22.12+, or 23.2+; this workspace uses Node 24). See `.env.example`. Vercel Production and Preview need `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_SENTRY_DSN`, and `NEXT_PUBLIC_APP_ENV` (respectively `production` and `preview`). The legacy `NEXT_PUBLIC_POSTHOG_API_KEY` alias is supported. Public variables are embedded at build time, so changes require a new build.

`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are private build settings for source-map uploads. Keep the token in Vercel secrets. Source maps are uploaded only when all three settings exist; generated maps are deleted after upload. Missing settings skip uploads and leave the app usable. Set `SENTRY_DISABLE_AUTO_UPLOAD=true` to skip uploads during a local build. The token needs release/source-map permissions for the web project; a mobile-only token must be replaced with one that covers both projects.

Development telemetry is off by default. Explicitly set `NEXT_PUBLIC_TELEMETRY_DEBUG=true` to test with a test project. `NEXT_PUBLIC_TELEMETRY_DISABLED=true` disables telemetry and uploads after rebuilding.

## Collection boundaries

- Browser analytics starts after hydration and auth resolution. SDK initialization is once per page load; page changes use manual `$pageview` events. Same-path rerenders do not duplicate events. Persistence is memory-only; identity resets on logout or account switch. Anonymous identity does not persist across reloads.
- Registered route templates in `src/lib/telemetry/routes.ts` replace business, conversation, post and profile identifiers. Queries, fragments, URL/referrer properties and unknown paths are dropped. Update this list when adding pages; the regression test checks route coverage.
- `message_sent` and `business_saved` record successful text messages in business chat and successful business editor saves. No content, IDs or form values accompany those events. The helpers deliberately support only these two product events.
- PostHog autocapture, recording, surveys, performance, exception capture and feature flags are disabled. The `/ingest` proxy follows the configured US/EU PostHog cloud region; unknown hosts use the US cloud. `before_send` rebuilds events from an allowlist and strips person updates. GeoIP is disabled, but ingestion still receives the transport connection's network address.
- Sentry starts through Next.js instrumentation, captures unhandled failures and request errors, and receives handled failures from global/shared error boundaries, business saving and business text-message sending. Tracing, replay, breadcrumbs, logs, metrics, request bodies, headers and cookies are disabled or discarded. A strict `beforeSend` filter keeps error class, stack locations, release/debug IDs and bounded operation/database codes. Free-text error messages and arbitrary context are omitted. Server events never include user identity; browser identity contains only a UUID.
- The filter preserves source-map debug IDs and applies the same path cleaning to stack frames and debug images. Keep Sentry server-side scrubbing enabled too. Existing Vercel Analytics/Speed Insights are separate and keep their current behavior.

## Validation and release

Run `pnpm test:telemetry`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`. SDK tests replace only SDK boundaries and execute the real telemetry helpers.

After an approved deployment, verify one templated pageview and a business success event in PostHog, switch accounts and confirm the new UUID, then trigger a controlled test error in Preview and confirm it resolves to source with no private context in Sentry. Do not send real customer messages to test telemetry. Production event delivery and source-map permissions require this deployment check; local tests do not prove them.
