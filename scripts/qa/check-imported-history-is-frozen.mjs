/**
 * IMPORTED HISTORY IS FROZEN AT WHAT WAS IMPORTED.
 *
 * THE FIRM, and this is law rather than preference: "what we import, the data has to stay exactly
 * like that, because we can't change the remittances that has already been passed." Swordfish's
 * figures are what the client was INVOICED on, so they are the record -- not our arithmetic about
 * what they should have been. CLAUDE.md states the consequence plainly: "Recalculating an
 * imported fee or commission against a current schedule rewrites an invoice a client has already
 * paid."
 *
 * THE RULE HAS TWO HALVES AND ONLY ONE WAS GUARDED. The import already counted `commissionDrift`,
 * so a check that asserted the REPORTING survived the very mutation the rule is about: swapping
 * `commission_rate: billedRate` for `commission_rate: expected ?? billedRate` writes the computed
 * mandate rate over what the client was actually billed, and left the whole suite green -- 11 202
 * checks -- because drift was still being counted. Silent in exactly the way the rule warns about.
 *
 * SO THIS EXERCISES THE IMPORT rather than reading the source. A regex over `commission_rate:` can
 * be satisfied by the wrong expression as easily as the right one; running the plan cannot.
 *
 * THE FIXTURE IS REAL. ABSTO Industrial Supplies is in swordfishClients.ts with BOTH a signed
 * mandate (commissionBands) and what Swordfish billed (commissionByPrefix), and on a R5 000
 * capital they disagree: billed 15%, mandate 21%. That disagreement is the whole point -- on a
 * client where the two match, every arrangement of this code passes.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-imported-history-is-frozen.mjs
 */
import { buildImportPlan } from '../../src/lib/swordfishImport.ts'
import { SWORDFISH_CLIENTS } from '../../src/lib/swordfishClients.ts'
import { rateForCapital } from '../../src/lib/commission.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------------- the client where the mandate and the invoice disagree ---------------- */

function* walk(specs) { for (const s of specs) { yield s; if (s.children) yield* walk(s.children) } }
const spec = [...walk(SWORDFISH_CLIENTS)].find((s) => s.name === 'ABSTO Industrial Supplies (Pty) Ltd')

ok('the fixture client is still in the register', !!spec)
ok('...with a signed mandate on file', !!spec?.commissionBands)
ok('...and with what Swordfish actually billed', !!spec?.commissionByPrefix)

const PREFIX = 'AIS2'
const CAPITAL = 5000
const billed = spec?.commissionByPrefix?.[PREFIX]
const expected = spec?.commissionBands
  ? rateForCapital(CAPITAL, { source: spec.commissionBands.source, bands: spec.commissionBands.bands })
  : undefined

check('Swordfish billed 15% on this prefix', billed, 0.15)
check('...while the mandate calls for 21% at this capital', expected, 0.21)
/*
 * THE FIXTURE HAS TO KEEP DISAGREEING OR THIS CHECK STOPS TESTING ANYTHING. If somebody corrects
 * the register so the two match, every assertion below passes for the wrong reason -- which is
 * the vacuous pass this suite has been bitten by before.
 */
ok('and the two genuinely disagree, or nothing below is a test',
  billed !== undefined && expected !== undefined && billed !== expected)

/* ---------------- run the import ---------------- */

/* THE EXPORT NAMES THE CLIENT THE WAY SWORDFISH DOES, which is `spec.swordfish`, not the display
   name -- `companyBySwordfishName` is keyed on it. Using the display name here produced an account
   filed under a brand-new client with no rates at all, which is a fixture that tests nothing. */
const swordfishName = spec?.swordfish?.[0]
ok('the register still knows this client by its Swordfish name', typeof swordfishName === 'string')

const row = {
  'Client': swordfishName ?? '',
  'Client Prefix': PREFIX,
  'Swordfish Reference': 'AIS2/0001',
  'Capital on Default': String(CAPITAL),
  'Surname': 'Ferreira',
  'Load Date': '2019-03-04',
  'Current Interest Rate': '24',
}
const plan = buildImportPlan(
  { accounts: [row], payments: [], actions: [], interest: [] },
  { ownerId: '00000000-0000-0000-0000-000000000001', now: new Date('2026-09-29T00:00:00Z') },
)
const account = plan.debtorAccounts?.[0]
ok('the import produced the account', !!account)

/* ---------------- and the invoice is what was written ---------------- */

/*
 * THE ASSERTION THE RULE IS ABOUT. `commission_rate` is what the client was invoiced on. Writing
 * the mandate rate here rewrites an invoice that has already been paid, and remittance has
 * already run against it.
 */
check('the rate stored is the one Swordfish billed', account?.commission_rate, billed)
check('...and it is NOT the mandate rate', account?.commission_rate === expected, false)

/*
 * THE OTHER HALF, WHICH THE RULE ALSO REQUIRES: "Where the two differ, write Swordfish's and
 * REPORT the difference." The mandate rate is kept beside it, so the discrepancy is visible and
 * the firm can decide case by case -- CLAUDE.md: "Corrections are the firm's decision, made case
 * by case, never a migration that sweeps."
 */
check('the mandate rate is kept alongside, for reporting', account?.commission_rate_expected, expected)
ok('...and the schedule it came from is named', typeof account?.commission_rate_source === 'string')
/* THE DRIFT IS COUNTED, which is the reporting half of the rule. It sits on the stats the import
   hands back, where the screen reads it. */
check('...and the difference is reported as drift', plan.stats?.commissionDrift, 1)

/* ---------------- the opening position is the handover, not our arithmetic ---------------- */

/*
 * THE SAME RULE ABOUT A DIFFERENT NUMBER, and worth holding here because it is the other place an
 * import could quietly substitute a computed figure for a recorded one.
 */
check('capital handed over is what the export said', account?.capital_handed_over, CAPITAL)
check('...and the in duplum ceiling is that capital, fixed at handover',
  account?.in_duplum_ceiling, CAPITAL)

console.log(`\ncheck-imported-history-is-frozen: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
