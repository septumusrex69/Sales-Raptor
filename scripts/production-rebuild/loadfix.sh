#!/bin/bash
# loadfix.sh: put fix.json's prelude (negative i) and fix-up (100000+) into _rebuild.stmts
HERE=$(cd "$(dirname "$0")" && pwd)
S=${REBUILD_DIR:?set REBUILD_DIR to a private work folder (never inside the repo)}; cd "$S"
python3 - <<'PY'
import os
import json
S=os.environ['REBUILD_DIR']
f=json.load(open(S+'/fix.json'))
rows=[(-len(f['pre'])+k, s) for k,s in enumerate(f['pre'])]+[(100000+k, s) for k,s in enumerate(f['post'])]
j=json.dumps(rows); assert '$zzq$' not in j
open(S+'/loadfix.sql','w').write(f"delete from _rebuild.stmts where i < 1 or i >= 100000; insert into _rebuild.stmts select (e->>0)::int, e->>1 from json_array_elements($zzq${j}$zzq$::json) e;")
PY
"$HERE"/q.sh qcvesjzoiznrvunjrqpv loadfix.sql; echo
