# Managed virtual accounts validation

Local implementation review, 21 October 2026. No production data, remote accounts, remote migrations or deployment changed.

## Checks

- Web full Node test collection: 483/485 passed initially. The new admin-route telemetry allowlist failure was fixed; all 17 targeted telemetry/auth/provisioning checks then passed. The remaining payment error-message assertion reproduces in unchanged `tests/audit-security.test.cjs` / `src/lib/payments/payluk-onboarding.ts`.
- Mobile full Node test collection: 226/226 passed.
- Final managed-account checks: 10 auth/provisioning tests and the PostgreSQL/PGlite integration fixture passed. Fixture includes existing session, moderation and comment-counter guards, forbidden direct writes, worker execution, private-target rejection, inactive-admin rejection, synthetic count separation, notification suppression, duplicate content, idempotency and stop behavior.
- The web production build completed successfully. Both TypeScript checks passed. Web and mobile lint completed without errors (existing warnings remain).
- Changed mobile files passed formatting. Repository-wide mobile formatting reports three untouched files: `BusinessHub.tsx`, `EventList.tsx`, and `MarketplaceGrid.tsx`.
- Admin static React preview inspected at 390px and 1440px with no horizontal overflow. This used fixture data and a simplified button adapter; it does not establish authenticated end-to-end behavior or native-device rendering.

## Standards review

Final independent review: no remaining documented-standard violations or serious maintainability findings. Earlier portability and fixture-realism findings were addressed by declaring PGlite in this repository and exercising existing session/moderation guards.

## Spec review

Final independent review: no new concrete blocker in the bounded review. Earlier private-post eligibility finding was fixed with an execution-time visibility check. The reviewer confirmed ownership invariants, comment target restrictions, organic-like isolation, and shared-lock serialization of stop and execution.

## Release prerequisites

The complete deployed schema has not been tested against this migration. Run the documented development Supabase pilot, actual Auth provisioning recovery, concurrent worker/stop tests, native-device disclosure checks and full authenticated administration flow before enabling activity. All configuration and the installed Cron job default to disabled.
