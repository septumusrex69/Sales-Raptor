/**
 * THE PAYOVER QUEUE IN CYCLES: THIS MONTH TO PROCESS, THEN EARLIER STILL PENDING.
 *
 * The firm, 8 Oct, asked for the runs to read as "this month to process" and "previous month
 * pending". What this holds: the cycle that ended the day the open one began is this month's; an
 * older one still in the queue is pending (late); one built inside the open cycle is early; the
 * newest cycle comes first; the totals are the runs' own figures; paid runs carry no urgency.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-payover-groups.mjs
 */
import { readFileSync } from 'node:fs'
import {
  defaultQueueTab, groupRunsByCycle, historyPayouts, parseQueueTab, payoutLabel, paysOnFor, queueTabOf,
} from '../../src/lib/payoverGroups.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const run = (start, end, net) => ({ periodStart: start, periodEnd: end, netPayover: net })
/* Today is 8 Oct: the open cycle began 11 Sep, so this month's payover is 11 Aug - 10 Sep. */
const OPEN = '2026-09-11'
const runs = [
  run('2026-07-11', '2026-08-10', 100),
  run('2026-08-11', '2026-09-10', 8426.07),
  run('2026-09-11', '2026-10-10', 5),
  run('2026-08-11', '2026-09-10', 9699.53),
]
const g = groupRunsByCycle(runs, OPEN, 'open')
/* The firm, 10 Oct: closed-and-pending apart from running, in words. Oldest (leaves soonest) first. */
check('the one that leaves soonest is first, one group per cycle', g.map((x) => x.periodStart), ['2026-07-11', '2026-08-11', '2026-09-11'])
check('each named for where it stands', g.map((x) => x.tone), ['late', 'now', 'early'])
check('...in words', g.map((x) => x.title), ['Overdue', 'Waiting', 'Collecting'])
check('the closed cycle says nothing more goes in, and when it is paid', g[1]?.state, 'Nothing more goes in · approved, paid and advised on 11 Oct')
check('the running cycle says when it closes and when it is paid', g[2]?.state, 'Still collecting · closes at midnight on 10 Oct · paid out 11 Nov')
check('an overdue one says it was due', g[0]?.state, 'Closed 10 Aug · was due 11 Sep and is not yet paid')
check('the total is the runs\' own figures', g[1]?.total, 18125.6)
check('...and every run is in exactly one group', g.reduce((s, x) => s + x.runs.length, 0), 4)
check('paid runs carry no urgency, newest first', groupRunsByCycle(runs, OPEN, 'paid').map((x) => [x.tone, x.periodStart]),
  [['done', '2026-09-11'], ['done', '2026-08-11'], ['done', '2026-07-11']])
check('with no open cycle known nothing is called this month', groupRunsByCycle(runs, null, 'open').map((x) => x.tone), ['late', 'late', 'late'])
check('the payover day follows the lag', [paysOnFor('2026-09-10', 1), paysOnFor('2026-09-10', 0), paysOnFor('2026-12-10', 1)],
  ['2026-10-11', '2026-09-11', '2027-01-11'])
check('...and the group uses it', groupRunsByCycle([run('2026-08-11', '2026-09-10', 1)], OPEN, 'open', 2)[0]?.paysOn, '2026-11-11')
/* 11 Oct, THE PAYOUT DAY, lag one month: the cycle being paid today closed on 10 Sep, not last
   night. It was called Overdue on the morning it fell due. */
const onDay = groupRunsByCycle([run('2026-08-11', '2026-09-10', 1), run('2026-09-11', '2026-10-10', 2)], '2026-10-11', 'open', 1, '2026-10-11')
check('on its payout day a cycle is due today, not overdue', onDay.map((x) => x.title), ['Due today', 'Waiting'])
check('...and the one that closed last night waits for its own day', onDay[1]?.state, 'Nothing more goes in · approved, paid and advised on 11 Nov')
check('the day after, it is overdue', groupRunsByCycle([run('2026-08-11', '2026-09-10', 1)], '2026-10-11', 'open', 1, '2026-10-12')[0]?.title, 'Overdue')
check('nothing to group is no groups', groupRunsByCycle([], OPEN, 'open'), [])

/* ---- S7: FOUR TABS, ONE CYCLE EACH (the firm, 12 Oct: "in the closed to pay, two months were mixed") ---- */
/* Staging day 11 Aug: open cycle 11 Aug - 10 Sep; 11 Jul - 10 Aug closed last night (pays 11 Sep);
   11 Jun - 10 Jul pays TODAY. Each of the three is in its own tab. */
const at = (today, extra = {}) => ({ final: false, released: false, openStart: '2026-08-11', today, lagMonths: 1, ...extra })
const tabs = (today) => [
  queueTabOf({ periodStart: '2026-08-11', periodEnd: '2026-09-10' }, at(today)),
  queueTabOf({ periodStart: '2026-07-11', periodEnd: '2026-08-10' }, at(today)),
  queueTabOf({ periodStart: '2026-06-11', periodEnd: '2026-07-10' }, at(today)),
]
check('on the payout day the three cycles are in three tabs', tabs('2026-08-11'), ['collecting', 'waiting', 'topay'])
check('a cycle due before today is still To pay (overdue)', queueTabOf({ periodStart: '2026-05-11', periodEnd: '2026-06-10' }, at('2026-08-11')), 'topay')
check('a cycle moves from Waiting to To pay on the morning of its day, by the date alone',
  [queueTabOf({ periodStart: '2026-07-11', periodEnd: '2026-08-10' }, at('2026-09-10')), queueTabOf({ periodStart: '2026-07-11', periodEnd: '2026-08-10' }, at('2026-09-11'))],
  ['waiting', 'topay'])
check('released early is due now, in To pay', queueTabOf({ periodStart: '2026-07-11', periodEnd: '2026-08-10' }, at('2026-08-11', { released: true })), 'topay')
check('finished is History whatever its dates', queueTabOf({ periodStart: '2026-08-11', periodEnd: '2026-09-10' }, at('2026-08-11', { final: true })), 'history')
check('the lag decides the day', queueTabOf({ periodStart: '2026-07-11', periodEnd: '2026-08-10' }, at('2026-09-11', { lagMonths: 2 })), 'waiting')
check('opens on To pay when anything is due', defaultQueueTab({ collecting: 3, waiting: 4, topay: 1, history: 9 }), 'topay')
check('...else on Waiting', defaultQueueTab({ collecting: 3, waiting: 4, topay: 0, history: 9 }), 'waiting')
check('...else on Collecting', defaultQueueTab({ collecting: 3, waiting: 0, topay: 0, history: 9 }), 'collecting')
check('an old link still lands', ['running', 'closed', 'paid', 'finalised', 'nonsense', null].map(parseQueueTab),
  ['collecting', 'topay', 'history', 'history', null, null])
check('History\'s months are the payout days, newest first, once each',
  historyPayouts([{ periodEnd: '2026-07-10' }, { periodEnd: '2026-08-10' }, { periodEnd: '2026-07-10' }], 1), ['2026-09-11', '2026-08-11'])
check('...said as payouts', payoutLabel('2026-09-11'), 'Payout 11 Sep 2026')

const page = readFileSync(new URL('../../src/pages/finance/FinanceWorkQueue.tsx', import.meta.url), 'utf8')
check('the queue draws the groups', /groupRunsByCycle\(shown, cycle\?\.periodStart \?\? null, tabShown === 'history' \? 'paid' : 'open', lag, cycle\?\.today \?\? null\)/.test(page) && /groups\.map\(\(g\) =>/.test(page), true)
check('...sorts every run with queueTabOf, once', (page.match(/queueTabOf\(/g) ?? []).length, 1)
check('...in the four tabs, in order', /\['collecting', 'waiting', 'topay', 'history'\] as const/.test(page), true)
check('...and draws the open cycle even with nothing in it', /emptyCollecting && cycle/.test(page) && /collectingState\(cycle\.periodEnd, lag\)/.test(page), true)

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-payover-groups: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
