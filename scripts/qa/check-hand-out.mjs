/**
 * Handing accounts out, and who gets what.
 *
 * THIS IS THE RULE THAT DECIDES WHERE A BILLION RAND OF WORK GOES. The firm earns only on what
 * it recovers and carries its clients' reputation while doing it, so a R400 000 defended matter
 * landing on a junior's desk is not a training opportunity — it is a client relationship and a
 * year's commission. And it would be invisible: the plan would look full, the diary would look
 * healthy, and nothing would fail.
 *
 * Every check here is about a way the distribution could be quietly, plausibly wrong.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-hand-out.mjs
 */
import {
  ACCOUNT_BANDS, COLLECTOR_GRADES, DEFAULT_BOOK_CEILING, DEFAULT_DIARY_RESERVE,
  accountBand, bookCeilingOf, diaryReserveOf, gradeRank, mayTake, selfBookingLimit,
} from '../../src/lib/collectorGrade.ts'
import { planHandOut, planSummary } from '../../src/lib/handOut.ts'
import { DIARY_PRIORITY } from '../../src/lib/diaryPriority.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

/* A Monday, so the working-day arithmetic is readable. 2026-09-21 is a Monday. */
const MONDAY = '2026-09-21'

const band = (id) => ACCOUNT_BANDS.find((b) => b.id === id)

const acc = (id, over, opts = {}) => ({
  id,
  label: id,
  band: opts.band ?? accountBand({ capitalOutstanding: over }),
  kind: opts.kind ?? 'review',
  capitalOutstanding: over,
  alreadyBooked: opts.alreadyBooked,
})

const col = (name, grade, opts = {}) => ({
  userId: `u-${name}`,
  name,
  grade,
  bookCeiling: opts.ceiling ?? 500,
  inPlayNow: opts.inPlay ?? 0,
  capacity: opts.capacity ?? 40,
  bookedByDay: opts.booked ?? {},
})

const plan = (accounts, collectors, opts = {}) => planHandOut({
  accounts, collectors, startOn: MONDAY, windowDays: opts.windowDays ?? 5, ...opts,
})

const takenBy = (p, name) => p.placements.filter((x) => x.userId === `u-${name}`).length

/*
 * Defensive readers. Indexing straight into unplaced[0] turns "the guard was removed and
 * everything got placed" into a TypeError two lines below the check that should have reported it
 * -- the run still fails, but the message names the wrong thing and hides the real one.
 */
const reasonOf = (p, i = 0) => p.unplaced[i]?.reason ?? '(nothing unplaced)'
const labelOf = (p, i = 0) => p.unplaced[i]?.label ?? '(nothing unplaced)'
const dayOf = (p, accountId) => p.placements.find((x) => x.accountId === accountId)?.dueOn ?? '(not placed)'

/* ================= the bands ================= */

check('a small account is generic', accountBand({ capitalOutstanding: 1800 }).id, 'generic')
check('R24 999 is still generic', accountBand({ capitalOutstanding: 24999 }).id, 'generic')
check('R25 000 is high value', accountBand({ capitalOutstanding: 25000 }).id, 'high_value')
check('R49 999 is high value', accountBand({ capitalOutstanding: 49999 }).id, 'high_value')
check('R50 000 is major', accountBand({ capitalOutstanding: 50000 }).id, 'major')
check('R27 million is major', accountBand({ capitalOutstanding: 27000000 }).id, 'major')

/*
 * A HARD POSITION LIFTS THE BAND WHATEVER THE BALANCE. A defended matter is a legal conversation
 * at R2 000 as much as at R200 000: the debtor has taken a position, somebody has to answer it in
 * writing, and getting that wrong is how a dispute becomes a counterclaim.
 */
check('a small disputed account is not junior work',
  accountBand({ capitalOutstanding: 2000, disputed: true }).id, 'high_value')
check('...nor one in legal', accountBand({ capitalOutstanding: 500, inLegal: true }).id, 'high_value')
check('...nor one under administration',
  accountBand({ capitalOutstanding: 100, underAdministration: true }).id, 'high_value')
/*
 * But it only ever LIFTS. A disputed R2 million account must not drop to High value because the
 * dispute rule fired — that would take it off the senior desk it belongs on.
 */
check('a hard position never lowers the band',
  accountBand({ capitalOutstanding: 2000000, disputed: true }).id, 'major')

/* The bands have to stay ordered, or "the last one whose from is met" picks the wrong rung. */
ok('bands are ordered by value', ACCOUNT_BANDS.every((b, i) => i === 0 || b.from > ACCOUNT_BANDS[i - 1].from))
ok('...and by grade', ACCOUNT_BANDS.every((b, i) => i === 0
  || gradeRank(b.minGrade) >= gradeRank(ACCOUNT_BANDS[i - 1].minGrade)))
ok('the lowest band starts at nothing', ACCOUNT_BANDS[0].from === 0)
ok('every band names a real grade', ACCOUNT_BANDS.every((b) => COLLECTOR_GRADES.includes(b.minGrade)))

/* ================= who may take what ================= */

ok('a junior may take generic', mayTake('Junior', band('generic')))
ok('a junior may NOT take high value', !mayTake('Junior', band('high_value')))
ok('a junior may NOT take a major account', !mayTake('Junior', band('major')))
ok('a skilled collector may take high value', mayTake('Skilled', band('high_value')))
ok('a skilled collector may NOT take a major account', !mayTake('Skilled', band('major')))
ok('a senior may take anything', ACCOUNT_BANDS.every((b) => mayTake('Senior', b)))
ok('an elite may take anything', ACCOUNT_BANDS.every((b) => mayTake('Elite', b)))

/* ================= gate 2: grade beats convenience ================= */

/*
 * THE CHECK THIS WHOLE FILE EXISTS FOR. A junior with a completely empty book and an empty diary
 * is the most convenient desk in the building, and must still not be given a major account.
 */
{
  const p = plan([acc('big', 400000)], [col('Junior', 'Junior'), col('Senior', 'Senior', { inPlay: 300 })])
  check('a major account goes to the senior, not the empty junior', takenBy(p, 'Senior'), 1)
  check('...and the junior gets none', takenBy(p, 'Junior'), 0)
}
{
  const p = plan([acc('big', 400000)], [col('Junior', 'Junior')])
  check('with nobody graded for it, it is not placed', p.placements.length, 0)
  check('...and the reason says so', reasonOf(p), 'no_one_graded')
}

/*
 * And the converse, with a correction worth recording: generic work must not HOARD the elite
 * desks, but neither should it all pile onto the junior while an elite sits idle. With equal
 * headroom the planner spreads, and the grade tie-break only decides who goes first.
 *
 * The assertion here originally demanded the junior take both, which is wrong: leaving one
 * collector empty to keep another "free" is not a goal, it is an idle desk. What actually
 * protects the senior desks is headroom and the grade gate, not hoarding.
 */
{
  const p = plan(
    [acc('a', 1000), acc('b', 1000)],
    [col('Elite', 'Elite'), col('Junior', 'Junior')],
  )
  check('generic work goes to the junior first', p.placements[0]?.userId ?? '(none)', 'u-Junior')
  ok('...and then spreads rather than piling', takenBy(p, 'Elite') === 1 && takenBy(p, 'Junior') === 1)
}

/* ================= gate 1: book room, not diary room ================= */

/*
 * THE HEURISTIC THIS REPLACED WAS WRONG, and this is the case that proved it. Stefan is Elite
 * with an empty week but carrying 480 of 500. Thandi is Skilled, carrying 60 of 500, and her
 * week is half booked. Dealing by free diary slots hands the work to Stefan — piling onto a book
 * that is already full — and leaves Thandi, who has the actual room, nearly empty.
 */
{
  const week = { [MONDAY]: 20, '2026-09-22': 20, '2026-09-23': 20 }
  const p = plan(
    Array.from({ length: 40 }, (_, i) => acc(`a${i}`, 1000)),
    [
      col('Stefan', 'Elite', { inPlay: 480, ceiling: 500 }),
      col('Thandi', 'Skilled', { inPlay: 60, ceiling: 500, booked: week }),
    ],
  )
  ok('the nearly-full book takes fewer', takenBy(p, 'Stefan') < takenBy(p, 'Thandi'))
  ok('...and is not pushed past its ceiling while room exists elsewhere',
    p.collectors.find((c) => c.name === 'Stefan').after <= 500)
  check('everything is still placed', p.placements.length, 40)
}

/*
 * Proportional to headroom, not equal counts. An elite on 200 of 500 has 300 of room; a junior
 * on 140 of 150 has 10. Splitting 50 accounts evenly would put the junior 15 over.
 */
{
  const p = plan(
    Array.from({ length: 50 }, (_, i) => acc(`a${i}`, 1000)),
    [
      col('Roomy', 'Elite', { inPlay: 200, ceiling: 500, capacity: 100 }),
      col('Tight', 'Junior', { inPlay: 140, ceiling: 150, capacity: 100 }),
    ],
  )
  /*
   * The tight book is SPARED ENTIRELY, not topped up to its ceiling — and that is the right
   * answer, though it was not the one this check first demanded. Roomy has space for all fifty;
   * pushing a junior from 140 of 150 to 150 of 150 to "use the room" leaves them with no capacity
   * for anything urgent that arrives tomorrow, for no gain today.
   */
  check('the person with room takes all of it', takenBy(p, 'Roomy'), 50)
  check('...and the nearly-full book is spared', takenBy(p, 'Tight'), 0)
  ok('nobody is pushed over while room exists', p.collectors.every((c) => c.overBy === 0))
}

/*
 * WARN, NEVER BLOCK. When every eligible desk is full the work still lands — leaving it unplaced
 * would put it back in the adrift pile this feature exists to empty — and the plan says plainly
 * who it pushed over and by how much.
 */
{
  const p = plan(
    Array.from({ length: 10 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Full', 'Senior', { inPlay: 500, ceiling: 500, capacity: 100 })],
  )
  check('a full book still takes the work', p.placements.length, 10)
  check('...and the plan says how far over', p.collectors[0].overBy, 10)
  check('...and what it becomes', p.collectors[0].after, 510)
  ok('...and the summary warns', /over their book ceiling/.test(planSummary(p)))
}

/* ================= gate 3: which day ================= */

{
  const p = plan(
    Array.from({ length: 5 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Solo', 'Senior', { capacity: 2 })],
  )
  const byDay = {}
  for (const x of p.placements) byDay[x.dueOn] = (byDay[x.dueOn] ?? 0) + 1
  check('a day is filled to capacity and no further', byDay[MONDAY], 2)
  check('...then the next day', byDay['2026-09-22'], 2)
  check('...and the remainder rolls on', byDay['2026-09-23'], 1)
}

/*
 * EXISTING LOAD COUNTS. A day already holding 38 of a 40 capacity has room for two, not forty —
 * and a planner that ignored what is already booked would double every diary it touched.
 */
{
  const p = plan(
    Array.from({ length: 4 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Busy', 'Senior', { capacity: 40, booked: { [MONDAY]: 38 } })],
  )
  check('only the free slots are used', p.placements.filter((x) => x.dueOn === MONDAY).length, 2)
  check('...the rest goes to the next day', p.placements.filter((x) => x.dueOn === '2026-09-22').length, 2)
}

/*
 * WEEKENDS AND PUBLIC HOLIDAYS ARE NOT WORKING DAYS. 2026-09-24 is Heritage Day, a Thursday.
 * Booking onto it produces a diary nobody opens and a day of work silently lost.
 */
{
  const p = plan(
    Array.from({ length: 12 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Solo', 'Senior', { capacity: 3 })],
    { windowDays: 10 },
  )
  const dates = [...new Set(p.placements.map((x) => x.dueOn))]
  ok('nothing lands on Heritage Day', !dates.includes('2026-09-24'))
  ok('nothing lands on a Saturday', !dates.includes('2026-09-26'))
  ok('nothing lands on a Sunday', !dates.includes('2026-09-27'))
}
{
  // A start date that is itself a weekend rolls forward rather than booking onto it.
  const p = planHandOut({
    accounts: [acc('a', 1000)], collectors: [col('Solo', 'Senior')],
    startOn: '2026-09-26', windowDays: 5,
  })
  check('a weekend start rolls forward', dayOf(p, 'a'), '2026-09-28')
}

/* ================= the ladder decides what is seen first ================= */

/*
 * A broken promise is the most collectable account on the book and the quickest to go quiet. If
 * the day fills with routine reviews first, the promise lands on Thursday and the money is gone.
 */
{
  const p = plan(
    [
      acc('routine', 1000, { kind: 'review' }),
      acc('trace', 1000, { kind: 'trace' }),
      acc('broken', 1000, { kind: 'promise_broken' }),
      acc('fresh', 1000, { kind: 'new_account' }),
    ],
    [col('Solo', 'Senior', { capacity: 1 })],
  )
  const order = [...p.placements].sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1)).map((x) => x.accountId)
  check('the broken promise is first', order[0], 'broken')
  check('...then the fresh handover', order[1], 'fresh')
  /*
   * A ROUTINE REVIEW IS LAST, BELOW EVEN A TRACE — the firm's own ladder, and the opposite of
   * what this check first assumed. A trace is waiting on a bureau result somebody has to chase;
   * a review is "nothing has happened, look again", which is the only rung with no event behind
   * it. It comes last however long it has been waiting.
   */
  check('...then the trace', order[2], 'trace')
  check('...with the routine review last', order[3], 'routine')
  ok('the order is the firm’s own ladder',
    DIARY_PRIORITY.promise_broken < DIARY_PRIORITY.new_account
    && DIARY_PRIORITY.new_account < DIARY_PRIORITY.trace
    && DIARY_PRIORITY.trace < DIARY_PRIORITY.review)
}

/* Within a rung, the larger balance is dealt first, so it reaches the better desk. */
{
  const p = plan(
    [acc('small', 1000, { kind: 'review' }), acc('large', 900000, { kind: 'review' })],
    [col('Solo', 'Senior', { capacity: 1 })],
  )
  check('the bigger account is booked sooner', dayOf(p, 'large'), MONDAY)
}

/* ================= one diary date per account ================= */

/*
 * The database refuses a second open entry. So an account already booked must be SKIPPED, not
 * rebooked — rebooking would silently drag it off whoever's Tuesday it was sitting on.
 */
{
  const p = plan(
    [acc('a', 1000), acc('b', 1000, { alreadyBooked: true })],
    [col('Solo', 'Senior')],
    { skipAlreadyBooked: true },
  )
  check('the booked one is left alone', p.placements.length, 1)
  check('...and reported', reasonOf(p), 'already_booked')
  check('...by name', labelOf(p), 'b')
}

/* ================= running past the window ================= */

/*
 * IT RUNS PAST RATHER THAN DROPPING ACCOUNTS. Filling the window and leaving the rest unbooked
 * recreates the exact hole this feature exists to close — accounts belonging to somebody with
 * nobody booked to ring them — and a leader would have to remember to come back for them.
 */
{
  const p = plan(
    Array.from({ length: 20 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Solo', 'Senior', { capacity: 2 })],
    { windowDays: 3 },
  )
  check('everything is placed', p.placements.length, 20)
  ok('...and it admits it ran past the window', p.ranPastWindow)
  ok('...and says how far', p.lastDate > '2026-09-25')
}
{
  // But not for ever: bounded, or "keep going" quietly books work into March.
  const p = plan(
    Array.from({ length: 50 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Solo', 'Senior', { capacity: 1 })],
    { windowDays: 3, maxWindowDays: 5 },
  )
  check('it stops at the limit', p.placements.length, 5)
  check('...and the rest are reported, not lost', p.unplaced.length, 45)
  ok('...with a reason', p.unplaced.every((u) => u.reason === 'no_room'))
}
{
  const p = plan(
    Array.from({ length: 4 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Solo', 'Senior', { capacity: 2 })],
    { windowDays: 5 },
  )
  ok('a plan that fits does not claim to have run past', !p.ranPastWindow)
}

/* ================= the reserve constrains self-booking only ================= */

/*
 * The firm's rule: a clerk who works 45 a day may diarise 35 himself, leaving 10 for what a team
 * leader sends. If the PLANNER also held those 10 back, the slots would be reserved from the only
 * thing they were ever reserved for and the reserve would make hand-outs harder, not easier.
 */
{
  const p = plan(
    Array.from({ length: 45 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Solo', 'Senior', { capacity: 45 })],
  )
  check('the distributor fills the whole day', p.placements.filter((x) => x.dueOn === MONDAY).length, 45)
}
check('a clerk books 35 of 45 himself', selfBookingLimit(45, 10), 35)
check('the firm standard', selfBookingLimit(40, DEFAULT_DIARY_RESERVE), 30)
/* A reserve bigger than the day would otherwise say "book nothing", which nobody meant. */
check('a reserve cannot close the day', selfBookingLimit(10, 50), 1)
check('no reserve means the whole day', selfBookingLimit(40, 0), 40)

/* ================= the standards ================= */

check('the company book ceiling', DEFAULT_BOOK_CEILING, 500)
check('an unset ceiling takes the standard', bookCeilingOf(null), 500)
check('an unset ceiling is not zero', bookCeilingOf(0), 500)
check('a set ceiling is honoured', bookCeilingOf(250), 250)
check('an unset reserve takes the standard', diaryReserveOf(null), DEFAULT_DIARY_RESERVE)
/* Zero is a CHOICE — "hold nothing back" — and must not collapse into the default. */
check('a reserve of none is honoured', diaryReserveOf(0), 0)

/* ================= the plan is deterministic and adds up ================= */

{
  const accounts = Array.from({ length: 37 }, (_, i) => acc(`a${i}`, (i % 7) * 12000))
  const collectors = [
    col('Ann', 'Junior', { inPlay: 10 }), col('Ben', 'Skilled', { inPlay: 300 }),
    col('Cat', 'Senior', { inPlay: 120 }), col('Dan', 'Elite', { inPlay: 470 }),
  ]
  const a = plan(accounts, collectors)
  const b = plan(accounts, collectors)
  check('the same inputs give the same plan', JSON.stringify(a), JSON.stringify(b))
  check('every account is accounted for', a.placements.length + a.unplaced.length, 37)
  ok('no account is placed twice', new Set(a.placements.map((p) => p.accountId)).size === a.placements.length)
  ok('the per-collector totals match the placements',
    a.collectors.every((c) => c.taking === a.placements.filter((p) => p.userId === c.userId).length))
  ok('the per-day totals match too',
    a.days.reduce((t, d) => t + d.added, 0) === a.placements.length)
  ok('nobody is given an account above their grade',
    a.placements.every((p) => {
      const c = collectors.find((x) => x.userId === p.userId)
      const account = accounts.find((x) => x.id === p.accountId)
      return mayTake(c.grade, account.band)
    }))
  ok('the planner does not mutate what it was given',
    collectors.every((c) => Object.keys(c.bookedByDay).length === 0))
}

/* Nothing to do is not an error. */
{
  const p = plan([], [col('Solo', 'Senior')])
  check('an empty hand-out places nothing', p.placements.length, 0)
  check('...and says so', p.lastDate, null)
  ok('...readably', /Nothing can be booked in/.test(planSummary(p)))
}
{
  const p = plan([acc('a', 1000)], [])
  check('no collectors places nothing', p.placements.length, 0)
  check('...for a stated reason', reasonOf(p), 'no_one_graded')
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Book room first, then grade, then the day. A junior with an empty desk never gets a major
account; a full book never gets more while room exists elsewhere; and when every desk is full the
work still lands and the plan says who it pushed over.`)
