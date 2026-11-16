# Migration review tools recovered on 16 November 2026

These read-only SQL diagnostics were extracted from QA-only PR #78. No baseline migration, migration deletion, finance migration move, or deployment workflow is included.

Run SQL only in an isolated disposable QA database using a read-only transaction. The assertion scripts contain **11 November 2026 snapshot counts and hashes**; they are historical evidence, not current production acceptance criteria. Refresh expected values after reviewing the intended schema. Never run the old QA baseline on production or reset existing staging data.

`node qa-scripts/audit-migration-bootstrap.mjs` inspects source files without a database connection. On 16 November it inspects 117 migrations and reports four missing foundational tables: users, posts, events, ticket_tiers. Its nonzero exit is expected until a history-preserving bootstrap repair is designed. It is a conservative regex preflight, not a SQL parser or substitute for a clean database replay.

The documents under docs/qa are dated audit records; their old counts and branch statuses must not be treated as current service health. These tools do not repair migration lineage or authorize financial operations.
