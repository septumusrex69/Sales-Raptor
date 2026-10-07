/**
 * PAYMENTS IN, REDESIGNED: THE FIRM'S WORKED EXAMPLES TO THE CENT, AND THE PTC FIGURE THAT WAS
 * SHORT BY ITS VAT.
 *
 * WHAT THIS HOLDS:
 *
 *   1. THE THREE EXAMPLES THE FIRM CHECKED BY HAND. A -- Nandi Zulu, Summit Fitness, R8 000 into
 *      trust: to client R4 728.50, BF keeps R3 271.50. B -- Lowveld, R2 000 that paid the capital
 *      off: to client R962.50, BF keeps R547.08, credit R490.42. And A again as a PTC: nothing to
 *      pay the client, R4 728.50 already held by them, R3 271.50 due to BF.
 *   2. THE PTC CORRECTION. allocate_payment writes due_to_bf WITHOUT the VAT on commission; the
 *      ledger trigger books the client as owing it WITH. The firm confirmed the ledger: the screen
 *      shows interest + costs + commission + VAT on commission, and adds no VAT to costs that
 *      already carry it. Held against trust_creditors_on_allocation's own sum, so the day either
 *      side moves this fails rather than the month end.
 *   3. THE BATCH CLOSES three ways, and the PTC due is inside the firm's share, not on top of it.
 *   4. THE BADGES SAY WHAT IS TRUE: capital paid off is never "settled"; no badge claims the items
 *      1-7 cap was respected, because the engine does not report it per payment.
 *   5. THE SCREEN DRAWS THESE FIGURES and not the engine's raw due_to_bf; Payments in has no list of
 *      posted payments any more; and Reverse lives on Check, where a posted payment is found.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-payments-queue.mjs
 */
import { readFileSync } from 'node:fs'
import {
  batchReconciliation, batchTotals, checkedRow, exceptionsOf, ptcDueToBf, queueFigures, totalsByClient,
} from '../../src/lib/paymentsQueue.ts'
import { allocationOf, checkAllocation } from '../../src/lib/allocationRules.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* TWO STRIPPERS: SQL's `--` comment would eat a CSS variable like `--color-card-solid` in TSX. */
const stripTs = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
const strip = (t) => stripTs(t).replace(/--[^\n]*/g, '')

/* ---------------- the firm's examples, as the engine reports them ---------------- */

/*
 * EVERY FIGURE HERE IS ONE THE ENGINE HANDS BACK -- payments_awaiting_approval's columns, as
 * fetchAwaitingApproval maps them. Nothing is derived in the fixture, so what is tested is what the
 * screen does with the engine's answer.
 */
const base = {
  client: null, cameBackFrom: null, interestCant: 0, rfCant: 0, feesCant: 0, hasRate: true,
}
/* A: R8 000 into trust. Half A R4 000 pays interest R50.66, the R701.50 receipt fee it raises and
   R28.75 of earlier fees; R3 219.09 rolls to capital, which takes R7 219.09. */
const A = {
  ...base, paymentId: 'A', client: 'Summit Fitness', receivedOn: '2026-10-05', amount: 8000, paidToClient: false,
  toInterest: 50.66, toReceiptFees: 701.5, toFees: 28.75, toCosts: 730.25,
  receiptFee: 610, receiptFeeVat: 91.5,
  toCapital: 7219.09, capitalBefore: 78500, capitalAfter: 71280.91, excess: 0,
  commission: 2165.73, commissionVat: 324.86, commissionRate: 0.3,
  toClient: 4728.5, dueToBf: 0,
}
/* B: R2 000 that pays the R1 250 of capital off, with R490.42 left over as the debtor's credit. */
const B = {
  ...base, paymentId: 'B', client: 'Lowveld', receivedOn: '2026-10-05', amount: 2000, paidToClient: false,
  toInterest: 0.83, toReceiptFees: 230, toFees: 28.75, toCosts: 258.75,
  receiptFee: 200, receiptFeeVat: 30,
  toCapital: 1250, capitalBefore: 1250, capitalAfter: 0, excess: 490.42,
  commission: 250, commissionVat: 37.5, commissionRate: 0.2,
  toClient: 962.5, dueToBf: 0,
}
/* A AS A PTC: the engine pays the client nothing and writes due_to_bf WITHOUT the VAT --
   50.66 + 730.25 + 2 165.73 = 2 946.64. That is the figure the screen must not show. */
const PTC_A = { ...A, paymentId: 'PTC-A', paidToClient: true, toClient: 0, dueToBf: 2946.64 }

const a = queueFigures(A)
check('A: to client', a.toClient, 4728.5)
check('A: BF keeps, VAT included', a.bfShare, 3271.5)
check('A: no credit', a.credit, 0)
check('A: half A is R4 000', a.halfA, 4000)
check('A: of which R3 219.09 rolled to capital', a.halfAUnused, 3219.09)
check('A: interest, receipt fee and earlier fees as the engine paid them',
  [a.interestPaid, a.receiptFeePaid, a.earlierFeesPaid], [50.66, 701.5, 28.75])
check('A: capital before, paid, after', [a.capitalBefore, a.capitalPaid, a.capitalAfter], [78500, 7219.09, 71280.91])
check('A: no PTC due on a trust receipt', a.ptcDueToBf, null)
check('A: client share + BF share + credit is the payment',
  Math.round((a.clientShare + a.bfShare + a.credit) * 100) / 100, 8000)

const b = queueFigures(B)
check('B: to client', b.toClient, 962.5)
check('B: BF keeps, VAT included', b.bfShare, 547.08)
check('B: debtor credit', b.credit, 490.42)
check('B: R740.42 of half A rolled to capital', b.halfAUnused, 740.42)
check('B: client + BF + credit is the payment', Math.round((b.clientShare + b.bfShare + b.credit) * 100) / 100, 2000)

const p = queueFigures(PTC_A)
check('PTC-A: nothing to pay the client', p.toClient, 0)
check('PTC-A: the client already holds its share', p.clientShare, 4728.5)
check('PTC-A: due to BF includes the VAT on commission', p.ptcDueToBf, 3271.5)
check('PTC-A: ...which is the firm’s share, not something beside it', p.ptcDueToBf, p.bfShare)
/* THE REGRESSION ITSELF: the engine's own figure, short by exactly the VAT. */
check('PTC-A: the engine’s due_to_bf is short by the VAT on commission',
  Math.round((p.ptcDueToBf - PTC_A.dueToBf) * 100) / 100, 324.86)
/* NO VAT ON COSTS: they carry it already. One more 15% on R730.25 would be R109.54 too much. */
check('PTC-A: costs are not grossed up again', ptcDueToBf(PTC_A),
  Math.round((50.66 + 730.25 + 2165.73 + 324.86) * 100) / 100)

/* ---------------- the formulas hold on all three, so nothing is flagged ---------------- */

const alloc = (r) => allocationOf({
  payment: r.amount,
  interestTotal: r.toInterest, interestCant: 0, interestRetained: 0, interestBefore: r.toInterest,
  toInterest: r.toInterest, interestAfter: 0,
  rfTotal: r.toReceiptFees, rfCant: 0, rfRetained: 0, toReceiptFees: r.toReceiptFees,
  feesTotal: r.toFees, feesCant: 0, feesRetained: 0, toFees: r.toFees,
  costsBefore: r.toFees, costsAfter: 0, receiptFeeRaised: r.receiptFee + r.receiptFeeVat,
  capitalBefore: r.capitalBefore, toCapital: r.toCapital, capitalAfter: r.capitalAfter,
  commission: r.commission, commissionVat: r.commissionVat, toClient: r.toClient, dueToBf: r.dueToBf,
  excess: r.excess, paidToClient: r.paidToClient, commissionRate: r.commissionRate, vatRate: 0.15,
})
for (const r of [A, B, PTC_A]) {
  check(`${r.paymentId}: every allocation formula holds`, checkAllocation(alloc(r)).map((v) => v.rule), [])
}
const keys = (r, h = null) => checkedRow(r, alloc(r), h).exceptions.map((e) => e.key).sort()
check('A: nothing unusual', keys(A), [])
check('B: credit and capital paid off', keys(B), ['capital_paid_off', 'credit'])
check('PTC-A: marked PTC, and no mismatch', keys(PTC_A), ['ptc'])

/* ---------------- the badges ---------------- */

const paidOff = exceptionsOf(B, []).find((e) => e.key === 'capital_paid_off')
ok('capital paid off is never called settled', !!paidOff && !/\bsettled\b(?! —)/i.test(paidOff.label)
  && /not the same as settled/.test(paidOff.detail))
check('the credit badge carries its amount', exceptionsOf(B, []).find((e) => e.key === 'credit')?.label, 'Credit 490.42')
check('in duplum clipping is badged', exceptionsOf({ ...A, feesCant: 57.01 }, []).map((e) => e.key), ['in_duplum'])
check('...and says it cannot be recovered',
  /can't be recovered/.test(exceptionsOf({ ...A, feesCant: 57.01 }, [])[0].detail), true)
check('no rate is badged', exceptionsOf({ ...A, hasRate: false }, []).map((e) => e.key), ['needs_rate'])
check('before handover is badged', keys(A, '2026-10-06'), ['before_handover'])
check('...and not on the day itself', keys(A, '2026-10-05'), [])
check('...and not drawn at all where the handover day is unknown', keys(A, null), [])
check('a formula that fails is an allocation mismatch',
  exceptionsOf(A, [{ rule: 'x', detail: 'y' }]).map((e) => e.key), ['allocation_mismatch'])
/* EVEN WHERE NO FORMULA WAS RUN: ten rand of credit nobody paid makes the three shares R10 more
   than the payment. */
check('a split that does not add back is one too',
  exceptionsOf({ ...A, excess: 10 }, []).map((e) => e.key), ['credit', 'allocation_mismatch'])
/* THE PTC FIGURE IS WATCHED AGAINST THE LEDGER'S SUM: an engine that started including the VAT in
   due_to_bf would make the ledger book it twice, and the row says so. */
check('a PTC whose engine figure already had the VAT is flagged',
  exceptionsOf({ ...PTC_A, dueToBf: 3271.5 }, []).map((e) => e.key), ['ptc', 'ptc_mismatch'])
const sql = read('supabase/schema.sql')
const ledger = (() => {
  const at = sql.lastIndexOf('create or replace function public.trust_creditors_on_allocation(')
  return at < 0 ? '' : strip(sql.slice(at, sql.indexOf('$$;', at)))
})()
ok('the ledger trigger is read', ledger.length > 500)
ok('...and books a PTC client as owing interest + costs + commission + its VAT',
  /if new\.paid_to_client then\s+v_firm := coalesce\(new\.to_interest, 0\) \+ coalesce\(new\.to_costs, 0\)\s+\+ coalesce\(new\.commission, 0\) \+ coalesce\(new\.commission_vat, 0\);/.test(ledger))
check('no badge claims the items 1-7 limit was respected',
  /within (the )?limit|items 1.7[^']*within/i.test(stripTs(read('src/lib/paymentsQueue.ts'))), false)

/* ---------------- the batch ---------------- */

const t = batchTotals([A, B, PTC_A])
check('batch: total awaiting', t.total, 18000)
check('batch: into trust and paid to clients kept apart', [t.direct.amount, t.ptc.amount], [10000, 8000])
check('batch: to pay clients is direct receipts only', t.toClients, 5691)
check('batch: BF share across both routes', t.bfShare, 7090.08)
check('batch: of which due on PTCs', t.ptc.dueToBf, 3271.5)
check('batch: credit', t.credit, 490.42)
check('batch: every reconciliation holds', batchReconciliation(t).map((c) => c.holds), [true, true, true])
/* THE PTC DUE IS NOT ADDED TWICE: added on top of the BF share, the second sum would be out by
   exactly R3 271.50. */
check('batch: client + BF + credit is the total without adding the PTC due again',
  Math.round((t.clientShare + t.bfShare + t.credit) * 100) / 100, t.total)
const broken = batchTotals([A, { ...B, toClient: 900 }])
check('batch: a payover that does not close is reported',
  batchReconciliation(broken).map((c) => c.holds), [true, true, false])
check('batch by client: one line a client, biggest first',
  totalsByClient([A, B, PTC_A]).map((c) => [c.client, c.count, c.total]),
  [['Summit Fitness', 2, 16000], ['Lowveld', 1, 2000]])

/* ---------------- the screen ---------------- */

const queue = stripTs(read('src/pages/finance/AwaitingApproval.tsx'))
const page = stripTs(read('src/pages/finance/FinancePayments.tsx'))
const checkPage = stripTs(read('src/pages/finance/CheckPayments.tsx'))
ok('the queue draws the PTC due from the corrected figure', /f\.ptcDueToBf !== null \? rand\(f\.ptcDueToBf\)/.test(queue))
check('...and never the engine’s raw due_to_bf', /rand\(r\.dueToBf\)/.test(queue), false)
ok('...and keeps the VAT on commission as its own column', /<Th right>VAT on commission<\/Th>/.test(queue))
ok('the batch figures are labelled as a projection', /Projected on approval/.test(queue))
ok('approve all says its scope before it runs', /function ApproveAllModal\(/.test(queue)
  && /not only the ones on this page/.test(queue) && /onClick=\{\(\) => setConfirmAll\(true\)\}/.test(queue))
ok('a second press is refused while one runs', /if \(ids\.length === 0 \|\| busy\) return/.test(queue))
ok('partial failures are named', /approved, \$\{out\.skipped\} could not be/.test(queue))
ok('the debtor and the tick box are pinned', /STICKY_CELL\} left-0/.test(queue) && /STICKY_CELL\} left-10/.test(queue))
ok('...on a solid background', /--color-card-solid/.test(queue)
  && /--color-card-solid: #/.test(read('src/styles/glass-mountain.css')))
ok('...and the rows are paged', /checked\.slice\(page \* PAGE, page \* PAGE \+ PAGE\)/.test(queue))

check('Payments in no longer lists every payment', /Every client|Trust and client-direct|from\('account_payments'\)/.test(page), false)
check('...nor reverses one', /reversePayment|ReverseModal/.test(page), false)
ok('Reverse lives on Check', /reversePayment\(row\.paymentId/.test(checkPage) && /mayReverse && !c\.row\.reversedOn/.test(checkPage))
ok('Record a payment and the statement sit side by side', /lg:grid-cols-2[\s\S]{0,600}Record a payment[\s\S]{0,800}<BankImportCard/.test(page))
ok('the four overview tiles', ['Pending processing', 'Processed in trust', 'Paid directly to client', 'Unmatched / suspense']
  .every((l) => page.includes(`label="${l}"`)))
ok('suspense comes after the queue', page.includes('<AwaitingApproval') && page.includes('<UnallocatedReceipts')
  && page.indexOf('<AwaitingApproval') < page.indexOf('<UnallocatedReceipts'))
const month = sql.slice(sql.lastIndexOf('create or replace function public.payments_in_month('))
ok('the processed tiles are summed in the database, behind finance.view',
  /has_capability\('finance\.view'\)/.test(month.slice(0, 1200)) && /reversed_at is null/.test(month.slice(0, 1200)))
ok('...and not reachable by anon', sql.includes('revoke all on function public.payments_in_month(date, date) from public, anon;'))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-payments-queue: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
