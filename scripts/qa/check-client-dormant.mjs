/**
 * DORMANT CLIENTS, AND THE CLIENTS WAITING FOR A LIAISON HANDLED IN BULK (S11).
 *
 * THE FIRM (24-25 Oct): "There are also clients that are dormant ... not using our services or not
 * interested in using our services anymore" -- and, of the Swordfish clients with no liaison, "you
 * should be able to do something with them in bulk ... assign them in bulk, or leave us dormant."
 *
 * Held here: the rule (src/lib/clientDormant.ts), the Swordfish import marking the register's
 * dormant clients dormant, the database waking a client when an account arrives, the assign route
 * taking many clients with one notification, and the screens that offer it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-dormant.mjs
 */
import { readFileSync } from 'node:fs'
import {
  activePatch, dormantInRegister, dormantLine, dormantPatch, isDormant, mayChangeDormancy, SWORDFISH_DORMANT_REASON,
} from '../../src/lib/clientDormant.ts'
import { buildImportPlan } from '../../src/lib/swordfishImport.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

/* ---------- the rule ---------- */
ok('an Administrator, Sales Manager or Liaison Manager may change it',
  ['Administrator', 'Sales Manager', 'Liaison Manager'].every((role) => mayChangeDormancy({ id: 'x', role }, { accountOwnerId: 'y' })))
ok('...and the client\'s own liaison', mayChangeDormancy({ id: 'y', role: 'Liaison' }, { accountOwnerId: 'y' }))
ok('...not another liaison, a rep or an agent', !mayChangeDormancy({ id: 'z', role: 'Liaison' }, { accountOwnerId: 'y' })
  && !mayChangeDormancy({ id: 'z', role: 'Sales Representative' }, { accountOwnerId: 'y' })
  && !mayChangeDormancy({ id: 'z', role: 'Pre-legal Agent' }, { accountOwnerId: 'y' }))
ok('Swordfish\'s word is read case- and space-blind', dormantInRegister(' dormant ') && dormantInRegister('Dormant') && !dormantInRegister('Active') && !dormantInRegister(null))
const mark = dormantPatch('  Not interested any more ', 'me', '2026-10-25T08:00:00Z')
check('marking says when, why and who, and asks nobody for a liaison', mark,
  { dormant_at: '2026-10-25T08:00:00Z', dormant_reason: 'Not interested any more', dormant_by: 'me', liaison_needed: false })
check('...an empty reason is no reason, not an empty string', dormantPatch('  ', 'me', 't').dormant_reason, null)
check('waking clears all three, and asks for a liaison where the caller says so', activePatch(true),
  { dormant_at: null, dormant_reason: null, dormant_by: null, liaison_needed: true })
ok('a client is dormant exactly when dormant_at is set', isDormant({ dormantAt: 't' }) && !isDormant({ dormantAt: null }) && !isDormant({}))
ok('the line says since when, by whom and why', /^Dormant since .+, marked by Nicole -- Not interested\.$/.test(dormantLine({ dormantAt: '2026-10-25T08:00:00Z', dormantReason: 'Not interested' }, 'Nicole')))

/* ---------- the Swordfish import ---------- */
const reg = (client, regNo, status, assigned = '') => ({ 'Client': client, 'COMPANY REG/ID': regNo, 'Prefix': client.slice(0, 3).toUpperCase(),
  'PERCENTAGE': '20', 'Assigned To': assigned, 'Active / Dormant': status })
const plan = buildImportPlan({ accounts: [], payments: [], actions: [], interest: [], clients: [
  reg('Sleepy Client', 'D1', 'Dormant'), reg('Awake Client', 'A1', 'Active'),
] }, { ownerId: 'placeholder', clerks: [], now: new Date('2026-10-25T08:00:00Z') })
const by = new Map(plan.companies.map((c) => [c.name, c]))
check('a client the register calls dormant arrives dormant, and needs no liaison',
  [!!by.get('Sleepy Client')?.dormant_at, by.get('Sleepy Client')?.dormant_reason, by.get('Sleepy Client')?.liaison_needed], [true, SWORDFISH_DORMANT_REASON, false])
check('...an active one with nobody on staff still needs one', [by.get('Awake Client')?.dormant_at, by.get('Awake Client')?.liaison_needed], [null, true])
ok('...and the plan says how many came in dormant', plan.notes.some((n) => /^1 client is dormant in the register/.test(n)))

/* ---------- the database: a new account wakes it ---------- */
const schema = read('supabase/schema.sql')
ok('the three columns exist', ['dormant_at timestamptz', 'dormant_reason text', 'dormant_by uuid']
  .every((c) => schema.includes(`alter table public.companies add column if not exists ${c}`)))
const at = schema.lastIndexOf('create or replace function public.client_wakes_on_account(')
const fn = at === -1 ? '' : schema.slice(at, schema.indexOf('$$;', schema.indexOf('$$', at) + 2))
ok('a new account wakes a dormant client', /set dormant_at = null, dormant_reason = null, dormant_by = null/.test(fn) && /c\.dormant_at is not null/.test(fn))
ok('...and asks for a liaison where its owner is not one', /liaison_needed = not exists/.test(fn) && /role in \('Liaison', 'Liaison Manager'\)/.test(fn))
ok('...on every account opened, batch or by hand', /create or replace trigger client_wakes_on_account\s+after insert on public\.debtor_accounts/.test(schema))

/* ---------- the assign route: many clients, one bell ---------- */
const route = code('api/_lib/email/assignLiaison.ts')
ok('the route takes many clients', /companyIds/.test(route) && /\.in\('id', ids\)/.test(route))
ok('...each assigned client is no longer dormant', /dormant_at: null, dormant_reason: null, dormant_by: null/.test(route))
ok('...an imported one gets no welcome tasks', /if \(!imported\) \{[\s\S]*?Send welcome email/.test(route) && /const imported = !!company\.import_batch_id/.test(route))
ok('...and she gets ONE notification, however many', (route.match(/from\('notifications'\)\.insert/g) ?? []).length === 1
  && route.indexOf("from('notifications').insert") > route.indexOf('for (const company of companies)')
  && /if \(assigned > 0\) \{\s*const only/.test(route))

/* ---------- the screens ---------- */
const panel = code('src/components/companies/NeedsLiaisonPanel.tsx')
ok('the panel lists clients needing a liaison, not dormant ones', /c\.liaisonNeeded && !isDormant\(c\)/.test(panel))
ok('...assigns the ticked ones in one call', /body: JSON\.stringify\(\{ companyIds: chosen\.map\(\(c\) => c\.id\), liaisonId: pick \}\)/.test(panel))
ok('...and marks them dormant in one write, for the roles the policy allows',
  /from\('companies'\)\.update\(patch\)\.in\('id', chosen\.map/.test(panel) && /\['Administrator', 'Sales Manager', 'Liaison Manager'\]\.includes\(role\)/.test(panel))
const list = code('src/pages/companies/CompaniesList.tsx')
ok('the clients list draws the panel', /<NeedsLiaisonPanel \/>/.test(list))
ok('...and keeps dormant clients on their own shelf', /isDormant\(c\) === \(shelf === 'dormant'\)/.test(list))
const importTab = code('src/components/settings/DataImportTab.tsx')
ok('the Swordfish import ends on the same panel ("we can do it in the import")', /\{done && <NeedsLiaisonPanel \/>\}/.test(importTab)
  && /void refreshSyncedData\(\)\s*const r = plan\.receipts/.test(importTab))
const page = code('src/pages/companies/CompanyDetail.tsx')
ok('the client page says it and offers Make active', /<ClientDormancy company=\{company\} \/>/.test(page)
  && /Make active/.test(read('src/components/companies/ClientDormancy.tsx')))

console.log(`\ncheck-client-dormant: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
