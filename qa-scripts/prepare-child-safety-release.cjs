// Prepares a selected production release; never executes SQL or changes old history.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const names = [
  '20261026170603_enforce_account_suspension_in_active_sessions',
  '20261026170833_add_audited_account_moderation_actions',
  '20261026180520_enable_reported_child_safety_post_takedowns',
];
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
const originals = names.map((name) => fs.readFileSync(path.join('supabase/migrations', name + '.sql'), 'utf8'));
const bodies = originals.map((sql) => {
  const body = sql.replace(/^BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
  if (/^(?:BEGIN|COMMIT|ROLLBACK);\s*$/im.test(body)) throw new Error('Unexpected transaction boundary');
  return body;
});
const preflight = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtext('yrdly-child-safety-release-20261026'));
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
  IF md5(pg_get_functiondef('public.is_current_session_active()'::regprocedure)) <> '5ad2af658c0a9b4d87b3d476e1aacf10' THEN
    RAISE EXCEPTION 'Session gate differs from reviewed production definition';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN (${names.map((name) => literal(name.slice(0, 14))).join(',')})) THEN
    RAISE EXCEPTION 'Selected migration already recorded';
  END IF;
  IF to_regclass('public.account_moderation_actions') IS NOT NULL OR to_regclass('public.content_moderation_actions') IS NOT NULL
    OR to_regprocedure('public.admin_set_account_moderation(uuid,uuid,text,text,uuid)') IS NOT NULL
    OR to_regprocedure('public.admin_hide_child_safety_reported_post(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Selected moderation objects already exist';
  END IF;
END $preflight$;
`;
const assertions = `
DO $verify$
DECLARE role_name text; table_name text; function_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH table_name IN ARRAY ARRAY['public.account_moderation_actions','public.content_moderation_actions'] LOOP
      IF has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE') THEN
        RAISE EXCEPTION 'Unexpected client audit table access: %, %',role_name,table_name;
      END IF;
      IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=table_name::regclass) THEN
        RAISE EXCEPTION 'Audit table RLS missing';
      END IF;
    END LOOP;
    FOREACH function_name IN ARRAY ARRAY['public.admin_set_account_moderation(uuid,uuid,text,text,uuid)','public.admin_hide_child_safety_reported_post(uuid,uuid)'] LOOP
      IF has_function_privilege(role_name,function_name,'EXECUTE') THEN
        RAISE EXCEPTION 'Unexpected client RPC execution';
      END IF;
      IF NOT has_function_privilege('service_role',function_name,'EXECUTE') THEN
        RAISE EXCEPTION 'Service execution missing';
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  BEGIN
    PERFORM public.admin_set_account_moderation(NULL,NULL,'ban','release check',NULL);
    RAISE EXCEPTION 'Account RPC accepted non-service caller';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.admin_hide_child_safety_reported_post(NULL,NULL);
    RAISE EXCEPTION 'Post RPC accepted non-service caller';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF public.is_current_session_active() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Missing session unexpectedly active';
  END IF;
END $verify$;
`;
const history = names.map((name, index) => `INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES (${literal(name.slice(0,14))},${literal(name.slice(15))},ARRAY[${literal(originals[index])}]::text[]);`).join('\n');
const sql = preflight + bodies.join('\n') + assertions + history + "\nNOTIFY pgrst, 'reload schema';\n";
fs.mkdirSync('.qa-artifacts', { recursive: true });
fs.writeFileSync('.qa-artifacts/child-safety-release-rehearsal.sql', sql + 'ROLLBACK;\n');
fs.writeFileSync('.qa-artifacts/child-safety-release-apply.sql', sql + 'COMMIT;\n');
console.log(JSON.stringify(names.map((name,index) => ({name,sha256:crypto.createHash('sha256').update(originals[index]).digest('hex')})),null,2));
