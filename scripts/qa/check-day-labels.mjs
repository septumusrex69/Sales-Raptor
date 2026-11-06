/**
 * A DATE IN A LIST ALWAYS NAMES A DAY (Raptor · Handover 17, S18; Stephan, 6 Nov, on an email: "It says
 * last week at 13:40. When was it received? There's no actual date").
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-day-labels.mjs
 */
import { readFileSync } from 'node:fs'
import { relativeDayLabel } from '../../src/lib/dateLabels.ts'

let pass = 0
const failures = []
const check = (n, a, e) => { if (a === e) pass += 1; else failures.push(`${n}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`) }

/* Relative to the real clock: the labels are built from today's date so the check never goes stale. */
const now = new Date()
const at = (daysBack) => { const d = new Date(now); d.setDate(d.getDate() - daysBack); d.setHours(13, 20, 0, 0); return d }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

check('today', relativeDayLabel(at(0).toISOString()), 'Today')
check('yesterday', relativeDayLabel(at(1).toISOString()), 'Yesterday')
const three = at(3)
check('this week: the weekday WITH its date', relativeDayLabel(three.toISOString()),
  `${three.toLocaleDateString('en-ZA', { weekday: 'long' })} ${three.getDate()} ${MONTHS[three.getMonth()].slice(0, 3)}`)
const nine = at(9)
const nineLabel = relativeDayLabel(nine.toISOString())
check('7-13 days back is a date, never "Last week"', nineLabel.startsWith(`${nine.getDate()} ${MONTHS[nine.getMonth()]}`), true)
check('...and "Last week" is gone from the label', /Last week/.test(readFileSync(new URL('../../src/lib/dateLabels.ts', import.meta.url), 'utf8').split('export function dateGroupLabel')[0].replace(/\/\*[\s\S]*?\*\//g, '')), false)
check('September is written out, not "Sept"', relativeDayLabel('2001-09-15T10:00:00'), '15 September 2001')
check('nothing is a dash', relativeDayLabel(undefined), '—')

console.log(`${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1) }
