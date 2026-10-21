/**
 * A PERIOD IS MEASURED AGAINST THE TARGETS OF THE MONTHS IT IS MADE OF, OR AGAINST NOTHING (S7).
 *
 * The firm, 13 Oct, on the company dashboard set to All time: R121 650 collected read as "101.4%
 * achieved" of R120 000 -- one month's target -- over "275 of 275 working days". Held here: one month
 * is its own target; last 3/6/12 months are that many months, each looked up by its own key; all
 * time, year to date and custom dates have no target; the hook sums each month's target rather than
 * reading one key; and both dashboards tell the month bar when there is nothing to measure.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-period-target.mjs
 */
import { readFileSync } from 'node:fs'
import { getAllTimeRange, getCurrentSalesMonth, getLastNSalesMonthsRange, getYTDRange, targetMonthsOf } from '../../src/lib/salesMonth.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ref = new Date('2026-09-11T10:00:00')
const month = getCurrentSalesMonth(ref)
check('one month is measured against its own target', targetMonthsOf(month)?.map((m) => m.key), [month.key])
check('the last three months against three months\' targets, each by its own key',
  targetMonthsOf(getLastNSalesMonthsRange(ref, 3))?.map((m) => m.key), ['2026-08', '2026-09', '2026-10'])
check('...the last of which is this month', targetMonthsOf(getLastNSalesMonthsRange(ref, 3))?.at(-1)?.key, month.key)
check('...and twelve against twelve', targetMonthsOf(getLastNSalesMonthsRange(ref, 12))?.length, 12)
check('all time has no target (the firm\'s 101.4% of one month)', targetMonthsOf(getAllTimeRange(ref)), null)
check('nor has year to date, which starts where no month does', targetMonthsOf(getYTDRange(ref)), null)
check('nor custom dates', targetMonthsOf({ start: ref, end: ref, label: 'Custom Range', rangeLabel: '', key: 'custom-2026-08-01-2026-09-05' }), null)

const hook = readFileSync(new URL('../../src/hooks/useCollectionsMonth.ts', import.meta.url), 'utf8')
check('the hook sums each month\'s own target', /for \(const m of targetMonths\)/.test(hook) && /'collected', m\.key\)/.test(hook), true)
check('...and no longer reads one key for the whole period', /'collected', period\.key\)/.test(hook), false)
check('...and gives no target where the period has none', /if \(!targetMonths\) return \{ target: null/.test(hook), true)
for (const [file, attr] of [['CompanyDashboard', 'measured={month.measured}'], ['CollectorDashboard', 'measured={measured}']]) {
  const src = readFileSync(new URL(`../../src/pages/${file}.tsx`, import.meta.url), 'utf8')
  check(`${file} tells the month bar when there is nothing to measure`, src.includes(`<MonthProgress pace=`) && src.includes(attr), true)
}

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-period-target: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
