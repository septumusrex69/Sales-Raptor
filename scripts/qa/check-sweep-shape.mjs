/**
 * FIFTY MAILBOXES, ONE AFTER ANOTHER, IS THE LOOPHOLE.
 *
 * THE FIRM: "there's still possibilities that the company's got 50 people, so in 60 seconds that
 * it doesn't sync anything. Like, or it syncs like two people and the third person is not synced.
 * You know what I mean? And then you still don't get that. So you still have a loophole in your
 * method."
 *
 * THEY ARE DESCRIBING A SERIAL LOOP, and sync-all.ts had carried a note admitting it since the day
 * it was written: "this route is the wrong shape for that many mailboxes". Three different things
 * had to change and they are not substitutes for one another:
 *
 *   - ORDER decides WHO a short run reaches. Oldest first, so nobody is starved. (check-sync-
 *     starvation holds that one; it is what the firm was answering when they said "I see what
 *     you've done with the sync thing, but...".)
 *   - CADENCE decides HOW LONG a missed mailbox waits. Minutes rather than a day. (Also there.)
 *   - SHAPE decides whether a run finishes at all, and it is the one this file is about.
 *
 * NEARLY ALL OF A SYNC IS WAITING. A TLS handshake, a LOGIN and a UID SEARCH per folder -- the
 * function sits idle for most of it, so fifty mailboxes a few at a time finish in about the time
 * five of them took end to end.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-sweep-shape.mjs
 */
import { readFileSync } from 'node:fs'
import { inPool } from '../../src/lib/pool.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------------------------------------------------------------------------------------
 * A FEW AT A TIME, AND NEVER MORE
 * ------------------------------------------------------------------------------------------- */

/*
 * THE CAP IS THE WHOLE SAFETY OF THIS. Every mailbox in the firm is on the same mail server, and a
 * server asked for fifty connections at once refuses some of them -- which would turn a sweep that
 * reached everybody slowly into one that reached nobody quickly.
 */
{
  let live = 0
  let peak = 0
  const done = []
  await inPool([...Array(20).keys()], 5, async (n) => {
    live += 1
    peak = Math.max(peak, live)
    await wait(5)
    done.push(n)
    live -= 1
  })
  check('every item is done', done.length, 20)
  check('...each exactly once', new Set(done).size, 20)
  check('...and never more than the width at a time', peak, 5)
}

/* A SHORT LIST DOES NOT SPAWN WORKERS WITH NOTHING TO DO. */
{
  let peak = 0
  let live = 0
  await inPool([1, 2], 5, async () => {
    live += 1; peak = Math.max(peak, live); await wait(2); live -= 1
  })
  check('two items need two workers, not five', peak, 2)
}
check('an empty list is nothing to do', await inPool([], 5, async () => {}), undefined)
/* A WIDTH OF NOUGHT IS STILL ONE AT A TIME. Misread as "no workers" it would hang for ever, which
   on this route is a sweep that never answers and a cron that times out every run. */
{
  const seen = []
  await inPool([1, 2, 3], 0, async (n) => { seen.push(n) })
  check('a width of nought still does the work', seen, [1, 2, 3])
}

/* ---------------------------------------------------------------------------------------------
 * AND THE ORDER THE STARVATION FIX DEPENDS ON SURVIVES IT
 * ------------------------------------------------------------------------------------------- */

/*
 * OLDEST FIRST IS WHY NO MAILBOX CAN STARVE, and it is a property of which items are STARTED
 * rather than which finish: a slow mailbox finishing last is fine, a stale mailbox never being
 * begun is the bug that lost a debtor's reply for four days.
 */
{
  const started = []
  await inPool(['oldest', 'older', 'old', 'new'], 2, async (name) => {
    started.push(name)
    await wait(5)
  })
  check('the stalest mailboxes are started first', started.slice(0, 2), ['oldest', 'older'])
  check('...and the rest follow in order', started, ['oldest', 'older', 'old', 'new'])
}

/* ---------------------------------------------------------------------------------------------
 * ONE BAD MAILBOX DOES NOT STOP THE REST
 * ------------------------------------------------------------------------------------------- */

/*
 * FIFTY MAILBOXES STOPPED BY ONE BAD PASSWORD is the failure this shape exists to avoid, and it is
 * the shape of the bug that was already found once: a mailbox connected on 24 September had still
 * never been read four nightly runs later. The route catches per mailbox; this is the second lock
 * on the same door.
 */
{
  const done = []
  /*
   * CAUGHT HERE SO A FAILURE IS REPORTED RATHER THAN THROWN. Written as a bare await, breaking the
   * pool's own catch made this file reject out of its top-level await -- a hang and a stack trace
   * instead of "a failing item rejected the pool: expected true, got false". CLAUDE.md names the
   * trap; this is the same one wearing a promise.
   */
  let swallowed = true
  try {
    await inPool([1, 2, 3, 4], 2, async (n) => {
      if (n === 2) throw new Error('bad password')
      done.push(n)
    })
  } catch {
    swallowed = false
  }
  ok('a failing mailbox does not reject the whole sweep', swallowed)
  check('...and the others are still done', done.sort(), [1, 3, 4])
}

/* ---------------------------------------------------------------------------------------------
 * AND THE SWEEP ACTUALLY USES IT
 * ------------------------------------------------------------------------------------------- */

const sweep = read('api/_lib/email/sync-all.ts')
ok('the sweep reads mailboxes a few at a time', /await inPool\(all, AT_ONCE, async \(conn\) => \{/.test(sweep))
/* NOT ALL OF THEM AT ONCE, for the reason above: one mail server, fifty requests. */
const atOnce = Number((sweep.match(/const AT_ONCE = (\d+)/) ?? [])[1])
ok('the width was found', Number.isFinite(atOnce))
ok(`...and it is a handful rather than the whole firm (${atOnce})`, atOnce >= 2 && atOnce <= 10)
/* THE SERIAL LOOP IS GONE, not merely wrapped: `for (const conn of all)` passing a list of fifty
   to a mail server one at a time is the thing the firm described. */
ok('...and the one-after-another loop is gone', !/for \(const conn of all\)/.test(sweep))

/*
 * THE ORDER IS STILL ASKED FOR. Concurrency only preserves it because the list arrives sorted --
 * made concurrent on an unordered select, this would be the original starvation bug running five
 * times faster.
 */
ok('the mailboxes still arrive stalest first',
  /\.order\('last_synced_at', \{ ascending: true, nullsFirst: true \}\)/.test(sweep))

/*
 * AND THE NOTE THAT ADMITTED THE PROBLEM IS ANSWERED RATHER THAN DELETED. "This route is the wrong
 * shape for that many mailboxes" was true and is the sentence somebody will search for; leaving it
 * would describe code that no longer exists, and removing it silently would lose the reasoning
 * about where the shape stops working again.
 */
ok('the known limit is answered where it was recorded',
  /THE LIMIT THIS FILE USED TO RECORD/.test(sweep))
ok('...and says what would come next at a few hundred people',
  /ONE INVOCATION PER MAILBOX IS STILL THE SHAPE THIS WANTS/.test(sweep))

/* ---------------------------------------------------------------------------------------------
 * AND NOBODY HAS TO PRESS ANYTHING
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM: "not having to go and sync and blah blah blah." The answer to that is not a better
 * button -- it is knowing there is no need to press one, which means the mailbox has to say when
 * it was last read.
 */
const page = read('src/pages/mail/MailPage.tsx')
ok('the header says when the mailbox was last read', /Checked \{agoLabel\(checkedAt\)\}/.test(page))
ok('...off the mailbox status rather than a guess', /setCheckedAt\(b\.lastSyncedAt \?\? null\)/.test(page))
ok('...and a press updates it', /setCheckedAt\(new Date\(\)\.toISOString\(\)\)/.test(page))
/*
 * AND THE LABEL AGES. A mailbox left open all afternoon still saying "just now" is worse than one
 * that says nothing: somebody would stop pressing the button on the strength of it.
 */
ok('...and it ages while the page is open', /setClockTick\(\(n\) => n \+ 1\), 60_000/.test(page))

console.log(`\ncheck-sweep-shape: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
