/**
 * A CLEAN BREAK: EVERY RECEIPT UP TO THE CUT-OVER IS SWORDFISH'S (S8, the go-live plan of 10 Oct).
 *
 * "Everything up to the cut-over stays Swordfish's: receipts dated on or before it are Swordfish's to
 * pay over (Camille keeps running those runs from Swordfish); Raptor splits only receipts from the
 * day after." The lagged default (settledThroughDefault) brought the month Swordfish had not yet paid
 * INTO Raptor's queue -- on staging that was R15 943.54 Raptor would have paid over a second time.
 *
 * WHAT THIS HOLDS:
 *   1. cutoverDefault is the end of the last cycle to CLOSE (not the last one paid).
 *   2. In a clean break, every receipt on or before the cut-over is flagged paid_over_in_swordfish
 *      (never split, never on a run) and approved as at its day; the day after is Raptor's.
 *   3. The estimate of what Swordfish still has to pay over at the cut-over: into trust only (no
 *      PTCs, no reversals), after the cycle Swordfish has paid -- judged at the cut-over, not today.
 *   4. "Nothing left to approve" is NOT a problem in a clean break (it is an import on the cut-over
 *      day); "everything to approve" still is. The lagged mode keeps both warnings.
 *   5. The import screen offers it, by default, with the cut-over date.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-clean-break.mjs
 */
import { readFileSync } from 'node:fs'
import { buildImportPlan } from '../../src/lib/swordfishImport.ts'
import { cutoverDefault, settledThroughDefault } from '../../src/lib/trustCycles.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/* ---------- 1. the default ---------- */

check('cut-over on 11 Dec is 10 Dec (the cycle that closed last night)', cutoverDefault('2026-12-11'), '2026-12-10')
check('...and on 10 Dec it is 10 Nov (10 Dec has not closed yet)', cutoverDefault('2026-12-10'), '2026-11-10')
check('...across a year end', cutoverDefault('2027-01-05'), '2026-12-10')
check('...a month later than the lagged default', settledThroughDefault('2026-12-11'), '2026-11-10')

/* ---------- 2. the line ---------- */

const acct = (ref) => ({
  'Client': 'Break Test Client', 'Client Prefix': 'BTC', 'Swordfish Reference': ref,
  'Capital on Default': '10000', 'Surname': 'Debtor', 'Load Date': '2024-05-06', 'Current Interest Rate': '0',
})
const pay = (ref, day, amount, extra = {}) => ({
  'Swordfish Reference': ref, 'Payment Date': day, 'Payment Amount': String(amount), 'Payment Type': 'EFT', ...extra,
})
const owner = '00000000-0000-0000-0000-000000000001'
const exportsWith = (payments) => ({ accounts: [acct('BTC/1')], payments, actions: [], interest: [] })
const payments = [
  pay('BTC/1', '2026-10-05', 100),   // paid by Swordfish on 11 Oct
  pay('BTC/1', '2026-10-10', 200),   // the last day of a paid cycle
  pay('BTC/1', '2026-10-11', 400),   // Swordfish's, not yet paid at the cut-over
  pay('BTC/1', '2026-11-20', 800),   // Swordfish's, not yet paid
  pay('BTC/1', '2026-12-01', 1600, { 'Payment Type': 'Client Direct' }), // a PTC: never in trust
  pay('BTC/1', '2026-12-10', 3200),  // the cut-over day itself: Swordfish's
  pay('BTC/1', '2026-12-11', 6400),  // the day after: Raptor's
]
const clean = buildImportPlan(exportsWith(payments),
  { ownerId: owner, now: new Date('2026-12-11T08:00:00Z'), cleanBreak: true })
const flag = Object.fromEntries(clean.payments.map((p) => [p.received_at.slice(0, 10), p.paid_over_in_swordfish]))
check('everything on or before the default cut-over is Swordfish\'s', flag, {
  '2026-10-05': true, '2026-10-10': true, '2026-10-11': true, '2026-11-20': true,
  '2026-12-01': true, '2026-12-10': true, '2026-12-11': false,
})
check('...approved as at its day, the day after left for a person',
  clean.payments.map((p) => p.approved_at),
  ['2026-10-05T00:00:00Z', '2026-10-10T00:00:00Z', '2026-10-11T00:00:00Z', '2026-11-20T00:00:00Z',
   '2026-12-01T00:00:00Z', '2026-12-10T00:00:00Z', null])

/* The lagged mode on the same day draws the line a month earlier: the old behaviour, untouched. */
const lagged = buildImportPlan(exportsWith(payments), { ownerId: owner, now: new Date('2026-12-11T08:00:00Z') })
check('the lagged mode still stops at what Swordfish has paid (10 Nov)',
  lagged.payments.filter((p) => !p.paid_over_in_swordfish).map((p) => p.received_at.slice(0, 10)),
  ['2026-11-20', '2026-12-01', '2026-12-10', '2026-12-11'])

/* ---------- 3. the estimate ---------- */

const owedNote = clean.notes.find((n) => n.includes('not yet paid over'))
ok('the clean break says what Swordfish has not paid over yet', Boolean(owedNote))
/* 11 Oct - 10 Dec into trust: 400 + 800 + 3200. Not the PTC (1600), not 10 Oct (paid 11 Oct). */
ok('...R4400.00: two cycles, into trust only, judged at the cut-over', Boolean(owedNote?.includes('R4400.00')))
ok('...3 receipts after 2026-10-10', Boolean(owedNote?.includes('3 receipts into trust after 2026-10-10')))
ok('...and points at where it is captured', Boolean(owedNote?.includes('Held for Swordfish payovers')))
ok('the clean-break note names the cut-over', clean.notes.some((n) => n.startsWith('Clean break at the end of 2026-12-10')))
ok('the lagged mode does not talk about a clean break', !lagged.notes.some((n) => n.includes('Clean break')))

/* A reversed receipt is not money Swordfish owes anybody. */
const withReversal = buildImportPlan(exportsWith([
  pay('BTC/1', '2026-11-20', 800, { 'Reversal Date': '2026-11-21', 'Reversal Reason': 'bounced' }),
  pay('BTC/1', '2026-11-25', 50),
]), { ownerId: owner, now: new Date('2026-12-11T08:00:00Z'), cleanBreak: true })
const rn = withReversal.notes.find((n) => n.includes('not yet paid over'))
ok('a reversed receipt is left out of the estimate', Boolean(rn?.includes('R50.00')) && !rn?.includes('R850.00'))

/* ---------- 4. the warnings ---------- */

const allSwordfish = buildImportPlan(exportsWith([pay('BTC/1', '2026-12-01', 10)]),
  { ownerId: owner, now: new Date('2026-12-11T08:00:00Z'), cleanBreak: true })
ok('nothing to approve on the cut-over day is not a problem in a clean break',
  !allSwordfish.problems.some((p) => p.includes('approve')))
const allSwordfishLagged = buildImportPlan(exportsWith([pay('BTC/1', '2026-10-01', 10)]),
  { ownerId: owner, now: new Date('2026-12-11T08:00:00Z') })
ok('...and still is in the lagged mode', allSwordfishLagged.problems.some((p) => p.startsWith('Nothing was left to approve')))
const allRaptor = buildImportPlan(exportsWith([pay('BTC/1', '2026-12-11', 10)]),
  { ownerId: owner, now: new Date('2026-12-11T08:00:00Z'), cleanBreak: true })
ok('everything after the cut-over is still a problem in a clean break',
  allRaptor.problems.some((p) => p.startsWith('Every receipt is dated after the cut-over')))
ok('an explicit cut-over wins over the default (the parallel run: 10 Oct)',
  buildImportPlan(exportsWith(payments), { ownerId: owner, now: new Date('2026-11-15T08:00:00Z'), cleanBreak: true, settledThrough: '2026-10-10' })
    .payments.filter((p) => !p.paid_over_in_swordfish).length === 5)

/* ---------- 5. the screen ---------- */

const tab = read('src/components/settings/DataImportTab.tsx')
ok('the import screen asks clean break or not', /cleanBreak/.test(tab) && /setCleanBreak/.test(tab))
ok('...clean break by default', /useState\(true\)/.test(tab.slice(tab.indexOf('const [cleanBreak'), tab.indexOf('const [cleanBreak') + 80)))
ok('...defaulting the date to the cut-over', /cutoverDefault\(clockToday\(\)\)/.test(tab))
ok('...and passes it to the plan', /cleanBreak,/.test(tab.slice(tab.indexOf('buildImportPlan('))))

if (failures.length) {
  console.error(`check-clean-break: ${failures.length} failed, ${pass} passed\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-clean-break: all ${pass} checks passed`)
