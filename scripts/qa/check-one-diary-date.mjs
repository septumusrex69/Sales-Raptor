/**
 * One diary date per account.
 *
 * The firm's rule, in their words: "if a diary date is scheduled for the 7th and it's rescheduled
 * by someone for the 10th, it goes away from the 7th." Before this, debtor_accounts arrived from
 * Swordfish with 327 diarised accounts of which 279 were already overdue — a diary that can hold
 * two dates for one account is a diary in which neither is the answer to "when are we ringing
 * these people".
 *
 * ENFORCED IN TWO PLACES ON PURPOSE. The unique index is the rule; the supersede in diarise() is
 * the courtesy that stops the rule from being felt as an error. Lose the index and the app quietly
 * grows second entries whenever a write races; lose the supersede and every reschedule fails with
 * a constraint violation a clerk cannot act on. These checks hold both.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-one-diary-date.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, actual) => {
  if (actual === true) { pass += 1; return }
  failures.push(`${name}\n    expected true\n    got      ${JSON.stringify(actual)}`)
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const schema = read('../../supabase/schema.sql')
const diary = read('../../src/lib/diary.ts')
const handOutWrite = read('../../src/lib/handOutWrite.ts')

/* ---------- the rule ---------- */

/*
 * PARTIAL, on state = 'open'. A plain unique index on account_id would forbid an account from
 * ever having a second diary entry in its life, which is not the rule — an account is worked
 * dozens of times. What may not exist twice is an OPEN one.
 */
ok('the index exists', /create unique index[^;]*diary_entries_one_open_per_account/i.test(schema))
ok('...on the account', /diary_entries_one_open_per_account[\s\S]{0,120}\(account_id\)/i.test(schema))
ok('...and only over open entries',
  /diary_entries_one_open_per_account[\s\S]{0,200}where\s+state\s*=\s*'open'/i.test(schema))

/*
 * NOT AN UPSERT TARGET. PostgREST cannot infer a partial unique index, so an upsert against it
 * fails rather than silently merging — which is the behaviour wanted here. A second open entry
 * should be refused loudly, not quietly folded into the first.
 */
ok('nothing upserts diary entries', !/from\('diary_entries'\)[\s\S]{0,80}\.upsert\(/.test(diary))

/* ---------- the courtesy ---------- */

/*
 * Every path that books a date goes through diarise(). Doing the supersede in each caller instead
 * would be a rule implemented in four places, which is a rule that holds in three.
 */
const diariseBody = diary.slice(diary.indexOf('export async function diarise'), diary.indexOf('export async function moveEntry'))
ok('diarise supersedes before it inserts', diariseBody.indexOf('.eq(\'state\', \'open\')') < diariseBody.indexOf('.insert({'))
ok('...every open entry on that account', /\.eq\('account_id', input\.accountId\)\s*\n\s*\.eq\('state', 'open'\)/.test(diariseBody))

/*
 * MOVED, NOT CANCELLED. The work did not stop, it went somewhere else — and the superseded row
 * keeps the date it was always due, so "this was booked for the 7th and nobody worked it" stays
 * true afterwards. Cancelling would erase the miss, which is the one fact a team leader needs.
 */
ok('the old entry is moved, not cancelled', /state: 'moved', moved_at:/.test(diariseBody))
ok('...and says who moved it', /moved_by: input\.actor\.id/.test(diariseBody))

/*
 * A FAILED SUPERSEDE MUST STOP THE BOOKING. Swallowing the error would leave the old entry open,
 * the insert would hit the unique index, and the clerk would be told the booking failed for a
 * reason that is not the reason.
 */
ok('a failed supersede throws', /supersedeError\) throw new Error\(supersedeError\.message\)/.test(diariseBody))

/* ---------- nothing is spared, because sparing was the bug ---------- */

/*
 * THE REGRESSION THIS SECTION EXISTS FOR. diarise() once took a `supersedeExcept` so a caller
 * could keep the entry it was in the middle of closing. workEntry and moveEntry both used it,
 * and both were broken the moment the unique index landed: the caller's entry stayed OPEN, the
 * insert made a second, and the index refused it. Working an entry and booking the next threw a
 * constraint violation at the agent every single time.
 *
 * The escape hatch is gone rather than fixed. An option whose only use recreated the bug is a
 * trap, not a feature.
 */
ok('nothing can be spared from a supersede', !/supersedeExcept/.test(diary))
ok('every open entry on the account is superseded',
  /\.eq\('account_id', input\.accountId\)\s*\n\s*\.eq\('state', 'open'\)/.test(diary))

/*
 * workEntry CLOSES BEFORE IT BOOKS. The old order booked first so that a failure would
 * double-book rather than leave the account un-diarised — sound reasoning before the index made
 * double-booking impossible and before the No diary date view made un-diarised visible.
 */
const workBody = diary.slice(diary.indexOf('export async function workEntry'), diary.indexOf('export async function countOutOfCirculation'))
ok('workEntry closes the worked entry first',
  workBody.indexOf('await completeEntry(') < workBody.indexOf('await diarise('))
ok('...as done, carrying the outcome', /completeEntry\(\{ id: input\.entry\.id, outcome: said \|\| null/.test(workBody))
/*
 * And if the booking then fails, the agent is told exactly what did and did not happen. "Failed"
 * on its own would have somebody redo a call they have already made.
 */
ok('a failed booking says the work was saved', /The work was saved, but/.test(workBody))
ok('...and where the account went', /No diary date/.test(workBody))

/*
 * moveEntry cannot close first — the old entry has to point at the replacement, which does not
 * exist yet. So diarise supersedes it on the way past and the trail is completed afterwards.
 * That is only possible because protect_closed_diary_entries preserves account, owner, date,
 * kind, state, source and the stamps on a closed row, and deliberately NOT moved_to or
 * moved_reason. Add those to the trigger and the move loses its trail silently.
 */
/*
 * Bounded at the NEXT export, not at workEntry — there is another function between the two, and
 * slicing to workEntry swept it in. A check that reads a neighbouring function is a check that
 * reports on code it was never about.
 */
const moveStart = diary.indexOf('export async function moveEntry')
const moveBody = diary.slice(moveStart, diary.indexOf('export async function', moveStart + 40))
ok('moveEntry lets the supersede close the original', /NOTHING IS SPARED/.test(moveBody))
ok('...then writes where it went', /moved_to: replacement\.id/.test(moveBody))
ok('...without trying to set state again', !/state: 'moved'/.test(moveBody))
ok('...and does not filter on a state the row has left', !/\.eq\('state', 'open'\)/.test(moveBody))

const schemaTrigger = schema.slice(schema.indexOf('function public.protect_closed_diary_entries'))
ok('the trigger still leaves moved_to writable', !/new\.moved_to\s*:=/.test(schemaTrigger.slice(0, 900)))
ok('...and moved_reason', !/new\.moved_reason\s*:=/.test(schemaTrigger.slice(0, 900)))

/* ---------- the one place that books in bulk ---------- */

/*
 * A HAND-OUT WRITES DIARY ENTRIES WITHOUT GOING THROUGH diarise(), and that is allowed for one
 * reason only: it does the same two things in the same order, for fifty accounts at a time. The
 * firm reported a hundred-account hand-out taking "a very long time" — it was two sequential
 * round trips per account — so the writer now supersedes a chunk and inserts a chunk.
 *
 * The batch is only legal because of the rule at the top of this file. Insert fifty rows while
 * fifty old ones are still open and the partial unique index refuses the first collision, which
 * is exactly what it is there for. So these checks hold the ORDER, and they are here rather than
 * in the hand-out's own file because what they are really guarding is this rule.
 */
const bulkSupersede = /\.in\('account_id', slice\.map\(\(p\) => p\.accountId\)\)\s*\n\s*\.eq\('state', 'open'\)/
ok('the bulk writer supersedes a whole chunk', bulkSupersede.test(handOutWrite))
ok('...and inserts a whole chunk', /\.from\('diary_entries'\)\.insert\(rows\.slice\(/.test(handOutWrite))
/*
 * Presence asserted first, on purpose. indexOf returns -1 for something that is not there, so an
 * order-only assertion passes vacuously the moment the supersede is deleted — which is the exact
 * failure this check exists to catch, and it has caught itself once already elsewhere.
 */
ok('...in that order, never the other way round',
  handOutWrite.search(bulkSupersede) < handOutWrite.indexOf(".from('diary_entries').insert(rows.slice("))
ok('a failed bulk supersede stops the insert',
  /supersedeError\) throw new Error\(supersedeError\.message\)/.test(handOutWrite))
ok('nothing upserts in bulk either', !/from\('diary_entries'\)[\s\S]{0,80}\.upsert\(/.test(handOutWrite))
/*
 * ONE REFUSAL MUST NOT COST THE CHUNK. A batch fails whole, so a chunk that is rejected is walked
 * the slow way per account and each account that still refuses is named. Without this a hand-out
 * of five hundred could report fifty failures and leave the operator no idea which fifty.
 */
ok('a refused chunk falls back to one at a time', /for \(const p of slice\)[\s\S]{0,400}await diarise\(/.test(handOutWrite))
ok('...and names what it could not book', /result\.failed\.push\(/.test(handOutWrite))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
An account carries one diary date. Booking a new one moves the old one aside with its original
date intact, and the database refuses a second open entry whatever the app believes.`)
