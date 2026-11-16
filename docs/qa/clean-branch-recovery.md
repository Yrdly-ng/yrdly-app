# Supabase clean-branch recovery

## Reproduced failure (10 November 2026)

A newly created Supabase branch of YRDLY's production project failed migrations on the second source migration:

- First recorded migration: `20260708000000_create_rate_limits`
- Failing migration: `20260713105005_migrate_legacy_events`
- Exact PostgreSQL diagnostic: `relation "public.posts" does not exist`
- Missing related foundational objects: `public.users`, `public.events`, and `public.ticket_tiers`

This is a **missing foundational schema**, not a stale branch status. The database did not receive these base tables in any source migration before scripts attempted to read or alter them.

The source currently contains 111 migration files. Production has 107 recorded versions and an already-provisioned schema; the existing Staging branch has a separate QA baseline and 35 recorded versions. Neither database history is a reproducible replacement for the missing original base schema.

## Safety constraints

Do not reset the old Staging branch, rebase it on production, insert fabricated version rows into `supabase_migrations.schema_migrations`, or apply the current production schema on top of the old incremental migrations. Any of these can lose test fixtures or silently produce broken authorization/ledger behavior.

The repository's historically valid eight-digit versions (e.g. `20260819`, `20260820`) are already recorded in production; **do not rename** those files to fourteen digits.

The temporary clean Supabase branch was deleted after the reproduction to end the approved hourly billing. Production remains unchanged.

## Required foundation and acceptance gates

1. Recover an **authoritative pre-July-2026 schema baseline** or reconstruct it in an isolated local PostgreSQL instance from carefully reviewed, *schema-only* catalog definitions. Include schemas, extensions, 15 public enum types, base tables, constraints, indexes, RLS, policies, triggers, function privilege grants, and storage rules. Do not include user rows, session tokens, access keys or private data.
2. Review each historical migration against the reconstructed baseline and make fresh-database assumptions explicit. Legacy-data conversion migrations must safely do nothing on an empty database but must preserve their one-time conversion behavior on existing populated databases.
3. Run the complete migration sequence on a disposable **local** database. The final effective schema, policies and privileges must match YRDLY's approved production design. Start with the read-only `node qa-scripts/audit-migration-bootstrap.mjs` preflight, which currently fails as expected until a baseline exists.
4. Validate signup/profile RLS, public ward lookups, session revocation, financial/escrow and tickets, storage policies and all privileged functions; do not infer security correctness from successful SQL execution alone.
5. Only after successful local replay, use a disposable Supabase branch with separate cost approval to verify provider-specific behavior; do not use production account data as fixtures.
6. Keep migration repair in its own pull request and require CI; do not auto-merge a foundational schema refactor together with frontend onboarding.

## Observed catalog sizes (read-only)

| Object | Production | Existing Staging |
|---|---:|---:|
| Public tables | 98 | 82 |
| Public enums | 15 | 15 |
| Public functions | 168 | 133 |
| Application triggers | 171 | 157 |
| Public RLS policies | 274 | 269 |

These differences underline that current Staging cannot be treated as an exact snapshot of production.
