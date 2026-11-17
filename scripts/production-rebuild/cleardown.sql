  -- Everything Raptor made in public, and nothing an extension owns. The schema itself stays, so its default
  -- privileges (anon/authenticated/service_role grants on new objects) stay with it.
  for rr in select c.oid, c.relname, c.relkind from pg_class c where c.relnamespace = 'public'::regnamespace
             and c.relkind in ('v','m') and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    execute format('drop %s if exists public.%I cascade', case rr.relkind when 'v' then 'view' else 'materialized view' end, rr.relname);
  end loop;
  for rr in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
             and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    execute format('drop table if exists public.%I cascade', rr.relname);
  end loop;
  for rr in select p.oid::regprocedure::text sig, p.prokind from pg_proc p where p.pronamespace = 'public'::regnamespace
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('drop %s if exists %s cascade', case rr.prokind when 'p' then 'procedure' when 'a' then 'aggregate' else 'function' end, rr.sig);
  end loop;
  for rr in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
             and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    execute format('drop sequence if exists public.%I cascade', rr.relname);
  end loop;
  for rr in select t.typname from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype in ('e','c','d') and t.typrelid = 0 or (t.typnamespace = 'public'::regnamespace and t.typtype='c' and exists (select 1 from pg_class c where c.oid=t.typrelid and c.relkind='c'))
             loop
    begin execute format('drop type if exists public.%I cascade', rr.typname); exception when others then null; end;
  end loop;
