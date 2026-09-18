/**
 * One collector's own page, and where they stand on the floor.
 *
 * THESE NUMBERS ARE ABOUT A PERSON AND WILL BE READ BY THAT PERSON, which is what raises the cost
 * of every quiet mistake here above the usual. A place computed over the wrong denominator, a
 * month bucketed a day out, a rate over the wrong bottom — none of them error, all of them are
 * things somebody will be told about themselves and believe.
 *
 * Four that look like reasonable arithmetic and are not:
 *
 *   - numbering ties 1,2,3,4 instead of 1,2,2,4 tells one of two identical people they are behind
 *     the other, which is a fact the screen would be inventing
 *   - ranking over everybody on the system rather than over everybody working a book pads the
 *     denominator with people who were never in the race
 *   - bucketing a 12-month trend on calendar months moves a month's takings into the month beside
 *     it, because the firm's month runs the 11th to the 10th
 *   - dropping a month with nothing in it draws a straight line through it and tells a collector
 *     their takings held up through a month they were on leave
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-collector-profile.mjs
 */
import { readFileSync } from 'node:fs'
import {
  bucketByMonth, peakOf, placeLabel, standings, trendAgainstAverage,
} from '../../src/lib/collectorTrend.ts'
import { scoreCollector, THRESHOLDS, band } from '../../src/lib/collectorScore.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------- where somebody stands ---------- */

/*
 * DELIBERATELY OUT OF ORDER. Written biggest-first this fixture cannot tell a ranking from a row
 * number: deleting the sort altogether gives the same four answers, and the check goes on passing
 * over a function that has stopped ranking anything. Found by break-testing it.
 */
const floor = [
  { userId: 'd', collected: 500 },
  { userId: 'b', collected: 80000 },
  { userId: 'a', collected: 120000 },
  { userId: 'c', collected: 80000 },
]
const places = standings(floor, (r) => r.collected)
check('the top collector is first', places.get('a').place, 1)
/*
 * TIES SHARE A PLACE, the way a results board does, and the next one down takes the place the
 * count implies: 1, 2, 2, 4. Numbering them 1, 2, 3, 4 would tell one of two people on identical
 * figures that they are behind the other.
 */
check('two on the same figure share second', places.get('b').place, 2)
check('...both of them', places.get('c').place, 2)
check('...and the next takes fourth, not third', places.get('d').place, 4)
check('everybody is measured against the same field', places.get('d').outOf, 4)
check('an empty floor has no places', standings([], (r) => r.collected).size, 0)
check('one person is first of one', standings([{ userId: 'a', collected: 0 }], (r) => r.collected).get('a').place, 1)
/* Everybody on nought is everybody first — nobody is behind anybody on an empty month. */
const flat = standings([{ userId: 'a', collected: 0 }, { userId: 'b', collected: 0 }], (r) => r.collected)
check('a month where nobody collected leaves nobody behind', flat.get('b').place, 1)

check('a place reads the way a person says it', placeLabel({ place: 3, outOf: 28 }), '3rd of 28')
check('...first', placeLabel({ place: 1, outOf: 28 }), '1st of 28')
check('...second', placeLabel({ place: 2, outOf: 28 }), '2nd of 28')
check('...and the ones English is odd about', placeLabel({ place: 11, outOf: 28 }), '11th of 28')
check('...twelfth', placeLabel({ place: 12, outOf: 28 }), '12th of 28')
check('...thirteenth', placeLabel({ place: 13, outOf: 28 }), '13th of 28')
check('...twenty-first', placeLabel({ place: 21, outOf: 28 }), '21st of 28')
check('nobody in the race has no place', placeLabel(undefined), '—')

/* ---------- twelve months, on the firm's own month ---------- */

/*
 * THE FIRM'S MONTH IS THE 11th TO THE 10th. A payment on the 10th and one on the 11th belong to
 * different months, so an off-by-one here does not smooth a line — it moves a month's takings
 * into the month beside it and makes both of them wrong.
 */
const windows = [
  { key: '2026-09', label: 'September 2026', start: new Date(2026, 7, 11), end: new Date(2026, 8, 10) },
  { key: '2026-10', label: 'October 2026', start: new Date(2026, 8, 11), end: new Date(2026, 9, 10) },
]
const daily = [
  { day: '2026-09-10', collected: 1000, payments: 1 },
  { day: '2026-09-11', collected: 2000, payments: 2 },
  { day: '2026-10-10', collected: 4000, payments: 4 },
  /* Outside both windows, and must be counted in neither. */
  { day: '2026-10-11', collected: 9999, payments: 9 },
  { day: '2026-08-10', collected: 8888, payments: 8 },
]
const buckets = bucketByMonth(daily, windows)
check('the 10th closes the month it ends', buckets[0].collected, 1000)
check('...and the 11th opens the next one', buckets[1].collected, 2000 + 4000)
check('payments are bucketed with the money', buckets[1].payments, 6)
check('a day after the last window belongs to nobody',
  buckets[0].collected + buckets[1].collected, 7000)
check('...and so does a day before the first', buckets.some((b) => b.collected === 8888), false)

/*
 * A MONTH WITH NOTHING IN IT IS STILL RETURNED. Omitting it lets the chart run a straight line
 * through the gap and tell a collector their takings held up through a month they were on leave.
 */
const quiet = bucketByMonth([], windows)
check('every month asked for comes back', quiet.length, 2)
check('...marked as empty rather than missing', quiet[0].empty, true)
check('...with nought in it', quiet[0].collected, 0)
check('a month with money in it is not empty', buckets[1].empty, false)
check('a month with a nought-rand payment is still not empty',
  bucketByMonth([{ day: '2026-09-15', collected: 0, payments: 1 }], windows)[1].empty, false)

check('a chart scales to its biggest month', peakOf(buckets), 6000)
/* Never nought, so nothing divides by it and no bar is drawn at infinity. */
check('an empty year still has a scale', peakOf(quiet), 1)

/*
 * AGAINST THE MONTHS BEFORE IT, not against last month alone. One quiet August makes September
 * look like a triumph and October like a collapse, and a collector reading their own page should
 * not be handed that.
 */
const months = (...amounts) => amounts.map((collected, i) => ({
  key: `m${i}`, label: `m${i}`, collected, payments: collected > 0 ? 1 : 0, empty: collected === 0,
}))
check('a month at twice the average reads as +100%',
  Math.round(trendAgainstAverage(months(100, 100, 100, 200)) * 100), 100)
check('a month at the average reads as nothing',
  Math.round(trendAgainstAverage(months(100, 100, 100, 100)) * 100), 0)
check('a month at half reads as -50%',
  Math.round(trendAgainstAverage(months(100, 100, 100, 50)) * 100), -50)
/*
 * THREE MONTHS TO AVERAGE. Two is not a trend and saying so would be inventing one — and the
 * denominator is the months BEFORE this one, so it takes four months on the chart to have three
 * to average.
 */
check('two months is not a trend', trendAgainstAverage(months(100, 200)), null)
check('three is still not enough to average three', trendAgainstAverage(months(100, 200, 300)), null)
check('four months gives three to average', trendAgainstAverage(months(100, 100, 100, 200)) !== null, true)
/* Five months with two of them quiet is still only three to average, so it is still allowed. */
check('quiet months are not counted towards the three',
  trendAgainstAverage(months(0, 0, 100, 100, 200)), null)
/* Quiet months are left out of the average rather than dragging it to nought. */
check('a month on leave does not become the baseline',
  Math.round(trendAgainstAverage(months(100, 0, 100, 100, 100)) * 100), 0)
check('a floor that has never collected has no trend to state',
  trendAgainstAverage(months(0, 0, 0, 0)), null)

/* ---------- traces are bought and then worked ---------- */

const stats = (over = {}) => ({
  userId: 'u1', inPlayAccounts: 0, inPlayValue: 0, collected: 0, payments: 0,
  calls: 0, callsAnswered: 0, emailsSent: 0, smsSent: 0, notesWritten: 0,
  promisesMade: 0, promisesKept: 0, promisesBroken: 0, accountsTouched: 0,
  tracesPulled: 0, traceLeads: 0, tracesWorked: 0, tracesVerified: 0, ...over,
})

/*
 * VERIFIED OVER WORKED, never over what the bureau printed. A trace comes back with eleven numbers
 * and most are stale by construction — that is what a trace is. Judging somebody on how many of
 * the eleven were good would be judging the bureau, not the collector.
 */
const traced = scoreCollector(stats({ tracesPulled: 4, traceLeads: 40, tracesWorked: 20, tracesVerified: 6 }))
check('the hit rate is over what they tried', traced.traceHitRate, 6 / 20)
check('...not over what the bureau printed', traced.traceHitRate === 6 / 40, false)
check('somebody who has worked none has no rate, not a nought',
  scoreCollector(stats({ tracesPulled: 4, traceLeads: 40 })).traceHitRate, null)
check('...which the screen shows as unknown rather than poor',
  band(scoreCollector(stats({ traceLeads: 40 })).traceHitRate, THRESHOLDS.traceHitRate), 'unknown')
check('a third of what you try is good work', band(0.35, THRESHOLDS.traceHitRate), 'good')
check('one in ten is not', band(0.1, THRESHOLDS.traceHitRate), 'poor')

/* ---------- the page ---------- */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const profile = read('../../src/pages/CollectorProfile.tsx')
const board = read('../../src/pages/CollectorDashboard.tsx')
const app = read('../../src/App.tsx')
const sql = read('../../supabase/schema.sql')

ok('there is a page for one collector', /export function CollectorProfile/.test(profile))
ok('...on its own route', /path="\/performance\/:userId"/.test(app))
ok('...reachable from every row of the floor list', /to=\{`\/performance\/\$\{l\.userId\}`\}/.test(board))
ok('...and from your own strip', /to=\{`\/performance\/\$\{mine\.userId\}`\}/.test(board))

/*
 * EVERYBODY SEES THE FLOOR. The firm: "they should see their own thing, but they should also be
 * able to see the entire company's performance, and where they stand relative to everybody else."
 * The role gate that used to hide the tables from an agent is gone, not merely widened.
 */
ok('the floor list is not gated by role', !/SEES_EVERYONE/.test(board))
ok('...and the headline is the company’s', /totalStats\(shownRows\)/.test(board))
ok('...with the reader’s own month beside it', /Your month/.test(board))
ok('...and their place on it', /placeLabel\(myPlace\)/.test(board))
ok('...and their own row marked in the list', /\(you\)/.test(board))

/* Everything the firm listed for the collector's page. */
for (const [what, needle] of [
  ['collections', /label="Collected"/],
  ['payments', /label="Payments"/],
  ['the average payment', /label="Average payment"/],
  ['promises taken', /label="Taken"/],
  ['promises kept', /label="Kept"/],
  ['promises broken', /label="Broken"/],
  ['accounts', /accounts on the book/],
  ['book value', /label="Book value"/],
  ['calls', /label="Calls"/],
  ['SMS', /label="SMS"/],
  ['emails', /label="Emails"/],
  ['traces pulled', /label="Pulled"/],
  ['traces worked', /label="Worked"/],
  ['twelve months', /<TrendCard/],
]) {
  ok(`the page carries ${what}`, needle.test(profile))
}

/*
 * A PROMISE NOT YET DUE IS NEITHER KEPT NOR BROKEN, and the page has to have somewhere to put it
 * or the three numbers do not add up to the fourth and the collector counts them.
 */
ok('promises not yet due are shown as their own figure', /Still to come/.test(profile))

/*
 * WHATSAPP IS SAID, NOT LEFT BLANK. The firm asked for it beside the calls and SMS, and Raptor
 * does not send or record one — there is no table and no integration. A tile reading "WhatsApp 0"
 * would be a lie that looks like a quiet month.
 */
ok('WhatsApp is named as not counted', /WhatsApp is not counted here/.test(profile))
ok('...and no WhatsApp figure is drawn', !/label="WhatsApp"/.test(profile))
/*
 * PRECISELY: there is no WhatsApp MESSAGE anywhere to count. The word does appear once in the
 * schema, in a comment on promises_to_pay.origin — somebody may type that a promise was obtained
 * over WhatsApp — but that is a note on one promise, not a channel Raptor sends or stores. A
 * blanket "the word never appears" was the first version of this check and it failed on correct
 * code, which is how a check gets deleted rather than understood.
 */
ok('...because there is no WhatsApp message table to draw one from',
  !/create table[^;]*whats\s?app/i.test(sql))
ok('...and no WhatsApp column on any of them', !/whatsapp_\w+/i.test(sql))

/*
 * THE GRADE IS ON THE PAGE ABOVE EVERY PLACE ON IT. This is the firm's own answer to their own
 * worry about a pissing contest, and it only works if the reader meets it before the numbers.
 */
ok('the grade is beside the name', /collectorGrade \?\? 'Ungraded'/.test(profile))
ok('...with the size of the book', /accounts on the book/.test(profile))
ok('...and the caveat said in words', /partly a place on the book somebody was given/.test(profile))

/* A place is over the people actually working a book, not over everybody on the system. */
ok('the ranking counts only people working a book',
  /\.filter\(\(r\) => r\.inPlayAccounts > 0 \|\| r\.collected > 0\)/.test(profile))
ok('...and says how many that was', /Out of \{running\.length\} collectors/.test(profile))

/* Three places, because they move independently and say different things. */
ok('there is a place on rand', /standings\(running, \(r\) => r\.collected\)/.test(profile))
ok('...on how many people paid', /standings\(running, \(r\) => r\.payments\)/.test(profile))
ok('...and on the average payment', /r\.payments > 0 \? r\.collected \/ r\.payments : 0/.test(profile))

/* One measure, one scale — the same rule the sales trend card spells out next door. */
ok('the trend draws one measure', /dataKey="collected"/.test(profile))
ok('...against the target as a flat line', /<ReferenceLine y=\{target\}/.test(profile))
ok('...and a month past target reads at a glance', /d\.collected >= target/.test(profile))

/* ---------- the database gives up what the page needs ---------- */

const fn = sql.slice(sql.lastIndexOf('create function public.collector_performance'))
ok('traces pulled are counted', /traces_pulled integer/.test(fn))
ok('...and what they turned up', /trace_leads integer/.test(fn))
ok('...and what was actually tried', /traces_worked integer/.test(fn))
ok('...and what proved real', /traces_verified integer/.test(fn))
/*
 * WORKED IS COUNTED ON THE OUTCOME DATE, whoever pulled the trace: one bought in August and worked
 * in September is September's effort. Counted on the trace's own date it would credit the month
 * the firm spent the money, not the month somebody did the work.
 */
ok('work on a trace counts in the month it was done',
  /from public\.account_trace_items\s*\n\s*where outcome_by is not null\s*\n\s*and outcome_at >= p_from/.test(fn))

const daily_fn = sql.slice(sql.lastIndexOf('create or replace function public.collector_daily'))
ok('a year of days comes back in one round trip', /returns table \(on_day date/.test(daily_fn))
/* The firm's own day, not UTC: a payment at half past one in Johannesburg is still yesterday in
   UTC, and a daily total that disagrees with the bank statement is one nobody trusts again. */
ok('...on the firm’s own day', /at time zone 'Africa\/Johannesburg'/.test(daily_fn))
ok('...excluding payments that bounced', /p\.reversed_at is null/.test(daily_fn))
ok('...credited to whoever held the account that day', /order by dh\.effective_from desc/.test(daily_fn))
ok('...and able to answer for the whole floor', /p_user is null or h\.user_id = p_user/.test(daily_fn))

/* The mapper is the trap this codebase has a name for. */
const mapper = read('../../src/lib/collectorStats.ts')
for (const col of ['traces_pulled', 'trace_leads', 'traces_worked', 'traces_verified']) {
  ok(`${col} reaches the app`, new RegExp(`r\\.${col}`).test(mapper))
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A collector can see their own month, the whole floor's, and where they stand on it — with their
grade and the size of their book beside the place, which is the firm's own answer to their own
worry. Twelve months are bucketed on the firm's month, quiet ones included.`)
