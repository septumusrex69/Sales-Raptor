with
ext as (select objid from pg_depend where deptype='e'),
n as (select v from (values ('public'),('storage')) t(v)),
rel as (select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl from pg_class c
        where c.relnamespace='public'::regnamespace and c.oid not in (select objid from ext)),
nb as (select p.oid, p.proname, p.oid::regprocedure::text sig, p.prosrc, p.prosecdef, p.provolatile, p.proconfig, p.proacl,
              pg_get_function_result(p.oid) res, p.prokind
       from pg_proc p where p.pronamespace='public'::regnamespace and p.oid not in (select objid from ext)),
items(k, v) as (
  select 'rel:'||relname, relkind::text||'|rls='||relrowsecurity||'|force='||relforcerowsecurity from rel where relkind in ('r','p','v','m','S')
  union all select 'acl:'||relname, coalesce((select string_agg(x::text, ',' order by x::text) from unnest(relacl) x),'-') from rel where relkind in ('r','p','v','m','S')
  union all select 'col:'||r.relname||'.'||a.attname, format_type(a.atttypid,a.atttypmod)||'|nn='||a.attnotnull||'|def='||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||'|gen='||a.attgenerated::text||'|id='||a.attidentity::text
     from rel r join pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=r.oid and d.adnum=a.attnum where r.relkind in ('r','p','v','m')
  union all select 'con:'||r.relname||'.'||c.conname, pg_get_constraintdef(c.oid) from pg_constraint c join rel r on r.oid=c.conrelid
  union all select 'idx:'||i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid) from pg_index i join rel r on r.oid=i.indrelid
  union all select 'trg:'||c.relname||'.'||t.tgname, pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid
     where not t.tgisinternal and (c.relnamespace in ('public'::regnamespace,'storage'::regnamespace) or c.oid='auth.users'::regclass)
  union all select 'pol:'||p.schemaname||'.'||p.tablename||'.'||p.policyname, p.cmd||'|'||p.permissive||'|'||array_to_string(p.roles,',')||'|'||coalesce(p.qual,'')||'|'||coalesce(p.with_check,'')
     from pg_policies p where p.schemaname in ('public','storage')
  union all select 'view:'||relname, md5(pg_get_viewdef(oid)) from rel where relkind in ('v','m')
  union all select 'fn:'||sig, md5(regexp_replace(regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g'), '\s+', '', 'g'))||'|sd='||prosecdef||'|vol='||provolatile::text||'|cfg='||coalesce(array_to_string(proconfig,','),'')||'|res='||res||'|k='||prokind::text from nb
  union all select 'fnacl:'||sig, coalesce((select string_agg(x::text, ',' order by x::text) from unnest(proacl) x),'-') from nb
  union all select 'type:'||t.typname, t.typtype::text||'|'||coalesce((select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid=t.oid),'')
     from pg_type t where t.typnamespace='public'::regnamespace and t.typtype in ('e','d') and t.oid not in (select objid from ext)
  union all select 'bucket:'||id, public||'|'||coalesce(file_size_limit::text,'')||'|'||coalesce(array_to_string(allowed_mime_types,','),'') from storage.buckets
  union all select 'ext:'||extname, '1' from pg_extension
  union all select 'pub:'||pubname||'.'||schemaname||'.'||tablename, '1' from pg_publication_tables
  union all select 'nsacl:public', coalesce((select string_agg(x::text, ',' order by x::text) from unnest(nspacl) x),'-') from pg_namespace where nspname='public'
  union all select 'defacl:'||defaclrole::regrole||'.'||defaclobjtype::text, (select string_agg(x::text, ',' order by x::text) from unnest(defaclacl) x) from pg_default_acl where defaclnamespace='public'::regnamespace
)
