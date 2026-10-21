/**
 * FINDING A PAYMENT, AND WHAT MAY STOP IT BEING REVERSED (prompt 11).
 *
 * The firm needed KLR/1005's R3 500.00 and could not find it. What this holds: the search matches
 * the account number however it is spaced or cased, the amount however it is typed -- and an amount
 * as an AMOUNT, so "350" is R350 and not every figure containing 350 -- the client's reference, the
 * debtor and the bank's words; and the reasons a reversal is refused are said, not hidden.
 * Also that a receipt off the trust statement cannot be re-captured as paid to the client.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-payment-search.mjs
 */
import { readFileSync } from 'node:fs'
import { amountOf, matchesPayment, reverseBlocked } from '../../src/lib/paymentSearch.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const KLR = { accountNumber: 'KLR/1005', caseNumber: 'RAP-124296', clientReference: 'KLR-CUST-1005',
  debtor: 'Thandi Mokoena', client: 'Karoo Linen Rentals', reference: 'KLR1005',
  bankDescription: 'FNB APP PAYMENT FROM KLR1005', amount: 3500 }
const HTH = { ...KLR, accountNumber: 'HTH/4001', caseNumber: 'RAP-124310', clientReference: null,
  debtor: 'Ndlovu Plant Hire', client: 'Highveld Tool Hire', reference: 'HTH4001', bankDescription: 'ACB CREDIT', amount: 350 }

for (const q of ['KLR/1005', 'klr / 1005', 'RAP-124296', 'rap-124296', 'KLR-CUST-1005', 'mokoena', 'FNB APP', '3500', '3 500', 'R3 500.00', 'r3500,00', '3500.00']) {
  ok(`"${q}" finds KLR/1005's R3 500.00`, matchesPayment(KLR, q))
}
check('"350" is the R350, not every amount containing 350', [matchesPayment(KLR, '350'), matchesPayment(HTH, '350')], [false, true])
ok('an empty search hides nothing', matchesPayment(KLR, '   '))
check('amounts parse the ways a person types them', ['3500', 'R 3 500.00', '3500,5', 'KLR1005', '35.123'].map(amountOf), [3500, 3500, 3500.5, null, null])

check('a reversed payment says so', reverseBlocked({ approved: true, reversedOn: '2026-07-10', swordfish: false }), 'Already reversed.')
ok('Swordfish history says why it cannot be reversed', /Swordfish/.test(reverseBlocked({ approved: true, reversedOn: null, swordfish: true }) ?? ''))
ok('an unapproved one points to the queue', /approval queue/.test(reverseBlocked({ approved: false, reversedOn: null, swordfish: false }) ?? ''))
check('an approved, unreversed Raptor payment may be reversed', reverseBlocked({ approved: true, reversedOn: null, swordfish: false }), null)

/* THE SAME BOX FROM EVERY DOOR, GATED ON THE SAME TICK. */
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
ok('History, the account and the run all open the one box',
  ['src/pages/finance/CheckPayments.tsx', 'src/pages/finance/RunDetail.tsx', 'src/components/accounts/AccountPaymentsList.tsx']
    .every((f) => /<ReversePaymentModal /.test(read(f))))
ok('...the account shows Reverse only to who holds payment.reverse', /mayReverse=\{canReversePayment\(currentUser\)\}/.test(read('src/pages/accounts/AccountDetail.tsx')))
ok('...and the run the same', /const mayReverse = canReversePayment\(currentUser\)/.test(read('src/pages/finance/RunDetail.tsx')))

/* PTC <-> TRUST (the firm, 11 Oct). */
const sql = read('supabase/schema.sql')
const at = sql.lastIndexOf('create or replace function public.reverse_payment_switching_side(')
const body = at >= 0 ? sql.slice(at, sql.indexOf('end $$;', at)) : ''
ok('switching side asks payment.reverse', /has_capability\('payment\.reverse'\)/.test(body))
const refuse = body.indexOf('cannot be made a payment to the client')
ok('a statement receipt cannot become a PTC, refused before anything is reversed',
  refuse >= 0 && refuse < body.indexOf('public.reverse_payment('))
ok('...and the copy goes back to the queue on the other side', /update public\.account_payments set paid_to_client = p_paid_to_client where id = v_copy/.test(body))

/* MONEY ON A CLOSED ACCOUNT IS THE DEBTOR'S CREDIT (prompt 11, the firm, 12 Oct: "this should just
   be an overpayment"). Nothing split, nothing charged, before any interest is brought up to date. */
const lastFn = (name) => {
  const i = sql.lastIndexOf(`create or replace function public.${name}(`)
  return i < 0 ? '' : sql.slice(i, sql.indexOf('end $$;', i))
}
const alloc = lastFn('allocate_payment')
const closedAt = alloc.indexOf('if (v_acct.ended_as is not null')
ok('a receipt on a closed account is caught', closedAt >= 0)
/* ONLY MONEY RECEIVED ON OR AFTER THE CLOSE, or a receipt explicitly held. A reversal re-splits the
   payments after it; tested on the bare ended_as, a payment KEPT through a withdrawal would come back
   as a credit the first time anything earlier on the account was reversed. */
const closedTest = closedAt >= 0 ? alloc.slice(closedAt, alloc.indexOf('then', closedAt)) : ''
ok('...only money received on or after the close, or held as credit',
  /received_at at time zone 'Africa\/Johannesburg'\)::date >= v_acct\.ended_on/.test(closedTest) && /v_pay\.hold_as_credit/.test(closedTest))
ok('...before interest is posted or a receipt fee raised', closedAt >= 0 && closedAt < alloc.indexOf('accrue_interest_to')
  && closedAt < alloc.indexOf('insert into public.account_fees'))
const branch = closedAt >= 0 ? alloc.slice(closedAt, alloc.indexOf('return v_id;', closedAt)) : ''
ok('...and the whole amount is the credit, every taking nought', /0, 0, 0, v_pay\.amount,/.test(branch) && /'v2-closed-credit'/.test(branch))
const preview = lastFn('preview_allocation')
const previewClosed = preview.indexOf('d.ended_as is not null and v_day >= d.ended_on')
ok('the queue previews it the same way, on the same day test', previewClosed >= 0
  && /excess_credit := greatest\(coalesce\(p_amount, 0\), 0\);/.test(preview)
  && previewClosed < preview.indexOf('finance_split('))

/* WITHDRAWING WITH PAYMENTS ON IT: KEEP BY DEFAULT, OR REFUND (prompt 11; the firm, 12 Oct: "by
   default, keep it on the account"). The refund is the existing machinery in one transaction. */
const wr = lastFn('withdraw_account_refunding')
ok('withdraw_account_refunding exists', wr.length > 0)
const wrAt = (needle) => wr.indexOf(needle)
ok('...checks every receipt before anything is withdrawn',
  wrAt('That payment is not on this account.') >= 0 && wrAt('That payment is not on this account.') < wrAt('public.withdraw_account('))
ok('...refuses a PTC, which never reached the trust', /if v_pay\.paid_to_client then/.test(wr) && wrAt('if v_pay.paid_to_client') < wrAt('public.withdraw_account('))
ok('...withdraws first, so the charge is the one the box showed', wrAt('public.withdraw_account(') >= 0 && wrAt('public.withdraw_account(') < wrAt('public.reverse_payment('))
const hold = wrAt('set hold_as_credit = true')
ok('...holds the copy as credit BEFORE approving it, or it would be split again',
  hold >= 0 && hold > wrAt('public.reverse_payment(') && hold < wrAt('public.approve_payment('))
ok('...and refunds that credit through the one refund path', wrAt("public.dispose_excess_credit(v_alloc, 'refund'") > wrAt('public.approve_payment('))
ok('...gated to signed-in users only', /revoke execute on function public\.withdraw_account_refunding\([^)]*\) from public, anon;/.test(sql))
const modal = read('src/components/accounts/EndAccountModal.tsx')
ok('the withdrawal box keeps the payments by default', /useState<'keep' \| 'refund'>\('keep'\)/.test(modal))
ok('...shows the effect before confirming', /data-testid="withdraw-effect"/.test(modal))
ok('...and only refunds when something is ticked', /chosen\.length > 0[\s\S]{0,200}withdrawAccountRefunding/.test(modal))

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-payment-search: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
