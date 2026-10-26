# Enforce account suspension at the shared session gate

Account-level suspensions must stop authenticated access through database policies as well as through server routes. `public.is_current_session_active()` is the shared gate for RLS policies and protected RPCs, so it also checks the account's suspension and ban fields. This makes a moderator action effective for an already-issued current session without depending on a client refresh or sign-out.

The check fails closed when the account row is missing. Service-role background work keeps its existing authorization paths. When adding new protected database operations, continue to use the shared gate and preserve the rule that clients cannot modify suspension fields directly.

The migration is additive and must be applied through the normal Supabase release process; do not apply it directly to production from a development shell.
