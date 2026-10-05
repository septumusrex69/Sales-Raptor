/**
 * THE CLIENT ACCOUNT: WHAT PASSES BETWEEN THE FIRM AND A CLIENT.
 *
 * Raptor could only ever see money owed TO a client. A payover run says what the firm collected and
 * what it owes; nothing recorded what a CLIENT owes the FIRM, so a withdrawal could not be billed,
 * a listing could not be invoiced, and there was no statement a client could be shown.
 *
 * THE FIRM'S OWN EXAMPLE IS THE SPECIFICATION, and the whole of it is asserted below:
 *   Payover due to client / Payover paid to client / Withdrawal invoice for client /
 *   Payover due to client / Withdrawal fee subtracted from payover / Client paid payover /
 *   Invoice for executive listing / Invoice paid by client.
 *
 * TWO WAYS A CHARGE IS COLLECTED, because that example shows both: `set_off` comes off the next
 * payover and rides the rail `due_to_bf` already uses; `invoice` the client pays in money.
 *
 * AND IT IS NOT AN ANNEXURE B FEE -- the hardest-asserted thing here. The tariff is charged to a
 * DEBTOR against an account and is bound by in duplum; this is the firm invoicing its own client.
 * A withdrawal fee that found its way into a debtor's balance would be a charge the debtor never
 * incurred, on an account the client has taken back.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-account.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const no = (name, actual) => check(name, actual, false)
const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')

function liveBody(name) {
  const at = Math.max(
    sql.lastIndexOf(`create or replace function public.${name}(`),
    sql.lastIndexOf(`create function public.${name}(`),
  )
  if (at < 0) return null
  const end = sql.indexOf('$$;', at)
  return end < 0 ? null : sql.slice(at, end + 3)
}

const raise = liveBody('raise_client_charge')
const cancel = liveBody('cancel_client_charge')
const paid = liveBody('mark_client_charge_paid')
const account = liveBody('client_account')
const recompute = liveBody('recompute_payover_run')
const build = liveBody('build_payover_run')
const guard = liveBody('protect_payover_run')
const voidRun = liveBody('void_payover_run')

for (const [n, b] of Object.entries({
  raise_client_charge: raise, cancel_client_charge: cancel, mark_client_charge_paid: paid,
  client_account: account, recompute_payover_run: recompute, build_payover_run: build,
  protect_payover_run: guard, void_payover_run: voidRun,
})) ok(`schema.sql defines ${n}`, typeof b === 'string' && b.length > 80)

/* ---------------- the table ---------------- */

ok('a client charge is its own table', /create table if not exists public\.client_charges/.test(sql))
ok('...with the three kinds the firm named',
  /kind text not null check \(kind in \('withdrawal', 'listing', 'other'\)\)/.test(sql))
ok('...and the two ways it is collected',
  /settlement text not null default 'set_off' check \(settlement in \('set_off', 'invoice'\)\)/.test(sql))
/* A CHARGE OF NOTHING IS NOT A CHARGE, and a negative one is a credit wearing the wrong word. */
ok('...an amount that has to be positive', /amount numeric\(12,2\) not null check \(amount > 0\)/.test(sql))
/* NO WRITE POLICY, like the ledgers: every change goes through a guarded function, so a charge
   cannot be edited into a different figure after the client has been billed for it. */
ok('...readable only by an Administrator',
  /create policy client_charges_select on public\.client_charges/.test(sql))
ok('...and writable through functions alone',
  /revoke insert, update, delete on public\.client_charges from authenticated, anon/.test(sql))
no('...with no write policy to let anybody past',
  /create policy \w+ on public\.client_charges\s*\n?\s*for (insert|update|delete|all)/.test(sql))

/*
 * AND IT IS NOT AN ANNEXURE B FEE. This is the one that would cost the firm a client: a charge
 * that reached a debtor's balance is money the debtor never owed, on a file the client has taken
 * back. Asserted as an absence over the three functions that write one.
 */
for (const [n, b] of [['raise_client_charge', raise], ['cancel_client_charge', cancel],
  ['mark_client_charge_paid', paid]]) {
  no(`${n} never touches a debtor's fees`, /account_fees|fee_ledger|in_duplum/.test(b ?? ''))
  no(`...nor a debtor's balance`, /update public\.debtor_accounts/.test(b ?? ''))
}

/* ---------------- raising, cancelling, settling ---------------- */

for (const [n, b] of [['raise_client_charge', raise], ['cancel_client_charge', cancel],
  ['mark_client_charge_paid', paid], ['client_account', account]]) {
  ok(`${n} is Administrator only`,
    /current_user_role\(\) is distinct from 'Administrator'|current_user_role\(\) = 'Administrator'/.test(b ?? ''))
}
ok('a charge has to say what it is for', /Say what the client is being charged for/.test(raise ?? ''))
ok('...and be more than nothing', /has to be more than nothing/.test(raise ?? ''))
ok('cancelling asks why', /Say why it is being cancelled/.test(cancel ?? ''))

/*
 * ONCE IT HAS RIDDEN AN ISSUED PAYOVER IT IS ON AN INVOICE THE CLIENT HOLDS. The payover's own
 * rule is that a correction is a line in the NEXT run, never a change to one that went out.
 */
ok('a charge on an issued payover is not cancelled',
  /not public\.payover_run_is_open\(coalesce\(v_status, 'paid'\)\)/.test(cancel ?? ''))
ok('...and is told to credit it next time', /Credit it in the next run instead/.test(cancel ?? ''))
ok('a paid charge is not cancelled either', /A refund is a credit, not a cancellation/.test(cancel ?? ''))
/* AND A SET-OFF IS NOT PAID TWICE -- once in money and once in a payover the client never got. */
ok('a charge that comes off a payover is not also paid in money',
  /the client does not pay it separately/.test(paid ?? ''))

/* ---------------- the payover nets it ---------------- */

ok('a charge is a line kind on the run',
  /line_kind in \('trust', 'ptc', 'reversal', 'carried', 'charge'\)/.test(sql))
ok('...and the run carries what came off it',
  /add column if not exists charges_set_off numeric\(12,2\) not null default 0/.test(sql))
ok('the run takes the charges off the payover',
  /- t\.charges/.test(recompute ?? ''))
ok('...summed from the charge lines',
  /sum\(l\.charge_amount\)\s+filter \(where l\.line_kind = 'charge'\)/.test(recompute ?? ''))
/*
 * AND A CHARGE IS EXCLUDED FROM EVERY OTHER SUM BY NAME. It carries nothing in the payment
 * columns, and leaving it inside `line_kind <> 'carried'` counts its zero rows into filters that
 * are about payments -- which reads right and quietly shifts an average.
 */
check('every payment figure excludes the charge lines',
  (recompute.match(/line_kind not in \('carried','charge'\)/g) ?? []).length, 7)
no('...and none of them still says only carried', /line_kind <> 'carried'/.test(recompute ?? ''))

ok('building a run claims the charges that are set off',
  /c\.settlement = 'set_off'\s*\n\s*and c\.payover_run_id is null/.test(build ?? ''))
/* AN INVOICE IS THE OTHER HALF OF THE FIRM'S EXAMPLE and must stay off the run: that one the
   client pays directly, and netting it as well would collect it twice. */
ok('...and leaves an invoice alone', /settlement = ''?invoice''?.{0,120}NOT claimed/s.test(build ?? ''))
ok('...and never a cancelled or already-paid one',
  /and c\.cancelled_at is null\s*\n\s*and c\.paid_at is null/.test(build ?? ''))
/* A REBUILD LETS GO FIRST, or the charges stay pointing at a run whose lines have gone. */
ok('a rebuild releases the charges it was carrying',
  /update public\.client_charges set payover_run_id = null where payover_run_id = v_run/.test(build ?? ''))
ok('...and so does voiding one',
  /update public\.client_charges set payover_run_id = null where payover_run_id = p_run/.test(voidRun ?? ''))

/* AND THE FIGURE IS FROZEN ON AN ISSUED INVOICE, or a charge attached afterwards would change
   what the client was told they were being paid. */
ok('charges_set_off is one of the frozen figures',
  /new\.carried_in, new\.charges_set_off, new\.net_payover/.test(guard ?? ''))
ok('...on both sides of the comparison',
  /old\.carried_in, old\.charges_set_off, old\.net_payover/.test(guard ?? ''))

/* ---------------- the statement ---------------- */

/*
 * THE PAYOVER IS SHOWN GROSS AND THE CHARGE AS ITS OWN LINE -- the firm's sequence names the two
 * separately. net_payover already has the charge off it, so it is added back on the due line and
 * deducted again on the charge line; the pair nets to what actually left the bank.
 */
ok('the statement shows the payover before the charge came off',
  /r\.net_payover \+ r\.charges_set_off as amount/.test(account ?? ''))
ok('...and the charge as its own deduction', /'charge_set_off'/.test(account ?? ''))
ok('...a second behind it, so they always read in that order',
  /r\.approved_at \+ interval '1 second'/.test(account ?? ''))
for (const kind of ['payover_due', 'payover_paid', 'invoice_raised', 'invoice_paid']) {
  ok(`the statement has a ${kind} entry`, new RegExp(`'${kind}'`).test(account ?? ''))
}
/* AN APPROVED RUN IS WHERE IT STARTS. Until then the figures still move, and a statement showing a
   working document would change under the client. */
ok('only an issued payover reaches the statement',
  /r\.status in \('approved','sent','paid'\)/.test(account ?? ''))
ok('a cancelled charge is off the statement entirely',
  (account.match(/c\.cancelled_at is null/g) ?? []).length >= 3)
ok('the balance runs down the entries in order',
  /sum\(e\.amount\) over \(order by e\.sort_at, e\.kind/.test(account ?? ''))

/* ---------------- nothing new is reachable by a stranger ---------------- */

/*
 * AND FOUR THAT ALREADY WERE, found by writing this list. `void_payover_run` had no role guard of
 * its own either, so anybody reaching the API could throw away a client's working payover.
 */
for (const fn of [
  'raise_client_charge(uuid, text, text, numeric, numeric, text, uuid, date)',
  'cancel_client_charge(uuid, text)', 'mark_client_charge_paid(uuid, text, timestamptz)',
  'client_account(uuid)', 'recompute_payover_run(uuid)', 'void_payover_run(uuid)',
]) {
  const inList = new RegExp(`'${fn.replace(/[()[\]]/g, (c) => `\\${c}`)}'`).test(sql)
  ok(`${fn} is revoked from anon`, inList)
}
ok('payover_run_blockers is revoked too',
  /revoke execute on function public\.payover_run_blockers\(uuid\) from public, anon/.test(sql))
ok('payover_invoice_number as well',
  /revoke execute on function public\.payover_invoice_number\(uuid, date\) from public, anon/.test(sql))
ok('and voiding a run now asks who is asking',
  /current_user_role\(\) is distinct from 'Administrator'/.test(voidRun ?? ''))

/* ---------------- an overpayment is a credit to dispose of ---------------- */

const dispose = liveBody('dispose_excess_credit')
const blockers = liveBody('payover_run_blockers')
ok('schema.sql defines dispose_excess_credit', typeof dispose === 'string' && dispose.length > 80)

/*
 * IT IS NOT SUSPENSE, AND THAT IS THE WHOLE DESIGN. Suspense means nobody knows whose the money
 * is; an excess credit's owner is the debtor, on an account with a name on it. The firm asked
 * whether it should go there and be refunded out of it -- asserted as an absence, because the
 * failure would be a fully identified credit dropped into a list of unidentified receipts.
 */
no('an overpayment never reaches suspense', /suspend|suspense/i.test(dispose ?? ''))

ok('there is a trust payment out that is not a payover',
  /create table if not exists public\.trust_payments_out/.test(sql))
/* RECONCILED AGAINST THE BANK like a payover run is, or it is a status change nobody can tie to
   money actually leaving. */
ok('...matched to a line off the statement',
  /bank_line_id uuid references public\.bank_statement_lines\(id\)/.test(sql))
ok('...and Administrator only', /create policy trust_payments_out_select/.test(sql))

/*
 * FOUR DISPOSALS AND NO DEFAULT -- the firm chose "ask every time", because they send the same
 * money to four different places.
 *
 * PARKING WAS THE FOURTH AND ARRIVED LATER, when the firm put the commonest case plainly: "who are
 * we going to pay five rand to? We're going to give the guy a call, and the costs are going to be
 * already more than 20 rand." check-parked-credit holds what parking may and may not do; this only
 * asserts that the closed list is closed.
 */
for (const d of ['refund', 'moved', 'released', 'parked']) {
  ok(`an overpayment can be ${d}`, new RegExp(`'${d}'`).test(dispose ?? ''))
}
ok('...and nothing else',
  /refunded, moved to another account, released to the client, or parked/.test(dispose ?? ''))
ok('a refund has to say who it is payable to', /Say who the refund is payable to/.test(dispose ?? ''))
ok('a move has to say which account', /Say which account it moves to/.test(dispose ?? ''))
ok('...and not the one it is already on', /That is the account it is already on/.test(dispose ?? ''))
ok('every disposal says why', /Say why it is going that way/.test(dispose ?? ''))
ok('deciding twice is refused', /already been dealt with/.test(dispose ?? ''))
/* DECIDED BEFORE THE PAYOVER GOES OUT. Once the run is issued its figures are an invoice the
   client holds, and moving the money then changes what they were told. */
ok('a decision is refused once the payover has gone out',
  /The credit belongs in the next run/.test(dispose ?? ''))

/*
 * AND THE BLOCKER CLEARS. It read "held pending a refund decision" with no way to make one, so one
 * overpayment held the rest of that client's money too -- which is what the firm hit.
 */
ok('only an undecided overpayment holds the run', /a\.excess_disposal is null/.test(blockers ?? ''))
ok('...and it asks for the decision rather than naming a dead end',
  /say what happens to the credit/.test(blockers ?? ''))
no('...no longer calling it a refund decision nobody can make',
  /held pending a refund decision/.test(blockers ?? ''))

/* A RELEASED CREDIT REACHES THE CLIENT, and carries no commission: it is not recovered capital,
   so there is no recovery to be paid on. */
ok('a released credit is added to the payover', /\+ t\.released/.test(recompute ?? ''))
ok('...only where it was actually decided',
  /filter \(where a\.excess_disposal = 'released'\)/.test(recompute ?? ''))
no('...and no commission is taken off it',
  /released \* |commission.{0,20}released/.test(recompute ?? ''))

/* ---------------- the trust creditors, and cash reconciled to them ---------------- */

/*
 * THE FIRM: "does the overpayment then create a trust creditor?" It did not, and neither did
 * anything else -- Raptor had no trust creditor concept at all, so "does your trust account
 * balance to its creditors" could not be answered. Four parties hold money in that account and
 * every cent belongs to one of them.
 */
const onAlloc = liveBody('trust_creditors_on_allocation')
const onRun = liveBody('trust_creditors_on_run')
const onOut = liveBody('trust_creditors_on_payment_out')
const draw = liveBody('draw_from_trust')
const position = liveBody('trust_position')

ok('there is a trust creditors ledger', /create table if not exists public\.trust_creditor_entries/.test(sql))
ok('...with the four parties who hold money there',
  /party text not null check \(party in \('client', 'debtor', 'firm', 'unidentified'\)\)/.test(sql))
/* A LEDGER, SO IT IS WRITTEN AND NEVER EDITED -- check-financial-immutability holds the rest. */
ok('...which cannot be edited through the API',
  /revoke insert, update, delete on public\.trust_creditor_entries from authenticated, anon/.test(sql))

/*
 * THE RECEIPT SPLITS THREE WAYS AND THE THREE ADD BACK TO IT. Checked across every allocation on
 * the book before this was written -- eight of eight to the cent -- which is what makes the
 * identity safe to build a reconciliation on.
 */
ok('the firm is owed its fees, interest and commission',
  /to_interest, 0\) \+ coalesce\(new\.to_costs, 0\)\s*\n\s*\+ coalesce\(new\.commission, 0\) \+ coalesce\(new\.commission_vat, 0\)/.test(onAlloc ?? ''))
ok('the client is owed capital less commission',
  /to_capital, 0\) - coalesce\(new\.commission, 0\)\s*\n\s*- coalesce\(new\.commission_vat, 0\)/.test(onAlloc ?? ''))
ok('the debtor is owed the overpayment', /new\.excess_credit,\s*\n?\s*'Paid more than the account owed/.test(onAlloc ?? ''))

/*
 * A PTC MAKES THE CLIENT A TRUST DEBTOR, NOT A CREDITOR -- the firm's own correction: "the trust
 * can have creditors or debtors, because PTCs of debtors paid to clients owe the trust."
 *
 * No money entered trust, which is why this used to return early and skip the receipt entirely.
 * But the fees, interest and commission were earned and the client owes them, so leaving it out
 * meant the trust position and the payover disagreed about the same money: due_to_bf set it off
 * every month while the trust ledger had never heard of it.
 */
ok('a receipt paid straight to the client is still recorded',
  /if new\.paid_to_client then\s*\n\s*v_firm :=/.test(onAlloc ?? ''))
no('...and no longer skipped altogether',
  /if new\.paid_to_client then return new; end if;/.test(onAlloc ?? ''))
/* NEGATIVE, because the client OWES it. The sign is the whole difference between a receivable and
   a payable, and getting it the wrong way round reads as money the firm is holding. */
ok('...as something the client owes the trust',
  /values \('client', v_company, new\.account_id, -v_firm,/.test(onAlloc ?? ''))
ok('...and says so in the entry', /so they owe the trust the fees and commission/.test(onAlloc ?? ''))
ok('...and neither does a reversed one', /if new\.status = 'reversed' then return new; end if;/.test(onAlloc ?? ''))
ok('...nor demo money', /if coalesce\(v_demo, false\) then return new; end if;/.test(onAlloc ?? ''))

/* APPROVING RECLASSIFIES, PAYING MOVES CASH. The first two are the same money in the same account
   changing whose it is, which is why they hang off the status rather than paid_at. */
ok('a charge set off moves from the client to the firm',
  /'Charges set off against payover '/.test(onRun ?? '') && /'Charges recovered from payover '/.test(onRun ?? ''))
ok('a released overpayment moves from the debtor to the client',
  /'Overpayment released to the client on '/.test(onRun ?? ''))
ok('and paying the payover is what takes it out of trust',
  /old\.paid_at is null and new\.paid_at is not null/.test(onRun ?? ''))
ok('a refund takes the debtor\u2019s credit out',
  /old\.paid_at is null and new\.paid_at is not null/.test(onOut ?? ''))

/*
 * THE FIRM CANNOT DRAW MORE THAN IT HAS EARNED. Drawing against another party's money is a trust
 * shortfall -- the most serious thing that can happen in this account -- so it is refused at the
 * moment of asking rather than found at a reconciliation weeks later, by which time it has gone.
 */
/* A CAPABILITY, NOT A ROLE NAME: a role spelled out here cannot be reached by a grant. */
ok('drawing asks for the trust capability', /has_capability\('finance\.view'\)/.test(draw ?? ''))
ok('...rather than naming the role', !/current_user_role\(\)/.test(draw ?? ''))
/* THE COMPARISON, NOT THE MESSAGE. Asserted on the wording first, which passed happily with the
   test replaced by `if false` -- the sentence sat there unreachable inside a dead branch. */
ok('...and refuses to overdraw', /if p_amount > v_held then/.test(draw ?? ''))
ok('...saying so in the firm\u2019s terms', /Drawing more than is earned is a trust shortfall/.test(draw ?? ''))
ok('...measured against what the firm actually holds',
  /select coalesce\(sum\(amount\), 0\) into v_held[\s\S]{0,160}where party = 'firm'/.test(draw ?? ''))
ok('...and says which transfer it was', /Say which transfer this is/.test(draw ?? ''))

/*
 * AND THE RECONCILIATION TAKES CASH FROM THE BANK, not from Raptor. A balance computed on both
 * sides by the same code reconciles to itself and proves nothing.
 */
/*
 * READ OUT OF THE `cash` CTE ITSELF, not the function. Both assertions were written against the
 * whole body and both passed with the cash side's filter replaced by `true` -- the `unplaced` CTE
 * further down has the same two lines, so the patterns matched it instead and the reconciliation
 * would have compared every bank account in the firm against the trust creditors.
 */
const cashCte = (() => {
  const at = (position ?? '').indexOf('with cash as (')
  if (at < 0) return ''
  /* THE CTE'S OWN CLOSING BRACKET, which is at the start of a line. Looking for the first '),'
     landed inside `coalesce(sum(l.amount), 0)` and returned a few characters -- so the assertions
     below failed on correct code until this was read properly. */
  const end = (position ?? '').indexOf('\n  ),', at)
  return end < 0 ? '' : position.slice(at, end)
})()
ok('the cash side of the reconciliation really is its own block', cashCte.length > 60)
ok('trust cash is read off the bank statement',
  /from public\.bank_statement_lines l/.test(cashCte))
ok('...on the trust account, not any account',
  /l\.bank_account = f\.trust_account_number/.test(cashCte))
ok('...and the difference is named rather than hidden',
  /c\.bal - \(\(h\.owed_out \+ u\.bal\) - h\.owed_in\)/.test(position ?? ''))

/*
 * AND THE TWO SIDES ARE REPORTED APART. Summing a receivable into a smaller payable hides it, and
 * a reconciliation that reads better than the truth is the one kind worse than none.
 */
ok('what is owed OUT of trust is counted on its own',
  /filter \(where bal > 0\), 0\) as owed_out/.test(position ?? ''))
ok('...and what is owed TO it separately',
  /filter \(where bal < 0\), 0\) as owed_in/.test(position ?? ''))
/*
 * A CLIENT NETS ACROSS THEIR BOOK, because that is how they are paid -- one payover run for the
 * company. Netting per account showed a client owed R100 on one file and owing R50 on another as a
 * R100 creditor AND a R50 debtor, when the firm will hand them R50: both sides overstated.
 */
ok('a client nets across their whole book, a debtor per account',
  /case when party = 'client' then company_id::text else coalesce\(account_id::text, party\) end/.test(position ?? ''))
/* AN UNPLACED RECEIPT IS A CREDITOR WITH NO NAME ON IT YET -- counted, because the bank has the
   money whether or not anybody has said whose it is. */
ok('receipts nobody has placed are still owed to somebody',
  /l\.direction = 'credit' and l\.status = 'unallocated'/.test(position ?? ''))
ok('...and every party is reported separately',
  ['client', 'debtor', 'firm', 'unidentified'].every((p) =>
    new RegExp(`filter \\(where party = '${p}'\\)`).test(position ?? '')))

console.log(`\ncheck-client-account: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
