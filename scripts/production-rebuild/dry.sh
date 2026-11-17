#!/bin/bash
HERE=$(cd "$(dirname "$0")" && pwd)
S=${REBUILD_DIR:?set REBUILD_DIR to a private work folder (never inside the repo)}; cd "$S"
"$HERE"/gen.sh dry; "$HERE"/q.sh qcvesjzoiznrvunjrqpv run-dry.sql > dry.json
python3 - <<'PY'
import os
import json
S=os.environ['REBUILD_DIR']
m=json.load(open(S+'/dry.json'))['message']
if 'DRYRUN' not in m: print(m[:2000]); raise SystemExit(1)
d=json.loads(m[m.index('DRYRUN')+6:m.rindex('}')+1])
json.dump(d,open(S+'/dry-result.json','w'))
print('errors', len(d['errors']))
for e in d['errors']: print(' ', e['i'],'|',e['msg'][:110],'|',e['q'][:90])
st=json.load(open(S+'/fp-staging.json')); pr=d['fp']; st.update(json.load(open(S+'/fp-staging-cron.json')) or {}); pr.update(d['cron'] or {})
only_s=sorted(k for k in st if k not in pr); only_p=sorted(k for k in pr if k not in st); diff=sorted(k for k in st if k in pr and st[k]!=pr[k])
json.dump({'only_staging':only_s,'only_prod':only_p,'differ':diff},open(S+'/diff.json','w'),indent=1)
from collections import Counter
for name,l in (('only on staging',only_s),('only on production',only_p),('different',diff)):
    print(name, len(l), dict(Counter(k.split(':')[0] for k in l)))
PY
