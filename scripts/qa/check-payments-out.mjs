/**
 * PAYMENTS TO MAKE OUT OF TRUST, EACH WITH THE REFERENCE IT GOES OUT ON.
 *
 * THE FIRM, 8 Oct: a refund "should go to a place for payments that we have to make"; a payover
 * "should go out with a client unique reference. For example, BF for Bredell Ferreira"; a payment
 * out "should be matched ... by means of a reference number".
 *
 * WHAT THIS HOLDS:
 *   1. ONE REFERENCE RULE IN TWO PLACES. 'BF ' + the run's number or the debtor's case number, in
 *      payment_out_reference (SQL) and paymentReference (TS). If they drift, the firm pays on one
 *      string and Raptor looks for another, and the match never happens.
 *   2. THE MATCH. A debit carrying a payment's reference AND its exact amount is that payment even
 *      where another payment is the same amount; a reference with the wrong amount is not.
 *   3. THE LIST: approved and sent runs, refunds not yet paid or cancelled, behind finance.view.
 *   4. The page is in the Trust rail, and the run and the client's advice carry the reference.
 *
 * Proved on staging: BF PO-SMT-2610 and BF PO-BPM-2610 due 11 Nov, BF RAP-124059 for the refund;
 * anon gets no row.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-payments-out.mjs
 */
import { readFileSync } from 'node:fs'
import { paymentReference, referenceIn, totalToPay, toPaymentToMake, toPaidOut, transferReference } from '../../src/lib/paymentsOut.ts'
import { suggestAllocation } from '../../src/lib/bankLineAllocation.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const sql = read('supabase/schema.sql')
const liveFn = (name) => {
  const at = Math.max(sql.lastIndexOf(`create or replace function public.${name}(`), sql.lastIndexOf(`create function public.${name}(`))
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return strip(m?.[2] ?? '')
}

/* ---- 1. one reference rule ---- */
const refSql = liveFn('payment_out_reference')
ok('the database writes BF + the code, upper-cased and trimmed', /'BF ' \|\| upper\(btrim\(p_code\)\)/.test(refSql))
ok('...and nothing for no code', /nullif\(btrim\(coalesce\(p_code, ''\)\), ''\) is null then null/.test(refSql))
check('the browser writes the same', paymentReference(' po-lvm-2610 '), 'BF PO-LVM-2610')
check('...a refund on the case number', paymentReference('RAP-124059'), 'BF RAP-124059')
check('...and nothing for no code', paymentReference('  '), null)
ok('a payover is referenced by its run number', /payment_out_reference\('payover', r\.invoice_number\)/.test(liveFn('payments_to_make')))
ok('...a refund by the debtor\'s case number', /payment_out_reference\('refund', coalesce\(d\.case_number, d\.account_number\)\)/.test(liveFn('payments_to_make')))
ok('the match screen is given the same references', /payment_out_reference\('payover', r\.invoice_number\)/.test(liveFn('bank_allocation_candidates'))
  && /payment_out_reference\('refund', coalesce\(d\.case_number, d\.account_number\)\)/.test(liveFn('bank_allocation_candidates')))
ok('...and the browser reads them', /reference: r\.reference === null/.test(read('src/lib/bankAllocationApi.ts')))

/* ---- 2. the match ---- */
ok('a reference is found run into the payee\'s name', referenceIn('PAYOVER POLVM2610 LOWVELD', 'BF PO-LVM-2610'))
ok('...with the BF cut off', referenceIn('PO-LVM-2610', 'BF PO-LVM-2610'))
check('...and not in a different run', referenceIn('PAYOVER POLVM2609', 'BF PO-LVM-2610'), false)
check('a code too short to mean anything is not trusted', referenceIn('ABC12 PAYMENT', 'BF AB1'), false)
const line = (amount, description) => ({ id: 'l', txnDate: '2026-10-12', amount, description, direction: 'debit', reference: null, bankAccount: '62700201255', bankAccountLabel: null })
const RUNS = [
  { kind: 'payover', id: 'run-lvm', amount: 4000, label: 'PO-LVM-2610 - Lowveld', reference: 'BF PO-LVM-2610' },
  { kind: 'payover', id: 'run-smt', amount: 4000, label: 'PO-SMT-2610 - Summit', reference: 'BF PO-SMT-2610' },
  { kind: 'refund', id: 'ref-1', amount: 490.42, label: 'Refund to Sizwe Dlamini', reference: 'BF RAP-124059' },
]
check('two runs of the same amount and no reference: a question for a person', suggestAllocation(line(-4000, 'PAYOVER LOWVELD'), RUNS), null)
check('...the reference decides it', suggestAllocation(line(-4000, 'BF PO-SMT-2610 SUMMIT FITNESS'), RUNS)?.targetId, 'run-smt')
check('a reference with the wrong amount is not that payment', suggestAllocation(line(-3999, 'BF PO-SMT-2610'), RUNS), null)
check('a refund on the debtor\'s case number', suggestAllocation(line(-490.42, 'BF RAP124059 S DLAMINI'), RUNS)?.targetId, 'ref-1')
ok('...saying why', /carries the reference BF RAP-124059/.test(suggestAllocation(line(-490.42, 'BF RAP124059'), RUNS)?.why ?? ''))

/* ---- 3. the list ---- */
const list = liveFn('payments_to_make')
ok('approved and sent runs are to pay', /r\.status in \('approved', 'sent'\)/.test(list))
ok('...and refunds not yet paid or cancelled', /o\.paid_at is null and o\.cancelled_at is null/.test(list))
ok('...behind the trust tick', (list.match(/public\.has_capability\('finance\.view'\)/g) ?? []).length === 2)
ok('...due on the 11th, the lag after the cycle closes', /\(r\.period_end \+ make_interval\(months => coalesce\(f\.payover_lag_months, 1\)\)\)::date \+ 1/.test(list))
for (const sig of ['payment_out_reference(text, text)', 'payments_to_make()', 'bank_allocation_candidates()']) {
  ok(`${sig} is revoked from public and anon`, sql.includes(`revoke all on function public.${sig} from public, anon;`))
}
const rows = [toPaymentToMake({ kind: 'payover', id: 'a', payee: 'X', amount: '8426.07' }), toPaymentToMake({ kind: 'refund', id: 'b', payee: 'Y', amount: 490.42 })]
check('the total is the sum, to the cent', totalToPay(rows), 8916.49)

/* ---- 4. where it shows ---- */
ok('Payments to make is in the Trust rail', /to: '\/trust\/payments-out', label: 'Payments to make'/.test(read('src/pages/trust/TrustLayout.tsx')))
ok('...and routed', /path="payments-out" element=\{<TrustPaymentsOut \/>\}/.test(read('src/App.tsx')))
const run = strip(read('src/pages/finance/RunDetail.tsx'))
ok('the run says which reference to pay it on', /Pay with reference/.test(run) && /paymentReference\(run\.invoice_number\)/.test(run))
ok('...and Mark paid starts from it', /suggested=\{paymentReference\(run\.invoice_number\) \?\? ''\}/.test(run) && /useState\(suggested\)/.test(run))
ok('the client\'s advice says it will carry it', /reference \$\{paymentReference\(run\.invoiceNumber\)\}/.test(read('src/lib/remittanceAdvice.ts')))

/* ---- 5. completed from two places, confirmed by the statement (the firm, 8 Oct) ---- */
const reconcile = liveFn('reconcile_bank_debit')
ok('a run marked paid by hand can still be matched to its debit', /if v_status not in \('approved', 'sent', 'paid'\) then/.test(reconcile))
ok('...once', /if v_status = 'paid' and exists \(select 1 from public\.bank_statement_lines x where x\.payover_run_id = p_run\) then/.test(reconcile))
ok('...keeping the date and reference it was marked with', /paid_at = coalesce\(paid_at,/.test(reconcile) && /eft_reference = coalesce\(eft_reference,/.test(reconcile))
const allocate = liveFn('allocate_bank_line')
ok('a refund marked paid can still be confirmed from the statement', /if v_out\.bank_line_id is not null or v_out\.cancelled_at is not null then/.test(allocate))
ok('...without paying it twice', /set paid_at = coalesce\(paid_at,/.test(allocate) && /paid_reference = coalesce\(paid_reference, v_desc\)/.test(allocate))
const cands = liveFn('bank_allocation_candidates')
ok('the match screen offers runs marked paid and not yet on the statement',
  /r\.status = 'paid' and not exists \(select 1 from public\.bank_statement_lines x where x\.payover_run_id = r\.id\)/.test(cands))
ok('...and refunds not yet on the statement', /o\.bank_line_id is null and o\.cancelled_at is null/.test(cands))
const markRefund = liveFn('mark_refund_paid')
ok('a refund can be marked paid by hand, with a reference', /if v_ref is null then/.test(markRefund) && /set paid_at = coalesce\(p_paid_at, now\(\)\), paid_reference = v_ref/.test(markRefund))
ok('...only while it is still due', /where id = p_refund and paid_at is null and cancelled_at is null/.test(markRefund))
ok('...behind the trust tick', /has_capability\('finance\.view'\)/.test(markRefund))
const history = liveFn('payments_out_paid')
ok('what has gone out covers runs, refunds and transfers to the business', /'payover'::text as kind/.test(history) && /select 'refund'/.test(history) && /select 'business_transfer'/.test(history))
ok('...each saying whether the statement confirmed it', /o\.statement_date is not null/.test(history))
ok('...always showing what is still waiting', /o\.statement_date is null or o\.statement_date >= p_since/.test(history))
for (const sig of ['mark_refund_paid(uuid, text, timestamptz)', 'payments_out_paid(date)']) {
  ok(`${sig} is revoked from public and anon`, sql.includes(`revoke all on function public.${sig} from public, anon;`))
}
check('the firm\'s transfer is referenced like the rest', transferReference('2026-10-08'), 'BF FEES-2610')
check('a paid row reads its confirmation', toPaidOut({ kind: 'refund', id: 'x', confirmed: true, statement_date: '2026-10-12' }).confirmed, true)
const pageSrc = strip(read('src/pages/trust/TrustPaymentsOut.tsx'))
ok('the page marks a run paid with the run\'s own call, and a refund with its own',
  /if \(paying\.kind === 'payover'\) await markRunPaid\(paying\.id, ref, at\)\s*else await markRefundPaid\(paying\.id, ref, at\)/.test(pageSrc))
ok('...a transfer is offered only to whoever may draw', /const mayDraw = canDrawFromTrust\(currentUser\)/.test(pageSrc))

/* ---- 6. at go-live, from the statement only (the firm, 8 Oct) ---- */
ok('the switch is a column, off by default', /add column if not exists payouts_statement_only boolean not null default false/.test(sql))
for (const fn of ['mark_payover_run_paid', 'mark_refund_paid']) {
  const body = liveFn(fn)
  ok(`${fn} refuses while the switch is on`, /if coalesce\(\(select payouts_statement_only from public\.firm_settings limit 1\), false\) then\s*raise exception 'Payments out are confirmed from the bank statement only/.test(body))
  ok(`...before it writes anything`, body.indexOf('payouts_statement_only') >= 0 && body.indexOf('payouts_statement_only') < body.search(/\bupdate public\./))
}
const runPage = strip(read('src/pages/finance/RunDetail.tsx'))
ok('the run offers Mark paid only while the switch is off', /\(run\.status === 'approved' \|\| run\.status === 'sent'\) && !statementOnly && \(/.test(runPage))
ok('...and says how it will be paid when it is on', /Paid when its line on the bank statement is allocated/.test(runPage))
ok('Payments to make offers Mark paid only while the switch is off', /\{statementOnly \? \(\s*<span[^>]*>Paid from the statement<\/span>/.test(strip(read('src/pages/trust/TrustPaymentsOut.tsx'))))
ok('Trust settings carries the switch', /saveStatementOnly\(e\.target\.checked\)/.test(strip(read('src/pages/finance/FinanceSettings.tsx'))))

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-payments-out: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
