-- Read-only QA-only inventory. Output identifiers only, never data or secrets.
SELECT 'POLICY|'||tablename||'.'||policyname||':'||cmd||':'||array_to_string(roles,',') AS item
FROM pg_policies WHERE schemaname='public'
UNION ALL
SELECT 'FUNCTION|'||proname||'('||pg_get_function_identity_arguments(p.oid)||')'||':'||
CASE WHEN prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS item
FROM pg_proc p WHERE pronamespace='public'::regnamespace
ORDER BY item;
