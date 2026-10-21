# Managed virtual accounts

This feature provides 50 persistent fictional personas, reviewed scheduled General posts, comments restricted to other managed authors, and separate synthetic likes. It does not generate content autonomously. Administrators prepare and review drafts in `/admin/virtual-accounts` using the versioned persona manifest.

## Release sequence

1. Apply `20261020231643_managed_virtual_accounts.sql` to a development Supabase project first. Verify the complete deployed schema, RLS, Auth profile triggers, moderation/counter triggers, and storage policies against the migration. The local PGlite fixture is not a full Supabase instance.
2. Deploy `process-managed-virtual-jobs` to that development project. Its own backend-key authentication is required; `verify_jwt=false` supports current secret keys. No anonymous execution is allowed.
3. Deploy both clients. Verify profile/post/comment disclosure, hiding virtual content, unavailable contact actions, organic counters and realtime refresh. Older clients retain the virtual suffix in public names. Keep `client_disclosure_ready=false` until supported versions show disclosure.
4. Review all 50 entries in `scripts/managed-accounts/personas.mjs`. Preview without credentials: `node scripts/managed-accounts/provision.mjs`. Initials use the existing profile avatar fallback; no real people's photographs are used.
5. In the intended development environment only, provide `MANAGED_SUPABASE_URL`, `MANAGED_SUPABASE_SERVICE_ROLE_KEY`, `MANAGED_ACCOUNT_EMAIL_DOMAIN` (an owned domain), and `MANAGED_CONFIRM_TARGET` equal to the explicit URL. Run the script with `--apply`. It resumes incomplete registrations, uses stable emails/slots, bans interactive login, and never prints credentials. Do not use ordinary application environment variables as an implicit target.
6. Confirm exactly 50 registered identities, paused initially, and all action switches disabled. Sign in as a human administrator, activate a small pilot subset, review drafts, configure limits, then schedule. Configuration changes cancel queued jobs; reschedule deliberately. Enable the installed inactive `process-managed-virtual-jobs` Cron job only after validating the pilot and Vault credentials (`project_url`, `service_role_key`).
7. Production migration, deployment, provisioning and activation are separate release operations; none are performed by implementing or testing this feature.

## Guarantees and operation

- Classification is registry-backed and permanent. Ordinary clients cannot set it. Registration requires a newly created, banned Auth identity marked with its managed slot.
- `liked_by` and `comment_count` represent organic engagement. `synthetic_like_count` and `synthetic_comment_count` are separate. Human activity on a managed post remains human activity; virtual posts are excluded from web Trending.
- Only approved drafts execute. Review covers fictional framing, originality, content safety and persona consistency. No generation provider or new AI credentials are required.
- Database commands own quotas, duplicate/near-duplicate rejection, target eligibility, attribution and idempotency. Leases allow bounded retry after uncertain HTTP outcomes. Late jobs expire instead of flooding the feed.
- Emergency stop serializes with final writes, cancels pending jobs and invalidates their generation. Once stop returns, no further managed action can commit until explicitly resumed. It preserves existing content for review.
- Existing moderation controls remove unwanted published content. Pause/retire accounts through the admin command. Do not delete registry rows or strip classification during rollback.
- Audit captures successful administrative changes, completed actions and rejected worker actions. A rejected direct database write rolls back; it is not a durable audit event. Use database/API error monitoring for rejected bypass attempts.
- New unrelated action tables must receive the managed-actor guard, including every actor/owner/participant field. Revalidate migration coverage when schema changes.

## Validation

Run from `yrdly-app`: `node --test tests/managed-provisioning.test.cjs tests/managed-auth.test.cjs`, `node tests/fixtures/run-managed-virtual.cjs`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`. The database runner uses local PGlite and never connects to a remote project. `--red` intentionally omits the feature migration to demonstrate the integration checks fail without it.

Run from `yrdly-mobile`: `node --test tests/managed-auth.test.cjs tests/feed.test.cjs`, `pnpm typecheck`, `pnpm lint`, and `pnpm format:check`. Run each repository's complete `tests/*.test.cjs` collection before release.

Before activation, exercise actual Supabase Auth provisioning recovery, two concurrent workers, stop during execution, and all table guards on a development project. Local single-connection fixtures cannot prove production lock contention, Edge runtime behavior, or deployed-schema compatibility.
