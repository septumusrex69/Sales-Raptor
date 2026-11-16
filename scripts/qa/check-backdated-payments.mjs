/**
 * PAYMENTS FOUND LATE: THE CORRECTION, TO THE CENT, AND HOW IT IS POSTED (Raptor H19 / S20, phases 1b-3).
 *
 * The worked example is the Claude Doc "Payments found late" (R10 000 on 1 Jan, 2% a month, 20% + VAT; R1 000 on
 * 1 Apr split and paid over; R1 000 on 1 Mar found later). Its correction to the April payment: interest -R307.16,
 * fees +R240.21, capital +R66.95, commission incl. VAT +R15.40, the client +R51.55, the firm -R51.55; the debtor's
 * interest down R17.59 to R605.30; capital outstanding R8 933.05.
 *
 *  1. correctionOf -- the browser's copy of restatement_figures' arithmetic -- gives those figures from the doc's
 *     "paid over" and "should have been" splits, and client + firm is always nil.
 *  2. The database posts it the firm's way, held against the LAST definitions in schema.sql: proposed, shown, and
 *     posted only by an Administrator with payment.approve; nothing paid over edited (a R0.00 correction receipt
 *     carries the difference); one interest row that does not move the day interest runs from; Swordfish history
 *     frozen; every step audited.
 *  3. The same figures came out of the DATABASE on staging: scripts/qa/live/s20-restatement-worked-example.sql
 *     posts the doc's account for real, reads it back and rolls back (last run 8 Nov 2026: failures []). This
 *     check holds that the probe still asserts every one of the doc's figures.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-backdated-payments.mjs
 */
import { readFileSync } from 'node:fs'
import { correctionOf, latestByPayment } from '../../src/lib/restatement.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const schema = read('supabase/schema.sql')
function lastFn(name) {
  const re = new RegExp(`create (or replace )?function public\\.${name}\\(`, 'gi')
  let m; let at = -1
  while ((m = re.exec(schema))) at = m.index
  if (at < 0) return ''
  const tag = /\bas\s+(\$[a-z_]*\$)/i.exec(schema.slice(at))
  if (!tag) return ''
  const start = at + tag.index + tag[0].length
  return schema.slice(at, schema.indexOf(tag[1], start))
}
const code = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

/* ---- 1. the doc's correction, to the cent ---- */
const paidOver = { to_interest: 500, to_costs: 0, to_capital: 500, commission: 100, commission_vat: 15, to_client: 385 }
const shouldHave = { to_interest: 192.84, to_costs: 240.21, to_capital: 566.95, commission: 113.39, commission_vat: 17.01, to_client: 436.55 }
const c = correctionOf(paidOver, shouldHave)
check('interest on the April payment: -R307.16', c.interest, -307.16)
check('fees: +R240.21 (over-taken interest goes to Annexure B fees first)', c.fees, 240.21)
check('capital: +R66.95 (then to capital)', c.capital, 66.95)
check('commission incl. VAT: +R15.40', c.commission, 15.4)
check('the client receives R51.55 more on the next run', c.client, 51.55)
check('the firm keeps R51.55 less', c.firm, -51.55)
check('...and the two add to nil: the R1 000 does not change, only whose it is', Math.round((c.client + c.firm) * 100) / 100, 0)
const ptc = correctionOf({ to_interest: 200, to_costs: 0, to_capital: 300, commission: 60, commission_vat: 9, to_client: 0 },
  { to_interest: 100, to_costs: 50, to_capital: 350, commission: 70, commission_vat: 10.5, to_client: 0 }, true)
check('a PTC turns it round: the client owes the firm what the firm gains', ptc.client, -ptc.firm)
check('the latest correction per payment is the one drawn',
  latestByPayment([{ paymentId: 'p', proposedAt: '2026-11-01T10:00:00Z', id: 'a' }, { paymentId: 'p', proposedAt: '2026-11-08T10:00:00Z', id: 'b' }]).get('p').id, 'b')

/* ---- 2. how the database posts it ---- */
const compute = lastFn('restatement_compute')
ok('the calculator is defined', compute.length > 2000)
ok('...works the account out again inside a block that ALWAYS rolls back', /raise exception using errcode = 'RQSIM'/.test(compute)
  && /exception when sqlstate 'RQSIM' then null;/.test(compute))
ok('...re-splits each payment through approve_payment, oldest first', /perform public\.approve_payment\(e\.id\);/.test(code(compute))
  && /order by p\.received_at, p\.created_at, p\.id/.test(compute))
ok('...as ITSELF, its old split parked on an R0.00 placeholder (a full copy doubled the payment day)',
  /update public\.payment_allocations set payment_id = v_shadow where payment_id = e\.id;/.test(compute)
  && /values \(e\.account_id, e\.received_at, 0, e\.method/.test(compute))
ok('...parks posted interest on the day before the handover, never in 1900 (it would accrue from 1900)',
  /accrued_on = coalesce\(v_acct\.handover_date - 1, date '1900-01-01'\)/.test(compute))
ok('...removes no rows at all', !/\bdelete\b/i.test(code(compute)))
ok('...and leaves correction receipts out of the re-split', /p\.source <> 'correction'/.test(compute))

const figures = lastFn('restatement_figures')
ok('a later receipt Swordfish paid over blocks it: imported history is frozen', /A later receipt on this account was paid over in Swordfish/.test(figures))
ok('...Swordfish interest after the day too', /Swordfish interest is posted after this payment''s day/.test(figures))
ok('...an account at its in duplum ceiling comes to finance first', /in duplum ceiling/.test(figures))
ok('...a receipt fee that would change is re-raised by hand, not corrected', /A fee is re-raised by hand/.test(figures))

const propose = lastFn('propose_restatement')
ok('proposing needs the trust account and payment.approve', /public\.has_capability\('finance\.view'\) and public\.has_capability\('payment\.approve'\)/.test(propose))
ok('...and is audited', /'proposed'/.test(propose) && /payment_restatement_events/.test(propose))
const approve = lastFn('approve_restatement')
ok('POSTING is an Administrator with payment.approve', /public\.current_user_role\(\) is distinct from 'Administrator'\s+or not public\.has_capability\('payment\.approve'\)/.test(approve))
ok('...worked out again and refused if the account moved since it was proposed', /The account has changed since this correction was proposed/.test(approve))
ok('...refused while blocked', /if f ->> 'blocked' is not null then/.test(approve))
ok('a payment already split gets an R0.00 CORRECTION RECEIPT carrying the difference',
  /values \(x\.account_id, x\.received_at, 0, 'Correction'/.test(approve) && /'correction', x\.paid_to_client, auth\.uid\(\), x\.id, r\.id/.test(approve))
ok('...inserted unapproved so the insert trigger does not split it, then approved',
  approve.indexOf("'correction', x.paid_to_client") > 0 && approve.indexOf("'s20-correction'") > approve.indexOf("'correction', x.paid_to_client")
  && /set approved_at = public\.raptor_now\(\), approved_by = auth\.uid\(\), allocated_on = public\.raptor_today\(\)\s+where id = v_corr;/.test(approve))
ok('NOTHING PAID OVER IS EDITED: no allocation is updated', !/update public\.payment_allocations/.test(code(approve)))
ok('...and no payover run or run line either', !/update public\.payover_run/.test(code(approve)) && !/insert into public\.payover_run_lines/.test(code(approve)))
ok('the backdated payment still waiting is approved by it, with its date-order split', /where id = x\.id and approved_at is null;/.test(approve)
  && /jsonb_populate_record\(null::public\.payment_allocations, n\)/.test(approve))
ok('the debtor\'s interest: ONE row, covering no days, at the end of what is posted', /select max\(accrued_on \+ days\) into v_covered/.test(approve)
  && /values \(r\.account_id, coalesce\(v_covered, \(c ->> 'day'\)::date\), 0, 0, 0,/.test(approve) && /false, 'restatement'\)/.test(approve))
ok('capital outstanding moves by what the restated splits took', /capital_outstanding = coalesce\(capital_outstanding, 0\) \+ \(f ->> 'capital_correction'\)::numeric/.test(approve))
ok('it rides the next open run now (refresh), as a line of its own', /perform public\.refresh_payover_runs\(\);/.test(approve))
ok('...audited as posted', /'posted', jsonb_build_object\('lines_posted'/.test(approve))
ok('cancelling needs a reason and is audited', /Say why the correction is being cancelled/.test(lastFn('cancel_restatement')) && /'cancelled'/.test(lastFn('cancel_restatement')))

/* The correction receipt is nobody's payment but finance's. */
const viewAt = schema.lastIndexOf('create or replace view public.account_payment_lines')
ok('the non-finance view leaves correction receipts out', /and p\.source <> 'correction';/.test(schema.slice(viewAt, schema.indexOf(';', viewAt) + 1)))
ok('...the debtor portal too', /\.neq\('source', 'correction'\)/.test(read('api/_lib/debtorPortal.ts')))
ok('...collections and commission do not count it', ['collector_performance', 'collector_daily', 'clerk_commission_lines']
  .every((f) => /p\.source not in \('moved', 'correction'\)/.test(lastFn(f))))
ok('...nor the control list', (lastFn('backdated_payments').match(/source <> 'correction'/g) ?? []).length === 2)
/* S20 review: only the payment a POSTED correction placed (and a correction receipt) is refused -- finance, by hand.
   A later receipt on a corrected account reverses: opposite entries, no replay (the probe s20-later-receipt-reversal). */
const revAlloc = lastFn('reverse_payment_allocation')
ok('the payment a posted correction placed is not reversed blind',
  /new\.source = 'correction'\s+or exists \(select 1 from public\.payment_restatements r where r\.payment_id = new\.id and r\.status = 'posted'\) then\s+raise exception 'This payment was placed by a correction for a payment found late\. Finance reverses it by hand\.'/.test(revAlloc))
ok('...but a later receipt on the account is not refused for the account\'s corrections',
  !/c\.corrects_payment_id = new\.id and c\.reversed_at is null\) then\s+raise/.test(revAlloc))
const noReplay = revAlloc.slice(revAlloc.indexOf("c.account_id = new.account_id and c.source = 'correction'"))
ok('a corrected account is NOT replayed: its branch returns before reallocate_account',
  revAlloc.indexOf("c.account_id = new.account_id and c.source = 'correction'") > 0
  && noReplay.indexOf('return new;') >= 0 && noReplay.indexOf('return new;') < noReplay.indexOf('perform public.reallocate_account'))
ok('...capital back for the payment\'s un-invoiced split and every correction of it',
  /set capital_outstanding = coalesce\(d\.capital_outstanding, 0\) \+ x\.cap[\s\S]*a\.payment_id = new\.id and not public\.allocation_is_invoiced\(a\.payover_run_id\)\)\s+or a\.payment_id in \(select c\.id from public\.account_payments c where c\.corrects_payment_id = new\.id\)/.test(noReplay))
ok('...every trust entry answered by its opposite, never edited',
  /insert into public\.trust_creditor_entries \(party, company_id, account_id, amount, reason, payment_id, allocation_id\)\s+select e\.party, e\.company_id, e\.account_id, -e\.amount/.test(noReplay)
  && !/update public\.trust_creditor_entries/.test(noReplay))
ok('...and the splits marked reversed, not removed', /update public\.payment_allocations\s+set status = 'reversed'\s+where payment_id = new\.id\s+or payment_id in/.test(noReplay))
const later = read('scripts/qa/live/s20-later-receipt-reversal.sql')
ok('the later-receipt probe is on file and checks capital, both trust balances and the open run to the cent',
  /a\.cap <> b\.cap/.test(later) && /a\.client <> b\.client/.test(later) && /a\.firm <> b\.firm/.test(later)
  && /run_after <> run_before/.test(later) && /run_mid - run_before <> may\.to_client/.test(later))
ok('...and that the payment found late is still refused', /reverse_payment\(v_mar, 'probe'\)[\s\S]*Finance reverses it by hand/.test(later))
ok('...and its last recorded run passed', /Last run: [^\n]*failures \[\]/.test(later))
ok('the screen says the payment found late is finance\'s to reverse',
  /can be reversed only by finance, by hand/.test(read('src/pages/trust/BackdatedPayments.tsx')))
ok('...nor is its account re-split', /is not re-split/.test(lastFn('reallocate_account')))
ok('Clear staging empties the correction tables with the payments', /public\.payment_restatement_events, public\.payment_restatements/.test(lastFn('clear_staging')))
ok('the debtor\'s statement says what the negative interest row is', /Interest corrected: a payment found late/.test(read('src/lib/accountBalance.ts')))
ok('the advice names a correction line by the payment it corrects', /Correction to the payment of \$\{advDate\(l\.correctionOf\)\}/.test(read('src/lib/remittanceAdvice.ts')))

/* ---- 3. the probe that ran it in the database ---- */
const probe = read('scripts/qa/live/s20-restatement-worked-example.sql')
for (const [what, re] of [
  ['March: interest R412.46', /m\.to_interest <> 412\.46/], ['March: fees R87.54', /m\.to_costs <> 87\.54/],
  ['March: capital R500', /m\.to_capital <> 500/], ['March: commission R115', /m\.commission \+ m\.commission_vat <> 115/],
  ['March: client R385', /m\.to_client <> 385/],
  ['April: interest -R307.16', /c\.to_interest <> -307\.16/], ['April: fees +R240.21', /c\.to_costs <> 240\.21/],
  ['April: capital +R66.95', /c\.to_capital <> 66\.95/], ['April: commission +R15.40', /c\.commission \+ c\.commission_vat <> 15\.40/],
  ['April: client +R51.55', /c\.to_client <> 51\.55/], ['interest charged R605.30', /acc_fix\.total <> 605\.30/],
  ['capital R8 933.05', /cap <> 8933\.05/], ['trust ledger +R51.55 / -R51.55', /ent\.client <> 51\.55 or ent\.firm <> -51\.55/],
  ['April\'s own split untouched', /April''s own allocation was changed/], ['it always rolls back', /raise exception 'RESTATEMENT %'/],
]) ok(`the staging probe asserts ${what}`, re.test(probe))

/* ---- the screen ---- */
const page = read('src/pages/trust/BackdatedPayments.tsx')
/* S21 · Raptor H19 (Stephan: "shown for approval in the payments in. Not a separate tab"): the list sits in Payments in,
   under the approval queue; the rail item is gone and the address still opens the page for links already sent. */
ok('Payments in has the list, for approval', /<BackdatedPayments embedded refreshKey=\{changed\} \/>/.test(read('src/pages/finance/FinancePayments.tsx'))
  && !/label: 'Backdated payments'/.test(read('src/pages/trust/TrustLayout.tsx'))
  && /path="backdated" element=\{<BackdatedPayments \/>\}/.test(read('src/App.tsx')))
ok('Approve is drawn only for an Administrator with payment.approve', /const mayApprove = mayPropose && currentUser\?\.role === 'Administrator'/.test(page)
  && /can\(currentUser, 'payment\.approve'\)/.test(page) && /\{mayApprove && rs\?\.status === 'proposed' && !rs\.blockedReason && \(/.test(page))

console.log(`\ncheck-backdated-payments: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
