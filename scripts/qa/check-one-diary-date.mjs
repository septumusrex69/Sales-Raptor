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

/* ---------- the one entry that is spared ---------- */

/*
 * workEntry and moveEntry are both holding an open entry they are about to close THEMSELVES —
 * done with the agent's outcome, or moved with where it went. Letting diarise() mark it `moved`
 * first would lose that, and worse, protect_closed_diary_entries would then silently revert the
 * proper close: a closed entry may not be edited, and the trigger does not raise, it reverts.
 */
ok('diarise can spare one entry', /supersedeExcept\?: string \| null/.test(diary))
ok('...and it is excluded by id', /neq\('id', input\.supersedeExcept\)/.test(diary))
ok('moveEntry spares the entry it is moving', /supersedeExcept: input\.entry\.id/.test(diary))

const moveBody = diary.slice(diary.indexOf('export async function moveEntry'))
ok('moveEntry still closes it itself', /state: 'moved',[\s\S]{0,200}moved_to: replacement\.id/.test(moveBody))

/*
 * The supersede is guarded rather than unconditional: `if (input.supersedeExcept)`. An undefined
 * id passed to neq would filter on the string "undefined" and spare nothing — or, on some
 * clients, nothing at all — and the bug would only show on the paths that do not pass one.
 */
ok('sparing is opt-in', /if \(input\.supersedeExcept\) superseding = superseding\.neq/.test(diary))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
An account carries one diary date. Booking a new one moves the old one aside with its original
date intact, and the database refuses a second open entry whatever the app believes.`)
