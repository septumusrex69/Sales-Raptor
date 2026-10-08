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
import { groupRunsByCycle } from '../../src/lib/payoverGroups.ts'

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
check('newest cycle first, one group per cycle', g.map((x) => x.periodStart), ['2026-09-11', '2026-08-11', '2026-07-11'])
check('each named for where it stands', g.map((x) => x.tone), ['early', 'now', 'late'])
check('this month is what the firm called it', g[1]?.title, 'This month to process')
check('...an older one is pending', g[2]?.title, 'Earlier, still pending')
check('the total is the runs\' own figures', g[1]?.total, 18125.6)
check('...and every run is in exactly one group', g.reduce((s, x) => s + x.runs.length, 0), 4)
check('paid runs carry no urgency', groupRunsByCycle(runs, OPEN, 'paid').every((x) => x.tone === 'done'), true)
check('with no open cycle known nothing is called this month', groupRunsByCycle(runs, null, 'open').map((x) => x.tone), ['late', 'late', 'late'])
check('nothing to group is no groups', groupRunsByCycle([], OPEN, 'open'), [])

const page = readFileSync(new URL('../../src/pages/finance/FinanceWorkQueue.tsx', import.meta.url), 'utf8')
check('the queue draws the groups', /groupRunsByCycle\(shown, cycle\?\.periodStart \?\? null, tab\)/.test(page) && /groups\.map\(\(g\) =>/.test(page), true)

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-payover-groups: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
