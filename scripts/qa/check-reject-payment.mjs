/**
 * THROWING A RECEIPT OUT OF THE APPROVAL QUEUE.
 *
 * THE FIRM: "there are no way to reject payments that are imported. From an import sheet. I don't
 * know if we can quickly build that in. So there's some ones waiting in the queue to be approved,
 * but I don't want to approve them. I want to start throwing things in."
 *
 * THERE ARE NOW THREE WORDS FOR THREE DIFFERENT THINGS AND THIS FILE MOSTLY EXISTS TO KEEP THEM
 * APART, because the money ends up in a different place for each and the screen cannot tell a
 * person which one they want if the code cannot either:
 *
 *   SUSPENSE   "I do not know whose this is yet."  The payment survives, waiting.
 *   REVERSAL   the payment WAS approved and posted. Balances moved, the four ledgers carry
 *              entries, a client may already have been paid -- so undoing it writes CONTRA
 *              entries. The firm: "everything that's been logged and booked as stamped and
 *              cannot be changed."
 *   REJECTION  nothing ran. allocate_payment was never called, no balance moved, no payover run
 *              saw it. There is nothing to reverse, which is why it is a flag on the payment and
 *              not an entry anywhere: a ledger pair cancelling something that never reached the
 *              ledger would INVENT a transaction.
 *
 * THREE THINGS THIS CAUGHT, AND THE FIRST IS WHY IT IS WORTH HAVING:
 *
 *   1. THE RELEASE WAS A SILENT NO-OP ON EVERY REAL ROW. reject_payment finds the statement line
 *      through `account_payments.bank_line_id` -- which `place_bank_line`, the ordinary one-to-one
 *      path, never wrote. Null there meant the payment was marked rejected, vanished off the
 *      queue, and the bank line stayed `allocated` and still pointing at it: money held by a
 *      payment nobody was ever going to make, off every screen that could show it. Nothing failed.
 *      That is the hand-written-mapper shape CLAUDE.md warns about, in a function rather than a
 *      mapper.
 *   2. approve_payment DID NOT REFUSE A REJECTED RECEIPT. The queue stops offering one, which is
 *      not the same as the row being unapprovable -- a browser holding a queue from before the
 *      rejection posts it straight through, and by then the bank line may be on a DIFFERENT
 *      payment, so one statement line is allocated twice.
 *   3. A SPLIT LINE WOULD HAVE BEEN RELEASED WITH ITS SIBLINGS STILL LIVE. A debt counsellor's
 *      R5 000 is one credit and five payments; rejecting one part must not put the whole line
 *      back on the unallocated queue with four payments hanging off it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-reject-payment.mjs
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
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const sql = read('supabase/schema.sql')
const lib = code('src/lib/payover.ts')
const queue = code('src/pages/finance/AwaitingApproval.tsx')

/*
 * schema.sql IS APPEND-ONLY, SO THE LAST DEFINITION IS THE LIVE ONE, and both spellings exist --
 * a function whose OUT columns changed cannot be replaced, so it is dropped and created plainly.
 * `protect_bank_statement_line` and `payments_awaiting_approval` are each in this file more than
 * once; reading with indexOf asserts against the copy this work replaced.
 *
 * AND IT TAKES THE OPENING PAREN. The bare name also appears in the function's own revoke line and
 * in its comment, so a plain lastIndexOf lands on a one-line statement and returns nothing --
 * which is a vacuous pass, not a failure.
 */
function liveBody(name) {
  const at = Math.max(
    sql.lastIndexOf(`create or replace function public.${name}(`),
    sql.lastIndexOf(`create function public.${name}(`),
  )
  if (at < 0) return null
  const end = sql.indexOf('$$;', at)
  return end < 0 ? null : sql.slice(at, end + 3)
}

const reject = liveBody('reject_payment')
const unreject = liveBody('unreject_payment')
const batch = liveBody('reject_payments')
const rejected = liveBody('payments_rejected')
const approve = liveBody('approve_payment')
const awaiting = liveBody('payments_awaiting_approval')
const place = liveBody('place_bank_line')
const guard = liveBody('protect_bank_statement_line')

/* PRESENCE BEFORE ANYTHING ELSE. Every assertion below reads one of these eight, and a null
   would make `String(null).includes(...)` false rather than throwing -- which reports as a wall of
   failures nobody can read, or, for the `no(...)` assertions, as a pass over nothing. */
for (const [name, body] of Object.entries({
  reject_payment: reject, unreject_payment: unreject, reject_payments: batch,
  payments_rejected: rejected, approve_payment: approve,
  payments_awaiting_approval: awaiting, place_bank_line: place,
  protect_bank_statement_line: guard,
})) ok(`schema.sql defines ${name}`, typeof body === 'string' && body.length > 100)

/* ---------------- the three columns, and what they are for ---------------- */

ok('the rejection is written on the payment', /add column if not exists rejected_at timestamptz/.test(sql))
ok('...with who did it', /add column if not exists rejected_by uuid references public\.profiles\(id\)/.test(sql))
ok('...and why', /add column if not exists rejection_reason text/.test(sql))

/*
 * THE COMMENT SAYS WHICH OF THE THREE THIS IS. A column called `rejected_at` beside `reversed_at`
 * and `suspended_at` is three nearly-identical timestamps, and the next person to read the table
 * has nothing but the comment to tell them that one of them means no money moved.
 */
const col = sql.slice(sql.lastIndexOf('comment on column public.account_payments.rejected_at'))
  .slice(0, 800)
ok('the column says it is not a reversal', /NOT a reversal/.test(col))
ok('...and not a suspense either', /NOT a suspense either/.test(col))
ok('...and that nothing was posted', /never reaches a payover run/.test(col))

/* ---------------- rejecting one ---------------- */

ok('only somebody who may approve may reject', /if not public\.may_approve_payment\(\) then/.test(reject))
ok('...and a reason is required', /Say why it is being rejected/.test(reject))
ok('...blank-or-whitespace is no reason at all',
  /nullif\(btrim\(coalesce\(p_reason, ''\)\), ''\)/.test(reject))

/*
 * AN APPROVED PAYMENT IS REFUSED, AND THE MESSAGE NAMES THE RIGHT TOOL. Rejecting one silently
 * would leave the balances moved and no contra entries behind them -- the ledger would say money
 * was allocated and the payment would say it never happened.
 */
ok('an approved payment cannot be rejected', /approved_at is not null/.test(reject))
ok('...and is told to reverse it instead', /Reverse it instead/.test(reject))
ok('a reversed payment cannot be rejected either', /reversed_at is not null/.test(reject))

/* ALREADY REJECTED IS A NO-OP. Two people clearing one morning's queue is ordinary, and the
   second must not see an error for work already done -- the same rule approve_payment follows. */
ok('rejecting twice is a no-op, not an error',
  /if v_pay\.rejected_at is not null then return; end if;/.test(reject))

/* SUSPENSE IS CLEARED. A payment can be in suspense AND wrong, and `suspended_payments` and
   `payments_rejected` must not both claim the same row. */
ok('a parked payment leaves suspense when it is rejected',
  /suspended_at = null, suspense_reason = null/.test(reject))

/* NOTHING IS POSTED. This is the whole distinction from a reversal, and it is checkable: the
   function must not reach the engine or any ledger. */
no('a rejection does not allocate', /allocate_payment/.test(reject))
no('...and writes to no ledger', /insert into public\.(account_ledger|fee_ledger|commission_ledger|trust_ledger)/.test(reject))

/* ---------------- FINDING THE BANK LINE, which is where it was broken ---------------- */

/*
 * THE LINE IS LOOKED FOR BOTH WAYS ROUND. `bank_line_id` on the payment is the authoritative link
 * and `bank_statement_lines.payment_id` is how the queue itself finds the same line; a payment
 * written before place_bank_line was fixed has only the second. Reading one direction is what made
 * this a silent no-op on 8 of 8 staging rows.
 */
ok('the statement line is found through either link',
  /coalesce\(\s*v_pay\.bank_line_id,\s*\(select l\.id from public\.bank_statement_lines l where l\.payment_id = p_payment\)\)/.test(reject))

/*
 * AND THE ANSWER IS WRITTEN DOWN BEFORE THE LINK IS CUT. The release clears the line's own
 * payment_id, so after that instant the reverse lookup finds nothing -- this is the last moment at
 * which "put it back" can still learn which line to restore.
 */
ok('...and recorded on the payment while it still can be', /bank_line_id = v_line,/.test(reject))

/*
 * place_bank_line WRITES IT. This is the fix the no-op was hiding: the ordinary one-to-one path
 * created the payment without it, so the column the schema calls authoritative read null on every
 * receipt placed off a statement.
 */
ok('place_bank_line records which line the payment came from',
  /created_by, bank_line_id\s*\)\s*values/.test(place))
ok('...and passes the line itself', /false, auth\.uid\(\), p_line/.test(place))
ok('...and a database written before that is backfilled',
  /update public\.account_payments p\s*set bank_line_id = l\.id\s*from public\.bank_statement_lines l\s*where l\.payment_id = p\.id and p\.bank_line_id is null;/
    .test(sql.slice(sql.indexOf('REJECTING A RECEIPT OFF THE APPROVAL QUEUE'))))

/* ---------------- where the line goes, which is the second argument ---------------- */

ok('the ordinary case puts the line back on the unallocated list',
  /status = case when p_not_a_receipt then 'excluded' else 'unallocated' end/.test(reject))
ok('...and it keeps nothing of the guess',
  /account_id = case when p_not_a_receipt then account_id else null end/.test(reject))
ok('...and reads as unplaced again', /placed_at = null, placed_by = null/.test(reject))
ok('...and the payment stops holding it', /payment_id = null,/.test(reject))

/*
 * A SPLIT LINE IS NOT RELEASED WHILE ITS SIBLINGS ARE LIVE. One credit becoming five payments is
 * the debt counsellor case split_bank_line was built for; rejecting one part and putting the whole
 * line back on the unallocated queue would offer money four live payments are already against.
 */
ok('a split line counts its other payments first',
  /where s\.bank_line_id = v_line and s\.id <> p_payment/.test(reject))
ok('...and only the rejected and reversed ones do not count',
  /and s\.rejected_at is null and s\.reversed_at is null/.test(reject))
ok('...and the line is released only when none are left',
  /if v_siblings = 0 then/.test(reject))

/* ---------------- putting it back ---------------- */

ok('putting it back is guarded too', /if not public\.may_approve_payment\(\) then/.test(unreject))
ok('...and un-rejecting what was never rejected is a no-op',
  /if v_pay\.rejected_at is null then return; end if;/.test(unreject))

/*
 * REFUSED WHERE THE LINE HAS MOVED ON. The point of rejecting is that the bank line goes back on
 * the queue, so by the time somebody presses Put it back it may carry a different payment.
 * Re-pointing it would quietly take the money off a payment somebody has since made properly.
 */
ok('a line since placed on another payment refuses the undo',
  /if v_line\.payment_id is not null and v_line\.payment_id <> p_payment then/.test(unreject))
ok('...and says so in the firm’s terms',
  /has since been placed on another payment/.test(unreject))
ok('the reason is cleared with the rejection',
  /rejected_at = null, rejected_by = null, rejection_reason = null/.test(unreject))

/* AND ON A SPLIT LINE IT RESTORES THE STATUS WITHOUT CLAIMING THE LINE -- split_bank_line's own
   rule is that a line that became five payments has no single payment_id. */
ok('the undo does not claim a split line',
  /payment_id = case when v_siblings = 0 then p_payment else payment_id end/.test(unreject))

/* ---------------- many at once ---------------- */

ok('a batch is guarded before it starts', /if not public\.may_approve_payment\(\) then/.test(batch))
ok('...and is built on the single rejection rather than repeating it',
  /perform public\.reject_payment\(v_id, p_reason, p_not_a_receipt\);/.test(batch))
/* ONE REFUSAL DOES NOT TAKE THE OTHER TWENTY-NINE WITH IT -- each row in its own sub-transaction,
   the same shape approve_payments uses, because two people on one morning's queue is ordinary. */
ok('...one row at a time, each in its own block', /exception when others then/.test(batch))
ok('...and the refusals come back rather than being swallowed',
  /v_problems := array_append\(v_problems, sqlerrm\);/.test(batch))
ok('a null list is an empty list, not an error',
  /coalesce\(p_payments, array\[\]::uuid\[\]\)/.test(batch))

/* ---------------- what was rejected, so the undo is reachable ---------------- */

ok('the rejected list is guarded', /where public\.may_approve_payment\(\)/.test(rejected))
ok('...and shows only what was rejected', /and p\.rejected_at is not null/.test(rejected))
ok('...and never a demo row', /and not p\.is_demo/.test(rejected))
ok('...and can be asked for one day only',
  /p_since is null or \(p\.rejected_at at time zone 'Africa\/Johannesburg'\)::date >= p_since/.test(rejected))
/* THE LINE IS JOINED THROUGH bank_line_id, which is the only direction left once the release has
   cleared the line's own payment_id. Joining on payment_id would return a null line for every
   rejected row -- and the screen's "where the money went" column would be permanently blank. */
ok('the statement line is joined the way that still works after a release',
  /left join public\.bank_statement_lines l on l\.id = p\.bank_line_id/.test(rejected))
ok('...and it says where the line went', /l\.status, l\.id/.test(rejected))

/* ---------------- and the queue stops offering it ---------------- */

ok('the approval queue skips a rejected receipt', /and p\.rejected_at is null/.test(awaiting))
/* THE LIVE COPY, NOT AN EARLIER ONE. The filter had to be added to a function this file already
   contained twice; asserting on the first copy is how a correct change reads as broken, and
   asserting on a superseded copy is how a broken one reads as correct. */
ok('...in the definition that is actually live',
  awaiting.lastIndexOf('and p.rejected_at is null') > awaiting.indexOf('and p.suspended_at is null'))

/*
 * AND APPROVE REFUSES IT, which is the part the queue filter cannot do. approve_payment is an RPC
 * and approve_payments takes a list of ids, so a browser holding a queue from before the rejection
 * posts one straight through -- onto a bank line that may since be on a different payment, which
 * allocates one statement line twice on a row no screen shows.
 */
ok('a rejected receipt cannot be approved', /if v_pay\.rejected_at is not null then/.test(approve))
ok('...and is told to put it back first', /Put it back first/.test(approve))
/* AND THE REFUSAL IS BEFORE THE ALREADY-APPROVED NO-OP, or a rejected row that somehow carries an
   approved_at returns quietly instead of being reported. */
ok('...before the already-approved no-op',
  approve.indexOf('rejected_at is not null') < approve.indexOf('if v_pay.approved_at is not null then return'))

/* ---------------- the bank line's own guard, and the narrow hole in it ---------------- */

ok('the bank’s own facts are still frozen', /new\.amount := old\.amount;/.test(guard))
ok('...including the description the debtor typed', /new\.description := old\.description;/.test(guard))
/*
 * THE EXCEPTION IS A CLEARING ONLY, AND IT ASKS THE PAYMENT RATHER THAN THE CALLER. An ordinary
 * unlink, a swap to a different payment and a clearing of an approved one are all refused exactly
 * as before; only a null payment_id whose outgoing payment really carries a rejection gets through.
 */
/* Since 10 Oct a reversed one may too, when nothing live holds the line (reverse_payment_to_unplaced;
   held in check-reversal-returns) -- so the rejection is one arm of an `or`. */
ok('a rejected payment may release its line',
  /not \(new\.payment_id is null\s*and \(exists \(select 1 from public\.account_payments p\s*where p\.id = old\.payment_id and p\.rejected_at is not null\)/.test(guard))
ok('...and anything else still cannot', /new\.payment_id := old\.payment_id;/.test(guard))

/* ---------------- the four are not reachable by a stranger ---------------- */

/*
 * Supabase grants EXECUTE on a new public-schema function to anon by DEFAULT, so a create IS a
 * grant. `reject_payment` reachable by a stranger lets anybody take a receipt off the queue and
 * put its bank line back on the unallocated list. The function's own guard is the second lock.
 *
 * THE LAST REVOKE BLOCK IS THE LIVE ONE, for the same append-only reason, and it must restate the
 * WHOLE list -- a block carrying only the new names leaves every other function un-revoked on a
 * fresh database.
 */
const revoke = sql.slice(sql.lastIndexOf('revoke execute on function public.%s from public, anon'))
const lastList = sql.lastIndexOf('foreach fn in array array[')
const list = sql.slice(lastList, sql.indexOf('] loop', lastList))
ok('there is a revoke block at the end of the file', revoke.length > 0 && lastList > 0)
for (const fn of [
  'reject_payment(uuid, text, boolean)', 'reject_payments(uuid[], text, boolean)',
  'unreject_payment(uuid)', 'payments_rejected(date)',
]) ok(`${fn} is revoked from anon`, list.includes(`'${fn}'`))
/* AND THE RESTATEMENT REALLY IS WHOLE -- the two re-created above among them, because a
   create or replace keeps the old grants but a fresh database's first create does not. */
for (const fn of [
  'approve_payment(uuid)', 'payments_awaiting_approval()', 'place_bank_line(uuid, uuid)',
  'payments_posted(date, date)', 'suspend_payment(uuid, text)',
]) ok(`...and ${fn} is still in the restated list`, list.includes(`'${fn}'`))

/* ---------------- the browser side ---------------- */

ok('the library can read what was rejected', /export async function fetchRejectedPayments\(/.test(lib))
ok('...reject a batch', /export async function rejectPayments\(/.test(lib))
ok('...and put one back', /export async function unrejectPayment\(/.test(lib))
ok('the three RPCs are the ones the database has',
  ['payments_rejected', 'reject_payments', 'unreject_payment']
    .every((r) => lib.includes(`.rpc('${r}'`)))

/*
 * EVERY OUT COLUMN REACHES THE MAPPER. `payover.ts` lists its fields BY HAND, which is the shape
 * CLAUDE.md names twice: a column in the function, in the type and in the select but missing from
 * the mapper reads as `undefined` for ever and nothing fails. `diary_capacity` sat in that state
 * for months. So the mapper is held against the function's own signature.
 */
const declared = rejected.slice(rejected.indexOf('returns table('))
const outs = [...declared.slice(0, declared.indexOf(')\nlanguage'))
  .matchAll(/([a-z_]+) (?:uuid|text|date|numeric|timestamptz|boolean)\b/g)].map((m) => m[1])
ok('payments_rejected really declares its columns here', outs.length >= 15)
const mapper = lib.slice(lib.indexOf('export async function fetchRejectedPayments('))
  .slice(0, lib.slice(lib.indexOf('export async function fetchRejectedPayments(')).indexOf('\n}\n'))
const missed = outs.filter((c) => !mapper.includes(`r.${c}`))
check('every column payments_rejected returns is read by the mapper', missed.join(','), '')

/* ---------------- the screen ---------------- */

ok('the queue can reject what is ticked',
  /const pickedRows = useMemo\(\(\) => rows\.filter\(\(r\) => picked\.has\(r\.paymentId\)\)/.test(queue)
  && /setRejecting\(pickedRows\)/.test(queue))
ok('...and one row on its own', /setRejecting\(\[r\]\)/.test(queue))
ok('...and there is a box that asks why', /function RejectModal\(/.test(queue))
/*
 * A REASON IS REQUIRED ON THE SCREEN TOO, not only in the database. A disabled button is how
 * somebody learns it before they have typed, rather than after a round trip.
 *
 * READ OUT OF RejectModal'S OWN BODY, not the file. SuspendModal on this same screen asks for a
 * reason in exactly the same two lines, so both of these passed against IT -- the break test that
 * deleted the real one came back green. That is the vacuous pass CLAUDE.md warns about, found by
 * breaking the thing rather than by reading the assertion.
 */
const rejectModal = (() => {
  const at = queue.indexOf('function RejectModal(')
  if (at < 0) return ''
  /* to the next top-level function, which is where this component ends */
  const next = queue.indexOf('\nfunction ', at + 1)
  return queue.slice(at, next < 0 ? queue.length : next)
})()
ok('RejectModal really is a component in this file', rejectModal.length > 500)
ok('the button is dead until there is a reason',
  /disabled=\{busy \|\| !reason\.trim\(\)\}/.test(rejectModal))
ok('...and pressing return early does nothing', /if \(!reason\.trim\(\)\) return/.test(rejectModal))

/*
 * THE CHOICE ABOUT THE STATEMENT LINE IS ONLY ASKED WHERE THERE IS ONE. A receipt captured by hand
 * has no line, so the question would be about nothing -- and offering it suggests the firm is
 * deciding something they are not.
 */
ok('the line question counts the receipts that have one',
  /const fromTheBank = payments\.filter\(\(p\) => p\.bankLineId\)\.length/.test(rejectModal))
ok('...and is asked only then', /\{fromTheBank > 0 && \(/.test(rejectModal))

/* THE UNDO IS BESIDE THE MISTAKE. Rejecting happens at speed down a list, which is when the wrong
   row gets pressed; an undo in a screen somebody has to find is one nobody uses. */
ok('what was thrown out today is shown over the queue', /Rejected today/.test(queue))
ok('...with the reason it was thrown out', /r\.rejectionReason/.test(queue))
ok('...and a way back', /unrejectPayment\(id\)/.test(queue))
/* TODAY'S ONLY. The record is permanent and `payments_rejected` answers for any day; a strip of
   fifty Put it back buttons over the queue is noise on a screen whose job is the queue. */
ok('...and it is today’s, not every rejection ever',
  /fetchRejectedPayments\(new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\)/.test(queue))

/*
 * AND THE STRIP SURVIVES AN EMPTY QUEUE, because rejecting the last receipt is HOW the queue
 * empties -- "I want to start throwing things in" ends with nothing left on it. The screen
 * returned early on `rows.length === 0`, so the Put it back button disappeared at the one moment
 * it was most likely to be wanted. It is one component drawn in two places rather than two copies.
 */
ok('the strip is a component, not markup inside the table',
  /function RejectedToday\(\{ rejected, busy, onPutBack \}/.test(queue))
check('...drawn in both the full and the empty queue',
  (queue.match(/<RejectedToday rejected=\{rejected\} busy=\{busy\} onPutBack=\{putBack\} \/>/g) ?? []).length, 2)
ok('...and it draws nothing when nothing was rejected',
  /if \(rejected\.length === 0\) return null/.test(queue))

/*
 * AND THE EMPTY LINE NO LONGER CLAIMS EVERYTHING WAS APPROVED. It said so unconditionally, which
 * is untrue on exactly the morning this was built for: nothing was approved, eight things were
 * thrown out. CLAUDE.md: a warning that fires when nothing is wrong is worse than no warning --
 * and the same holds for a reassurance that is false.
 */
ok('an empty queue says what actually happened to them',
  /approved or rejected/.test(queue))
ok('...and only where something was in fact rejected',
  /rejected\.length > 0\s*\?\s*'Everything that has arrived has been approved or rejected\.'/.test(queue))

/* THE SCREEN SAYS NOTHING IS DELETED. Somebody pressing this needs to know the money is still
   accounted for, or they go looking for it in the bank and cannot find it anywhere in Raptor. */
ok('the box says nothing is deleted', /Nothing is deleted\./.test(rejectModal))
ok('...and that no balance moves', /No balance moves, no fee is raised/.test(rejectModal))

/*
 * THE FIRM'S WORDS, NOT THE DATABASE'S. `rejected_at` is a column; "Reject" and "Put it back" are
 * what the firm said. A screen that offered "Unreject" would be a column on a button.
 */
ok('the undo is in the firm’s words', /Put it back/.test(queue))
no('...and not in the database’s', /Unreject/.test(queue))

console.log(`\ncheck-reject-payment: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
