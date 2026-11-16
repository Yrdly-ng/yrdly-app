-- Read-only QA schema fingerprint report, no user data.
WITH
policy AS (SELECT tablename||'.'||policyname||':'||cmd||':'||array_to_string(roles,',')||':'||permissive||':'||coalesce(qual,'')||':'||coalesce(with_check,'') AS k FROM pg_policies WHERE schemaname='public'),
func AS (SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||regexp_replace(lower(pg_get_functiondef(p.oid)),'[[:space:]]+','','g') AS k FROM pg_proc p WHERE p.pronamespace='public'::regnamespace),
trig AS (SELECT c.relname||'.'||t.tgname||':'||pg_get_triggerdef(t.oid,true) AS k FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public'),
idx AS (SELECT indexname||':'||indexdef AS k FROM pg_indexes WHERE schemaname='public'),
cnst AS (SELECT c.relname||'.'||co.conname||':'||pg_get_constraintdef(co.oid,true) AS k FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
def AS (SELECT c.relname||'.'||a.attname||':'||pg_get_expr(d.adbin,d.adrelid,true) AS k FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
SELECT 'SCHEMA_FINGERPRINT|'||jsonb_build_object(
'policies',(SELECT jsonb_build_array(count(*),md5(string_agg(k,chr(92)||'n' ORDER BY k))) FROM policy),
'functions',(SELECT jsonb_build_array(count(*),md5(string_agg(k,chr(92)||'n' ORDER BY k))) FROM func),
'triggers',(SELECT jsonb_build_array(count(*),md5(string_agg(k,chr(92)||'n' ORDER BY k))) FROM trig),
'indexes',(SELECT jsonb_build_array(count(*),md5(string_agg(k,chr(92)||'n' ORDER BY k))) FROM idx),
'constraints',(SELECT jsonb_build_array(count(*),md5(string_agg(k,chr(92)||'n' ORDER BY k))) FROM cnst),
'defaults',(SELECT jsonb_build_array(count(*),md5(string_agg(k,chr(92)||'n' ORDER BY k))) FROM def)
)::text AS schema_fingerprint;
