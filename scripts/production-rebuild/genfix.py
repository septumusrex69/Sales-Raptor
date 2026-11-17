# Builds the fix-up statements (run after the schema.sql replay, same transaction) from staging's catalogue.
import os
import json, re
S=os.environ['REBUILD_DIR']
st=json.load(open(S+'/fp-staging.json')); pr=json.load(open(S+'/dry-result.json'))['fp']
det=json.load(open(S+'/staging-details.json')); fns=json.load(open(S+'/staging-fns.json'))
qi=lambda s: '"%s"'%s.replace('"','""') if not re.fullmatch(r'[a-z_][a-z0-9_]*',s) else s
cols={(c['t'],c['c']):c for c in det['cols']}
rels={r['name']:r for r in det['rels']}
pre=[
 # Staging's default privileges in public, so objects made from here on are granted as staging's are.
 "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role",
 "alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role",
 "alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role",
]
post=[]
only_s=[k for k in st if k not in pr]; only_p=[k for k in pr if k not in st]; differ=[k for k in st if k in pr and st[k]!=pr[k]]
# 1. tables missing entirely
for k in only_s:
    if k.startswith('rel:'):
        t=k[4:]; cs=sorted([c for c in det['cols'] if c['t']==t], key=lambda c:c['num'])
        body=',\n  '.join(f"{qi(c['c'])} {c['type']}"+(f" default {c['def']}" if c['def'] else '')+(' not null' if c['nn'] else '') for c in cs)
        post.append(f"create table public.{qi(t)} (\n  {body}\n)")
        if rels[t]['rls']: post.append(f"alter table public.{qi(t)} enable row level security")
newtables={k[4:] for k in only_s if k.startswith('rel:')}
# 2. columns missing / different
for k in only_s:
    if k.startswith('col:'):
        t,c=k[4:].split('.',1)
        if t in newtables: continue
        x=cols[(t,c)]
        post.append(f"alter table public.{qi(t)} add column if not exists {qi(c)} {x['type']}"+(f" default {x['def']}" if x['def'] else '')+(' not null' if x['nn'] else ''))
for k in differ:
    if k.startswith('col:'):
        t,c=k[4:].split('.',1); x=cols[(t,c)]; T=f"alter table public.{qi(t)} alter column {qi(c)}"
        if pr[k].split('|')[0]!=st[k].split('|')[0]: post.append(f"{T} type {x['type']}")
        post.append(f"{T} set default {x['def']}" if x['def'] else f"{T} drop default")
        post.append(f"{T} set not null" if x['nn'] else f"{T} drop not null")
# 3. functions
for k in only_s+differ:
    if k.startswith('fn:'):
        sig=k[3:]
        if k in differ: post.append(f"drop function public.{sig}")
        post.append(fns[sig])
# 4. constraints: production-only and different ones dropped, missing and different ones added (PKs/uniques before FKs)
for k in only_p+differ:
    if k.startswith('con:'):
        t,c=k[4:].split('.',1); post.append(f"alter table public.{qi(t)} drop constraint if exists {qi(c)}")
cons=[k for k in only_s+differ if k.startswith('con:')]
cons.sort(key=lambda k: 1 if st[k].startswith('FOREIGN KEY') else 0)
for k in cons:
    t,c=k[4:].split('.',1); post.append(f"alter table public.{qi(t)} add constraint {qi(c)} {st[k]}")
# 5. indexes (a constraint's own index is made by the constraint)
for k in only_s:
    if k.startswith('idx:'):
        name=k[4:]
        if any(kk.startswith('con:') and kk.endswith('.'+name) for kk in only_s): continue
        post.append(st[k])
# 6. triggers
for k in only_s:
    if k.startswith('trg:'): post.append(st[k])
# 7. policies
for p in det['pol']:
    key=f"pol:{p['schema']}.{p['table']}.{p['name']}"
    if key in only_s or key in differ:
        if key in differ: post.append(f"drop policy if exists {qi(p['name'])} on {p['schema']}.{qi(p['table'])}")
        s=f"create policy {qi(p['name'])} on {p['schema']}.{qi(p['table'])} as {p['permissive'].lower()} for {p['cmd'].lower()} to {', '.join(p['roles'])}"
        if p['qual']: s+=f" using ({p['qual']})"
        if p['with_check']: s+=f" with check ({p['with_check']})"
        post.append(s)
# 8. grants: every table and function whose grants differ is reset to exactly staging's
def acl_stmts(kind, obj, acl):
    out=[f"revoke all on {kind} {obj} from public, anon, authenticated, service_role"]
    for item in acl or []:
        grantee, rest = item.split('=',1); privs=rest.split('/')[0].replace('*','')
        if grantee=='postgres': continue
        who='public' if grantee=='' else grantee
        if kind=='function': out.append(f"grant execute on function {obj} to {who}")
        else:
            m={'a':'insert','r':'select','w':'update','d':'delete','D':'truncate','x':'references','t':'trigger','m':'maintain','U':'usage'}
            names=[m[ch] for ch in privs if ch in m]
            if names: out.append(f"grant {', '.join(names)} on {'sequence' if kind=='sequence' else 'table'} {obj.replace('table ','')} to {who}")
    return out
for k in only_s+differ:
    if k.startswith('acl:'):
        r=rels[k[4:]]; kind='sequence' if r['kind']=='S' else 'table'
        post+=acl_stmts(kind, f"public.{qi(r['name'])}", r['acl'])
fa={f['sig']:f['acl'] for f in det['fnacl']}
for k in only_s+differ:
    if k.startswith('fnacl:'):
        sig=k[6:]; acl=fa[sig]
        if acl is None: post.append(f"grant execute on function public.{sig} to public"); continue
        post+=acl_stmts('function', f"public.{sig}", acl)
handled={'rel','col','fn','con','idx','trg','pol','acl','fnacl','defacl'}
left=[k for k in only_s+only_p+differ if k.split(':')[0] not in handled]
print('pre',len(pre),'post',len(post),'unhandled',left)
json.dump({'pre':pre,'post':post},open(S+'/fix.json','w'))
