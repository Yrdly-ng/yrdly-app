-- QA-only release gate. Derived from read-only YRDLY production catalog
-- fingerprints on 2026-11-11. Contains no rows, secrets, or credentials.
-- Run only against a disposable local QA database. Refresh fingerprints
-- deliberately after reviewed production schema migrations; never waive
-- differences solely to get CI green.
DO $qa_parity$
DECLARE
  actual jsonb;
  expected jsonb := '{
    "tables": [98, "660402cded816c27252078e9dcb4d711"],
    "columns": [1151, "9a9800ff30de1e7e00073f75657a5cfb"],
    "policy_inventory": [274, "a5af1f7ac7b9438a1b97e88f9eeb92db"]
  }'::jsonb;
BEGIN
  WITH tbl AS (
    SELECT c.relname||':'||c.relkind::text||':'||c.relrowsecurity::text AS k
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
  ), col AS (
    SELECT c.relname||'.'||a.attname||':'||
           pg_catalog.format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text AS k
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
  ), pol AS (
    SELECT tablename||'.'||policyname||':'||cmd||':'||array_to_string(roles,',') AS k
    FROM pg_policies WHERE schemaname='public'
  )
  SELECT jsonb_build_object(
    'tables',(SELECT jsonb_build_array(count(*),md5(string_agg(k,E'\\n' ORDER BY k))) FROM tbl),
    'columns',(SELECT jsonb_build_array(count(*),md5(string_agg(k,E'\\n' ORDER BY k))) FROM col),
    'policy_inventory',(SELECT jsonb_build_array(count(*),md5(string_agg(k,E'\\n' ORDER BY k))) FROM pol)
  ) INTO actual;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'QA foundational schema differs from vetted production fingerprint: %', actual;
  END IF;
END $qa_parity$;

DO $qa_parity$
DECLARE
  actual jsonb;
  expected jsonb := '{
    "policies": [274, "ba62daa0f9e7077aa1a10cce9d9507e6"],
    "functions": [168, "813b31e62f24c5a39a50484cc4c9eb26"],
    "triggers": [171, "8b6c18a4dc2c01b60e1b12b7200b8e55"],
    "indexes": [360, "e61ffcba049aeea27a228c6616f621a9"],
    "constraints": [521, "9b687f30036a4b88b265e140d6b0fe10"],
    "defaults": [439, "b7d3d181c30ddd0082701510c98302b0"]
  }'::jsonb;
BEGIN
  WITH policy AS (
    SELECT tablename||'.'||policyname||':'||cmd||':'||array_to_string(roles,',')||':'||
           permissive||':'||coalesce(qual,'')||':'||coalesce(with_check,'') AS k
    FROM pg_policies WHERE schemaname='public'
  ), func AS (
    SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||
           regexp_replace(lower(pg_get_functiondef(p.oid)),'[[:space:]]+','','g') AS k
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  ), trig AS (
    SELECT c.relname||'.'||t.tgname||':'||pg_get_triggerdef(t.oid,true) AS k
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname='public'
  ), idx AS (
    SELECT indexname||':'||indexdef AS k
    FROM pg_indexes WHERE schemaname='public'
  ), cnst AS (
    SELECT c.relname||'.'||co.conname||':'||pg_get_constraintdef(co.oid,true) AS k
    FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
  ), def AS (
    SELECT c.relname||'.'||a.attname||':'||pg_get_expr(d.adbin,d.adrelid,true) AS k
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
    JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
  )
  SELECT jsonb_build_object(
    'policies',(SELECT jsonb_build_array(count(*),md5(string_agg(k,chr(92)||'n' ORDER BY k))) FROM policy),
    'functions',(SELECT jsonb_build_array(count(*),md5(string_agg(k,chr(92)||'n' ORDER BY k))) FROM func),
    'triggers',(SELECT jsonb_build_array(count(*),md5(string_agg(k,chr(92)||'n' ORDER BY k))) FROM trig),
    'indexes',(SELECT jsonb_build_array(count(*),md5(string_agg(k,chr(92)||'n' ORDER BY k))) FROM idx),
    'constraints',(SELECT jsonb_build_array(count(*),md5(string_agg(k,chr(92)||'n' ORDER BY k))) FROM cnst),
    'defaults',(SELECT jsonb_build_array(count(*),md5(string_agg(k,chr(92)||'n' ORDER BY k))) FROM def)
  ) INTO actual;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'QA catalog security/DDL fingerprints differ from verified production: %', actual;
  END IF;
END $qa_parity$;
