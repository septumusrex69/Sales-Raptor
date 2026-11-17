# The rows production keeps, put back after the rebuild: teams, people (with staging's role and ticks), mailbox
import os
# connections, BuzzBox. Only columns both the old row and the new table have; the rest take their defaults.
import json
S=os.environ['REBUILD_DIR']
det=json.load(open(S+'/staging-details.json'))
newcols={}
for c in det['cols']: newcols.setdefault(c['t'],set()).add(c['c'])
sp={p['email']:p for p in json.load(open(S+'/staging-profiles.json'))}
out=[]
for t in ['teams','profiles','email_connections','buzzbox_settings']:
    rows=json.load(open(f'{S}/prod-backup/{t}.json'))
    if t=='profiles':
        for r in rows:
            s=sp.get(r['email'].lower())
            if s:
                for k in ('role','grants','revokes','collector_grade'): r[k]=s[k]
    cols=sorted(set().union(*[r.keys() for r in rows]) & newcols[t])
    dropped=sorted(set().union(*[r.keys() for r in rows]) - newcols[t])
    j=json.dumps(rows); assert '$r$' not in j
    cl=', '.join(f'"{c}"' for c in cols)
    if t=='teams':
        # A team now belongs to a department; production's one team is a Sales team (kind 'Sales').
        out.append(f"insert into public.teams ({cl}, department_id) select {cl}, (select id from public.departments where name = 'Sales') from jsonb_populate_recordset(null::public.teams, $r${j}$r$::jsonb)")
    else:
        out.append(f"insert into public.{t} ({cl}) select {cl} from jsonb_populate_recordset(null::public.{t}, $r${j}$r$::jsonb)")
    print(t, len(rows), 'rows; columns not carried:', dropped)
out.append("insert into public.deployment (id, kind) values (true, 'production') on conflict (id) do update set kind = 'production'")
out.append("do $$ begin if (select kind from public.deployment) is distinct from 'production' then raise exception 'deployment is not production'; end if; end $$")
json.dump(out, open(S+'/restore.json','w'))
