/**
 * THE BALANCE A WORKFLOW NOTICE QUOTES IS THE ACCOUNT PAGE'S (S9, 19 Oct, the firm's go-ahead).
 *
 * `api/_lib/workflow/step.ts` used to read the ledgers itself (`ledgersFor`) and build its own
 * position, and had drifted from the page four ways -- a receipt fee raised as a fee row counted
 * twice (no annexure_item / payment_id), the imported promise-to-pay fee dropped with the other
 * cancelled ones, rejected receipts counted as payments, and no ended / prescription -- so a
 * section 129 could state a different amount from the debtor's account. It now goes through the one
 * assembly the page, the list and the stored sort use.
 *
 * Holds: the runner reads the ledgers with storedBalance's reader and builds the position with
 * balanceInputFor off balanceAccountFromRow; it reads no ledger table of its own; and, behaviourally,
 * that one assembly gives the four answers the old reader got wrong.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-notice-balance.mjs
 */
import { readFileSync } from 'node:fs'
import { computeBalance } from '../../src/lib/accountBalance.ts'
import { balanceInputFor } from '../../src/lib/balanceInput.ts'
import { balanceAccountFromRow, ledgerRowsByAccount } from '../../src/lib/storedBalance.ts'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const step = strip(readFileSync(new URL('../../api/_lib/workflow/step.ts', import.meta.url), 'utf8'))

/* ---------- the runner goes through the shared assembly ---------- */
ok('the runner reads the ledgers with storedBalance\'s reader', /fetchLedgerRows\(admin, \[account\.id as string\]\)/.test(step))
ok('...builds the position as the account page does', /balanceInputFor\(\{ account: balanceAccountFromRow\(account\), ledgers: ledgerRows, today \}\)/.test(step))
ok('...and quotes computeBalance of exactly that', /const balance = computeBalance\(balanceInput\)/.test(step))
ok('...with no ledger reader of its own left', !/function ledgersFor/.test(step)
  && !/from\('account_fees'\)/.test(step) && !/from\('account_payments'\)/.test(step) && !/from\('account_interest_accruals'\)/.test(step))

/* ---------- and that assembly gets the four right ---------- */
const TODAY = '2026-10-19'
const account = { id: 'a1', capital_handed_over: '1000.00', handover_date: '2026-10-01', interest_rate_annual: '0', status: 'Active', last_action_at: null, ended_as: null, ended_on: null, prescribed: false, prescription_date: null }
const balanceOf = (raw, acct = account) => computeBalance(balanceInputFor({
  account: balanceAccountFromRow(acct), ledgers: ledgerRowsByAccount(['a1'], raw).get('a1'), today: TODAY,
})).balance
const pay = (id, amount, extra = {}) => ({ account_id: 'a1', id, received_at: '2026-10-05T08:00:00Z', amount: String(amount), paid_to_client: false, reversed_at: null, receipt_fee_legacy: null, rejected_at: null, ...extra })
const fee = (extra) => ({ account_id: 'a1', incurred_at: '2026-10-05T08:00:00Z', description: 'Fee', amount_excl_vat: '100.00', vat_amount: '15.00', billed: true, segments: null, cancelled_at: null, annexure_item: null, payment_id: null, legacy_name: null, ...extra })
const none = { payments: [], fees: [], accruals: [] }

const base = balanceOf(none)
ok(`a rejected receipt is not a payment (${balanceOf({ ...none, payments: [pay('p1', 200, { rejected_at: '2026-10-06T08:00:00Z' })] })} vs ${base})`,
  balanceOf({ ...none, payments: [pay('p1', 200, { rejected_at: '2026-10-06T08:00:00Z' })] }) === base)
const withPayment = balanceOf({ ...none, payments: [pay('p1', 200)] })
/* An item 9 row on the payment IS that payment's receipt fee, already in the balance: R823 with it or
   without it. The old reader dropped annexure_item and payment_id, which makes the same row an
   ordinary cost on top -- R846 -- and that is the double count. */
const receiptRow = { description: 'Receipt fee', amount_excl_vat: '20.00', vat_amount: '3.00' }
const withReceiptFee = balanceOf({ ...none, payments: [pay('p1', 200)], fees: [fee({ ...receiptRow, annexure_item: '9', payment_id: 'p1' })] })
const asTheOldReaderSawIt = balanceOf({ ...none, payments: [pay('p1', 200)], fees: [fee(receiptRow)] })
ok(`a receipt fee is counted once (${withReceiptFee} with its row, ${withPayment} without)`, withReceiptFee === withPayment)
ok(`...where the old reader counted it twice (${asTheOldReaderSawIt})`, asTheOldReaderSawIt > withReceiptFee)
const cancelled = balanceOf({ ...none, fees: [fee({ cancelled_at: '2026-10-06T08:00:00Z' })] })
const ptp = balanceOf({ ...none, fees: [fee({ cancelled_at: '2026-10-06T08:00:00Z', legacy_name: 'Promise to Pay' })] })
ok(`a cancelled fee comes off (${cancelled} vs ${base})`, cancelled === base)
ok(`...but the imported promise to pay still stands (${ptp})`, ptp > base)
const settled = balanceOf(none, { ...account, interest_rate_annual: '0.2', ended_as: 'settled', ended_on: '2026-10-02' })
const running = balanceOf(none, { ...account, interest_rate_annual: '0.2' })
ok(`a settled account stops accruing on the day it ended (${settled} < ${running})`, settled < running)

if (failures.length) { console.error(`check-notice-balance: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-notice-balance: ${pass} passed, 0 failed`)
