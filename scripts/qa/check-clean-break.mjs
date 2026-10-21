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
 *   6. (S10) The agreed cut-over, end of 10 Dec 2026, is the default -- a decision, not a cycle rule.
 *      The plan carries the split as figures (receipts and Rand each way), and the run is RECORDED
 *      with its batch (swordfish_import_runs, keyed on the batch id) before the first row is written,
 *      finished at the end, and stamped by discard_import_batch. The record's facts are frozen.
 *      Both choices are said on screen, one sentence each.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-clean-break.mjs
 */
import { readFileSync } from 'node:fs'
import { buildImportPlan, importRunRecord, receiptSplitLine, runAsSplit } from '../../src/lib/swordfishImport.ts'
import { SWORDFISH_CUTOVER, cutoverDefault, settledThroughDefault } from '../../src/lib/trustCycles.ts'

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
ok('...defaulting the date to the agreed cut-over', /useState\(SWORDFISH_CUTOVER\)/.test(tab))
ok('...and back to it when Clean break is picked again', /setSettledThrough\(v \? SWORDFISH_CUTOVER :/.test(tab))
ok('...and passes it to the plan', /cleanBreak,/.test(tab.slice(tab.indexOf('buildImportPlan('))))

/* ---------- 6. the agreed cut-over, the split, and the record (S10) ---------- */

check('the agreed cut-over is the end of 10 December 2026', SWORDFISH_CUTOVER, '2026-12-10')
/* IMPORTED IN OCTOBER, THE DEFAULT IS STILL 10 DEC: the cycle rule would have said 10 Oct and handed
   Raptor two months of receipts Swordfish pays over on 11 Dec and 11 Jan. */
const october = buildImportPlan(exportsWith(payments.slice(0, 4)),
  { ownerId: owner, now: new Date('2026-10-21T08:00:00Z'), cleanBreak: true })
check('a clean break with no date given draws the line at 10 Dec, whatever today is', october.receipts.cutover, '2026-12-10')
check('...so every receipt in an October export is Swordfish\'s', october.payments.every((p) => p.paid_over_in_swordfish), true)
check('the lagged mode on the same day is untouched (10 Sep)',
  buildImportPlan(exportsWith(payments.slice(0, 4)), { ownerId: owner, now: new Date('2026-10-21T08:00:00Z') }).receipts.cutover,
  '2026-09-10')

check('the split, as figures', clean.receipts, {
  cleanBreak: true, cutover: '2026-12-10',
  swordfish: { receipts: 6, amount: 6300 }, raptor: { receipts: 1, amount: 6400 },
})
check('...the lagged split names its own line', lagged.receipts.cleanBreak, false)
check('...and the note says the same figures', clean.notes.some((n) => n.includes('6 receipts up to that day (R6300.00)')
  && n.includes('1 received after it (R6400.00)')), true)
check('the split line, clean break', receiptSplitLine(clean.receipts),
  "Clean break at the end of 2026-12-10: 6 receipts (R6300.00) are Swordfish's to pay over; 1 receipt (R6400.00) after it are Raptor's.")
ok('the split line, lagged, calls it history', receiptSplitLine(lagged.receipts).startsWith('Swordfish paid over up to 2026-11-10'))

/* FROZEN HISTORY: the split counts what was flagged; it never touches an amount. */
check('nothing recalculated: the receipts are written as imported',
  clean.payments.map((p) => p.amount), [100, 200, 400, 800, 1600, 3200, 6400])

const rec = importRunRecord(clean, 'batch-1', false)
check('the run record is keyed on the batch and carries the line and the choice',
  [rec.id, rec.clean_break, rec.cutover_on], ['batch-1', true, '2026-12-10'])
check('...and the receipts each way',
  [rec.swordfish_receipts, rec.swordfish_amount, rec.raptor_receipts, rec.raptor_amount], [6, 6300, 1, 6400])
check('...and the report as shown', rec.report.notes, clean.notes)
check('a record read back gives the same split', runAsSplit({ ...rec, swordfish_amount: '6300.00', raptor_amount: '6400.00' }), clean.receipts)

/* THE SCREEN WRITES IT, FIRST. Presence before order (indexOf is -1 when the thing is gone). */
const runBody = tab.slice(tab.indexOf('const runImport'), tab.indexOf('TWO TABS, NOT TWO HEADINGS'))
const recAt = runBody.indexOf(".from('swordfish_import_runs').insert(importRunRecord(plan, batch, wipe))")
const wipeAt = runBody.indexOf('if (wipe) {')
const firstRowAt = runBody.indexOf('.from(table).insert(chunk)')
ok('the import screen records the run', recAt > 0)
ok('...before the wipe and before the first row', recAt > 0 && wipeAt > recAt && firstRowAt > recAt)
ok('...and a record that cannot be written stops the import with nothing changed',
  /Recording this import run[\s\S]{0,200}Nothing was changed/.test(runBody))
ok('...marks it finished at the end', /\.update\(\{ completed_at:[\s\S]{0,60}\.eq\('id', batch\)/.test(runBody))
ok('...and says the split when it is done', /receiptSplitLine\(r\)/.test(runBody))
ok('both choices are said, one sentence each', /data-testid="cutover-choices"/.test(tab)
  && /<strong>Clean break<\/strong>/.test(tab) && /<strong>Swordfish has paid up to<\/strong>/.test(tab))
ok('earlier runs are read back off the record', /from\('swordfish_import_runs'\)\s*\.select\(/.test(tab))

/* THE DATABASE: the table, its freeze, and the take-back stamping it. Last definitions only. */
const schema = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = schema.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const a = schema.indexOf('$$', at) + 2
  return schema.slice(a, schema.indexOf('$$', a))
}
const tableAt = schema.lastIndexOf('create table if not exists public.swordfish_import_runs (')
const tableSql = tableAt < 0 ? '' : schema.slice(tableAt, schema.indexOf(');', tableAt))
ok('swordfish_import_runs exists in schema.sql', tableSql.length > 0)
for (const col of ['id uuid primary key', 'clean_break boolean not null', 'cutover_on date not null',
  'swordfish_receipts integer', 'swordfish_amount numeric', 'raptor_receipts integer', 'raptor_amount numeric',
  'report jsonb', 'completed_at timestamptz', 'discarded_at timestamptz']) {
  ok(`...with ${col}`, tableSql.includes(col))
}
ok('...every column the record writes is in the table',
  Object.keys(rec).every((k) => new RegExp(`\\n\\s+${k} `).test(tableSql)))
ok('...row-level security on', /alter table public\.swordfish_import_runs enable row level security/.test(schema))
ok('...only an Administrator records a run', /swordfish_import_runs_insert[\s\S]{0,200}current_user_role\(\) = 'Administrator'/.test(schema))
ok('...and there is no delete policy', !/policy \w+ on public\.swordfish_import_runs\s+for delete/.test(schema))
const guard = lastFn('protect_swordfish_import_run')
ok('the record\'s facts are frozen (and it raises, not reverts)',
  /new\.cutover_on/.test(guard) && /new\.clean_break/.test(guard) && /new\.swordfish_amount/.test(guard)
  && /raise exception/.test(guard))
ok('...on a before-update trigger', /before update on public\.swordfish_import_runs[\s\S]{0,80}protect_swordfish_import_run/.test(schema))
ok('taking a run back out stamps its record', /update public\.swordfish_import_runs set discarded_at = now\(\)\s+where id = p_batch/.test(lastFn('discard_import_batch')))

if (failures.length) {
  console.error(`check-clean-break: ${failures.length} failed, ${pass} passed\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-clean-break: ${pass} passed, 0 failed`)
