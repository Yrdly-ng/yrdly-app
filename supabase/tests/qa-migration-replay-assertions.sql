-- Read-only QA migration replay assertions. Never run against production.
DO $$
DECLARE
  object_name text;
  table_name text;
  applied integer;
BEGIN
  SELECT COUNT(*) INTO applied FROM supabase_migrations.schema_migrations;
  IF applied <> 59 THEN
    RAISE EXCEPTION 'Expected 59 QA migration records, found %', applied;
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
