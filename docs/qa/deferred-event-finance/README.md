# Deferred Payluk event finance migrations — QA audit only

These five migration files were present in the repository's historical migrations but **NOT applied to YRDLY production** as of 11 November 2026. Production did not have their four new tables or associated RPCs. They must NOT be implicitly executed by a migration-history repair.

The files are preserved here byte-for-byte for a separate reviewed Payluk event-finance rollout. Event ticketing/organizer release has additional escrow and licensed-partner requirements. Restoring these files into `supabase/migrations` must be deliberate, with a fresh forward-only migration plan, finance authorization, sandbox payout tests and safe production release gates.

They are excluded from the QA-only migration replay to better reproduce the *current* production schema.

Files:
- `20261031173533_payluk_event_finance.sql`
- `20261101183741_resumable_payluk_event_withdrawals.sql`
- `20261102145854_bind_payluk_event_environments.sql`
- `20261102154631_enforce_event_dispute_release_hold.sql`
- `20261102201132_reconcile_native_event_fee_evidence.sql`

**Do not merge the QA-only branch's historical migration removals into production.** Reconcile main's remote migration history and release pending finance work independently.
