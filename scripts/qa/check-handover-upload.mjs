/**
 * WHO MAY LOAD A CLIENT'S ACCOUNTS, AND FOR WHICH CLIENTS (23 Oct).
 *
 * THE FIRM (Stephan): "any person in the client liaison department can upload a handover sheet" --
 * the sheet (a batch) and the single account (Add debtor). Holds:
 *
 *   - the rule: mayLoadAccountsFor -- the tick, then an Administrator any client, anybody else a client
 *     whose liaison is them or sits in their stored department; a client with no liaison is the
 *     Administrator's alone; null is nobody's department;
 *   - the database's twin, may_load_accounts(), arm for arm, and the four restrictive insert
 *     policies that ask it -- one per table the import and Add debtor write an account or a batch to;
 *   - the screens: both buttons on the client page ask the one rule, the upload lives outside
 *     Settings and IS the Settings card (one component, not a copy), the picker lists only the
 *     clients the person may load for, and Settings -> Data Import is still the Administrator's.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-handover-upload.mjs
 */
import { readFileSync } from 'node:fs'
import { loadableClients, mayLoadAccounts, mayLoadAccountsFor, uploadPathFor } from '../../src/lib/handoverUpload.ts'
import { ROLE_CAPABILITIES } from '../../src/lib/capabilities.ts'
import { DUTY_CAPABILITIES, DUTY_MAY_GRANT } from '../../src/lib/duties.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/* ---------------- the people ---------------- */
const COMMS = 'd-comms'
const CALL = 'd-call'
const ADMIN_D = 'd-admin'
const bonnitta = { id: 'liaison-1', role: 'Liaison', departmentId: COMMS }
const nicole = { id: 'liaison-mgr', role: 'Liaison Manager', departmentId: COMMS }
const stephan = { id: 'admin-1', role: 'Administrator', departmentId: ADMIN_D }
const nathi = { id: 'agent-1', role: 'Pre-legal Agent', departmentId: CALL }
const kamini = { id: 'rep-1', role: 'Sales Representative', departmentId: 'd-sales' }
const homeless = { id: 'liaison-2', role: 'Liaison', departmentId: undefined }
const homeless2 = { id: 'liaison-3', role: 'Liaison', departmentId: undefined }
const people = [bonnitta, nicole, stephan, nathi, kamini, homeless, homeless2]

const own = { id: 'c-own', accountOwnerId: bonnitta.id }
const colleagues = { id: 'c-col', accountOwnerId: nicole.id }
const outside = { id: 'c-out', accountOwnerId: stephan.id }
const salesOwned = { id: 'c-sales', accountOwnerId: kamini.id }
const nobodys = { id: 'c-none', accountOwnerId: undefined }
const homelessOwned = { id: 'c-homeless', accountOwnerId: homeless2.id }

/* ---------------- the tick ---------------- */
check('the two liaison roles and the Administrator are born with it',
  Object.keys(ROLE_CAPABILITIES).filter((r) => ROLE_CAPABILITIES[r].includes('handover.upload')).sort(),
  ['Administrator', 'Liaison', 'Liaison Manager'])
check('a pre-legal agent is not', mayLoadAccounts(nathi), false)
check('...nor a sales rep', mayLoadAccounts(kamini), false)
check('the department duty gives it', mayLoadAccounts({ ...nathi, duties: ['load_handovers'] }), true)
check('...and only it', [...DUTY_CAPABILITIES.load_handovers], ['handover.upload'])
ok('...because a duty may grant it', DUTY_MAY_GRANT.includes('handover.upload'))
check('a revoke beats the role', mayLoadAccounts({ ...bonnitta, revokes: ['handover.upload'] }), false)
check('a revoke beats the duty', mayLoadAccounts({ ...nathi, duties: ['load_handovers'], revokes: ['handover.upload'] }), false)
check('nobody signed in', mayLoadAccounts(null), false)

/* ---------------- which clients ---------------- */
check('a liaison: their own client', mayLoadAccountsFor(bonnitta, own, people), true)
check('...a department colleague\'s', mayLoadAccountsFor(bonnitta, colleagues, people), true)
check('...not a client whose liaison sits in Administration', mayLoadAccountsFor(bonnitta, outside, people), false)
check('...nor one a sales rep looks after', mayLoadAccountsFor(bonnitta, salesOwned, people), false)
check('...nor one with no liaison', mayLoadAccountsFor(bonnitta, nobodys, people), false)
check('the liaison manager: a liaison\'s client', mayLoadAccountsFor(nicole, own, people), true)
check('an Administrator: any client', [own, colleagues, outside, salesOwned, nobodys].every((c) => mayLoadAccountsFor(stephan, c, people)), true)
check('...unless the tick was taken away', mayLoadAccountsFor({ ...stephan, revokes: ['handover.upload'] }, own, people), false)
check('a pre-legal agent: nobody\'s client', [own, colleagues, outside, nobodys].some((c) => mayLoadAccountsFor(nathi, c, people)), false)
check('a pre-legal agent placed in Communications with the duty: the department\'s clients',
  mayLoadAccountsFor({ ...nathi, departmentId: COMMS, duties: ['load_handovers'] }, colleagues, people), true)
check('...and still not Administration\'s',
  mayLoadAccountsFor({ ...nathi, departmentId: COMMS, duties: ['load_handovers'] }, outside, people), false)
/* NULL IS NOBODY'S DEPARTMENT. Two people with none are not colleagues. */
check('two people with no department are not colleagues', mayLoadAccountsFor(homeless, homelessOwned, people), false)
check('...but a liaison with no department still loads their own', mayLoadAccountsFor(homeless2, homelessOwned, people), true)
check('a liaison not on the people list is nobody\'s colleague', mayLoadAccountsFor(bonnitta, { accountOwnerId: 'ghost' }, people), false)
check('no client, no load', mayLoadAccountsFor(bonnitta, null, people), false)
check('the picker: exactly the loadable ones',
  loadableClients(bonnitta, [own, colleagues, outside, salesOwned, nobodys], people).map((c) => c.id), ['c-own', 'c-col'])
check('the road out of Settings', uploadPathFor('abc'), '/companies/abc/upload')

/* ---------------- the database asks the same ---------------- */
const sql = read('supabase/schema.sql')
function lastFn(name) {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const open = sql.indexOf('$$', at)
  const close = sql.indexOf('$$', open + 2)
  return open < 0 || close < 0 ? '' : sql.slice(at, close + 2)
}
const fn = lastFn('may_load_accounts')
ok('may_load_accounts() is there', fn.length > 0)
ok('...asks the tick', /public\.has_capability\('handover\.upload'\)\s+and/.test(fn))
ok('...lets an Administrator load any client', /public\.current_user_role\(\) = 'Administrator'/.test(fn))
ok('...reads the client\'s liaison', /join public\.profiles liaison on liaison\.id = c\.account_owner_id/.test(fn))
ok('...as the signed-in person', /join public\.profiles me on me\.id = auth\.uid\(\)/.test(fn))
ok('...their own client', /liaison\.id = me\.id/.test(fn))
ok('...or a colleague\'s, where they HAVE a department',
  /me\.department_id is not null and liaison\.department_id = me\.department_id/.test(fn))
ok('...security invoker, with the search path set', /security invoker\s+set search_path to 'public'/.test(fn))
ok('...and not for anon', sql.includes('revoke all on function public.may_load_accounts(uuid) from public, anon;')
  && sql.includes('grant execute on function public.may_load_accounts(uuid) to authenticated;'))

/* EVERY TABLE A LOAD WRITES A BATCH OR AN ACCOUNT TO. Restrictive, so the existing permissive
   policies are narrowed and nothing else they allow is touched. */
for (const [table, expr] of [
  ['handovers', 'public.may_load_accounts(company_id)'],
  ['handover_drafts', 'public.may_load_accounts(company_id)'],
  ['debtor_accounts', 'public.may_load_accounts(company_id)'],
  ['handover_draft_rows', 'public.may_load_accounts(d.company_id)'],
]) {
  const m = new RegExp(`create policy ${table}_insert_may_load on public\\.${table}\\s+as restrictive for insert to authenticated\\s+with check \\(([\\s\\S]*?)\\);`).exec(sql)
  ok(`${table}: a restrictive insert policy`, !!m)
  ok(`...that asks may_load_accounts`, (m?.[1] ?? '').includes(expr))
}

/* ---------------- the screens ---------------- */
const detail = code('src/pages/companies/CompanyDetail.tsx')
ok('the client page asks the one rule', /const mayLoad = isClient && mayLoadAccountsFor\(currentUser, company, users\)/.test(detail))
ok('...for Upload a batch', /\{mayLoad && \(\s*<RecordAction icon=\{Upload\} label="Upload a batch"/.test(detail))
ok('...which goes outside Settings', /navigate\(uploadPathFor\(company\.id\)\)/.test(detail) && !/tab=Data\+Import/.test(detail))
ok('...and for Add debtor', /\{mayLoad && \(\s*<RecordAction icon=\{UserPlus\} label="Add debtor"/.test(detail))
ok('...and the Handover Book\'s own link', /onUpload=\{mayLoad \? \(\) => navigate\(uploadPathFor\(company\.id\)\) : undefined\}/.test(detail))
ok('...which draws nothing when it is not given', /action=\{onUpload && \(/.test(code('src/components/companies/HandoverBook.tsx')))
ok('...and the modal itself', /\{debtorOpen && mayLoad && \(/.test(detail))

const page = code('src/pages/companies/ClientUpload.tsx')
ok('the upload page draws the Settings card itself -- one component, not a copy',
  /<HandoverImportCard forCompanyId=\{id\} \/>/.test(page))
ok('...only for somebody who may load for this client', /\{client && allowed && <HandoverImportCard/.test(page)
  && /const allowed = mayLoadAccountsFor\(currentUser, client, users\)/.test(page))
ok('...and never the Swordfish import or the rest of Data Import', !/DataImportTab|Swordfish|LeadsImportCard/.test(page))
const app = code('src/App.tsx')
ok('the route is outside Settings, behind client access',
  /path="\/companies\/:id\/upload" element=\{<RequireClientAccess><ClientUpload \/><\/RequireClientAccess>\}/.test(app))

const card = code('src/components/settings/HandoverImportCard.tsx')
ok('the picker lists only loadable clients', /loadableClients\(currentUser, companies\.filter/.test(card))
ok('...and the queues are filtered to them for everyone but an Administrator',
  /isAdmin \? null : new Set\(clients\.map/.test(card) && /\.filter\(\(d\) => mine\(d\.companyId\)\)/.test(card)
  && /\.filter\(\(b\) => mine\(b\.companyId\)\)/.test(card))

const tab = code('src/components/settings/DataImportTab.tsx')
ok('Settings -> Data Import is still the Administrator\'s', /if \(!isAdmin\) \{\s*return \(/.test(tab)
  && /const isAdmin = currentUser\?\.role === 'Administrator'/.test(tab))
ok('...and still draws the same card', /<HandoverImportCard forCompanyId=\{forCompanyId\} \/>/.test(tab))

console.log(`\ncheck-handover-upload: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
