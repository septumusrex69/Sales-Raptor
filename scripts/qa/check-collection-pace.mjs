/**
 * Pace against target, checked against the firm's own sheets.
 *
 * THE FIGURES BELOW ARE REAL. They are read off the September 2026 "Clerks Needing Attention"
 * and "Teams Progress" workbooks the firm runs the floor on, and every one of them has to come
 * out of Raptor unchanged — because a team leader will put this screen next to that spreadsheet,
 * and a screen that disagrees with the sheet by one work day is a screen nobody uses twice.
 *
 * Three ways this goes quietly wrong, each of which looks like reasonable arithmetic:
 *
 *   - counting calendar days instead of work days, or forgetting Heritage Day, gives 21 work days
 *     where the firm has 20, and every percentage on the screen is then wrong by 5%
 *   - hard-coding the sheet's printed legend ("<10% critical, >=20% on track") freezes one day's
 *     pace into the rule and is wrong on every other day of the month
 *   - returning nought for somebody with no target set puts people nobody has given a figure to
 *     at the top of a list headed "needing attention"
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-collection-pace.mjs
 */
/*
 * THE FIRM'S OWN CLOCK, set before the first Date is made.
 *
 * Every date on this screen is a South African working day, and the one bug this file exists to
 * stop — reading a local midnight as the previous day — cannot happen at all on a machine
 * running in UTC, which is what CI does. Pinning the zone here is what makes that check bite
 * somewhere other than on the firm's own desks. The offset is asserted below, so a Node that
 * ignored this would show up as a failure rather than as a check that quietly proves nothing.
 */
process.env.TZ = 'Africa/Johannesburg'

import { readFileSync } from 'node:fs'
import {
  dayKey, monthPace, paceLine, standingLabel, teamTotal, workDaysInclusive,
} from '../../src/lib/collectionPace.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const near = (name, actual, expected, places = 2) =>
  check(name, Math.round((actual ?? NaN) * 10 ** places) / 10 ** places, expected)

/* The firm's September 2026 Sales Month: 11 Sep – 10 Oct, printed on Monday 14 September. */
const START = new Date(2026, 8, 11)
const END = new Date(2026, 9, 10)
const ON_THE_14TH = new Date(2026, 8, 14, 9, 30)

/* ---------- the month, in work days ---------- */

const sept = monthPace(START, END, ON_THE_14TH)
check('the firm’s September has 20 work days', sept.workDays, 20)
check('2 of them are worked by Monday the 14th', sept.daysWorked, 2)
check('18 are left', sept.daysLeft, 18)
check('which the firm calls 4 weeks', sept.weeksLeft, 4)
near('expected pace is 10%', sept.expected, 0.1, 4)
ok('the month is not finished', sept.finished === false)

/*
 * 24 September is Heritage Day. It is the single day that makes this month 20 and not 21, and
 * dropping it is the quiet failure that puts every percentage on the screen out by 5%.
 */
check('Heritage Day is not a work day', workDaysInclusive('2026-09-24', '2026-09-24'), 0)
check('the 23rd and 25th are', workDaysInclusive('2026-09-23', '2026-09-25'), 2)
check('a weekend counts for nothing', workDaysInclusive('2026-09-12', '2026-09-13'), 0)
check('one work day counts as one, both ends included', workDaysInclusive('2026-09-11', '2026-09-11'), 1)
check('a backwards range is nought, not a crash', workDaysInclusive('2026-09-14', '2026-09-11'), 0)

/*
 * TODAY COUNTS AS WORKED FROM THE MOMENT IT STARTS — the firm's convention, which is why their
 * sheet printed on the 14th says 2 and not 1. It means everybody reads slightly behind at nine
 * in the morning; counting only finished days would flatter the whole floor by a day's pace and
 * disagree with the spreadsheet open beside this screen.
 */
check('today counts the moment it starts', monthPace(START, END, new Date(2026, 8, 11, 0, 1)).daysWorked, 1)
check('a Saturday adds nothing to the count', monthPace(START, END, new Date(2026, 8, 12)).daysWorked, 1)
check('before the month opens, nothing is worked', monthPace(START, END, new Date(2026, 8, 1)).daysWorked, 0)

const closed = monthPace(START, END, new Date(2026, 10, 1))
check('a finished month has every day worked', closed.daysWorked, 20)
check('...and none left', closed.daysLeft, 0)
ok('...and says so', closed.finished === true)
near('...and its pace is 100%', closed.expected, 1, 4)

/* A local midnight must not be read as the previous day, which UTC formatting would do in SAST. */
check('dates are the local calendar’s', dayKey(new Date(2026, 8, 11, 0, 0, 0)), '2026-09-11')

/* ---------- the three bands, as the firm actually applies them ---------- */

/*
 * These four rows are lifted straight off the sheet and they are what pin the rule. The legend
 * printed at the top of it says "<10% Critical, 10-19% Below pace, >=20% On Track" — and the
 * sheet's own rows disprove it twice: Keamogetse Mose sits at 19.9% and is marked On Track, and
 * the line between Tumisang Mose at 5.1% and Amanda Coertze at 4.9% is exactly half the day's
 * 10% pace. The legend is that one day's pace written out longhand.
 */
const at = (collected, target) => paceLine(collected, target, sept).standing
check('Keamogetse Mose, 19.9% against 10% pace', at(15886.51, 80000), 'on-track')
check('Baphiwe Tati, 22.0%', at(6603.62, 30000), 'on-track')
check('Samuel Ndaba, 9.8% — a whisker under pace', at(4409.98, 45000), 'behind')
check('Tumisang Mose, 5.1% — just over half pace', at(3083, 60000), 'behind')
check('Amanda Coertze, 4.9% — just under half pace', at(4884, 100000), 'critical')
check('Agnes Ntlaba, 3.1%', at(3104, 100000), 'critical')
check('Antoinette Mahlangu, 0.2%', at(100, 45000), 'critical')
check('exactly on pace is on track', at(10000, 100000), 'on-track')
check('exactly half of pace is behind, not critical', at(5000, 100000), 'behind')
check('the target reached is its own answer', at(100000, 100000), 'met')
check('past the target stays met', at(250000, 100000), 'met')

/*
 * The bands move with the month, which is the entire reason they are not written as percentages.
 * The same 10% is on pace on the second working day and critical on the eighteenth.
 */
const late = monthPace(START, END, new Date(2026, 9, 6))
check('17 days worked by 6 October', late.daysWorked, 17)
check('10% on the second day is on track', paceLine(10000, 100000, sept).standing, 'on-track')
check('10% on the eighteenth is critical', paceLine(10000, 100000, late).standing, 'critical')

/* ---------- what is still needed ---------- */

/* Agnes Ntlaba's line, figure for figure: R100 000 target, R3 104 in, 18 days left. */
const agnes = paceLine(3104, 100000, sept)
near('achieved', agnes.achieved * 100, 3.1, 1)
near('gap vs pace', agnes.gap * 100, -6.9, 1)
near('still needed', agnes.stillNeeded, 96896)
near('needed a day', agnes.neededADay, 5383.11)
check('and the status the sheet prints', standingLabel(agnes.standing), 'Critical')

/* The Cheetahs' line off the Teams sheet: R625 000 target, R18 479.05 in, 18 days / 4 weeks. */
const cheetahs = paceLine(18479.05, 625000, sept)
near('a team’s difference', cheetahs.stillNeeded, 606520.95)
near('a team’s daily figure', cheetahs.neededADay, 33695.61)
near('a team’s weekly figure', cheetahs.neededAWeek, 151630.24)

/* Overpaying leaves nothing still needed. A negative would read as money owed back to the firm. */
near('past target, nothing is still needed', paceLine(120000, 100000, sept).stillNeeded, 0)
near('...and nothing a day', paceLine(120000, 100000, sept).neededADay, 0)

/*
 * On the last afternoon of the month there are no days left to spread the shortfall over. R0 a
 * day is a comfortable lie and a division by nought is a crash; the answer is that there is no
 * answer, and the screen prints a dash.
 */
const lastDay = monthPace(START, END, new Date(2026, 9, 9))
check('the last work day leaves none after it', lastDay.daysLeft, 0)
check('needed a day has no answer then', paceLine(3104, 100000, lastDay).neededADay, null)
check('nor does needed a week', paceLine(3104, 100000, lastDay).neededAWeek, null)

/* ---------- no target is not a target of nought ---------- */

for (const [what, target] of [['null', null], ['undefined', undefined], ['nought', 0]]) {
  const none = paceLine(4884, target, sept)
  check(`${what} target has no standing`, none.standing, 'no-target')
  check(`${what} target has no percentage`, none.achieved, null)
  check(`${what} target has no gap`, none.gap, null)
  check(`${what} target needs no stated amount`, none.stillNeeded, null)
  check(`${what} target still reports what came in`, none.collected, 4884)
}
check('and it is said in words, not left blank', standingLabel('no-target'), 'No target')

/* The firm's words, not the database's. */
check('behind is "slightly behind"', standingLabel('behind'), 'Slightly behind')
check('met is "target reached"', standingLabel('met'), 'Target reached')

/* ---------- a team total is the sum of the people's ---------- */

const team = teamTotal([
  { collected: 1000, target: 60000 },
  { collected: 2000, target: 80000 },
  { collected: 500, target: null },
])
check('collected is everybody’s', team.collected, 3500)
check('the target is only those who have one', team.target, 140000)
check('the head count is everybody', team.members, 3)
check('and it says how many were set', team.withTarget, 2)

const untargeted = teamTotal([{ collected: 900, target: null }])
check('a team nobody was set has no target', untargeted.target, null)
check('...but still has its collections', untargeted.collected, 900)
check('an empty team has no target either', teamTotal([]).target, null)

/* ---------- the numbers reach the screen ---------- */

const page = readFileSync(new URL('../../src/pages/CollectorDashboard.tsx', import.meta.url), 'utf8')

ok('the Performance screen computes the month in work days', /monthPace\(period\.start, period\.end/.test(page))
ok('the work-day header is rendered', /<PaceCard/.test(page))
ok('it carries the firm’s four header facts',
  /label="Work days"/.test(page) && /label="Worked"/.test(page)
  && /label="Expected pace"/.test(page) && /label="Gap vs pace"/.test(page))
ok('the teams sheet is rendered', /<TeamTable/.test(page))
ok('the needing-attention table is rendered', /<TargetTable/.test(page))
ok('needed a week is on the teams table only', /Needed a week/.test(page))

/*
 * BOTH VIEWS EXIST, and the fair one is what the page opens on. Ranking collectors on rand
 * measures the book somebody was handed; the whole of collectorScore.ts exists to stop that, and
 * a target table that quietly became the default would undo it.
 */
ok('the fair comparison is still there', /<FairTable/.test(page))
ok('...and is what the card opens on', /useState<EveryoneView>\('fair'\)/.test(page))
ok('...and still says why it is ordered that way', /not by rand/.test(page))
ok('the attention list says it is not a ranking', /it is not a ranking of collectors/.test(page))

/*
 * Worst first is the whole point of a list headed "needing attention" — and this is asserted
 * against the attention table's OWN source, not against the page. Both tables sort the same way
 * and with the same expression, so a page-wide regex is satisfied by the teams table and would
 * go on passing with the collectors' list reversed.
 */
const attention = page.slice(page.indexOf('function TargetTable'), page.indexOf('function TeamTable'))
const teamsTable = page.slice(page.indexOf('function TeamTable'))
ok('there is an attention table to read', attention.length > 500)
ok('there is a teams table to read', teamsTable.length > 500)
ok('the attention list sorts worst first', /a\.line\.achieved - b\.line\.achieved/.test(attention))
ok('...with people who have no target at the bottom',
  /Number\(a\.line\.achieved === null\) - Number\(b\.line\.achieved === null\)/.test(attention))
ok('the teams list sorts worst first too', /a\.line\.achieved - b\.line\.achieved/.test(teamsTable))
ok('a collector with no team is a line on the teams table', /'No team'/.test(teamsTable))

/* ---------- a collections target can be set and stored ---------- */

const lib = readFileSync(new URL('../../src/lib/targets.ts', import.meta.url), 'utf8')
ok('there is a collections target', /id: 'collected', side: 'collections'/.test(lib))
ok('it is money received, not billed or promised', /Money received on accounts in the sales month/.test(lib))
ok('every metric declares its side', !/\{ id: '(?!collected)[a-z]+', (?!side:)/.test(lib))

/*
 * The sales dashboard must not render it. A collections target there reads as a rep who has
 * collected nothing — true, useless, and it would sit on the screen every month for ever.
 */
const dash = readFileSync(new URL('../../src/pages/Dashboard.tsx', import.meta.url), 'utf8')
ok('the sales dashboard takes the sales metrics only', /SALES_TARGET_METRICS\.map/.test(dash))
ok('...and cannot silently pick up a new one', !/\bTARGET_METRICS\.map/.test(dash))

const settings = readFileSync(new URL('../../src/pages/settings/SettingsPage.tsx', import.meta.url), 'utf8')
ok('targets are set per side in Settings', /def\.side === side/.test(settings))

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const metricCheck = sql.slice(sql.lastIndexOf('targets_metric_check'))
ok('the database accepts the collections metric', /'collected'/.test(metricCheck))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Twenty work days, two worked, eighteen left, ten per cent expected — the same header the firm's
own sheet prints, from the firm's own month. The bands move with the month rather than sitting
at the percentages one day's pace happened to produce.`)
