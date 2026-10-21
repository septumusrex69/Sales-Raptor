/**
 * CANCELLING AN ARRANGEMENT: WHY, AND WHAT THE ACCOUNT DOES NEXT.
 *
 * THE FIRM, HAVING CANCELLED ONE ON THEIR OWN TEST ACCOUNT AND WATCHED NOTHING HAPPEN: "I
 * cancelled the payment arrangement but the workflow is still in motion... If the payment
 * arrangement is cancelled, there should be a reason. So the person should write a reason, say why
 * has it been cancelled. And if it's because of a dispute, a dispute should be raised. And if it's
 * because the debtor just decided not to pay, then it should go back to the section 129. So that
 * needs to be done and it can't go out of the workflow. It should be in a workflow. All accounts
 * should be somewhere and somehow in a workflow."
 *
 * THREE FAULTS AND THEY WERE ONE FAULT. `cancelled` was a status and nothing else: the
 * arrangement's own sequence went on reminding a debtor about a payment nobody would make, the
 * section 129 that the promise had PAUSED stayed paused for an arrangement that no longer existed,
 * and nothing recorded why any of it happened. An account paused on a cancelled promise is an
 * account nothing will ever happen to again -- which is the state the firm found, and the sentence
 * they ended on is the rule this file exists to keep.
 *
 * WHAT IS GUARDED HERE:
 *
 *   - THE CAUSE IS A CLOSED LIST, and the same list in the database, in the type and on the screen.
 *   - CANCELLING WITHOUT ONE IS REFUSED BY THE COLUMN, not only by the box.
 *   - THE TRIGGER ENDS THE ARRANGEMENT'S OWN SEQUENCE AND NOTHING ELSE. workflow_exit_account
 *     would take the section 129 with it -- the very run this is meant to give back.
 *   - AND GIVES THE HOLD BACK EXCEPT WHERE A CORRECTED ARRANGEMENT IS COMING. A promise may pause
 *     a run once per run EVER, so releasing on a mis-capture leaves a statutory sequence running
 *     at a debtor who is paying.
 *   - THE WRITE IS ONE UPDATE. Two, and the trigger fires with the cause still null.
 *   - AND THE TIMELINE SHOWS BOTH EVENTS: the arrangement being made, and the day it ended.
 *
 * schema.sql IS APPEND-ONLY, SO THE LAST DEFINITION IS THE LIVE ONE -- read with lastIndexOf on
 * the full `create or replace function public.<name>(` and never on the bare name, which also
 * appears in the grant, the revoke and the comment.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-promise-cancel.mjs
 */
import { readFileSync } from 'node:fs'
import {
  CANCEL_CHOICES, CANCEL_CAUSE_LABEL, PROMISE_ENDED, promiseCancelWords,
} from '../../src/lib/promiseRules.ts'
import { buildTimeline } from '../../src/lib/accountTimeline.ts'

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
const workspace = read('src/lib/accountWorkspace.ts')
const modal = read('src/pages/accounts/CancelArrangementModal.tsx')
const account = read('src/pages/accounts/AccountDetail.tsx')

/* ---------------- the three causes ---------------- */

/* PRESENT BEFORE ANYTHING ABOUT THEM, or an emptied list makes every comparison below vacuous. */
check('there are three reasons an arrangement is cancelled', CANCEL_CHOICES.length, 3)
check('...and they are these three',
  CANCEL_CHOICES.map((c) => c.cause).sort(), ['disputed', 'refusing', 'replaced'])
/* THE FIRM NAMED TWO OF THEM, so the words are theirs rather than a workflow's. */
check('the debtor disputing the account is one', CANCEL_CAUSE_LABEL.disputed,
  'The debtor disputes the account')
check('...and the debtor refusing to pay is another', CANCEL_CAUSE_LABEL.refusing,
  'The debtor will not pay')
/*
 * EVERY ONE SAYS WHAT WILL HAPPEN. Two of the three press a statutory sequence back into motion,
 * and a collector who did not know that is one who cancels an arrangement to tidy the screen up
 * and puts a final notice in the post.
 */
for (const c of CANCEL_CHOICES) {
  ok(`${c.cause} says what Raptor will do about it`, (c.consequence ?? '').length > 30)
  ok(`...in a sentence, not a column name`, !/[_]/.test(c.consequence))
}
/* THE ONE THE FIRM DID NOT NAME SAYS WHY IT EXISTS: it is the case where cancelling means wait. */
ok('the third is about a corrected arrangement rather than an outcome',
  /corrected/i.test(CANCEL_CAUSE_LABEL.replaced))
ok('...and it is the only one that sends nothing',
  CANCEL_CHOICES.filter((c) => /Nothing is sent/i.test(c.consequence)).map((c) => c.cause).join(',')
    === 'replaced')

/* ---------------- and the database holds the same three ---------------- */

ok('the column exists', /add column if not exists cancel_cause text/.test(sql))
ok('...with the reason beside it', /add column if not exists cancel_reason text/.test(sql))
const causeCheck = sql.slice(sql.lastIndexOf('promises_to_pay_cancel_cause_check\n'))
ok('the database holds the cause to the same closed list',
  /in \('disputed', 'refusing', 'replaced'\)/.test(causeCheck))
/*
 * AND A CANCELLATION WITH NO CAUSE IS REFUSED BY THE COLUMN. Enforced there rather than only in
 * the box, because resolvePromise is a library function and the box is one caller of it.
 */
const saysWhy = sql.slice(sql.lastIndexOf('add constraint promises_cancelled_says_why'))
ok('a cancellation with no cause is refused',
  /check \(status <> 'cancelled' or cancel_cause is not null\)/.test(saysWhy))
/*
 * NOT VALID, AND THAT IS THE POINT RATHER THAN A CONCESSION. The arrangements already cancelled
 * were cancelled before there was a question to answer, and inventing a cause for them would be
 * writing history nobody witnessed. The constraint binds every cancellation from here on.
 */
ok('...without rewriting the ones cancelled before the question existed',
  /promises_cancelled_says_why[\s\S]{0,200}?not valid;/.test(saysWhy))

/* ---------------- what the trigger does ---------------- */

const at = sql.lastIndexOf('create or replace function public.workflow_on_promise_cancelled(')
ok('there is a trigger function for it', at > 0)
const fn = sql.slice(at, sql.indexOf('$$;', at) + 3)
/* IT FIRES ON THE TRANSITION, not on every update of a row that is already cancelled. */
ok('it only fires when a live arrangement becomes cancelled',
  /new\.status <> 'cancelled' or coalesce\(old\.status, ''\) = 'cancelled'/.test(fn))
/*
 * IT ENDS THE ARRANGEMENT'S OWN SEQUENCE AND NOTHING ELSE. workflow_exit_account ends EVERY live
 * run on the account -- including the section 129 this function exists to give back -- so using it
 * here would answer the firm's complaint by making it worse.
 */
ok('...ending the sequence the arrangement is about', /trigger_kind = 'promise_due'/.test(fn))
/* COMMENTS STRIPPED, or the paragraph explaining why workflow_exit_account is wrong here reads as
   a call to it. */
const body = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
ok('...and not every run on the account', !/workflow_exit_account/.test(body))
/* A SENT STEP STAYS SENT: it is the record of a notice that reached a debtor. */
ok('...cancelling only what has not gone', /s\.state in \('pending', 'held'\)/.test(fn))
/*
 * AND THE COLLECTION SEQUENCE COMES BACK. This is the firm's "it should go back to the section
 * 129", and it is `workflow_resume_account` with the cause named -- a bare resume would also
 * release a hold that a written DISPUTE had put there, which is a fault this codebase has already
 * had once.
 */
ok('the held sequence is given back', /workflow_resume_account\(new\.account_id/.test(fn))
ok('...naming the cause, so a dispute’s hold is left alone', /, 'promise'\)/.test(fn))
/*
 * EXCEPT FOR A REPLACEMENT, AND THIS IS THE ASSERTION THE THIRD CAUSE EXISTS FOR. A promise may
 * pause a run ONCE per run ever -- the firm's own rule, "stop it only once. Not twice" -- so
 * releasing here and letting the corrected arrangement re-capture would leave a section 129
 * running at a debtor whose arrangement the firm has accepted.
 */
ok('...but not where a corrected arrangement is coming',
  /cancel_cause is distinct from 'replaced'/.test(fn))
/* THE TRIGGER IS ACTUALLY HUNG ON THE TABLE. A function nothing calls guards nothing. */
const trg = sql.slice(sql.lastIndexOf('create trigger workflow_on_promise_cancelled'))
ok('the trigger is on promises_to_pay',
  /after update of status on public\.promises_to_pay/.test(trg)
  && /execute function public\.workflow_on_promise_cancelled\(\)/.test(trg))

/* ---------------- the write ---------------- */

const resolve = workspace.slice(workspace.indexOf('export async function resolvePromise('))
ok('resolvePromise takes the cause and the reason', /cancel\?: \{ cause: CancelCause; reason: string \}/.test(resolve))
/*
 * ONE UPDATE, AND IT IS NOT A TIDINESS POINT. The trigger reads the cause off NEW; written in a
 * second update the status change fires it with cancel_cause still null, the account is not
 * released, and the firm's complaint comes straight back.
 */
ok('...and writes them in the same update as the status',
  /\.update\(\{[\s\S]{0,700}?cancel_cause: cancel\.cause[\s\S]{0,200}?\}\)/.test(resolve))
ok('...only on a cancellation', /status === 'cancelled' && cancel/.test(resolve))
/*
 * AND THE MAPPER CARRIES BOTH COLUMNS. CLAUDE.md's own warning, and the reason it is written down:
 * a column in the table, in the type and in the select but missing from the hand-written mapper
 * reads as undefined for ever and nothing fails. `diary_capacity` sat in that state for months.
 */
ok('the mapper reads the cause', /cancelCause: \(r\.cancel_cause \?\? null\)/.test(workspace))
ok('...and the reason', /cancelReason: r\.cancel_reason \?\? null/.test(workspace))

/* ---------------- the box ---------------- */

ok('there is a box that asks', /export function CancelArrangementModal/.test(modal))
ok('...offering the three from one place', /CANCEL_CHOICES\.map/.test(modal))
/* BOTH, OR NEITHER. The column refuses a cancellation with no cause and the firm asked for the
   sentence too, so the button says so rather than an error afterwards. */
ok('...and refuses to go without a cause and a sentence',
  /cause !== null && reason\.trim\(\)\.length > 0/.test(modal))
/* WRITTEN WITH THE DEBTOR STILL ON THE TELEPHONE, which is the field that gets left blank. */
ok('...with the reason dictatable, like the call note', /<DictateButton/.test(modal))

/* ---------------- and a dispute is actually raised ---------------- */

const wired = account.slice(account.indexOf('<CancelArrangementModal'))
ok('the account page opens it', wired.length > 200)
/*
 * THE ORDER IS LOAD-BEARING. The cancellation is written FIRST, because that write is what fires
 * the trigger; a dispute raised while the promise is still live is a contradiction on the file,
 * and the firm's rule that a written dispute stops the sequence cannot be decided while a promise
 * is still holding it.
 */
const atResolve = wired.indexOf("resolvePromise(cancelling.id, 'cancelled'")
const atRaise = wired.indexOf('await raiseQuery(')
ok('the arrangement is cancelled before the dispute is raised',
  atResolve > 0 && atRaise > atResolve)
ok('...and only where the debtor disputes it', /cause === 'disputed'/.test(wired))
ok('...as a dispute rather than any other escalation', /kind: 'dispute'/.test(wired))
/* NOT CHARGED. Item 3 is for a dispute taken up with somebody else; one written down at the
   collector's own desk mid-call is the job. The same call recordOutcome makes. */
ok('...and it does not charge the debtor item 3', /charge: false/.test(wired))
/*
 * AND A DISPUTE THAT WILL NOT SAVE DOES NOT UNDO THE CANCELLATION. The arrangement really is
 * cancelled; saying otherwise would be a lie about the file.
 */
ok('a dispute that fails is reported, not rolled back',
  /The arrangement was cancelled, but the dispute was not raised/.test(wired))

/* ---------------- what the timeline says ---------------- */

const promise = (over) => ({
  id: 'pr1', accountId: 'a', amount: 5000, dueOn: '2026-10-04', method: 'EFT',
  status: 'open', resolvedAt: null, notes: null, createdBy: null,
  createdAt: '2026-09-27T09:12:00Z', arrangement: 'weekly', dayOfMonth: null,
  onLastDay: false, dayOfWeek: 7, instalmentsKept: 0, totalPromised: null,
  cancelCause: null, cancelReason: null, ...over,
})
const bare = { payments: [], fees: [], accruals: [] }
const entriesFor = (p) => buildTimeline(bare, [], [p]).filter((e) => e.kind === 'promise')

/*
 * A LIVE ARRANGEMENT IS ONE ENTRY. Nothing is invented for one still running, which is the common
 * case and the one that must not grow a second line.
 */
const live = entriesFor(promise())
check('a live arrangement is one entry on the timeline', live.length, 1)
check('...saying it was made', live[0]?.title, 'Arrangement made')
/* THE SHAPE, NOT JUST THE DATE. "due 2026-10-04" said nothing about it being weekly. */
ok('...and how it was to be paid', /Weekly/.test(live[0]?.detail ?? ''))

/*
 * AND A CANCELLED ONE IS TWO. This is the firm's complaint, in one assertion: "I don't see that
 * the payment arrangement has been created, I can only see that it's been cancelled." There was
 * ONE row, dated the day it was made, wearing the CURRENT status as a chip.
 */
const done = entriesFor(promise({
  status: 'cancelled', resolvedAt: '2026-09-27T20:38:00Z',
  cancelCause: 'refusing', cancelReason: 'Says he is not paying a cent.',
}))
check('a cancelled arrangement is two entries', done.length, 2)
/* NEWEST FIRST, which is the order buildTimeline returns. */
check('...the ending first', done[0]?.title, 'Arrangement cancelled')
check('...and the making still there under it', done[1]?.title, 'Arrangement made')
/*
 * THE FIRST ENTRY NO LONGER CARRIES THE VERDICT. On the day it was made it WAS open, and a chip
 * reading "cancelled" beside it is exactly what made the two unreadable as one line.
 */
check('the day it was made does not wear what became of it', done[1]?.status, 'open')
check('...and the day it ended does', done[0]?.status, 'cancelled')
/* DATED WHEN EACH HAPPENED, or the two sit on one day and the point is lost. */
check('the ending is dated when it was cancelled', done[0]?.date, '2026-09-27')
ok('...off resolvedAt rather than off createdAt', done[0]?.at === '2026-09-27T20:38:00Z')
/* AND THE REASON TRAVELS WITH IT. "cancelled" on its own is what the firm was complaining about. */
ok('...and says why, in the collector’s own words',
  /Says he is not paying a cent/.test(done[0]?.detail ?? ''))
ok('...under the cause that was chosen',
  /The debtor will not pay/.test(done[0]?.detail ?? ''))

/*
 * A DEFAULTED ARRANGEMENT IS NOT AN ENDING. It is the 48 hours the firm's own default letter
 * gives the debtor to put it right, and the arrangement is still live inside it -- so it must not
 * grow a closing entry saying it is over.
 */
ok('defaulted is not an ending', PROMISE_ENDED.defaulted === undefined)
check('...and the three that are', Object.keys(PROMISE_ENDED).sort(),
  ['broken', 'cancelled', 'kept'])

/* ---------------- the words, where there are none ---------------- */

check('a cause and a sentence read as one line',
  promiseCancelWords({ cancelCause: 'disputed', cancelReason: 'Never had the account.' }),
  'The debtor disputes the account — Never had the account.')
/* THE OLD ROWS HAVE NEITHER, and "cancelled: no reason given" reads as an accusation about the
   collector rather than as a fact about the row. */
check('...and neither reads as nothing at all',
  promiseCancelWords({ cancelCause: null, cancelReason: null }), null)
check('...a cause on its own stands in for the sentence',
  promiseCancelWords({ cancelCause: 'refusing', cancelReason: '   ' }), 'The debtor will not pay')

console.log(`\ncheck-promise-cancel: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
