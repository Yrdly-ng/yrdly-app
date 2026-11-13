# YRDLY migration history reconciliation — 11 November 2026

This is an **audit record**, not a migration or permission to change production history.

## Verified production migration drift

- GitHub `main`: 111 migration files.
- Production `supabase_migrations.schema_migrations`: 107 version records.
- 22 production-only versions, 26 repo-only versions.
- **20 production-only versions match repo files exactly after lowercasing and whitespace normalization**. The SQL is equivalent; their timestamps were renamed.
- The other **two production-only** versions are paired temporary maintenance steps: `20261013112335` paused writes and `20261013112944` resumed writes. Their effects were intended to cancel at release time. A fresh branch should not replay a write pause during bootstrap.
- Six repo-only versions remain after those 20 matches. The `20261022124500` stale-checkout-expiration RPC already exists on production but its version isn't recorded. The other **five** are Payluk event-finance changes intentionally **not applied** to production, and their four tables do not exist there.

## Exact SQL mappings (production version → Git version)

| Applied in production | Equivalent Git source version |
|---|---|
| `20261010051306` | `20261009120000` |
| `20261010051311` | `20261009120200` |
| `20261010051316` | `20261009120400` |
| `20261010051323` | `20261009120500` |
| `20261013112048` | `20261010152102` |
| `20261013112050` | `20261011065344` |
| `20261013112103` | `20261011071619` |
| `20261013112104` | `20261011082302` |
| `20261013112350` | `20261011153000` |
| `20261013112351` | `20261011173901` |
| `20261013112402` | `20261011192107` |
| `20261013112403` | `20261009120100` |
| `20261013112416` | `20261010142106` |
| `20261013112419` | `20261009120300` |
| `20261013112427` | `20261010054000` |
| `20261013112429` | `20261010145624` |
| `20261013112438` | `20261012125707` |
| `20261013112440` | `20261012130109` |
| `20261013112757` | `20261013112556` |
| `20261023195540` | `20261023190000` |

## Unapplied finance migrations — DO NOT deploy as part of history repair

- `20261031173533_payluk_event_finance.sql`
- `20261101183741_resumable_payluk_event_withdrawals.sql`
- `20261102145854_bind_payluk_event_environments.sql`
- `20261102154631_enforce_event_dispute_release_hold.sql`
- `20261102201132_reconcile_native_event_fee_evidence.sql`

These affect ticket escrow, organizer payouts, release holds and refunds. Their separate financial and licensing review is mandatory. The QA-only branch `qa/onboarding-clean-migrations` preserves their SQL under `docs/qa/deferred-event-finance/`, outside the active migration directory.

## Reproducibility and parity

The QA branch reconstructs a fresh local Supabase database from the historical October QA schema baseline and later production-equivalent migrations. GitHub Actions runs `supabase db start`, executes schema/RLS checks and stops the disposable instance. The original dashboard-created Supabase branches failed because they replayed the production history, not GitHub branch files.

As of the first production-equivalent replay, table-count (98), table-name/RLS-enabled fingerprint and column-count (1,151)/type/nullability fingerprint **matched production**. RLS policies still differed by four and public function count still differed; full security-definition parity remains under investigation. Matching metadata hashes is not proof of complete DDL or permissions parity.

## Do-not-break-live plan

1. Complete read-only QA vs production policy/function/constraint/grant comparison.
2. Keep the 5 Payluk migrations out of the active migration stream and preserve their original SQL.
3. Reconcile the 20 identical timestamp aliases, the 2 temporary maintenance versions and the one already-live but unrecorded RPC **in a draft branch first**. Do not invent rows in production's history as a shortcut.
4. Run fresh local Supabase replay and review RLS SECURITY DEFINER grants and business-payment rules.
5. Confirm Supabase's GitHub integration is attached to `Yrdly-ng/yrdly-app` with working directory `.` and automatic branching enabled. Dashboard-created branches use **production history**, not the QA Git branch.
6. Create a separate GitHub-connected preview, check its migrations and app health. Only then plan a backed-up production migration-history reconciliation, with an explicit rollback strategy.

**Production tables, data and migration history have not been modified by this audit.** Never merge QA-only PR #78 into production.
