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
  dayKey, monthPace, paceLine, standingLabel, targetLaps, teamTotal, workDaysInclusive,
} from '../../src/lib/collectionPace.ts'
import { DEFAULT_MONTH_TARGET, monthTargetFor } from '../../src/lib/collectorGrade.ts'

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

/* ---------- a target before anybody sets one ---------- */

/*
 * THE FIRM'S OWN FIGURES, and the first two being equal is theirs too: "make all the junior
 * collectors 60 and the skilled collector 60 and then the senior 80 and then the elite 100". A
 * junior and a skilled collector carry the same book and are asked for the same rand; what
 * separates them is which accounts they may be given.
 */
check('a junior is asked for R60 000', DEFAULT_MONTH_TARGET.Junior, 60000)
check('a skilled collector for the same', DEFAULT_MONTH_TARGET.Skilled, 60000)
check('a senior for R80 000', DEFAULT_MONTH_TARGET.Senior, 80000)
check('an elite for R100 000', DEFAULT_MONTH_TARGET.Elite, 100000)

const resolved = (over = {}) => monthTargetFor({ set: null, grade: 'Senior', collects: true, ...over })
check('with nothing set, the grade supplies it', resolved().target, 80000)
check('...and the screen is told where it came from', resolved().origin, 'grade')
check('a figure somebody set wins', resolved({ set: 45000 }).target, 45000)
check('...and says so', resolved({ set: 45000 }).origin, 'set')
/*
 * NOUGHT IS NOT A TARGET SOMEBODY SET. A stored nought is how a target is cleared -- see the
 * setTarget path in AppStore -- so reading it as "they were set nothing" would pin a whole team
 * at 0% of R0 instead of falling back to their grade.
 */
check('a cleared target falls back to the grade', resolved({ set: 0 }).target, 80000)
check('...and so does a null one', resolved({ set: null }).target, 80000)
/*
 * UNGRADED MEANS JUNIOR, the same as everywhere else -- see UNGRADED_EQUIVALENT. A firm with
 * thirty ungraded clerks must not be a firm with thirty people who have no target.
 */
check('an ungraded collector gets the junior figure', resolved({ grade: null }).target, 60000)
/* Somebody who works no book has no target. Nought would put them at the top of a list of
   people needing help, which is a real problem but a different one. */
check('somebody with no book has no target at all', resolved({ collects: false }).target, null)

/* ---------- the bar laps when somebody passes their target ---------- */

/*
 * THE FIRM'S OWN IDEA: "when somebody has exceeded their target, the bar that's there starts
 * over, but now it's a different colour." A bar pinned at 100% makes a collector at 260% and one
 * at 101% look identical, on a screen whose whole job is to show who is carrying the month.
 */
check('nothing collected is an empty bar', targetLaps(0).fill, 0)
check('...and no target at all is too', targetLaps(null).fill, 0)
check('...and neither is a lap', targetLaps(null).laps, 0)
check('a third of the way is a third of a bar', targetLaps(1 / 3).fill, 1 / 3)
check('...still on the first colour', targetLaps(1 / 3).over, false)
/*
 * AN EXACT TARGET IS A FULL BAR, NOT AN EMPTY ONE. Somebody who has just hit their figure has
 * earned a full bar; resetting it to nothing at the instant they got there would be the screen
 * taking the moment away from them.
 */
check('exactly on target fills the bar', targetLaps(1).fill, 1)
check('...and is not yet a second lap', targetLaps(1).laps, 0)
check('...and keeps the first colour', targetLaps(1).over, false)
check('a sliver past it starts a second bar', Math.round(targetLaps(1.01).fill * 100) / 100, 0.01)
check('...which is one whole target behind them', targetLaps(1.01).laps, 1)
check('...and is drawn in the other colour', targetLaps(1.01).over, true)
check('half way round again', targetLaps(1.5).fill, 0.5)
check('twice the target is a full second bar', targetLaps(2).fill, 1)
check('...and still one lap, not two', targetLaps(2).laps, 1)
check('a hair past twice starts a third', targetLaps(2.01).laps, 2)
check('three and a half targets', targetLaps(3.5).laps, 3)
check('...with the half showing', targetLaps(3.5).fill, 0.5)
/* A negative cannot happen from paceLine, but a bar drawn at -40% would overflow its track. */
check('a negative draws nothing rather than overflowing', targetLaps(-0.4).fill, 0)

/* ---------- the numbers reach the screen ---------- */

const page = readFileSync(new URL('../../src/pages/CollectorDashboard.tsx', import.meta.url), 'utf8')

ok('the Collections screen computes the month in work days', /monthPace\(period\.start, period\.end, asAt\)/.test(page))

/*
 * READ AS AT A DAY, which is what makes it the firm's report rather than a dashboard. Their own
 * sheet is headed "Date: 14/09/2026" and every percentage on it is read against how far into the
 * month's work days that date is.
 */
ok('the report can be read as at a day', /type="date" value=\{dayKey\(asAt\)\}/.test(page))
ok('...and the pace is taken at that day, not at today', /monthPace\(period\.start, period\.end, asAt\)/.test(page))
/*
 * CLAMPED INTO THE PERIOD. A date outside the month would produce a report with more work days
 * behind it than the month has, and every percentage on the screen would be nonsense rather than
 * wrong in a way somebody could spot.
 */
ok('...and a date outside the period is pulled back into it',
  /if \(picked < period\.start\) return period\.start/.test(page))
ok('...and never past today', /new Date\(\) > period\.end \? period\.end : new Date\(\)/.test(page))

ok('the month header is a progress bar', /<MonthProgress/.test(page))
ok('...carrying the work days behind and ahead', /working days completed/.test(page))
ok('...and marking the pace expected by now', /% expected by now/.test(page))
ok('the day\u2019s own figure leads', /Collected today/.test(page))
ok('the teams sheet is rendered', /<TeamTable/.test(page))
ok('the clerk sheet is rendered', /<ClerkTable/.test(page))
ok('needed a week is on the teams table only', /Needed a week/.test(page))

/*
 * ONE TABLE, NO TABS.
 *
 * It had three -- All clerks, Needs attention, Ranking -- and the firm folded them into one:
 * "remove the ranking page, remove the needs attention page and put everything at the all clerks
 * page." Asserted as absences as well as presences, because the failure this guards against is a
 * tab quietly surviving the merge with half the columns behind it.
 */
const clerks = page.slice(page.indexOf('function ClerkTable('), page.indexOf('function ExportButton('))
ok('there is a clerk table to read', clerks.length > 1000)
{
  /* Comments stripped, or the paragraph explaining why the tabs went would satisfy every one of
     these absence checks -- the trap this suite has a name for. */
  const code = clerks.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok('there is no needs-attention tab any more', !/'Needs attention'/.test(code))
  ok('...nor a ranking tab', !/'Ranking'/.test(code))
  ok('...nor the target-reached tab dropped before them', !/Target reached/i.test(code))
  ok('...and no tab state left behind to switch on', !/ClerkView/.test(code))
}

/*
 * THE ROSTER IS RANKED ON RAND, which reverses what this table used to be told to do.
 *
 * It was alphabetical on purpose, and the reason was good: sorted by rand it becomes a
 * leaderboard on the one figure that measures the book somebody was handed rather than the
 * person. The firm has now asked for exactly that -- "I think the ranking, it should
 * automatically be ranked and rank it from one to down" -- which is their call to make, and they
 * made the same call when they asked for the ranking in the first place: "so the people know that
 * if they're senior collectors they get more work, it's not a pissing contest."
 *
 * So the safeguard did not go away, it moved onto the row. The grade and the size of the book are
 * asserted below, and they are the condition this ranking exists under.
 */
ok('the roster is ranked on rand collected', /b\.line\.collected - a\.line\.collected/.test(clerks))
ok('...with ties falling back to the name, so the list does not reshuffle itself',
  /\|\| a\.name\.localeCompare\(b\.name, 'en-ZA'\)/.test(clerks))
ok('...and every row carries its place', /places\.get\(l\.userId\)/.test(clerks))
/*
 * SHARED PLACES FOR TIES, and computed over everybody rather than over what the search box shows
 * -- a place that moved when somebody typed a letter would not be a place.
 */
ok('places come from the shared standings helper', /standings\(lines\.filter/.test(clerks))
ok('...over people who have a book or have collected', /l\.accounts > 0 \|\| l\.line\.collected > 0/.test(clerks))

/*
 * THE CONDITION THE RANKING EXISTS UNDER. The firm's answer to "it's not a pissing contest" is
 * that a senior collector is given the bigger accounts -- which is only visible while the grade
 * and the number of accounts are on the row beside the rand. They were the old Ranking tab's own
 * columns; ranking the roster and leaving them behind is the one version of this nobody asked for.
 */
ok('the grade is on the row', /\{l\.grade\}/.test(clerks))
ok('...and the size of the book with it', /\{l\.accounts\.toLocaleString\('en-ZA'\)\}/.test(clerks))
ok('...and the caption says how to read the two together',
  /part of their rand is the book they were handed/.test(clerks))

/*
 * THE COLUMNS, IN THE FIRM'S OWN ORDER, asserted as the whole list at once.
 *
 * "Number, clerk, team, then target, then today, then period to date, then the number of payment,
 * then the average payment, then the achieved, and then it can go to gap needed per day status."
 *
 * One equality rather than thirteen presence checks and twelve order checks: a list compared
 * whole cannot pass with a column missing, duplicated or moved, and it cannot pass vacuously the
 * way an indexOf comparison does when what it orders has been deleted.
 */
{
  const thead = clerks.slice(clerks.indexOf('<thead>'), clerks.indexOf('</thead>'))
  const headings = [...thead.matchAll(/<th[^>]*>([^<{}]+)<\/th>/g)].map((m) => m[1].trim())
  check('the columns are in the order the firm asked for', headings.join(' | '),
    '# | Clerk | Team | Target | Today | Period to date | Accounts | Payments '
    + '| Average payment | Achieved | Gap vs pace | Needed / day | Status')
}

/* Where a target came from is shown, or nobody can tell a figure set wrong from one never set. */
ok('a grade-supplied target says so', /from grade/.test(clerks))

/*
 * AND THE ONE THING THE NEEDS ATTENTION TAB TOLD YOU THAT A RANKED LIST DOES NOT: how many people
 * are behind. It was read off the tab's own badge rather than out of the list, so the number
 * survives in the footer. Silent at nought -- a line saying "0 are behind their pace" every day
 * is a line people stop seeing, and that is what teaches them to stop reading the rest.
 */
ok('the count of people behind their pace survived the merge',
  /const behind = useMemo/.test(clerks))
ok('...counting the two bands that are behind',
  /l\.line\.standing === 'behind' \|\| l\.line\.standing === 'critical'/.test(clerks))
ok('...and saying nothing at nought', /\{behind > 0 && \(/.test(clerks))

/*
 * Worst first is asserted against the SHARED helper, and the helper against itself. Both tables
 * sort the same way, so a page-wide regex is satisfied by either one and would go on passing with
 * the other reversed.
 */
const sorter = page.slice(page.indexOf('function worstFirst'), page.indexOf('function ClerkTable('))
ok('there is a worst-first sort to read', sorter.length > 100)
ok('it sorts worst first', /a\.line\.achieved - b\.line\.achieved/.test(sorter))
ok('...with people who have no target at the bottom',
  /Number\(a\.line\.achieved === null\) - Number\(b\.line\.achieved === null\)/.test(sorter))
const teamsTable = page.slice(page.indexOf('function TeamTable'))
ok('there is a teams table to read', teamsTable.length > 500)
ok('the teams list sorts worst first too', /\.sort\(worstFirst\)/.test(teamsTable))
ok('a collector with no team is a line on the teams table', /'No team'/.test(teamsTable))

/*
 * THE FAIR COMPARISON SURVIVED THE REDESIGN, as its own card. Rand leads the page now, which is
 * what the firm runs the month on -- but the figures that compare two collectors fairly must
 * still be on the screen, or the redesign quietly turned the page into a rand leaderboard.
 */
ok('the fair comparison is still there', /<FairTable/.test(page))
ok('...ordered on the book-independent figure',
  /paymentsPerHundred \?\? -1\) - \(a\.paymentsPerHundred/.test(page))
/*
 * ASSERTED AGAINST THE RENDERED TEXT, NOT THE PAGE. The comment above FairTable says the same
 * thing in almost the same words, so a regex over the whole file is satisfied by the explanation
 * of the behaviour rather than by the behaviour -- the exact trap this codebase has a name for.
 * The card's own caption is sliced out and asserted on.
 */
const fairCaption = page.slice(page.indexOf('How people compare\n'), page.indexOf('<div className="overflow-x-auto">', page.indexOf('How people compare\n')))
ok('there is a caption on the fair card to read', fairCaption.length > 100)
ok('...naming what the ranking above it is for', /the month the firm is run on/.test(fairCaption))
ok('...and what these figures survive', /survive being given a different/.test(fairCaption))
ok('...and what they are for', /should decide who is promoted/.test(fairCaption))

/* The team filter narrows the totals as well as the table: a team leader reading their team's
   list against the firm's headline figures is reading two different things. */
ok('the team filter narrows the rows', /const shownRows = useMemo/.test(page))
ok('...and the totals are taken from the narrowed rows', /totalStats\(shownRows\)/.test(page))

/*
 * THE EXPORT IS BUILT IN THE BROWSER. No new endpoint -- Vercel's Hobby plan caps this project at
 * twelve functions and it is at twelve -- and nothing leaves the machine, which is the right
 * posture for a list of named people and what they have collected.
 */
ok('the day can be exported', /Export daily report/.test(page))
ok('...without a server seeing it', /new Blob\(\['\\uFEFF', csv\], \{ type: 'text\/csv/.test(page))
/*
 * THE BOM IS WRITTEN AS AN ESCAPE, NOT AS THE CHARACTER. Excel needs it or every R sign and every
 * en dash in a team name opens as mojibake -- but pasted in literally it is an invisible
 * character sitting in the source that no reviewer can see and any editor may strip.
 */
ok('...and the byte-order mark is not an invisible character in the source',
  !page.includes('\ufeff'))
ok('...and no endpoint was added for it', !/fetch\('\/api\//.test(page))
ok('...and the file says which period and day it is of', /\['As at', dayKey\(asAt\)\]/.test(page))
/* Quoted and doubled, or a team called "Smit, Botha & Seun" becomes two columns and shifts every
   figure on the row one to the left. */
ok('...with its cells quoted', /String\(v\)\.replace\(\/"\/g, '""'\)/.test(page))

/* ---------- the tab is called what the firm calls the work ---------- */

const sidebar = readFileSync(new URL('../../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8')
ok('the tab says Collections', /label: 'Collections'/.test(sidebar))
ok('...and no longer says Performance', !/label: 'Performance'/.test(sidebar))
/* The route is unchanged on purpose: renaming it would break every bookmark for a word. */
ok('...on the same route as before', /to: '\/performance', label: 'Collections'/.test(sidebar))

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
