-- Diagnostic hashes only; does not expose function source or any user data.
SELECT 'INDEX|'||indexname||'|'||md5(indexdef) AS item
FROM pg_indexes WHERE schemaname='public'
UNION ALL
SELECT 'DEFAULT|'||c.relname||'.'||a.attname||'|'||md5(pg_get_expr(d.adbin,d.adrelid,true))
FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
UNION ALL
SELECT 'FUNCDEF|'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||'|'||
md5(regexp_replace(lower(pg_get_functiondef(p.oid)),'[[:space:]]+','','g'))
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
UNION ALL
SELECT 'STORAGEPOLICY|'||tablename||'.'||policyname||':'||cmd||':'||array_to_string(roles,',')||'|'||
md5(tablename||'.'||policyname||':'||cmd||':'||array_to_string(roles,',')||':'||
coalesce(qual,'')||':'||coalesce(with_check,''))
FROM pg_policies WHERE schemaname='storage'
ORDER BY item;
