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
 * WORK FOLLOWS THE PERSON, even where money does not. A call is an act by somebody and stays
 * theirs wherever the account later goes — unlike a payment, which belongs to whoever held the
 * account on the day it landed (checked below).
 */
ok('calls are credited to whoever made them', /select placed_by as uid/.test(fn.slice(0, 5000)))
/*
 * System notes are not work. Raptor composes one on every trace and freeze, and counting them
 * would reward whoever clicked the most buttons.
 */
ok('only a person’s own notes count', /source = 'manual'/.test(fn.slice(0, 6000)))
ok('accounts touched is distinct, not a count of actions', /count\(distinct account_id\)/.test(fn.slice(0, 6000)))

/* ---------- a payment belongs to whoever held the account THAT DAY ---------- */

/*
 * THE FIRM'S RULE, and the reason account_desk_history exists. "Whoever holds it now" hands an
 * account that moved desks on the 28th its whole month's collections — proved against staging:
 * R1 000 paid while a junior held it stays with the junior, and only the R7 000 paid after the
 * handover goes to the senior who holds it today. Under the old rule the senior took all R8 000.
 *
 * It matters because commission and promotions may key off these numbers, and a figure somebody
 * can argue with is not a figure.
 */
const history = sql.slice(sql.indexOf('create table if not exists public.account_desk_history'))
ok('there is a history of who held what', /create table if not exists public\.account_desk_history/.test(sql))
ok('the payment is matched to the holder at the time',
  /dh\.effective_from <= p\.received_at/.test(fn.slice(0, 5000)))
ok('...taking the latest such row', /order by dh\.effective_from desc\s*\n\s*limit 1/.test(fn.slice(0, 5000)))
/* Absence over the whole function, for the same reason: a window is a guess that is right until
   somebody adds a line above it. `fn` is already bounded by the function's own terminator. */
ok('...and not to whoever holds it now', !/select d\.assigned_to as uid/.test(fn))

/*
 * A payment on an account that was on NOBODY's desk that day belongs to nobody. Falling back to
 * the current holder is precisely the behaviour being removed, so the guard has to be explicit.
 */
ok('an unheld account credits nobody', /and h\.user_id is not null/.test(fn.slice(0, 5000)))
/*
 * And somebody who collected in the period but holds nothing today is still owed a row — they
 * did the work, and a leaver's last month should not vanish.
 */
ok('a collector with no book today still appears', /or pd\.payments > 0/.test(fn.slice(0, 8000)))

/*
 * `is distinct from`, not `<>`. With <> a move TO or FROM null is silently dropped — and those
 * are exactly the transitions a team leader makes when somebody leaves and their book goes back
 * to the unallocated pile.
 */
ok('unallocating is recorded too', /new\.assigned_to is distinct from old\.assigned_to/.test(history.slice(0, 4000)))
// Read from the whole file: the reasoning sits in the comment block ABOVE `create table`, which
// a slice starting at the table itself cannot see.
ok('null means unallocated, not missing', /null MEANS SOMETHING: unallocated/.test(sql))

/*
 * EVENT ROWS, NOT SPANS. A span has two ends that can disagree and a closing write that can fail,
 * leaving an account held by two people at once. One row per change cannot.
 */
/*
 * SEARCHED OVER THE WHOLE FILE, not over a window of it.
 *
 * This read `history.slice(0, 2500)`, and schema.sql is APPEND-ONLY -- so the migration that
 * would add this column lands at the END of the file, hundreds of lines past any window. Adding
 * `alter table public.account_desk_history add column to_at timestamptz` left this passing, and
 * the ledger it guards is what commission is counted off.
 */
ok('no span end to fall out of step',
  !/\bto_at\b/.test(history) && !/account_desk_history[^;]*\bto_at\b/is.test(sql))

/*
 * WRITABLE BY NOBODY. The trigger is security definer and is the only writer — a ledger deciding
 * who earned what must not be editable from the browser by the people it measures.
 */
ok('the history is readable', /create policy "account_desk_history_select"/.test(history.slice(0, 4000)))
ok('...and writable by no policy',
  !/create policy "account_desk_history_(insert|update|delete)"/.test(history.slice(0, 4000)))
ok('the only writer is a definer trigger',
  /function public\.record_account_desk_change\(\) returns trigger\s*\n\s*language plpgsql security definer/.test(history.slice(0, 4000)))

/*
 * The backfill is a reconstruction and is marked as one, so nobody later reads a guess as an
 * observation.
 */
ok('the backfill admits it is a guess', /'backfill'/.test(history.slice(0, 6000)))

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

/* ---------- the screen ---------- */

const page = readFileSync(new URL('../../src/pages/CollectorDashboard.tsx', import.meta.url), 'utf8')

/*
 * THE FIRM'S OWN MONTH, the 11th to the 10th, because that is what the client statements and the
 * remittance run against. A dashboard on the calendar month would give two true answers to "how
 * much did we collect in September".
 */
/* Asked of the hook that now holds the period for both dashboards, rather than of the page it
   used to live on -- the firm's month is one decision and it is made once. */
ok('the period is the sales month',
  /getCurrentSalesMonth/.test(readFileSync(new URL('../../src/hooks/useCollectionsMonth.ts', import.meta.url), 'utf8')))
ok('...and the previous one is fetched to compare', /getPreviousSalesMonth\(period\)/.test(page))

/*
 * pctDelta, not arithmetic of its own. StatTile prints the number it is given verbatim, so a raw
 * ratio rendered as "0.6666666666666666%" on the first screenshot — and the shared helper
 * already returns null for a zero prior period, which the tile says in words rather than as a
 * fabricated 100% rise.
 */
ok('the change uses the shared helper', /import \{ pctDelta \}/.test(page))
ok('...and does no percentage arithmetic of its own', !/\(now - before\) \/ before/.test(page))

/*
 * THE RANKING ON RAND EXISTS NOW, AND IT CARRIES ITS OWN CONTEXT.
 *
 * The firm asked for it directly — "I like the idea of actually ranking them in terms of how much
 * rand they've collected" — and answered the obvious objection in the same breath: "so the people
 * know that if they're senior collectors they get more work, it's not a pissing contest." That
 * answer only holds if the grade and the size of the book are on the row beside the rand. Which
 * is what is guarded here: the ranking may exist, and it may not exist WITHOUT its context.
 */
ok('the ranking orders on rand', /b\.line\.collected - a\.line\.collected/.test(page))
/*
 * THE GRADE MOVED, THE RULE DID NOT. It was a column of its own on a Ranking tab; the firm folded
 * the tabs into one table -- "remove the ranking page... put everything at the all clerks page"
 * -- and thirteen columns is already more than fits, so the grade sits under the name instead.
 * Where it is drawn was never the point. That it is on the row is.
 */
ok('...carrying the grade beside it', /\{l\.grade\}/.test(page))
ok('...and the size of the book', /Accounts<\/th>/.test(page))
ok('...and says in words why the two are read together',
  /part of their rand is the book they were handed/.test(page))
ok('...and carries payments and the average, which move independently',
  /Payments<\/th>/.test(page) && /Average payment<\/th>/.test(page))
/*
 * AND THE BOOK-INDEPENDENT ORDER IS STILL ON THE PAGE, in its own card. It is what should decide
 * who is promoted, and if the ranking quietly replaced it the page would be a rand leaderboard
 * with nothing to read against it.
 */
ok('the fair comparison still orders on payments per hundred',
  /b\.paymentsPerHundred \?\? -1\) - \(a\.paymentsPerHundred \?\? -1\)/.test(page))
/*
 * ASSERTED AGAINST THE RENDERED TEXT, NOT THE PAGE. The comment above FairTable says the same
 * thing in almost the same words, so a regex over the whole file is satisfied by the explanation
 * of the behaviour rather than by the behaviour -- the exact trap this codebase has a name for.
 * The card's own caption is sliced out and asserted on.
 */
const fairCaption = page.slice(page.indexOf('How people compare\n'), page.indexOf('<div className="overflow-x-auto">', page.indexOf('How people compare\n')))
ok('there is a caption on the fair card to read', fairCaption.length > 100)
ok('...naming what the ranking is for', /the month the firm is run on/.test(fairCaption))
ok('...and what these figures survive', /survive being given a different/.test(fairCaption))
ok('...and what they are for', /should decide who is promoted/.test(fairCaption))
/*
 * THE FAIR FIGURES ARE DRAWN TWICE AND LABELLED BOTH TIMES -- once for the floor and once for the
 * person. They were on the screen once, as the FLOOR's, in exactly the shape a collector reads as
 * their own; a person cannot tell those apart by looking harder, and the fix is the caption.
 */
ok('the fair figures are a component, not two copies of four tiles',
  /function Measures\(\{ score, caption \}/.test(page))
ok('...drawn for the floor', /<Measures score=\{score\}/.test(page))
ok('...and for the person reading it', /<Measures score=\{myScore\}/.test(page))
ok('...each saying whose they are',
  /Across the whole floor/.test(page) && /Yours, on the same four measures/.test(page))
ok('the fair figures are separated from the money', /compare fairly/.test(page))

/*
 * The over-book notice belongs where a collector will see it. It also sits on the Collectors
 * table in Settings, which a collector never opens — so said only there it is said to nobody.
 */
ok('the over-book notice is on the collector’s own screen', /Your book is \{over/.test(page))
ok('...and says nothing is blocked', /nothing is blocked/.test(page))

/* A null is "no figure", not a bad one: a red 0% in somebody's first week is a lie about them. */
ok('a missing figure shows a dash, not a nought', /value === null\s*\n\s*\? '—'/.test(page))

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
