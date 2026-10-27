/**
 * TWO KINDS OF ADMINISTRATOR: WITH FINANCE AND WITHOUT (S14, 27 Oct).
 *
 * Stephan: "administrators that can access finances and ones that can't." One role; an Administrator
 * without finance has the finance capabilities revoked, and cannot give them back -- to anybody, or to
 * themselves -- nor reach somebody who has them through their login (email) or by removing them.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-admin-finance.mjs
 */
import { readFileSync } from 'node:fs'
import { FINANCE_CAPABILITIES, hasFinanceAccess, mayChangeCapability } from '../../src/lib/capabilities.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const full = { id: 's', role: 'Administrator', grants: [], revokes: [] }
const without = { id: 'r', role: 'Administrator', grants: ['marketing.send'], revokes: [...FINANCE_CAPABILITIES] }
check('an Administrator has finance; one with it revoked does not', [hasFinanceAccess(full), hasFinanceAccess(without)].join(), 'true,false')
check('with finance, anything may be changed on anybody', [mayChangeCapability(full, { id: 'x' }, 'finance.view'), mayChangeCapability(full, { id: 's' }, 'finance.view')].join(), 'true,true')
check('without, finance may not be changed on anybody, nor anything on yourself',
  [mayChangeCapability(without, { id: 'x' }, 'finance.view'), mayChangeCapability(without, { id: 'x' }, 'people.pay'),
   mayChangeCapability(without, { id: 'r' }, 'marketing.send'), mayChangeCapability(without, { id: 'x' }, 'marketing.send')].join(), 'false,false,false,true')

const schema = read('supabase/schema.sql')
const sqlSet = /select array\['finance\.view', 'business\.view', 'business\.income', 'people\.pay',\s*'payment\.approve', 'payment\.reverse', 'payment\.move'\]/.test(
  schema.slice(schema.lastIndexOf('create or replace function public.finance_capabilities(')))
check('the screen and the database name the same finance set', sqlSet, true)
const guard = schema.slice(schema.lastIndexOf('create or replace function public.protect_profile_privileged_fields('))
check('the database refuses it, loudly', [
  /if not public\.has_capability\('finance\.view'\) then/.test(guard),
  /new\.id = auth\.uid\(\) and \(new\.role is distinct from old\.role or new\.grants is distinct from old\.grants\s*or new\.revokes is distinct from old\.revokes or new\.department_id is distinct from old\.department_id\)/.test(guard),
  /public\.finance_held\(new\.role, new\.grants, new\.revokes, new\.department_id\)\s*is distinct from public\.finance_held\(old\.role, old\.grants, old\.revokes, old\.department_id\)/.test(guard),
  (guard.match(/raise exception/g) ?? []).length >= 2,
].join(), 'true,true,true,true')

check('the server routes hold the same line', [
  /financeRefusal\(admin, callerData\.user\.id, userId, 'change the login email of'\)/.test(read('api/update-user-email.ts')),
  /financeRefusal\(admin, callerData\.user\.id, userId, 'remove'\)/.test(read('api/delete-user.ts')),
  /const withoutFinance = role === 'Administrator' && !\(await hasFinance\(admin, caller\.id\)\)/.test(read('api/invite-user.ts'))
    && /if \(withoutFinance\) patch\.revokes = FINANCE_CAPABILITIES/.test(read('api/invite-user.ts')),
].join(), 'true,true,true')
const apiSet = /export const FINANCE_CAPABILITIES = \['finance\.view', 'business\.view', 'business\.income', 'people\.pay',\s*'payment\.approve', 'payment\.reverse', 'payment\.move'\]/.test(read('api/_lib/auth.ts'))
check('...with the same finance set', apiSet, true)
check('the Users list names the Administrators with finance General Manager', /u\.role === 'Administrator' && hasFinanceAccess\(u\) && \([\s\S]{0,300}General Manager/.test(read('src/pages/settings/SettingsPage.tsx')), true)

if (failures.length) {
  console.log(`check-admin-finance: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-admin-finance: ${pass} passed, 0 failed`)
