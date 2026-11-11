-- Read-only QA migration replay assertions. Never run against production.
DO $$
DECLARE
  object_name text;
  table_name text;
  applied integer;
BEGIN
  SELECT COUNT(*) INTO applied FROM supabase_migrations.schema_migrations;
  IF applied <> 54 THEN
    RAISE EXCEPTION 'Expected 54 QA migration records, found %', applied;
  END IF;

  FOREACH object_name IN ARRAY ARRAY[
    'public.users', 'public.posts', 'public.businesses',
    'public.escrow_transactions', 'public.payout_requests',
    'public.events', 'public.tickets', 'public.lga_wards'
  ] LOOP
    IF to_regclass(object_name) IS NULL THEN
      RAISE EXCEPTION 'Critical YRDLY table missing: %', object_name;
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'users', 'posts', 'businesses', 'escrow_transactions',
    'payout_requests', 'events', 'tickets'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relname=table_name AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', table_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=table_name
    ) THEN
      RAISE EXCEPTION 'No RLS policies found on public.%', table_name;
    END IF;
  END LOOP;
END $$;

-- Inventory is diagnostic only. Parity with production requires a separate,
-- reviewed schema comparison; row-count matching does NOT prove RLS safety.
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS public_tables,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public') AS public_policies,
  (SELECT COUNT(*) FROM pg_proc WHERE pronamespace='public'::regnamespace) AS public_functions,
  (SELECT COUNT(*) FROM supabase_migrations.schema_migrations) AS migrations_applied;


-- Compare these read-only fingerprints with a separately captured, vetted
-- production schema inventory. Do not fail merely because fingerprints differ:
-- differences require review, not automatic schema modification.
WITH
  tbl AS (
    SELECT c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text AS k
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
  ),
  col AS (
    SELECT c.relname || '.' || a.attname || ':' || pg_catalog.format_type(a.atttypid,a.atttypmod)
    || ':' || a.attnotnull::text AS k
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
  ),
  pol AS (
    SELECT tablename||'.'||policyname||':'||cmd||':'||array_to_string(roles,',') AS k
    FROM pg_policies WHERE schemaname='public'
  )
SELECT
 (SELECT count(*) FROM tbl) AS table_count,
 (SELECT md5(string_agg(k,E'\\n' ORDER BY k)) FROM tbl) AS table_fingerprint,
 (SELECT count(*) FROM col) AS column_count,
 (SELECT md5(string_agg(k,E'\\n' ORDER BY k)) FROM col) AS column_fingerprint,
 (SELECT count(*) FROM pol) AS policy_count,
 (SELECT md5(string_agg(k,E'\\n' ORDER BY k)) FROM pol) AS policy_fingerprint;
