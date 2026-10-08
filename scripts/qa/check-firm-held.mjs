/**
 * THE FIRM'S SHARE OF THE TRUST, BY WHAT IT IS: "BF funds held: Commission + Fees + VAT = total".
 *
 * WHAT THIS HOLDS:
 *
 *   1. EVERY KIND OF FIRM ENTRY LANDS ON A LINE. firm_held_parts routes the firm's ledger entries by
 *      firm_entry_kind. A kind the classifier learns and this function does not would fall out of
 *      every line while still being in `held` -- the lines would stop adding up, silently. So every
 *      kind the classifier can return is held against the function, LAST definitions, comments
 *      stripped (HANDOFF section 6).
 *   2. A RECEIPT SPLITS BY ITS OWN ALLOCATION, and whatever its four parts do not account for goes to
 *      "other", so the parts sum to the ledger.
 *   3. `held` IS THE SAME SUM trust_position CALLS owed_to_firm: every firm entry, nothing filtered.
 *   4. ONLY FOR THE TRUST TICK, and as no row rather than a row of zeroes (HAVING, not WHERE).
 *   5. THE LINES ADD UP on the screen, in cents.
 *
 * Proved on staging in a rolled-back transaction: commission 10 661.75 + fees 5 315.80 + VAT
 * 1 599.32 + interest 6 593.49 less bank charges 115.00 = 24 055.36 = trust_position's owed_to_firm;
 * anon got no row.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-firm-held.mjs
 */
import { readFileSync } from 'node:fs'
import { FIRM_HELD_LINES, firmHeldLines, firmHeldSum, toFirmHeld } from '../../src/lib/firmHeld.ts'

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
const liveFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return strip(m?.[2] ?? '')
}

const fn = liveFn('firm_held_parts')
ok('firm_held_parts exists', fn.length > 0)

/* ---------------- 1. every kind lands on a line ---------------- */

const kinds = [...new Set([...liveFn('firm_entry_kind').matchAll(/then '(\w+)'/g)].map((m) => m[1]))]
ok('the classifier still names its kinds', kinds.length >= 7)
const elseKind = /else '(\w+)'/.exec(liveFn('firm_entry_kind'))?.[1]
for (const k of [...kinds, elseKind]) {
  ok(`a "${k}" entry lands on a line`, fn.includes(`kind = '${k}'`))
}

/* ---------------- 2. a receipt splits by its own allocation ---------------- */

ok('the split reads the entry\'s own allocation', /left join public\.payment_allocations a on a\.id = e\.allocation_id/.test(fn))
for (const col of ['commission', 'commission_vat', 'to_costs', 'to_interest']) {
  ok(`...by ${col}`, fn.includes(`coalesce(a.${col}, 0)`))
}
ok('...and whatever the four miss goes to other', /sum\(amount - \(i \+ c \+ cm \+ v\)\)/.test(fn))
ok('...as does a receipt with no allocation to split by', /kind = 'other' or \(kind = 'earned' and alloc_id is null\)/.test(fn))

/* ---------------- 3. held is trust_position's firm sum ---------------- */

ok('held is every firm entry, nothing filtered', /coalesce\(sum\(amount\), 0\)\s+from firm/.test(fn))
ok('...over the firm\'s entries only', /where e\.party = 'firm'/.test(fn))
ok('trust_position reads the firm the same way', /filter \(where party = 'firm'\)/.test(liveFn('trust_position')))

/* ---------------- 4. only for the trust tick ---------------- */

ok('it asks finance.view', /having public\.has_capability\('finance\.view'\)/.test(fn))
check('...in a HAVING, so a refusal is no row rather than zeroes', /where public\.has_capability/.test(fn), false)
ok('it is revoked from public and anon', sql.includes('revoke all on function public.firm_held_parts() from public, anon;'))

/* ---------------- 5. the lines add up ---------------- */

const row = toFirmHeld({ commission: '10661.75', commission_vat: '1599.32', costs: '5315.80', interest: '6593.49',
  charges_recovered: 0, credit_taken: 0, bank_interest: 0, other: '0.00', bank_charges: '-115.00', paid_in: 0,
  drawn: 0, held: '24055.36' })
check('staging\'s figures add up to its held', firmHeldSum(row), 24055.36)
check('...and the firm\'s three are drawn even at nil, the rest only when not',
  firmHeldLines({ ...row, commission: 0 }).map((l) => l.key),
  ['commission', 'costs', 'commissionVat', 'interest', 'bankCharges'])
check('the firm\'s three come first, in its order',
  FIRM_HELD_LINES.slice(0, 3).map((l) => l.label), ['Commission', 'Fees and costs', 'VAT on commission'])
const cents = toFirmHeld({ commission: 0.1, commission_vat: 0.2, held: 0.3 })
check('summed in cents, so 0.1 + 0.2 is 0.3', firmHeldSum(cents), 0.3)
check('every part the database returns is a line',
  FIRM_HELD_LINES.map((l) => l.key).sort(),
  Object.keys(toFirmHeld({})).filter((k) => k !== 'held').sort())
const drawn = toFirmHeld({ commission: 1000, drawn: -400, held: 600 })
check('a drawing is its own line, taken off the whole', firmHeldSum(drawn), 600)
ok('...and says so', /share as a whole/.test(FIRM_HELD_LINES.find((l) => l.key === 'drawn').note))

/* ---------------- the page ---------------- */

const page = strip(read('src/pages/trust/TrustOverview.tsx'))
ok('the overview draws the split', /<FirmHeldCard held=\{firmHeld\} owedToFirm=\{position\.owedToFirm\} \/>/.test(page))
ok('...and says so when it does not tie to the firm\'s row', /\{!ties && \(/.test(page))
ok('...and a failed read leaves the rest of the page standing', /fetchFirmHeld\(\)\.catch\(\(\) => null\)/.test(page))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-firm-held: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
