#!/bin/bash
# reload.sh: re-split schema.sql and refill _rebuild.stmts on production
HERE=$(cd "$(dirname "$0")" && pwd)
S=${REBUILD_DIR:?set REBUILD_DIR to a private work folder (never inside the repo)}; cd "$S"
node "$HERE"/split.mjs "${1:-$HERE/../../supabase/schema.sql}" > stmts.json || exit 1
rm -f load-*.sql
python3 - <<'PY'
import os
import json
S=os.environ['REBUILD_DIR']
st=json.load(open(S+'/stmts.json'))
chunks=[];cur=[];size=0;start=1
for k,s in enumerate(st,1):
    if size+len(s)>400000 and cur: chunks.append((start,cur));cur=[];size=0;start=k
    cur.append(s);size+=len(s)
chunks.append((start,cur))
for n,(start,c) in enumerate(chunks):
    j=json.dumps(c); assert '$zzq$' not in j
    open(f'{S}/load-{n:02d}.sql','w').write(f"insert into _rebuild.stmts select ord+{start-1}, value from json_array_elements_text($zzq${j}$zzq$::json) with ordinality t(value,ord);")
PY
echo "truncate _rebuild.stmts" > t.sql; "$HERE"/q.sh qcvesjzoiznrvunjrqpv t.sql >/dev/null
for f in load-*.sql; do r=$("$HERE"/q.sh qcvesjzoiznrvunjrqpv $f); [ "$r" = "[]" ] || echo "$f $r"; done
echo "select count(*) n from _rebuild.stmts" > c.sql; "$HERE"/q.sh qcvesjzoiznrvunjrqpv c.sql; echo
