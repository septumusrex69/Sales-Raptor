/**
 * THE BUSINESS WORKSPACE'S INCOME AND DRAWINGS: each rand counted once, and behind the right ticks.
 *
 * WHAT THIS HOLDS, and why each is a money question rather than a display one:
 *
 *   1. ONE CLASSIFIER, AND ITS PREFIXES ARE THE WRITERS' OWN. firm_entry_kind sorts the firm's trust
 *      ledger entries by their reason text. A writer that rewords its reason without the classifier
 *      following would drop a drawing into "earned" -- so every prefix is held against the function
 *      that writes it, LAST definition, comments stripped (HANDOFF section 6).
 *   2. A CHARGE IS COUNTED WHEN RAISED, NOT AGAIN WHEN RECOVERED. business_month counted a charge set
 *      off against a payover in `earned` AND in `invoiced`, so `made` had it twice; and it called a
 *      parked credit given back to a debtor a drawing. Both fixed; both held here.
 *   3. INCOME IS business.income, WHICH NO ROLE HAS. The firm: "not even for an administrator".
 *   4. A DRAWING NEEDS BOTH TICKS, trust and business, at the firm's ruling -- in SQL and in the
 *      predicate that draws the button, so it is never offered and refused.
 *   5. THREE READERS OF THE FIRM'S BALANCE, ONE SUM: trust_position, business_month and the
 *      ceiling in draw_from_trust.
 *   6. THE PARTS ADD TO THE TOTAL on the screen.
 *
 * What the database DOES with real rows was proved on staging in a rolled-back transaction: a R1 000
 * receipt split R115 + R177 + R26.55 = R318.55, the ledger entry to the cent; with R7 credit, R115
 * charges and R3 unclassified, Income totalled R443.55 = earned + invoiced on the overview.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-business-income.mjs
 */
import { readFileSync } from 'node:fs'
import { INCOME_PARTS, incomeTotals, toIncomeRow } from '../../src/lib/businessIncome.ts'
import { CAPABILITIES, ROLE_CAPABILITIES } from '../../src/lib/capabilities.ts'
import { canDrawFromTrust, canViewIncome } from '../../src/lib/permissions.ts'

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

const sql = read('supabase/schema.sql')
/* THE LAST DEFINITION, anchored on the full phrase -- a bare name lands on a grant or a comment. */
const liveFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const rest = sql.slice(at)
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(rest)
  return strip(m?.[2] ?? '')
}

/* ---------------- 1. the classifier, against its writers ---------------- */

const kind = liveFn('firm_entry_kind')
ok('the classifier exists', kind.length > 0)
const WRITERS = [
  { prefix: 'Drawn to the business account - ', writer: 'draw_from_trust', as: 'drawing' },
  { prefix: 'Charges recovered from payover ', writer: 'trust_creditors_on_run', as: 'charge_recovered' },
  { prefix: 'Fees, interest and commission earned', writer: 'trust_creditors_on_allocation', as: 'earned' },
  { prefix: 'Parked credit taken to the firm', writer: 'take_parked_credit', as: 'credit' },
  { prefix: 'Parked credit returned to the debtor', writer: 'return_parked_credit', as: 'credit' },
]
for (const w of WRITERS) {
  ok(`${w.writer} still writes "${w.prefix.trim()}"`, liveFn(w.writer).includes(`'${w.prefix}`))
  ok(`...and the classifier calls it ${w.as}`,
    new RegExp(`like '${w.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}%'[^\\n]*\\n?[^\\n]*then '${w.as}'`).test(kind))
}

/* ---------------- 2. each rand once ---------------- */

const month = liveFn('business_month')
ok('business_month: earned leaves out drawings and charge recoveries',
  /firm_entry_kind\(reason\) not in \('drawing', 'charge_recovered'\)/.test(month))
ok('...drawn is the drawings and nothing else', /-sum\(amount\) filter \(where public\.firm_entry_kind\(reason\) = 'drawing'\)/.test(month))
/* THE OLD SHAPE, which counted every negative entry as a drawing and every positive one as earned. */
check('...and no longer sorts by sign', /filter \(where amount [<>] 0\)/.test(month), false)
ok('...and still counts charges when raised', /from public\.client_charges/.test(month))

const income = liveFn('business_income')
ok('business_income leaves out drawings and charge recoveries', /kind not in \('drawing', 'charge_recovered'\)/.test(income))
ok('...splits a receipt by the allocation it was built from',
  /left join public\.payment_allocations a on a\.id = e\.allocation_id/.test(income))
/* THE FOUR PARTS ARE THE FOUR trust_creditors_on_allocation ADDS UP -- if it ever adds a fifth,
   this list is where the split goes wrong, so they are held against each other. */
const alloc = liveFn('trust_creditors_on_allocation')
for (const col of ['to_interest', 'to_costs', 'commission', 'commission_vat']) {
  ok(`the ledger entry is built from ${col}`, alloc.includes(`new.${col}`))
  ok(`...and Income splits by it`, income.includes(`coalesce(${col}, 0)`))
}
ok('...and whatever the split misses goes to other, so the parts always sum to the ledger',
  /amount - \(coalesce\(to_interest, 0\) \+ coalesce\(to_costs, 0\)/.test(income))
ok('...and charges come from client_charges, once', /from public\.client_charges c/.test(income))

/* ---------------- 3. income is a tick nobody is born with ---------------- */

ok('business_income asks business.income', /has_capability\('business\.income'\)/.test(income))
ok('business.income is a capability the database enforces', CAPABILITIES['business.income']?.inDatabase === true)
check('...held by no role -- "not even for an administrator"',
  Object.entries(ROLE_CAPABILITIES).filter(([, c]) => c.includes('business.income')).map(([r]) => r), [])
check('an Administrator does not see Income', canViewIncome({ role: 'Administrator' }), false)
ok('...until given it', canViewIncome({ role: 'Administrator', grants: ['business.income'] }))

/* ---------------- 4. a drawing needs both ticks ---------------- */

const draw = liveFn('draw_from_trust')
ok('draw_from_trust asks both ticks',
  /has_capability\('finance\.view'\) and public\.has_capability\('business\.view'\)/.test(draw))
ok('...and still refuses more than the firm holds', /if p_amount > v_held then/.test(draw))
ok('the button asks both too', canDrawFromTrust({ role: 'Administrator' }))
check('...and is withheld with the trust tick taken away',
  canDrawFromTrust({ role: 'Administrator', revokes: ['finance.view'] }), false)
check('...or the business tick', canDrawFromTrust({ role: 'Administrator', revokes: ['business.view'] }), false)
ok('business_drawings asks business.view', /has_capability\('business\.view'\)/.test(liveFn('business_drawings')))

/* ---------------- 5. three readers, one sum ---------------- */

ok('trust_position reads the firm as its ledger sum', /filter \(where party = 'firm'\)/.test(liveFn('trust_position')))
ok('business_month reads the same', /select coalesce\(sum\(amount\), 0\) as bal from public\.trust_creditor_entries where party = 'firm'/.test(month))
ok('draw_from_trust\'s ceiling reads the same', /from public\.trust_creditor_entries\s+where party = 'firm'/.test(draw))

/* ---------------- not reachable by anon ---------------- */

for (const sig of ['firm_entry_kind(text)', 'draw_from_trust(numeric, text, uuid)', 'business_month(date, date)',
  'business_drawings(date, date)', 'business_income(date, date)']) {
  ok(`${sig} is revoked from public and anon`, sql.includes(`revoke all on function public.${sig} from public, anon;`))
}

/* ---------------- 6. the parts add up on the screen ---------------- */

const fields = ['interest', 'costs', 'commission', 'commissionVat', 'creditTaken', 'chargesRaised', 'other']
check('every part of an income row is drawn', INCOME_PARTS.map((p) => p.key).sort(), [...fields].sort())
const rows = [
  toIncomeRow({ company_id: 'a', company_name: 'A', interest: 0, costs: 115, commission: 177, commission_vat: 26.55,
    credit_taken: 7, charges_raised: 115, other: 3, total: 443.55 }),
  toIncomeRow({ company_id: 'b', company_name: 'B', interest: 10, costs: 0, commission: 0, commission_vat: 0,
    credit_taken: 0, charges_raised: 0, other: 0, total: 10 }),
]
const t = incomeTotals(rows)
check('the totals add each part across clients', t.commission, 177)
check('...and the total is the sum of the totals', Math.round(t.total * 100) / 100, 453.55)
check('...which is the sum of the parts',
  Math.round(fields.reduce((s, f) => s + t[f], 0) * 100) / 100, Math.round(t.total * 100) / 100)

/* ---------------- the pages ---------------- */

const app = read('src/App.tsx')
const layout = strip(read('src/pages/business/BusinessLayout.tsx'))
const drawings = strip(read('src/pages/business/BusinessDrawings.tsx'))
ok('Income is behind RequireIncome', /path="income" element=\{<RequireIncome><BusinessIncome \/><\/RequireIncome>\}/.test(app))
ok('...and listed only for whoever may open it', /canViewIncome\(currentUser\) \? \[/.test(layout))
ok('Drawings is routed', /path="drawings" element=\{<BusinessDrawings \/>\}/.test(app))
ok('...and the button is drawn off both ticks', /const mayDraw = canDrawFromTrust\(currentUser\)/.test(drawings)
  && /\{mayDraw && \(/.test(drawings))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-business-income: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
