-- Read-only catalogue export for an empty, isolated QA branch. No application rows.
select jsonb_build_object(
  'enums', (select jsonb_agg(format('CREATE TYPE public.%I AS ENUM (%s);', t.typname,
    (select string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid)) order by t.typname)
    from pg_type t where t.typnamespace='public'::regnamespace and t.typtype='e'),
  'tables', (select jsonb_agg(jsonb_build_object('name', c.relname, 'sql',
    format('CREATE TABLE IF NOT EXISTS public.%I (%s);', c.relname,
      (select string_agg(format('%I %s%s%s', a.attname, format_type(a.atttypid,a.atttypmod),
        case when d.adbin is not null then ' DEFAULT ' || pg_get_expr(d.adbin,d.adrelid) else '' end,
        case when a.attnotnull then ' NOT NULL' else '' end), ', ' order by a.attnum)
       from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
       where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)),
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'replicaIdentity',c.relreplident) order by c.relname)
    from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'),
  'constraints', (select jsonb_agg(jsonb_build_object('type',co.contype,'sql',
    format('ALTER TABLE public.%I ADD CONSTRAINT %I %s;', c.relname,co.conname,pg_get_constraintdef(co.oid,true)))
    order by case when co.contype='f' then 1 else 0 end,c.relname,co.conname)
    from pg_constraint co join pg_class c on c.oid=co.conrelid where c.relnamespace='public'::regnamespace),
  'indexes', (select jsonb_agg(pg_get_indexdef(i.indexrelid) || ';' order by i.indexrelid::regclass::text)
    from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace='public'::regnamespace
    and not exists(select 1 from pg_constraint co where co.conindid=i.indexrelid)),
  'functions', (select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'sql',pg_get_functiondef(p.oid),
    'acl',p.proacl::text) order by p.proname,p.oid) from pg_proc p where p.pronamespace='public'::regnamespace),
  'views', (select jsonb_agg(jsonb_build_object('name',c.relname,'options',c.reloptions,
    'sql',format('CREATE OR REPLACE VIEW public.%I%s AS %s;',c.relname,
      case when c.reloptions is null then '' else ' WITH (' || array_to_string(c.reloptions,', ') || ')' end,
      pg_get_viewdef(c.oid,true))) order by c.relname)
    from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='v'),
  'triggers', (select jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'functionSchema',pn.nspname,
    'sql',pg_get_triggerdef(t.oid,true)||';','enabled',t.tgenabled) order by c.relname,t.tgname)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
    join pg_namespace pn on pn.oid=p.pronamespace where c.relnamespace='public'::regnamespace and not t.tgisinternal),
  'policies', (select jsonb_agg(format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
    policyname,schemaname,tablename,permissive,cmd,
    (select string_agg(case when r='public' then 'PUBLIC' else quote_ident(r) end,', ') from unnest(roles) r),
    case when qual is null then '' else ' USING ('||qual||')' end,
    case when with_check is null then '' else ' WITH CHECK ('||with_check||')' end)
    order by schemaname,tablename,policyname) from pg_policies where schemaname in ('public','storage')),
  'tableGrants', (select jsonb_agg(format('GRANT %s ON TABLE public.%I TO %s%s;',a.privilege_type,c.relname,
    case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,
    case when a.is_grantable then ' WITH GRANT OPTION' else '' end) order by c.relname,a.grantee,a.privilege_type)
    from pg_class c cross join lateral aclexplode(c.relacl) a where c.relnamespace='public'::regnamespace and c.relkind in ('r','v')),
  'columnGrants', (select jsonb_agg(format('GRANT %s (%I) ON TABLE public.%I TO %s%s;',a.privilege_type,at.attname,c.relname,
    case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,
    case when a.is_grantable then ' WITH GRANT OPTION' else '' end))
    from pg_class c join pg_attribute at on at.attrelid=c.oid cross join lateral aclexplode(at.attacl) a
    where c.relnamespace='public'::regnamespace and at.attnum>0 and not at.attisdropped),
  'functionGrants', (select jsonb_agg(format('GRANT %s ON FUNCTION %s TO %s%s;',a.privilege_type,p.oid::regprocedure::text,
    case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,
    case when a.is_grantable then ' WITH GRANT OPTION' else '' end))
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.pronamespace='public'::regnamespace),
  'realtime', (select jsonb_agg(tablename order by tablename) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'),
  'buckets', (select jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) order by id) from storage.buckets)
) as baseline;
