-- Every foreign key in public, one row per key, in the shape scripts/qa/schemaForeignKeys.mjs reads
-- out of schema.sql: from>to:confdeltype (a no action, r restrict, c cascade, n set null). Run it on
-- staging and compare with the file's reading when a check that depends on it surprises you.
select count(*) as keys,
       string_agg(f, ' ' order by f) as pairs
  from (select distinct conrelid::regclass::text || '>' || confrelid::regclass::text || ':' || confdeltype::text as f
          from pg_constraint
         where contype = 'f' and connamespace = 'public'::regnamespace
           and confrelid::regclass::text not like '%.%') k;
