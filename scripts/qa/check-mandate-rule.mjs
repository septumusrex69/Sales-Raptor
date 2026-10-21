/**
 * PROMPT 10: A SWORDFISH CLIENT TAKES HANDOVERS WITHOUT A MANDATE DATE; A RAPTOR CLIENT DOES NOT.
 *
 * "No mandate, no handover" lived only in the browser, and it refused clients the Swordfish
 * import brought across -- clients with a book already with the firm -- because Swordfish's
 * register leaves "Sign Date" empty for many of them. The rule now:
 *   companies.import_batch_id is not null  -> no mandate date or document needed
 *   created in Raptor                      -> still needs the date, exactly as before
 * held in the browser (mandateRule.ts) and in the database (a trigger on the batch row), so it is
 * not weakened in one place only. And NOTHING about commission moves: three engine functions read
 * mandate_signed_at to decide which capital a sliding scale counts, and they must stay as they were.
 *
 * Proved on staging in a rolled-back transaction: Summit Fitness with its date cleared took a batch;
 * a client made by hand with no date was refused by name; given a date, it was accepted.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mandate-rule.mjs
 */
import { readFileSync } from 'node:fs'
import { needsMandate, fromSwordfish } from '../../src/lib/mandateRule.ts'

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

/* ---------------- the rule ---------------- */

check('a Raptor client with no date needs a mandate', needsMandate({ importBatchId: null, mandateSignedAt: undefined }), true)
check('...and with a date does not', needsMandate({ importBatchId: null, mandateSignedAt: '2026-01-01' }), false)
check('a Swordfish client with no date does not', needsMandate({ importBatchId: 'b1', mandateSignedAt: undefined }), false)
check('...nor with one', needsMandate({ importBatchId: 'b1', mandateSignedAt: '2024-01-01' }), false)
check('no client chosen is not a refusal', needsMandate(null), false)
ok('a Swordfish client is known by its import batch', fromSwordfish({ importBatchId: 'b1' }))

/* ---------------- the database ---------------- */

const sql = read('supabase/schema.sql')
const liveFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return strip(m?.[2] ?? '')
}
ok('the database decides it the same way',
  /c\.import_batch_id is null and c\.mandate_signed_at is null/.test(liveFn('client_needs_mandate')))
const trig = liveFn('refuse_handover_without_mandate')
ok('the batch row refuses a client that needs one', /public\.client_needs_mandate\(new\.company_id\)/.test(trig))
ok('...but never a batch the Swordfish import itself writes', /new\.import_batch_id is null and/.test(trig))
ok('...and it fires on every new batch',
  /create or replace trigger handovers_need_a_mandate\s+before insert on public\.handovers/.test(sql))

/* COMMISSION UNTOUCHED: the three readers of mandate_signed_at still read it, unconditionally. */
for (const fn of ['allocate_payment', 'preview_allocation', 'expected_from_promises']) {
  const body = liveFn(fn)
  ok(`${fn} still counts a scale's capital from the mandate date`, /a\.computed_at >= v_mandate/.test(body))
  check(`...without asking where the client came from`, /import_batch_id/.test(body), false)
}

/* ---------------- the screens ---------------- */

const card = strip(read('src/components/settings/HandoverImportCard.tsx'))
ok('the import screen asks the shared rule', /const noMandate = needsMandate\(client\)/.test(card))
check('...and no longer reads the date alone', /!client\.mandateSignedAt/.test(card), false)
const mandate = read('src/components/companies/MandateCard.tsx')
ok('the Mandate card says a Swordfish client needs none',
  mandate.includes('Brought across from Swordfish: no mandate needed for handovers.'))
ok('...in the branch for a Swordfish client', /fromSwordfish\(company\) \? \(/.test(strip(mandate)))
ok('...and still says "No mandate on record" for anybody else', mandate.includes('No mandate on record, so no handover can be imported'))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-mandate-rule: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
