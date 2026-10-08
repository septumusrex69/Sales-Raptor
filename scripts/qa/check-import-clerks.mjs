/**
 * AN IMPORTED ACCOUNT GOES TO ITS SWORDFISH CLERK, A NAME RAPTOR DOES NOT KNOW IS FLAGGED, AND
 * MONEY NO DESK HELD STILL COUNTS AS THE FIRM'S.
 *
 * THE FIRM, 8 October, after a company dashboard read R 0 with R 57 900 received:
 *   - "when an account is imported, it should go automatically to its swordfish clerk."
 *   - "when there's a user that is not recognized ... it should flag it ... specifically valuable
 *     for old clerks that have already left the firm, or if we forget to upload their details."
 *   - money that arrives before anyone has the account "goes to the firm".
 *
 * WHAT THIS HOLDS:
 *   1. The import matches "Assigned To" to an ACTIVE user on the whole name (case and spaces
 *      ignored) and to nobody on a first name alone; the diary entry follows the account.
 *   2. Unknown and inactive clerks are problems, counted per name; "(None)" is not a clerk.
 *      People named on actions who are not users are noted, their history kept under their name.
 *   3. The desk trigger dates an imported account WITH a clerk from its handover date, on the
 *      firm's clock; everything else from now().
 *   4. collector_performance carries the unheld money as one no-user row, and the browser keeps it
 *      out of the people and in the firm's total -- and out of a team's.
 *
 * Proved on staging in rolled-back probes: an imported account with a clerk dated 2024-05-06
 * 00:00 SAST, by hand and without a clerk now(); collector_performance for 11 Sep - 10 Oct
 * returned NOBODY = R 58 300 / 42 payments.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-import-clerks.mjs
 */
import { readFileSync } from 'node:fs'
import { buildImportPlan, clerkKey } from '../../src/lib/swordfishImport.ts'
import { splitUncredited } from '../../src/lib/collectorScore.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/^\s*\/\/.*$/gm, '')

/* ---------------- 1 and 2: the import ---------------- */

const VUSI = '00000000-0000-0000-0000-0000000000a1'
const ITU = '00000000-0000-0000-0000-0000000000a2'
const GONE = '00000000-0000-0000-0000-0000000000a3'
const clerks = [
  { id: VUSI, name: 'Vusi Maringa', active: true },
  { id: ITU, name: 'Itumeleng', active: true },
  { id: GONE, name: 'Old Clerk', active: false },
]
const acct = (ref, clerk, extra = {}) => ({
  'Client': 'Clerk Test Client', 'Client Prefix': 'CTC', 'Swordfish Reference': ref,
  'Capital on Default': '1000', 'Surname': 'Debtor', 'Load Date': '2024-05-06',
  'Current Interest Rate': '0', 'Assigned To': clerk, ...extra,
})
const plan = buildImportPlan(
  {
    accounts: [
      acct('CTC/1', 'Vusi  MARINGA', { 'Diary Date': '2026-10-12' }),
      acct('CTC/2', 'Ruben Liebenberg', { 'Diary Date': '2026-10-12' }),
      acct('CTC/3', 'Ruben Liebenberg'),
      acct('CTC/4', 'Itumeleng Masalesa'),
      acct('CTC/5', 'Old Clerk'),
      acct('CTC/6', '(None)'),
    ],
    payments: [],
    actions: [
      { 'Swordfish Reference': 'CTC/1', 'Action Date': '2026-09-01', 'Action Name': 'Note', 'User': 'Departed Person' },
      { 'Swordfish Reference': 'CTC/1', 'Action Date': '2026-09-02', 'Action Name': 'Note', 'User': 'Vusi Maringa' },
    ],
    interest: [],
  },
  { ownerId: '00000000-0000-0000-0000-000000000001', now: new Date('2026-10-08T08:00:00Z'), clerks },
)
const desk = Object.fromEntries(plan.debtorAccounts.map((a) => [a.swordfish_reference ?? a.account_number, a.assigned_to]))
const byRef = (ref) => plan.debtorAccounts.find((a) => Object.values(a).includes(ref))
check('six accounts imported', plan.debtorAccounts.length, 6)
check('Vusi\'s account is on Vusi\'s desk, case and spaces ignored', byRef('CTC/1')?.assigned_to, VUSI)
check('...and so is its diary entry',
  plan.diaryEntries.find((d) => d.account_id === byRef('CTC/1')?.id)?.owner_id, VUSI)
check('an unknown clerk\'s account is unassigned', byRef('CTC/2')?.assigned_to, null)
check('...and so is its diary entry', plan.diaryEntries.find((d) => d.account_id === byRef('CTC/2')?.id)?.owner_id, null)
check('...with the clerk\'s name kept', byRef('CTC/2')?.swordfish_assigned_to, 'Ruben Liebenberg')
check('a first name alone is not a match', byRef('CTC/4')?.assigned_to, null)
check('an inactive user is not given the account', byRef('CTC/5')?.assigned_to, null)
check('"(None)" is nobody', byRef('CTC/6')?.assigned_to, null)
check('the whole-name key ignores case and runs of spaces', clerkKey('  Leanette  Mathebe '), 'leanette mathebe')
void desk

const problems = plan.problems.join('\n')
ok('unknown clerks are flagged, counted per name',
  /3 accounts are with 2 Swordfish clerks who are not a Raptor user: Ruben Liebenberg \(2\), Itumeleng Masalesa \(1\)/.test(problems))
ok('an inactive user is flagged apart', /1 account is with a clerk whose Raptor user is no longer active: Old Clerk \(1\)/.test(problems))
check('"(None)" is not flagged', /\(None\)/.test(problems), false)
ok('the matched ones are counted in the notes', plan.notes.some((n) => /^1 account went to the clerk Swordfish had it with/.test(n)))
ok('a person on an action who is not a user is noted, history kept',
  plan.notes.some((n) => /Actions name 1 person who is not a Raptor user: Departed Person\. Their history is kept under their name/.test(n)))
ok('...and the action keeps their name', plan.fees.some((f) => f.performed_by === 'Departed Person'))

const tab = strip(read('src/components/settings/DataImportTab.tsx'))
ok('the import screen hands the plan every user, with whether they are active',
  /clerks: users\.map\(\(u\) => \(\{ id: u\.id, name: u\.name, active: u\.status === 'Active' \}\)\)/.test(tab))

/* ---------------- 3: the desk trigger ---------------- */

const sql = read('supabase/schema.sql')
const liveFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return strip(m?.[2] ?? '')
}
const trig = liveFn('record_account_desk_change')
ok('an imported account with a clerk is theirs from its handover date',
  /tg_op = 'INSERT' and new\.import_batch_id is not null\s+and new\.assigned_to is not null and new\.handover_date is not null\s+then least\(now\(\), new\.handover_date::timestamp at time zone 'Africa\/Johannesburg'\)/.test(trig))
ok('...and every other change from now()', /else now\(\) end/.test(trig))
ok('...and a move to or from nobody is still recorded', /new\.assigned_to is distinct from old\.assigned_to/.test(trig))

/* ---------------- 4: money no desk held ---------------- */

const perf = liveFn('collector_performance')
ok('the people are still only credited what they held', /and h\.user_id is not null/.test(perf))
ok('the unheld money comes back as one row with no user',
  /union all\s+select null::uuid, 0, 0::numeric, coalesce\(sum\(p\.amount\), 0\), count\(\*\)::integer/.test(perf))
ok('...for exactly the payments no desk held', /\) h on true[\s\S]*?and h\.user_id is null/.test(perf))
ok('...reversed payments still excluded', (perf.match(/p\.reversed_at is null/g) ?? []).length >= 2)
ok('...and no row at all when there is none', /having count\(\*\) > 0/.test(perf))

const rows = [
  { userId: VUSI, collected: 1000, payments: 2 },
  { userId: null, collected: 500, payments: 1 },
  { userId: ITU, collected: 0, payments: 0 },
]
const split = splitUncredited(rows)
check('the no-user row leaves the people', split.rows.map((r) => r.userId), [VUSI, ITU])
check('...and is the firm\'s', split.uncredited, { collected: 500, payments: 1 })
check('nothing unheld is nil, not missing', splitUncredited([rows[0]]).uncredited, { collected: 0, payments: 0 })

const hook = strip(read('src/hooks/useCollectionsMonth.ts'))
ok('the month reads the people and the unheld money apart', /fetchCollectionsPeriod\(period\.start, asAtEnd\)/.test(hook))
ok('...adds the unheld money only to the whole firm', /const firmWide = !teamId/.test(hook)
  && /firmWide \? unheld\[i\]/.test(hook))
ok('...to the period', /withUnheld\(totalStats\(shownRows\), unheldOf\(0\)\)/.test(hook))
ok('...to the day', /\+ unheldOf\(1\)\.collected/.test(hook))
ok('...and to the day it is compared with', /\+ unheldOf\(3\)\.collected/.test(hook))
ok('...and says how much of the total it is', /uncredited: unheldOf\(0\)\.collected/.test(hook))
const hero = strip(read('src/components/collections/CollectionsHero.tsx'))
ok('the hero says so under the period\'s total', /not on anybody’s desk/.test(hero))
const stats = strip(read('src/lib/collectorStats.ts'))
ok('every list of people is read through the split',
  /return \(await fetchCollectionsPeriod\(from, to\)\)\.rows/.test(stats))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-import-clerks: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
