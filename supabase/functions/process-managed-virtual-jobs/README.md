# Managed home-feed activity worker

Executes at most five reviewed jobs per invocation using database-enforced
identity, target, quota, deduplication and emergency-stop checks. No generation
service, user credentials, image upload or automatic engagement targeting exists.

Deployment does not enable activity. The migration defaults every account to
paused and all global switches to false. Administrators must acknowledge client
disclosure readiness, review drafts, deliberately schedule them, and enable the
relevant switches. Failed policy checks require a new reviewed draft; transport
failures may reclaim a lease up to three times.

The optional Cron entry is installed only where Cron already exists and remains
inactive until an operator activates it in a development deployment. It checks
the enablement switch before calling this function. Vault names follow the
existing community worker: `project_url` and `service_role_key`.

Backend authentication accepts the project's service-role key or a configured
`SUPABASE_SECRET_KEYS` value. These secrets never enter clients or audit payloads.
The stop RPC locks the same singleton row as final execution: after stop returns,
old leases cannot publish, and a resume never replays cancelled work.

Local database behavior checks: `node tests/fixtures/run-managed-virtual.cjs` from
`yrdly-app`. The runner uses this application's pinned PGlite development dependency;
it never connects to a deployed database. Its disposable schema is intentionally
minimal, so deployed-schema integration and multi-connection lock races must
still pass against a dedicated development Supabase project before activation.
