#!/bin/bash
# gen.sh dry|real -> run-<mode>.sql : cleardown, replay _rebuild.stmts, then
#   dry : raise with {errors, fingerprint, cron} so everything rolls back
#   real: raise only if an error is not on the allow-list _rebuild.allowed (stmt index + message prefix)
HERE=$(cd "$(dirname "$0")" && pwd)
S=${REBUILD_DIR:?set REBUILD_DIR to a private work folder (never inside the repo)}; cd "$S"; mode=$1
{ echo "create temp table _e(i int, msg text, q text);"
  echo 'do $run$ declare rr record; fpj json; cronj json; begin'
  echo "  set local check_function_bodies = off;"
  cat "$HERE"/cleardown.sql
  cat <<'X'
  for rr in select * from _rebuild.stmts order by i loop
    begin execute rr.q; exception when others then insert into _e values (rr.i, sqlerrm, left(regexp_replace(rr.q, '\s+', ' ', 'g'), 160)); end;
  end loop;
X
  if [ $mode = dry ]; then
    cat "$HERE"/fp-body.sql; echo "  select json_object_agg(k, v) into fpj from items;"
    echo "  execute \$c\$select json_object_agg('cron:'||jobname, schedule||'|'||md5(command)||'|'||active) from cron.job\$c\$ into cronj;"
    echo "  create temp table _n(t text, n bigint); for rr in select tablename from pg_tables where schemaname='public' loop execute format('insert into _n select %L, count(*) from public.%I', rr.tablename, rr.tablename); end loop;"
    echo "  raise exception 'DRYRUN%', json_build_object('errors', (select coalesce(json_agg(e order by i),'[]') from _e e), 'fp', fpj, 'cron', cronj, 'rows', (select json_object_agg(t, n) from _n where n > 0))::text;"
  else
    echo "  if exists (select 1 from _e e where not exists (select 1 from _rebuild.allowed a where a.i = e.i and e.msg like a.msg || '%')) then"
    echo "    raise exception 'ABORTED %', (select json_agg(e order by i) from _e e where not exists (select 1 from _rebuild.allowed a where a.i = e.i and e.msg like a.msg || '%'))::text; end if;"
  fi
  echo 'end $run$;'
} > run-$mode.sql
