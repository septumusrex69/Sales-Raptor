/**
 * THREE BOOKS: ACTIVE, ON HOLD AND CLOSED.
 *
 * THE FIRM, AFTER THE FIRST TEST IMPORT: "The Accounts screen opens on 'Whole book', which mixes
 * accounts collectors should ring today with accounts that are paid up, written off, withdrawn or
 * frozen. The tiles add them all together: 'Capital handed over R438 769' includes R71 287 on
 * KIS0007, which is paid in full. The work shortcuts (Gone quiet 19, No diary date and so on) count
 * closed and frozen accounts nobody may chase."
 *
 * WHAT THIS GUARDS:
 *
 * 1. ONE SOURCE OF TRUTH, AND IT IS DERIVED. `book` is a STORED GENERATED column over the row's own
 *    closure and hold fields. The firm's rule was explicit -- "do not add a second status that can
 *    drift from the first" -- and a column the application writes is exactly that: one import, one
 *    bulk action or one fix applied in SQL at half past eleven and the book says one thing while
 *    the status says another.
 *
 * 2. THE BROWSER'S READING AGREES WITH THE DATABASE'S. `bookOf` exists for a row held in memory and
 *    must answer what the column answers, case for case, or the account page and the list disagree
 *    about one debtor -- the failure CLAUDE.md names.
 *
 * 3. NO SHORTCUT REACHES A FROZEN OR CLOSED ACCOUNT. "A frozen or closed account must never appear
 *    in a collector's queue or a dialler campaign." It matches the call-script hard stops.
 *
 * 4. A HOLD HAS A DATE, AND MOVING RECORDS WHO, WHEN AND WHY. An account parked with nobody booked
 *    to look at it again is the hole the whole diary design exists to close.
 *
 * 5. HOLDING PAUSES A WORKFLOW; CLOSING STOPS EVERY ONE. And closing is deliberately NOT
 *    workflow_exit_account, whose three events are the DEBTOR's doing and are held against the
 *    database's own list by check-workflow-send in both directions.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-books.mjs
 */
import { readFileSync } from 'node:fs'
import {
  BOOK_CHOICES, CLOSURE_KINDS, DEFAULT_BOOK, HARD_STOP_HOLDS, HOLD_REASONS,
  bookOf, closureKind, parseBook, reviewState,
} from '../../src/lib/accountBooks.ts'
import { ACCOUNT_VIEWS, viewParams } from '../../src/lib/accountViews.ts'
import { ENDING_LABEL } from '../../src/lib/accountEnding.ts'

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
const sql = read('supabase/schema.sql')

/* ------------------------- 1. the book is generated, not set ------------------------- */

const generated = sql.slice(sql.lastIndexOf('add column if not exists book text generated always as'))
  .slice(0, 700)
ok('book is a column on debtor_accounts', generated.length > 100)
ok('...GENERATED, so nothing can write it by hand', /generated always as \(/.test(generated))
ok('...and STORED, so it can be indexed and filtered on', /\) stored;/.test(generated))
ok('it is indexed', /create index if not exists debtor_accounts_book_idx/.test(sql))

/*
 * THE ORDER INSIDE IT. Closed wins over on hold: an account can be closed while still carrying the
 * Frozen status it was imported with, and a closed account is not somebody's weekly review.
 */
ok('closed is decided first', /when ended_as is not null then 'closed'/.test(generated))
ok('...and the imported written-off status closes it too',
  /when status ~~\* 'Written-off%' or status ~~\* 'Closed%' then 'closed'/.test(generated))
ok('on hold is a held reason OR the imported frozen status',
  /when hold_reason is not null or status ~~\* 'Frozen%' then 'on_hold'/.test(generated))
ok('...and everything else is active', /else 'active'/.test(generated))

/* NO SECOND STATUS. A plain `book text` column that the app could set is the thing the firm said
   not to build, and it would look identical in every select. */
no('there is no settable book column',
  /add column if not exists book text(?! generated)/.test(sql))

/* ------------------- 2. the browser reads it the same way ------------------- */

/*
 * EVERY CASE THE GENERATED COLUMN HAS, PUT THROUGH `bookOf`. Not a sample: this is the one place
 * two readings of one rule exist, so the whole truth table is walked.
 */
const cases = [
  [{ status: 'Active: Activated' }, 'active'],
  [{ status: 'Active: Re-opened' }, 'active'],
  [{ status: 'Active: Unfrozen' }, 'active'],
  [{ status: 'Frozen' }, 'on_hold'],
  [{ status: 'Written-off' }, 'closed'],
  [{ status: 'Closed' }, 'closed'],
  /* A HOLD WITH NO STATUS CHANGE, which is how a debt review or a written dispute arrives. */
  [{ status: 'Active: Activated', holdReason: 'debt_review' }, 'on_hold'],
  /* CLOSED BEATS BOTH, and this is the case the order exists for: Raptor closed it and Swordfish
     still says Frozen. */
  [{ status: 'Frozen', endedAs: 'paid_up' }, 'closed'],
  [{ status: 'Active: Activated', holdReason: 'deceased', endedAs: 'settled' }, 'closed'],
  /* AND A ROW WITH NOTHING ON IT IS ACTIVE, not a crash. */
  [{}, 'active'],
  [{ status: null }, 'active'],
]
for (const [row, want] of cases) {
  check(`bookOf(${JSON.stringify(row)})`, bookOf(row), want)
}

/* ------------------- the eight written-off test accounts ------------------- */

/*
 * THE FIRM COUNTED THESE BY HAND: "Closed shows the 8 written-off ones (5 paid up, 1 settled, 2
 * written off)". The reasons are Swordfish's own words off the staging rows, and IMPORTED HISTORY
 * IS FROZEN AT WHAT WAS IMPORTED -- so the ending is READ from the reason rather than written into
 * a column the firm never filled in.
 */
const WRITTEN_OFF = [
  ['BPM0186', 'Paid in Full', 'paid_up'],
  ['KIS0007', 'Paid in Full', 'paid_up'],
  ['KSD10001', 'Paid in Full', 'paid_up'],
  ['MSH3/10065', 'Paid in Full', 'paid_up'],
  ['SMF10054', 'Paid in Full', 'paid_up'],
  ['MSH4/20014', 'Settled by way of compromise', 'settled'],
  ['BPM0113', 'Untraceable', 'written_off'],
  ['BPM20038', 'Recommended Write-Off', 'written_off'],
]
for (const [ref, why, want] of WRITTEN_OFF) {
  check(`${ref} (${why})`, closureKind({ status: 'Written-off', writeOffReason: why }), want)
}
check('five paid up', WRITTEN_OFF.filter(([, , k]) => k === 'paid_up').length, 5)
check('one settled', WRITTEN_OFF.filter(([, , k]) => k === 'settled').length, 1)
check('two written off', WRITTEN_OFF.filter(([, , k]) => k === 'written_off').length, 2)

/* THE FIRM'S OWN ASSERTION WINS WHEREVER IT EXISTS. */
check('ended_as beats the imported reason',
  closureKind({ status: 'Written-off', writeOffReason: 'Paid in Full', endedAs: 'withdrawn' }),
  'withdrawn')
check('an open account has no ending', closureKind({ status: 'Active: Activated' }), null)

/* AND THE FOUR ENDINGS ARE ONE LIST IN TWO FILES. accountEnding is about CHOOSING an ending and
   accountBooks about reading a book; held equal here rather than by one importing the other. */
check('the closure kinds and the ending labels are the same four',
  CLOSURE_KINDS.map((c) => c.id).sort(), Object.keys(ENDING_LABEL).sort())
ok('settled is one of them', CLOSURE_KINDS.some((c) => c.id === 'settled'))

/* ------------------- 3. no shortcut reaches another book ------------------- */

check('the screen opens on Active', DEFAULT_BOOK, 'active')
check('an absent book reads as Active', parseBook(null), 'active')
check('...and so does a mistyped one', parseBook('banana'), 'active')
check('the four choices', BOOK_CHOICES.map((b) => b.id), ['active', 'on_hold', 'closed', 'whole'])

for (const v of ACCOUNT_VIEWS) {
  const book = new URLSearchParams(viewParams(v.id, 'user-1').toString()).get('book')
  if (v.id === 'whole_book') {
    check('whole book narrows to no book at all', book, null)
  } else {
    check(`${v.id} is a question about the active book`, book, 'active')
  }
}

/* AND IN THE CLAUSE BUILDER, which is what a hand-typed URL has to go through. */
const builder = read('src/lib/accountBook.ts')
ok('the book is one indexed equality',
  /if \(q\.book && q\.book !== 'whole'\) out = out\.eq\('book', q\.book\)/.test(builder))
ok('adrift carries the book itself', /q\.adrift[\s\S]{0,200}\.eq\('book', 'active'\)/.test(builder))

/* AND IN THE COUNTS, which is where the firm saw it: "Gone quiet 19". */
const counts = sql.slice(sql.lastIndexOf('create or replace function public.account_view_counts('))
  .slice(0, 3000)
/*
 * READ AS A SPAN RATHER THAN A REGEX, because the escaping level of a character class inside a
 * template string passed to `new RegExp` is one backslash away from matching a literal backslash --
 * which it did, and failed on correct code. Every shortcut's filter must carry the book test between
 * the `filter (` that opens it and the predicate itself.
 */
for (const shortcut of ['assigned_to = p_user', 'assigned_to is null', 'diary_date is null',
  "bucket = 'Failed PTPs'", "sub_status = 'Promise To Pay'", 'last_action_at <']) {
  const at = counts.indexOf(shortcut)
  ok(`the ${shortcut} count is in the function`, at >= 0)
  const opened = at < 0 ? -1 : counts.lastIndexOf('filter (', at)
  ok(`...and it is inside Active`,
    opened >= 0 && counts.slice(opened, at).includes("book = 'active'"))
}

/* THE BOOKS THEMSELVES ARE COUNTED TOO, or the chooser has no numbers on it. */
for (const b of ['active', 'on_hold', 'closed']) {
  ok(`${b} is counted`, new RegExp(`filter \\(where book = '${b}'\\)`).test(counts))
}

/* ------------------- 4. a hold has a date, and moving is recorded ------------------- */

ok('a hold reason is one of the seven',
  /check \(hold_reason is null or hold_reason in\s*\n?\s*\('frozen','debt_review','deceased','insolvent','business_rescue','dispute_in_writing','awaiting_client'\)\)/
    .test(sql))
check('and the screen offers exactly those',
  HOLD_REASONS.map((h) => h.id).sort(),
  ['awaiting_client', 'business_rescue', 'debt_review', 'deceased', 'dispute_in_writing',
    'frozen', 'insolvent'].sort())
/* THE FOUR THE CALL SCRIPTS ALREADY REFUSE TO DIAL ON. A reason in one list and not the other is an
   account the screen says is on hold and the dialler still rings. */
check('the hard stops are the call scripts’ own four',
  [...HARD_STOP_HOLDS].sort(), ['debt_review', 'deceased', 'dispute_in_writing', 'insolvent'])
ok('every hard stop is a real hold reason',
  HARD_STOP_HOLDS.every((h) => HOLD_REASONS.some((r) => r.id === h)))

ok('a hold without a review date is refused by the database',
  /check \(hold_reason is null or hold_review_on is not null\)/.test(sql))

const holdFn = sql.slice(sql.lastIndexOf('create or replace function public.hold_account(')).slice(0, 2600)
ok('hold_account asks the freeze tick', /has_capability\('book\.freeze'\)/.test(holdFn))
ok('...and refuses a hold with no reason given', /Say why it is going on hold/.test(holdFn))
ok('...and will not hold a closed account', /Re-open it before putting it on hold/.test(holdFn))

const releaseFn = sql.slice(sql.lastIndexOf('create or replace function public.release_account(')).slice(0, 2600)
ok('release_account asks the same tick', /has_capability\('book\.freeze'\)/.test(releaseFn))
ok('...and refuses without a reason', /Say why it is coming back onto the active book/.test(releaseFn))
/* BOTH DOORS: a hold the firm placed AND the Frozen status it was imported with. Clearing one and
   not the other leaves the account where it was with its reason gone. */
ok('it clears the hold', /hold_reason = null/.test(releaseFn))
ok('...and the imported freeze', /frozen_reason = null/.test(releaseFn))
ok('...and re-opens a closure', /ended_as = null/.test(releaseFn))

/* THE HISTORY IS WRITTEN BY THE TRIGGER, which is what makes it complete. */
const trigger = sql.slice(sql.lastIndexOf('create or replace function public.record_account_status_event()'))
  .slice(0, 2600)
ok('a book change records an event', /or new\.book is distinct from old\.book/.test(trigger))
ok('...with where it came from and where it went', /from_book, to_book/.test(trigger))
/* THE REASON IS CHOSEN BY WHERE IT IS GOING. A flat coalesce put the hold's reason on the closing
   event: an account held for a debt review and later settled read "Debt review withdrawn" against
   the day it closed. */
ok('the reason follows the destination', /case new\.book\s*\n?\s*when 'closed'\s*then coalesce\(new\.ended_reason/.test(trigger))

/* ------------------- 5. holding pauses, closing stops ------------------- */

ok('a hold pauses the run at its node', /insert into public\.workflow_run_holds[\s\S]{0,200}'on_hold'/.test(holdFn))
ok('...and the run goes to held, not left', /update public\.workflow_runs set state = 'held'/.test(holdFn))
no('...and nothing is cancelled', /state = 'cancelled'/.test(holdFn))

const stopFn = sql.slice(sql.lastIndexOf('create or replace function public.stop_workflows_on_close('))
  .slice(0, 2000)
ok('closing cancels what has not gone', /set state = 'cancelled'/.test(stopFn))
ok('...and leaves the run', /set state = 'left'/.test(stopFn))
/*
 * AND IT IS NOT workflow_exit_account. That one is the three things the DEBTOR does that make the
 * next notice wrong, and its event list is held against the database's own by check-workflow-send
 * in BOTH directions -- adding a fourth would have broken that pairing on correct code.
 */
const settleFn = sql.slice(sql.lastIndexOf('create or replace function public.settle_account(')).slice(0, 3600)
ok('settling stops every sequence', /perform public\.stop_workflows_on_close/.test(settleFn))
no('...without joining the debtor’s three exits', /workflow_exit_account/.test(settleFn))
const withdrawFn = sql.slice(sql.lastIndexOf('create or replace function public.withdraw_account(')).slice(0, 4200)
ok('withdrawing stops every sequence too', /perform public\.stop_workflows_on_close/.test(withdrawFn))
/* THE FIRM ASKED FOR THIS BY NAME: "Withdrawal must still raise the credit bureau removal task." */
ok('withdrawing raises the bureau removal task',
  /perform public\.bureau_removal_task\(p_account, 'withdrawn', v_why\)/.test(withdrawFn))
const bureauFn = sql.slice(sql.lastIndexOf('create or replace function public.bureau_removal_task(')).slice(0, 2200)
ok('...only where something was listed', /if coalesce\(btrim\(v_a\.bureaus_listed\), ''\) = ''/.test(bureauFn))
/* A WRITE-OFF LEAVES IT STANDING: the debt was neither paid nor handed back, so the adverse record
   is still true and removing it would be telling the bureaus something false. */
ok('...and never on a write-off',
  /if p_ending not in \('paid_up', 'settled', 'withdrawn'\) then\s*\n?\s*return null;/.test(bureauFn))

/* ------------------- the review queue ------------------- */

check('a date in the past is due', reviewState({ holdReviewOn: '2026-10-01' }, '2026-10-06'), 'due')
check('today is due', reviewState({ holdReviewOn: '2026-10-06' }, '2026-10-06'), 'due')
check('tomorrow is not', reviewState({ holdReviewOn: '2026-10-07' }, '2026-10-06'), 'waiting')
/* NO DATE AT ALL IS ITS OWN STATE: every frozen account off the import is one, and nobody has ever
   undertaken to look at it. Folded into "due" it would read as a promise somebody broke. */
check('no date is not the same as overdue', reviewState({ holdReviewOn: null }, '2026-10-06'), 'never_set')

console.log(`check-books: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
