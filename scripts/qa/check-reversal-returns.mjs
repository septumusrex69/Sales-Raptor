/**
 * A REVERSED RECEIPT COMES BACK TO THE DAY'S QUEUE.
 *
 * THE FIRM, ASKED WHERE THE MONEY GOES: "not really the suspense account -- it goes back into a
 * state ready for approval." Suspense was my answer and it was the wrong one. Suspense is money in
 * the trust account nobody has been able to PLACE; a reversed receipt is money whose place was
 * decided and decided wrongly, and the screen where that decision gets taken is the morning's
 * approval list. One queue for a payment that needs somebody, not two.
 *
 * FOUR THINGS HOLD THIS UP AND EACH IS A DIFFERENT WAY TO LOSE MONEY:
 *
 *   - THE RECEIPT COMES BACK AT ALL. Without the copy, reversing a wrongly-placed R 5 000 takes it
 *     off the wrong debtor and leaves it nowhere -- off the book entirely, with nobody able to put
 *     it where it belongs.
 *   - IT COMES BACK ONLY ONCE. Only an APPROVED payment breeds a copy. Without that, reversing the
 *     copy makes another copy and a bounced cheque can never be got rid of.
 *   - THE REVERSED ROW STAYS. The firm's choice between the two ways of doing it: account_payments
 *     is never edited, so the reversal is permanent and carries its reason, and the same money is
 *     raised again as a NEW receipt pointing back at it.
 *   - AND THE QUEUE SAYS WHY IT IS BACK. A returned receipt that looks like new money gets
 *     approved again exactly as it was, straight back onto the wrong debtor.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-reversal-returns.mjs
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
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const sql = read('supabase/schema.sql')
const lib = read('src/lib/payover.ts')
const screen = read('src/pages/finance/AwaitingApproval.tsx')
const modal = read('src/pages/finance/FinancePayments.tsx')

/* schema.sql is append-only: the LAST definition is the live one, and both spellings exist --
   a function whose return type changed cannot be replaced, so it is dropped and created plainly. */
function liveFn(name) {
  const at = Math.max(
    sql.lastIndexOf(`create or replace function public.${name}(`),
    sql.lastIndexOf(`create function public.${name}(`),
  )
  if (at < 0) return null
  const end = sql.indexOf('$$;', at)
  return end < 0 ? null : sql.slice(at, end + 3)
}

/* ---------------- the link between the two rows ---------------- */

ok('a receipt can say which one it replaces',
  /add column if not exists replaces_payment_id uuid references public\.account_payments \(id\)/.test(sql))

const rev = liveFn('reverse_payment')
ok('the reversal is defined', rev !== null)
ok('...Administrator only, failing closed on a null role',
  /current_user_role\(\) is distinct from 'Administrator'/.test(rev ?? ''))
ok('...and it hands back the copy rather than nothing',
  /create function public\.reverse_payment\(p_payment uuid, p_reason text\)\s*\nreturns uuid/.test(sql))

/* ---------------- it comes back, and only from an approval ---------------- */

ok('an approved receipt is raised again', /if v_pay\.approved_at is not null then/.test(rev ?? ''))
ok('...as a new row on account_payments',
  /insert into public\.account_payments \([\s\S]{0,400}?replaces_payment_id/.test(rev ?? ''))
ok('...pointing back at the one that was reversed', /v_pay\.id\s*\n\s*\)\s*\n\s*returning id into v_copy/.test(rev ?? ''))
/*
 * THE LOOP GUARD. `approved_at is not null` is the whole of it: reversing something still sitting
 * in the queue takes it out, which is how the copy of a cheque that bounced is got rid of. Without
 * the condition every reversal breeds another copy and nothing can ever be removed.
 */
ok('...and an unapproved one breeds nothing',
  /if v_pay\.approved_at is not null then[\s\S]{0,700}?end if;\s*\n\s*return v_copy;/.test(rev ?? ''))

/* THE BANK'S FACTS TRAVEL AND ARE NOT RE-TYPED: the same money, the same day it landed. */
ok('the copy keeps the day the money arrived', /v_pay\.received_at, v_pay\.amount/.test(rev ?? ''))
ok('...and the bank line it came from', /v_pay\.bank_line_id/.test(rev ?? ''))
/* NOT the Swordfish id -- it is unique, and a second row carrying it would be refused. */
ok('...and not the imported id, which is unique', !/swordfish_payment_id,/.test(rev ?? ''))

/*
 * AND IMPORTED HISTORY IS NOT REVERSED HERE AT ALL. A Swordfish receipt reversed and raised again
 * would be re-split under TODAY's schedule against figures a client was invoiced on years ago --
 * the one thing swordfishImport rule 1 exists to prevent. Corrections are the firm's decision,
 * case by case, so it says to ask.
 */
ok('an imported payment is refused rather than re-split',
  /swordfish_payment_id is not null then[\s\S]{0,200}?Imported history is not corrected here/.test(rev ?? ''))

/* ---------------- and the reversed row is still there ---------------- */

/* NOT AN UN-APPROVAL. Clearing approved_at would be an edit to a ledger row and would leave
   nothing on it saying the reversal ever happened. */
ok('the reversal never takes an approval back', !/set approved_at = null/.test(rev ?? ''))
ok('...and never clears the reversal it just wrote', !/set reversed_at = null/.test(rev ?? ''))

/* ---------------- the queue shows it, and says why ---------------- */

const queue = liveFn('payments_awaiting_approval')
ok('the queue is defined', queue !== null)
ok('...and carries why a receipt is back',
  /came_back_from uuid, came_back_reason text, came_back_on date/.test(queue ?? ''))
ok('...read off the row it replaces',
  /left join public\.account_payments was on was\.id = p\.replaces_payment_id/.test(queue ?? ''))
/* The copy is unapproved and not reversed, so the queue's own filter is what puts it on the list;
   asserted so that "it comes back" cannot be true in the function and false on the screen. */
ok('...on the same terms as any other waiting payment',
  /p\.approved_at is null\s*\n\s*and p\.reversed_at is null/.test(queue ?? ''))

/* THE MAPPER. CLAUDE.md's own warning: a column in the function, the type and the select but
   missing from the hand-written mapper reads as undefined for ever and nothing fails. */
ok('the library reads the three back', /cameBackFrom: s\(r\.came_back_from\)/.test(lib)
  && /cameBackReason: s\(r\.came_back_reason\)/.test(lib)
  && /cameBackOn: s\(r\.came_back_on\)/.test(lib))
ok('the screen marks a returned receipt', /Came back/.test(screen))
ok('...and tints the row so it is not approved unread', /r\.cameBackFrom \? 'bg-amber-50\/50'/.test(screen))
/* SAID BEFORE IT IS PRESSED, on the box that does it. */
ok('the reverse box says where the money goes', /comes back to <strong[\s\S]{0,60}?Awaiting approval/.test(modal))

/* ---------------- correcting the debtor, and only the debtor ---------------- */

const move = liveFn('set_payment_account')
ok('an unapproved receipt can be put on the right debtor', move !== null)
ok('...by somebody who may approve payments', /if not public\.may_approve_payment\(\) then/.test(move ?? ''))
/*
 * THE TWO REFUSALS ARE WHAT MAKE THIS NOT AN EDIT TO A FINANCIAL RECORD. An unapproved payment has
 * nothing split, no fee raised and no remittance run against it. The moment it is approved this
 * must refuse, or it is a way to move money that has already been invoiced to a client.
 */
ok('...never once it has been approved and split',
  /if v_pay\.approved_at is not null then[\s\S]{0,160}?Reverse it instead/.test(move ?? ''))
ok('...and never on a reversed one', /if v_pay\.reversed_at is not null then/.test(move ?? ''))
ok('...onto an account that exists',
  /not exists \(select 1 from public\.debtor_accounts where id = p_account\)/.test(move ?? ''))
/*
 * AND ONLY THE ACCOUNT. The firm's answer to what the queue may change: the debtor, and nothing
 * else. The amount and the date are what the bank said, and a function that could set them would
 * be a way to turn R 5 000 into R 500 with nothing on the ledger to show it.
 */
ok('the amount and the date are not its business',
  /update public\.account_payments set account_id = p_account where id = p_payment;/.test(move ?? '')
  && !/set amount =/.test(move ?? '') && !/received_at =/.test(move ?? ''))

/* ---------------- and the browser reaches all of it through the one library ---------------- */

ok('the screen moves a payment through the library', /setPaymentAccount\(payment\.paymentId, chosen\.id\)/.test(screen))
ok('...which asks the function', /\.rpc\('set_payment_account'/.test(lib))
/* NOT AT THE TABLE. account_payments has no update policy, so a PATCH from the browser matches no
   rows and reports success -- see check-financial-immutability, which holds this in general. */
ok('...rather than writing at the table', !/from\('account_payments'\)[\s\S]{0,80}\.update/.test(screen))

console.log(`\ncheck-reversal-returns: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
