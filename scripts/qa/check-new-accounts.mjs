/**
 * A NEW ACCOUNT THAT WAS NOT WORKED ON THE DAY IT LANDED.
 *
 * The firm: "if an account has been loaded on the 23rd of September and the person has been
 * logged 15 new accounts and they've only worked five of them, the remaining 10 should
 * automatically carry over as priority on the next day's diary, not on the backlog" — and the
 * team leader is told.
 *
 * WHAT THIS FILE IS REALLY GUARDING is the thing that is NOT done. The obvious implementation
 * re-diarises the ten accounts onto tomorrow, and diary.ts already says what that costs, about
 * the system Raptor replaces: "updating `due_on` in place… is why nobody can say how much work
 * was missed last year." A re-dated entry looks as though it was always due tomorrow. So every
 * function here is pure and reads a date it never changes, and the checks below are written so
 * that an implementation which "helpfully" moved the date could not pass them.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-new-accounts.mjs
 */
import { readFileSync } from 'node:fs'
import { myDashboardPath } from '../../src/lib/departments.ts'
import {
  carriedLine, dayWeight, daysCarried, isCarried, lateForLeaders, splitCarried, stillInTime,
} from '../../src/lib/newAccounts.ts'
import { DEFAULT_DIARY_CAPACITY } from '../../src/lib/diaryPriority.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* 23 September 2026 is a Wednesday; 24 September is Heritage Day, a South African public
   holiday, and it is in the firm's own calendar. Both facts are used below on purpose. */
const entry = (dueOn, over = {}) => ({ kind: 'new_account', state: 'open', dueOn, ...over })

/* ------------------------------------------------------------------ what is carried */

ok('a new account still dated today is not carried — the day is not over',
  !isCarried(entry('2026-09-23'), '2026-09-23'))
ok('one dated yesterday is', isCarried(entry('2026-09-22'), '2026-09-23'))
ok('one that was worked is not, whatever its date',
  !isCarried(entry('2026-09-22', { state: 'done' }), '2026-09-23'))
/*
 * AND ONLY NEW ACCOUNTS. The two-list diary is a deliberate design — the imported book arrived
 * with 279 overdue entries and one merged list buries today's work. This is the narrow exception
 * the firm asked for, so a broken promise or a trace stays in the backlog where it was.
 */
for (const kind of ['promise_broken', 'promise_due', 'callback', 'dispute_chase', 'no_contact',
  'trace', 'review']) {
  ok(`a ${kind} that is overdue stays in the backlog`,
    !isCarried(entry('2026-09-22', { kind }), '2026-09-23'))
}

/* ------------------------------------------------------------------ the firm's own example */

/*
 * FIFTEEN LOADED, FIVE WORKED, TEN CARRIED. The example the firm gave, run as it was given.
 */
const loaded = Array.from({ length: 15 }, (_, i) => ({ ...entry('2026-09-23'), id: `a${i}` }))
const afterADay = loaded.map((e, i) => (i < 5 ? { ...e, state: 'done' } : e))
const split = splitCarried(afterADay, '2026-09-25')
check('ten of the fifteen carry over', split.carried.length, 10)
check('...and none of them land in the backlog', split.backlog.length, 5)
ok('...and the five that carried nothing are the ones that were worked',
  split.backlog.every((e) => e.state === 'done'))
/*
 * THE DATE IS UNTOUCHED, and this is the assertion the whole file exists for. An implementation
 * that re-diarised them onto the 25th would pass every count above and fail here.
 */
ok('every carried entry still carries the day it was always due',
  split.carried.every((e) => e.dueOn === '2026-09-23'))

/* ------------------------------------------------------------------ the clock is the firm's */

/*
 * FRIDAY AT FOUR. An account dated Friday 25 September 2026 is not late on the Saturday, and the
 * first working day after it is the Monday. Counted in 24-hour blocks it would be flagged on the
 * Saturday morning with nobody in the building, and a flag that fires when nothing is wrong is
 * one people stop reading.
 */
check('an account dated Friday has waited one working day by the Monday',
  daysCarried(entry('2026-09-25'), '2026-09-28'), 1)
check('...and two by the Tuesday', daysCarried(entry('2026-09-25'), '2026-09-29'), 2)
/*
 * HERITAGE DAY, 24 September, is a public holiday the firm's calendar already knows. An account
 * dated the 23rd is carried once on the 25th, not twice — nobody worked the 24th.
 */
check('a public holiday is not a day somebody failed to work',
  daysCarried(entry('2026-09-23'), '2026-09-25'), 1)
check('one that has never been late has waited no days',
  daysCarried(entry('2026-09-23'), '2026-09-23'), 0)

/*
 * DATED TO A DAY THE OFFICE WAS SHUT. Its day is the first working day after it, so it is not
 * late on that morning. Saturday 26 September 2026, looked at on the Monday.
 */
ok('an account dated to a Saturday is not late on the Monday — the Monday is its day',
  stillInTime(entry('2026-09-26'), '2026-09-28'))
ok('...and is late on the Tuesday', !stillInTime(entry('2026-09-26'), '2026-09-29'))
ok('one dated to a working day is late the next morning',
  !stillInTime(entry('2026-09-23'), '2026-09-25'))
const weekendSplit = splitCarried([entry('2026-09-26')], '2026-09-28')
check('...and the weekend one is not carried on the Monday either', weekendSplit.carried.length, 0)

/* ------------------------------------------------------------------ what the day weighs */

const weight = dayWeight({ due: 50, carried: 10, capacity: DEFAULT_DIARY_CAPACITY })
check('the day is sixty when ten are carried onto fifty', weight.total, 60)
check('...and says by how much it is over', weight.over, 10)
/*
 * NOT SOLVED BY RESHUFFLING. Pushing the routine reviews out until the day reads fifty is the
 * tempting fix — they are the last rung and the only kind with no event behind them. It removes
 * the one signal that somebody is underwater, which is the number the team leader needs.
 */
check('a day that fits is not reported as over',
  dayWeight({ due: 30, carried: 5, capacity: 50 }).over, 0)
check('the standard is fifty a day for everybody', DEFAULT_DIARY_CAPACITY, 50)

check('the collector is told what was carried and what it does to the day',
  carriedLine(weight), '10 new accounts carried over — work them first. That puts 60 on today against 50.')
check('...in the singular where there is one',
  carriedLine(dayWeight({ due: 10, carried: 1, capacity: 50 })),
  '1 new account carried over — work it first.')
/*
 * NOTHING TO SAY, NOTHING SAID. A panel that renders "0 new accounts carried over" every morning
 * is a panel people stop looking at. CLAUDE.md: a warning that fires when nothing is wrong is
 * worse than no warning.
 */
check('and nothing at all on a morning with none',
  carriedLine(dayWeight({ due: 40, carried: 0, capacity: 50 })), null)

/* ------------------------------------------------------------------ the team leader */

const floor = [
  { ...entry('2026-09-23'), ownerId: 'rinda' },
  { ...entry('2026-09-23'), ownerId: 'rinda' },
  { ...entry('2026-09-14'), ownerId: 'ruben' },
  { ...entry('2026-09-23'), ownerId: 'ruben' },
  { ...entry('2026-09-23'), ownerId: 'meloney', state: 'done' },
  { ...entry('2026-09-30'), ownerId: 'meloney' },
  { ...entry('2026-09-23'), ownerId: null },
]
const leaders = lateForLeaders(floor, '2026-09-25')
check('only the people actually carrying something are listed',
  leaders.map((l) => l.ownerId), ['ruben', 'rinda'])
/*
 * WORST FIRST, AND WORST MEANS LONGEST WAITING rather than most. Five accounts sitting a week is
 * a problem; twenty that landed yesterday is a busy Tuesday. Ruben has fewer than Rinda would if
 * she had more, and is still first, because his oldest has been waiting since the 14th.
 */
check('the one whose oldest has waited longest is first', leaders[0]?.ownerId, 'ruben')
check('...and how long that is, in working days', leaders[0]?.worst, 8)
check('...and how many they are carrying', leaders[0]?.carried, 2)
check('somebody whose only new account was worked is not on the list',
  leaders.some((l) => l.ownerId === 'meloney'), false)
/*
 * AN ACCOUNT NOBODY HOLDS IS NOT ANYBODY'S FAILURE. It is a real problem and it belongs on the
 * unallocated warning, not on a collector's name.
 */
check('unallocated work is not reported against a person',
  leaders.some((l) => l.ownerId === null), false)

/* ------------------------------------------------------------------ nothing here writes */

/*
 * THE FILE ITSELF. Every function above is pure, and the point of that is that carrying an
 * account forward can never become re-dating one. A `supabase` import, an `update` or a write to
 * `dueOn` in this module is the failure this whole file is about, and it would be invisible in
 * every assertion above if the new code happened to move the date the same way the reader expects.
 */
const source = readFileSync('src/lib/newAccounts.ts', 'utf8')
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
ok('nothing in the rule touches the database', !/supabase|\.update\(|\.insert\(/.test(code))
/*
 * TWO SHAPES, because `dueOn: string` in the interface is a declaration and matching that made
 * this fail on correct code — a check that fails on correct code gets deleted rather than fixed.
 * What a re-dating implementation would actually look like is one of these two.
 */
ok('...and nothing in it assigns over a due date', !/\.dueOn\s*=[^=]/.test(code))
ok('...and nothing spreads an entry to replace its due date',
  !/\.\.\.\s*\w+\s*,[^}]*dueOn\s*:/.test(code))
ok('...and the diary is still what decides a move, in two rows rather than an edit',
  /Two rows, not an edit/.test(readFileSync('src/lib/diary.ts', 'utf8')))

/* ------------------------------------------------------------------ where it is wired */

/*
 * THE DIARY PUTS THEM IN THE DAY, NOT THE BACKLOG, and it does it by reshaping what the page
 * reads rather than by changing what the database holds. Read back as source because the
 * alternative is a browser, and what would be asserted there is the same two lines.
 */
const diaryPage = readFileSync('src/pages/diary/DiaryPage.tsx', 'utf8')
ok('the diary splits the carried new accounts out of the backlog',
  /splitCarried\(rawDay\.overdue/.test(diaryPage))
ok('...puts them into the day', /due: \[\.\.\.carried\.carried, \.\.\.rawDay\.due\]/.test(diaryPage))
ok('...and leaves the rest of the backlog as the backlog',
  /overdue: carried\.backlog/.test(diaryPage))
ok('...tells the collector what was carried', /carriedLine\(weight\)/.test(diaryPage))
ok('...and marks the row so a carried one is not mistaken for a fresh one',
  /daysCarried\(row, today\)/.test(diaryPage))
/*
 * AND THE DIARY STILL DOES NOT RE-DATE THEM. The page holds the entries; an edit here would be
 * as damaging as one in the rule, and further from where anybody would look for it.
 */
ok('the diary page does not re-date a carried entry',
  !/\.\.\.\s*\w+\s*,[^}]*dueOn:\s*(today|viewDay)/.test(diaryPage))

/*
 * THE FLOOR-WIDE QUERY IS NARROWED IN THE DATABASE. CLAUDE.md: the book is hundreds of thousands
 * of rows and every filter belongs in the query. A version that read the diary and filtered in
 * JavaScript works on staging and stops working the month it matters.
 */
const diaryLib = readFileSync('src/lib/diary.ts', 'utf8')
/*
 * SLICED TO THE NEXT export, not to the first line starting with `}`. The obvious expression
 * stopped at `}[]> {` -- the close of the RETURN TYPE, three lines in -- so it captured the
 * signature and reported every clause in the body as missing. A check that fails on correct code
 * gets deleted rather than fixed.
 */
const carriedAt = diaryLib.indexOf('export async function fetchCarriedNewAccounts')
const nextExport = diaryLib.indexOf('\nexport ', carriedAt + 1)
const fetchCarried = carriedAt === -1 ? '' : diaryLib.slice(carriedAt, nextExport === -1 ? undefined : nextExport)
ok('the floor-wide query exists', fetchCarried.length > 0)
ok('...and asks the database for new accounts only', /\.eq\('kind', 'new_account'\)/.test(fetchCarried))
ok('...that are still open', /\.eq\('state', 'open'\)/.test(fetchCarried))
ok('...and already past their day', /\.lt\('due_on', date\)/.test(fetchCarried))
ok('...and it does not read the whole diary to count them',
  !/select\('\*'\)/.test(fetchCarried))

/*
 * THE DASHBOARD SHOWS IT TO BOTH AUDIENCES. The firm asked for exactly two things: the agent is
 * flagged, and the team leader is told. A panel that did one of them silently does half a job.
 */
const board = readFileSync('src/pages/CollectorDashboard.tsx', 'utf8')
ok('the collections dashboard flags the collector\'s own carried accounts', /mineLate/.test(board))
ok('...and lists the floor\'s for whoever leads it', /othersLate/.test(board))
ok('...to a role that actually leads collections', /canLeadCollections/.test(board))
ok('...and never shows a leader their own row twice',
  /ownerId !== currentUser\?\.id/.test(board))

const permissions = readFileSync('src/lib/permissions.ts', 'utf8')
/*
 * NOT canReassign, which is the sales side's managerial test and excludes the pre-legal team
 * leader -- who is the person this whole panel is for.
 */
ok('leading collections is its own test', /export function canLeadCollections/.test(permissions))
const leadFn = /export function canLeadCollections[\s\S]*?\n}/.exec(permissions)?.[0] ?? ''
ok('...and the pre-legal team leader is in it', /Pre-legal Team Leader/.test(leadFn))

/*
 * AND COLLECTIONS PEOPLE CAN GET TO THE COLLECTIONS DASHBOARD IN ONE CLICK.
 *
 * This used to assert that they LANDED on it. They no longer do, and nor does anybody else: the
 * firm moved the landing page to a company dashboard everyone in the firm opens -- "it's
 * important for everybody in the company to understand that we are a collective" -- with a
 * button into your own department. So what has to be true is that the button takes a collector
 * to the floor, and that the floor still carries this panel, which is the thing this file is
 * about: new accounts nobody has worked.
 */
const router = readFileSync('src/pages/DashboardRouter.tsx', 'utf8')
const routerBody = router.slice(router.indexOf('export function DashboardRouter'))
ok('the landing page is the company dashboard', /return <CompanyDashboard \/>/.test(routerBody))
/*
 * ASSERTED ON THE BRANCH, NOT ON THE NAME -- the lesson the old version of these lines learned by
 * being broken: written as /CollectorDashboard/ it passed with the branch deleted, because the
 * import line alone satisfied it.
 */
check('a pre-legal agent\u2019s own dashboard is the collections floor',
  myDashboardPath('Pre-legal Agent'), '/dashboard/collections')
check('...and a team leader\u2019s is too', myDashboardPath('Pre-legal Team Leader'), '/dashboard/collections')
const app = readFileSync('src/App.tsx', 'utf8')
ok('...and that route serves the collections dashboard',
  /path="\/dashboard\/collections" element=\{<CollectorDashboard \/>\}/.test(app))
/* The panel itself is still on that screen, which is what all of the above is in service of. */
ok('the new-account panel is still on the floor\u2019s own screen',
  /lateForLeaders\(/.test(board))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-new-accounts: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
