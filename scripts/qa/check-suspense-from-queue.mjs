/**
 * PARKING A RECEIPT IN SUSPENSE, FROM THE QUEUE IT IS SITTING IN.
 *
 * THE FIRM: "when something is in that state of approval, it should also give you an option to put
 * it into suspense. So, for example, if you reverse a payment, it goes to a state of approval and
 * then you just say move to suspense. Otherwise you have to go and look for it in suspense and
 * allocate it later."
 *
 * WHAT THERE WAS INSTEAD WAS TWO WAYS OUT OF THE QUEUE AND BOTH WERE WRONG for the case they
 * describe: approve it -- onto a debtor somebody has just decided it does not belong to -- or
 * leave it there for the next person to approve unread.
 *
 * THE TWO HALVES OF SUSPENSE ARE DIFFERENT PROBLEMS WEARING ONE WORD, and this file mostly exists
 * to keep them apart:
 *
 *   AN UNPLACED BANK LINE has never been attributed to anybody. "CAPITEC L SOLOMONS" with no
 *   reference is somebody's money and no debtor's account. Placing it needs somebody to RECOGNISE
 *   a name.
 *   A PARKED PAYMENT was attributed and then un-attributed. It is on an account, wrongly, and
 *   somebody looked at it and said so. Placing it needs somebody to DECIDE.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-suspense-from-queue.mjs
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
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const sql = read('supabase/schema.sql')
const lib = code('src/lib/payover.ts')
const queue = code('src/pages/finance/AwaitingApproval.tsx')
const suspense = code('src/pages/finance/UnallocatedReceipts.tsx')

/* schema.sql is append-only: the LAST definition is the live one, and BOTH spellings exist --
   a function whose return type changed cannot be replaced, so it is dropped and created plainly.
   Reading only `create or replace` is how the wrong definition gets asserted against; it cost a
   failed migration on this very feature. */
const liveFn = (name) => {
  const at = Math.max(
    sql.lastIndexOf(`create or replace function public.${name}(`),
    sql.lastIndexOf(`create function public.${name}(`),
  )
  if (at < 0) return null
  const end = sql.indexOf('$$;', at)
  return end < 0 ? null : sql.slice(at, end + 3)
}

/* ---------------- the column, and what it means ---------------- */

ok('a receipt can be parked', /add column if not exists suspended_at timestamptz/.test(sql))
/*
 * AND THE REASON IS A COLUMN, NOT A CONVENTION. A receipt sitting in suspense with no words is one
 * nobody can place without going to find whoever parked it -- and that person is the only one who
 * knows why the account it is on is wrong.
 */
ok('...with the words of whoever parked it', /add column if not exists suspense_reason text/.test(sql))
/*
 * IT KEEPS ITS ACCOUNT. `account_id` is not null and must stay so: detaching would leave money
 * belonging to nobody and throw away the one clue to where it came from -- the account somebody
 * thought it was for.
 */
ok('...still recorded against an account',
  !/alter table public\.account_payments[\s\S]{0,200}?alter column account_id drop not null/.test(sql))

/* ---------------- parking it ---------------- */

const park = liveFn('suspend_payment')
ok('there is a function that parks one', park !== null)
/* THE SAME PEOPLE WHO WORK THE QUEUE, asked through the capability rather than a role name. */
ok('...only for somebody who may clear the queue', /may_approve_payment\(\)/.test(park ?? ''))
ok('...and refused without a reason', /Say why it is going to suspense/.test(park ?? ''))
/*
 * APPROVED IS A REVERSAL, NOT A PARKING. Past approval it has been split, a fee raised and it may
 * be on a remittance -- the same line set_payment_account draws, and the reason an unapproved
 * payment can be touched at all.
 */
ok('...refused once it has been approved',
  /approved_at is not null then[\s\S]{0,140}?Reverse it instead/.test(park ?? ''))
ok('...and refused on a reversed one', /reversed_at is not null then/.test(park ?? ''))
/* TWICE IS A NO-OP. Two people clearing one morning's queue is ordinary and the second must not
   see an error for agreeing with the first. */
ok('...while parking it twice is not an error',
  /if v_pay\.suspended_at is not null then return; end if;/.test(park ?? ''))

/* ---------------- it actually leaves the queue ---------------- */

/*
 * THE ASSERTION THAT MAKES THE BUTTON MEAN ANYTHING. Without this the receipt sits in the queue
 * looking exactly as it did, and the firm's complaint -- having to go and look for it -- would be
 * true of a list it never left.
 */
const q = liveFn('payments_awaiting_approval')
ok('the queue exists', q !== null)
ok('...and no longer offers what somebody parked', /p\.suspended_at is null/.test(q ?? ''))
/* AND IT STILL SAYS WHICH ONES CAME BACK. The three came_back_* columns were added so a returned
   receipt explains itself; a later edit to this function must not quietly drop them. */
for (const col of ['came_back_from', 'came_back_reason', 'came_back_on']) {
  ok(`...still telling you it ${col === 'came_back_on' ? 'came back when' : 'came back'}`,
    (q ?? '').includes(col))
}

/* ---------------- and suspense shows it, apart from the bank lines ---------------- */

const listed = liveFn('suspended_payments')
ok('suspense can list the parked ones', listed !== null)
ok('...only the parked ones', /p\.suspended_at is not null/.test(listed ?? ''))
ok('...never an approved one', /p\.approved_at is null/.test(listed ?? ''))
ok('...nor a reversed one', /p\.reversed_at is null/.test(listed ?? ''))
/* IT CARRIES THE WORDS. Both sets: why it was parked, and -- where a reversal put it in the queue
   to begin with -- why it was reversed. Two people wrote those and the second only makes sense
   beside the first. */
ok('...with the reason it was parked', /p\.suspense_reason/.test(listed ?? ''))
ok('...and the reason it came back', /was\.reversal_reason/.test(listed ?? ''))
/*
 * A SEPARATE FUNCTION FROM unallocated_receipts, deliberately. One returns bank lines nobody has
 * attributed; the other returns payments somebody un-attributed. Folded into one list they would
 * need one set of buttons, and "Place it" means two different writes.
 */
const lines = liveFn('unallocated_receipts')
ok('the bank-line half is still its own function', lines !== null)
ok('...and still about lines rather than payments',
  /from public\.bank_statement_lines/.test(lines ?? ''))

/* ---------------- two ways out, and placing is one of them ---------------- */

const move = liveFn('set_payment_account')
ok('placing a parked receipt is set_payment_account', move !== null)
/*
 * AND IT CLEARS THE PARKING ITSELF. Giving a receipt the account it belongs to IS taking it out of
 * suspense; a second button to say so is a second chance to leave it there -- on a list of things
 * nobody has placed, after somebody just placed it.
 */
ok('...which takes it out of suspense as it goes', /suspended_at = null/.test(move ?? ''))
const release = liveFn('release_payment_from_suspense')
ok('and one parked by mistake goes back to the queue', release !== null)
ok('...clearing both columns', /suspended_at = null, suspense_reason = null/.test(release ?? ''))

/* ---------------- revoked, like every other finance function ---------------- */

/* Supabase grants EXECUTE on a public function to anon by default, and these move money between
   queues. check-finance-is-administrator-only holds the whole list; these three are named here
   because they are the ones this change added. */
for (const fn of ['suspend_payment(uuid, text)', 'release_payment_from_suspense(uuid)', 'suspended_payments()']) {
  ok(`${fn} is revoked from public and anon`, sql.includes(`'${fn}'`))
}

/* ---------------- and the screens ---------------- */

ok('the library offers all three', /export async function suspendPayment\(/.test(lib)
  && /export async function releasePaymentFromSuspense\(/.test(lib)
  && /export async function fetchSuspendedPayments\(/.test(lib))

ok('the queue has the button', /Suspense\b/.test(queue))
ok('...beside Move, which is the same question answered the other way', /setMoving\(r\)/.test(queue))
ok('...opening a box that asks why', /Why is it going to suspense\?/.test(queue))
/* THE REASON IS REQUIRED ON THE SCREEN TOO, so the refusal is a disabled button rather than a
   round trip that comes back red. */
ok('...and will not park it without one', /disabled=\{busy \|\| !reason\.trim\(\)\}/.test(queue))

ok('suspense lists the parked ones', /fetchSuspendedPayments\(\)/.test(suspense))
ok('...in their own card, not mixed with the bank lines', /Parked off the approval queue/.test(suspense))
ok('...showing why each is there', /r\.reason/.test(suspense))
ok('...with a way back to the queue', /releasePaymentFromSuspense\(/.test(suspense))
ok('...and placing one uses set_payment_account', /setPaymentAccount\(placingParked\.paymentId/.test(suspense))
/*
 * ONE DEBTOR SEARCH, NOT TWO. PlaceModal's own note: "introducing a second, subtly different way
 * to find a debtor is how somebody ends up placing money against a similar-looking account." So it
 * takes what to show and what to do, rather than being copied for the second kind of thing.
 */
/*
 * COUNTED AS DEBTOR SEARCHES, not as functions called PlaceModal -- which is what this asserted
 * first, and the break test walked straight past it by adding a second box under another name.
 * What the rule is actually about is that there is ONE way to find a debtor on this screen.
 */
check('there is one debtor search on this screen, not two',
  (suspense.match(/fetchAccounts\(\{ search:/g) ?? []).length, 1)
check('...and one placement box', (suspense.match(/function Place[A-Za-z]*Modal\(/g) ?? []).length, 1)
ok('...told what to do rather than knowing', /onPlace: \(accountId: string\) => Promise<void>/.test(suspense))

console.log(`\ncheck-suspense-from-queue: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
