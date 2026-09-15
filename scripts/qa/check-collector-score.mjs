/**
 * How a collector is judged.
 *
 * THESE NUMBERS WILL DECIDE WHO GETS PROMOTED, so the ways they can be quietly wrong matter more
 * than usual. Three in particular, each of which looks like a reasonable formula and punishes
 * exactly the wrong person:
 *
 *   - dividing kept promises by promises MADE scores an agent nought for a promise that has not
 *     come due yet, penalising whoever takes promises furthest out
 *   - dividing actions by accounts TOUCHED climbs as the book is neglected
 *   - ranking on rand collected measures the book somebody was handed, not the collector
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-collector-score.mjs
 */
import { readFileSync } from 'node:fs'
import {
  THRESHOLDS, band, overBookBy, scoreCollector, totalStats,
} from '../../src/lib/collectorScore.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const near = (name, actual, expected) => check(name, Math.round((actual ?? NaN) * 1e6) / 1e6, expected)

const stats = (over = {}) => ({
  userId: 'u1', inPlayAccounts: 0, inPlayValue: 0, collected: 0, payments: 0,
  calls: 0, callsAnswered: 0, emailsSent: 0, smsSent: 0, notesWritten: 0,
  promisesMade: 0, promisesKept: 0, promisesBroken: 0, accountsTouched: 0, ...over,
})

/* ---------- actions ---------- */

{
  const s = scoreCollector(stats({ calls: 10, emailsSent: 5, smsSent: 3, notesWritten: 12, inPlayAccounts: 100 }))
  check('everything a person did counts as an action', s.actions, 30)
  near('actions per account', s.actionsPerAccount, 0.3)
}

/*
 * PER ACCOUNT ON THE BOOK, NOT PER ACCOUNT TOUCHED. Per-touched rewards working forty accounts
 * hard and ignoring four hundred — the figure climbs as the book is neglected, which is the exact
 * opposite of what a team leader is looking for.
 */
{
  const diligent = scoreCollector(stats({ calls: 200, inPlayAccounts: 400, accountsTouched: 380 }))
  const narrow = scoreCollector(stats({ calls: 200, inPlayAccounts: 400, accountsTouched: 20 }))
  check('neglecting the book does not improve the figure', diligent.actionsPerAccount, narrow.actionsPerAccount)
  ok('...and coverage is what separates them', (diligent.coverage ?? 0) > (narrow.coverage ?? 0))
  near('coverage is of the whole book', narrow.coverage, 0.05)
}

/* ---------- promises ---------- */

/*
 * THE ONE THAT WOULD HAVE SHIPPED WRONG. An agent takes 11 promises, 1 is kept, 1 is broken and
 * 9 are not due yet. Kept over MADE reads 9%; kept over RESOLVED reads 50%. The first is a
 * verdict on work that has not happened.
 */
{
  const s = scoreCollector(stats({ promisesMade: 11, promisesKept: 1, promisesBroken: 1 }))
  check('resolved is the denominator', s.promisesResolved, 2)
  near('the kept rate ignores promises not yet due', s.promiseKeptRate, 0.5)
  ok('...which is not kept over made', s.promiseKeptRate !== 1 / 11)
}
{
  const s = scoreCollector(stats({ promisesMade: 6, promisesKept: 0, promisesBroken: 0 }))
  check('six promises none of which are due yet has no rate', s.promiseKeptRate, null)
  check('...and the promises still show', s.promisesMade, 6)
}

/* ---------- nothing to divide by is not nought ---------- */

/*
 * A rate of 0% is a claim about somebody. Null is the absence of one. A collector with no book
 * yet must not read as 0% recovery on their first morning.
 */
{
  const s = scoreCollector(stats())
  check('no book, no recovery rate', s.recoveryRate, null)
  check('no payments, no average', s.averagePayment, null)
  check('no accounts, no actions per account', s.actionsPerAccount, null)
  check('no calls, no answer rate', s.callAnswerRate, null)
  check('no book, no payments per hundred', s.paymentsPerHundred, null)
  check('no promises, no kept rate', s.promiseKeptRate, null)
}

/* ---------- the figures that survive a different book ---------- */

/*
 * THE TRAP THE WHOLE FILE EXISTS TO AVOID. A junior on 130 gym memberships and a senior on 130
 * commercial accounts, both working equally well: same payment count, same coverage. Rand
 * collected differs by a factor of fifty because the books do. Rank on rand and the junior can
 * never produce a number that earns them a better book.
 */
{
  const gym = scoreCollector(stats({ inPlayAccounts: 130, inPlayValue: 234000, collected: 12000, payments: 26 }))
  const commercial = scoreCollector(stats({ inPlayAccounts: 130, inPlayValue: 11700000, collected: 600000, payments: 26 }))
  ok('rand collected says they are miles apart', commercial.collected > gym.collected * 40)
  check('payments per hundred says they are level', gym.paymentsPerHundred, commercial.paymentsPerHundred)
  near('...at twenty per hundred', gym.paymentsPerHundred, 20)
  /*
   * Recovery rate is EQUAL, not merely close — which is the stronger version of the point and
   * the one this check first got wrong by asserting the gym book scored higher. Both recovered
   * the same proportion of what they were holding; that is exactly what makes it comparable
   * across books that differ by a factor of fifty.
   */
  check('recovery rate is a proportion, not a total', gym.recoveryRate, commercial.recoveryRate)
  near('...and it is what was actually recovered', gym.recoveryRate, 0.051282)
}

near('the average payment is the total over the count',
  scoreCollector(stats({ collected: 2555, payments: 5 })).averagePayment, 511)

/* ---------- reversed payments must never have been counted ---------- */

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const fn = sql.slice(sql.indexOf('function public.collector_performance'))
/*
 * A debit order that bounced was never money. Counting it would make somebody's best month the
 * one where a payment failed, and the figure would disagree with the client's own statement.
 */
ok('reversed payments are excluded', /p\.reversed_at is null/.test(fn.slice(0, 4000)))
/*
 * MONEY FOLLOWS THE BOOK, WORK FOLLOWS THE PERSON. An EFT landing overnight is "created by"
 * nobody, so a payment is credited to whoever holds the account; a call is an act by a person
 * and is credited to whoever made it.
 */
ok('collections are credited to whoever holds the account', /d\.assigned_to as uid/.test(fn.slice(0, 4000)))
ok('calls are credited to whoever made them', /select placed_by as uid/.test(fn.slice(0, 5000)))
/*
 * System notes are not work. Raptor composes one on every trace and freeze, and counting them
 * would reward whoever clicked the most buttons.
 */
ok('only a person’s own notes count', /source = 'manual'/.test(fn.slice(0, 6000)))
ok('accounts touched is distinct, not a count of actions', /count\(distinct account_id\)/.test(fn.slice(0, 6000)))

/* ---------- the over-book notice ---------- */

check('a full book is not over', overBookBy(stats({ inPlayAccounts: 500 }), 500), 0)
check('...and 470 against 150 is', overBookBy(stats({ inPlayAccounts: 470 }), 150), 320)
check('under is never negative', overBookBy(stats({ inPlayAccounts: 10 }), 500), 0)

/* ---------- the traffic light ---------- */

check('a good kept rate', band(0.8, THRESHOLDS.promiseKeptRate), 'good')
check('a fair one', band(0.5, THRESHOLDS.promiseKeptRate), 'fair')
check('a poor one', band(0.1, THRESHOLDS.promiseKeptRate), 'poor')
/* Unknown is its own state: no promises resolved is not a bad kept rate. */
check('no figure is not a poor figure', band(null, THRESHOLDS.promiseKeptRate), 'unknown')
ok('the thresholds are in one place, because they are guesses',
  /THRESHOLDS/.test(readFileSync(new URL('../../src/lib/collectorScore.ts', import.meta.url), 'utf8')))

/* ---------- team totals ---------- */

{
  const t = totalStats([
    stats({ inPlayAccounts: 88, collected: 2555, payments: 5, calls: 1, promisesKept: 1 }),
    stats({ inPlayAccounts: 120, collected: 40000, payments: 12, calls: 30, promisesKept: 4 }),
  ])
  check('the book adds up', t.inPlayAccounts, 208)
  check('the money adds up', t.collected, 42555)
  check('the payments add up', t.payments, 17)
  check('and the scored total divides correctly', scoreCollector(t).averagePayment, 42555 / 17)
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A promise not yet due is neither kept nor broken, neglecting the book does not flatter the
figures, and two collectors working equally well on very unlike books score the same on the
numbers that compare them.`)
