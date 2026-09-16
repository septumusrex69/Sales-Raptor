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
import { readFileSync } from 'node:fs'
import {
  ACCOUNT_BANDS, COLLECTING_ROLES, COLLECTOR_GRADES, DEFAULT_BOOK_CEILING, DEFAULT_DIARY_RESERVE,
  UNGRADED_EQUIVALENT, accountBand, bookCeilingOf, diaryReserveOf, gradeRank, mayTake,
  selfBookingLimit,
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
 * NINE PEOPLE CHOSEN MUST MEAN NINE PEOPLE USED. This is the bug the firm reported from a
 * screenshot, and it is the reason the dealing rule changed: nine collectors were ticked, a
 * hundred accounts were handed out, and the plan said "100 accounts across one person".
 *
 * It was not a crash and nothing failed. Dealing went to whoever had the most headroom COUNTED
 * IN ACCOUNTS, and Rehana's ceiling of 650 against 190 in play gave her more raw room than eight
 * colleagues had — and still did after ninety-nine of them, because 460 of headroom does not
 * fall below 306 in a hundred steps. So she took every one.
 *
 * These are the real figures off that screenshot.
 */
{
  const p = plan(
    Array.from({ length: 100 }, (_, i) => acc(`a${i}`, 1000)),
    [
      col('Rehana', 'Senior', { inPlay: 190, ceiling: 650, capacity: 50 }),
      col('Aisha', 'Skilled', { inPlay: 194, capacity: 50 }),
      col('Annelize', 'Skilled', { inPlay: 157, capacity: 50 }),
      col('Ayanda', 'Junior', { inPlay: 160, capacity: 50 }),
      col('Bongani', 'Junior', { inPlay: 171, capacity: 50 }),
      col('Charmaine', 'Senior', { inPlay: 183, capacity: 50 }),
      col('Dineo', 'Skilled', { inPlay: 166, capacity: 50 }),
      col('Elna', 'Elite', { inPlay: 149, capacity: 50 }),
      col('Farai', 'Junior', { inPlay: 178, capacity: 50 }),
    ],
    { windowDays: 5 },
  )
  const used = p.collectors.filter((c) => c.taking > 0)
  check('everything is placed', p.placements.length, 100)
  ok('the work does not land on one desk', used.length > 1)
  ok('...it reaches most of the people chosen', used.length >= 7)
  ok('...and nobody takes even half of it', p.collectors.every((c) => c.taking < 50))
  /*
   * The biggest book ceiling still takes the most — that is the point of levelling rather than
   * splitting equally — but "the most" is a share, not the lot.
   */
  ok('the emptiest desk against its own ceiling takes the most',
    takenBy(p, 'Rehana') === Math.max(...p.collectors.map((c) => c.taking)))
  ok('...and the summary says so', /across \d+ people/.test(planSummary(p)))
  ok('...not "one person"', !/across 1 person/.test(planSummary(p)))
}

/*
 * Nine equal desks take an equal share, and this is the check that would catch a rule which
 * spreads only because the numbers happened to differ. Level books, level ceilings, level
 * diaries: 90 accounts must come out as ten each, not 90 and eight zeroes.
 */
{
  const p = plan(
    Array.from({ length: 90 }, (_, i) => acc(`a${i}`, 1000)),
    Array.from({ length: 9 }, (_, i) => col(`C${i}`, 'Senior', { inPlay: 200, capacity: 50 })),
    { windowDays: 5 },
  )
  check('everything is placed', p.placements.length, 90)
  ok('nine level desks take ten each', p.collectors.every((c) => c.taking === 10))
}

/*
 * A SHARE OF THE ROOM, not an equal share of the work and not all of it to one desk. An elite on
 * 200 of 500 has 300 of room; a junior on 140 of 150 has 10. Thirty times the room, so roughly
 * thirty times the work: 48 and 2 out of fifty.
 *
 * This check has now been written three ways and the history is the point. It first demanded the
 * junior take a proportional slice by raw headroom; then it was corrected to spare the junior
 * entirely, on the reasoning that pushing 140 of 150 up to the ceiling leaves nothing for what
 * arrives tomorrow. That reasoning was sound about the ceiling and wrong about zero — the firm
 * then reported the same shape at floor scale, where nine people were ticked and three of them
 * were given nothing at all for exactly this reason. A near-full desk should be PROTECTED, which
 * two accounts out of fifty does, not EXCLUDED, which is a different thing wearing the same
 * argument.
 */
{
  const p = plan(
    Array.from({ length: 50 }, (_, i) => acc(`a${i}`, 1000)),
    [
      col('Roomy', 'Elite', { inPlay: 200, ceiling: 500, capacity: 100 }),
      col('Tight', 'Junior', { inPlay: 140, ceiling: 150, capacity: 100 }),
    ],
  )
  check('the desk with the room takes nearly all of it', takenBy(p, 'Roomy'), 48)
  check('...and the near-full one takes a token share', takenBy(p, 'Tight'), 2)
  ok('...which leaves it short of its ceiling', p.collectors.find((c) => c.name === 'Tight').after < 150)
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
  ok('...and that it was exactly at the line before', !p.collectors[0].alreadyOver)
  check('...and what it becomes', p.collectors[0].after, 510)
  ok('...and the summary warns', /over their book ceiling/.test(planSummary(p)))
}

/*
 * A WARNING MUST BE ABOUT THE PLAN, not about the world it found. Somebody already over their
 * ceiling who is given nothing has not been pushed anywhere by this hand-out — and counting them
 * fires the warning on exactly the plan that did the right thing by avoiding them. A screenshot
 * caught this: "1 person goes over their book ceiling" on a plan where the only person taking
 * work went from 120 to 160 against a ceiling of 500.
 */
{
  const p = plan(
    Array.from({ length: 10 }, (_, i) => acc(`a${i}`, 1000)),
    [
      col('Roomy', 'Senior', { inPlay: 120, ceiling: 500 }),
      col('Swamped', 'Junior', { inPlay: 470, ceiling: 150 }),
    ],
  )
  const swamped = p.collectors.find((c) => c.name === 'Swamped')
  const roomy = p.collectors.find((c) => c.name === 'Roomy')
  check('the work avoids the swamped desk', swamped.taking, 0)
  check('...and the plan does not claim to have pushed them over', swamped.overBy, 0)
  ok('...but still says they are over', swamped.alreadyOver)
  check('the person who took the work is nowhere near their ceiling', roomy.after, 130)
  check('...and is not flagged', roomy.overBy, 0)
  ok('...so the summary warns about nobody', !/over their book ceiling/.test(planSummary(p)))
}

/* But a plan that pushes somebody FURTHER over owns that much and says so. */
{
  const p = plan(
    Array.from({ length: 10 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Swamped', 'Junior', { inPlay: 470, ceiling: 150, capacity: 100 })],
  )
  const c = p.collectors[0]
  check('it takes the work anyway', c.taking, 10)
  check('...and owns exactly the excess it added', c.overBy, 10)
  ok('...and says so', /over their book ceiling/.test(planSummary(p)))
}

/* Crossing the ceiling from below is owned in full, not just the part past it. */
{
  const p = plan(
    Array.from({ length: 30 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Nearly', 'Senior', { inPlay: 140, ceiling: 150, capacity: 100 })],
  )
  check('everything still lands', p.collectors[0].taking, 30)
  check('and the excess is what went past the line', p.collectors[0].overBy, 20)
  ok('...and they were not over to begin with', !p.collectors[0].alreadyOver)
}

/* ================= gate 3: which day ================= */

const byDayOf = (p) => {
  const out = {}
  for (const x of p.placements) out[x.dueOn] = (out[x.dueOn] ?? 0) + 1
  return out
}

/*
 * THE WINDOW IS A SPREAD, NOT A CEILING, and this check exists because it was the other way
 * round and a screenshot caught it: a hundred accounts asked for "over five working days" were
 * booked as two solid days and three empty ones. "Over five working days" is the firm telling
 * the planner how to PACE the work, not the last date it may use.
 *
 * Five accounts, a window of five days, and a collector who could physically take two a day:
 * the old rule gave 2/2/1 across three days, this one gives one a day across all five.
 */
{
  const p = plan(
    Array.from({ length: 5 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Solo', 'Senior', { capacity: 2 })],
    { windowDays: 5 },
  )
  const byDay = byDayOf(p)
  check('everything is placed', p.placements.length, 5)
  check('...across the whole window the person asked for', Object.keys(byDay).length, 5)
  ok('...evenly, rather than filling the first days', Object.values(byDay).every((n) => n === 1))
  ok('...and it does not claim to have run past', !p.ranPastWindow)
}

/*
 * Ask for ONE day and you get one day, filled to capacity, with the overflow running past — the
 * old behaviour, which was never wrong about a one-day window. This is the check that keeps the
 * spread from swallowing the ceiling: a window of one still means one.
 */
{
  const p = plan(
    Array.from({ length: 5 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Solo', 'Senior', { capacity: 2 })],
    { windowDays: 1 },
  )
  const byDay = byDayOf(p)
  check('a one-day window fills that day to capacity', byDay[MONDAY], 2)
  check('...and the rest runs past it', p.placements.length - byDay[MONDAY], 3)
  ok('...and says so', p.ranPastWindow)
}

/*
 * EXISTING LOAD COUNTS. A day already holding 38 of a 40 capacity has room for two, not forty —
 * and a planner that ignored what is already booked would double every diary it touched.
 */
{
  const p = plan(
    Array.from({ length: 4 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Busy', 'Senior', { capacity: 40, booked: { [MONDAY]: 38 } })],
    { windowDays: 1 },
  )
  check('only the free slots are used', p.placements.filter((x) => x.dueOn === MONDAY).length, 2)
  check('...the rest goes to the next day', p.placements.filter((x) => x.dueOn === '2026-09-22').length, 2)
}

/*
 * And with room to choose, the emptiest day in the window takes the work rather than the
 * earliest. A Monday already holding 38 of 40 is not where four fresh accounts belong when
 * Tuesday is empty — the person still has to work the 38.
 */
{
  const p = plan(
    Array.from({ length: 4 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Busy', 'Senior', { capacity: 40, booked: { [MONDAY]: 38 } })],
    { windowDays: 5 },
  )
  check('the busy day is left alone', p.placements.filter((x) => x.dueOn === MONDAY).length, 0)
  check('...and the quiet days take it', new Set(p.placements.map((x) => x.dueOn)).size, 4)
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
    // One day, so this is about the reserve and not about how the window spreads work.
    { windowDays: 1 },
  )
  check('the distributor fills the whole day', p.placements.filter((x) => x.dueOn === MONDAY).length, 45)
}
check('a clerk books 35 of 45 himself', selfBookingLimit(45, 10), 35)
check('the firm standard', selfBookingLimit(40, DEFAULT_DIARY_RESERVE), 30)
/* A reserve bigger than the day would otherwise say "book nothing", which nobody meant. */
check('a reserve cannot close the day', selfBookingLimit(10, 50), 1)
check('no reserve means the whole day', selfBookingLimit(40, 0), 40)

/* ================= role admits, grade widens ================= */

/*
 * REQUIRING A GRADE BEFORE SOMEBODY COULD BE HANDED WORK WAS A MISTAKE I MADE, and the firm
 * caught it: they have pre-legal clerks doing the job, none of them graded, and the hand-out
 * screen offered nobody. A grade is not an admission ticket — it WIDENS which accounts a person
 * may be given. Ungraded means Junior: generic accounts, which is the bulk of any book and where
 * a new collector proves themselves anyway.
 */
ok('the collecting roles are named in one place', COLLECTING_ROLES.includes('Pre-legal Agent'))
ok('...including the team leader', COLLECTING_ROLES.includes('Pre-legal Team Leader'))
ok('...and a liaison, who also carries a book', COLLECTING_ROLES.includes('Liaison'))
ok('...but not a sales rep', !COLLECTING_ROLES.includes('Sales Representative'))
check('ungraded means the lowest rung, never nothing', UNGRADED_EQUIVALENT, 'Junior')
ok('...which can take generic work', mayTake(UNGRADED_EQUIVALENT, band('generic')))
ok('...and cannot take high value', !mayTake(UNGRADED_EQUIVALENT, band('high_value')))

const data = readFileSync(new URL('../../src/lib/handOutData.ts', import.meta.url), 'utf8')
ok('the role admits somebody to the list',
  /COLLECTING_ROLES\.includes\(u\.role\) \|\| !!u\.collectorGrade/.test(data))
ok('...and an ungraded person is treated as Junior',
  /\?\? UNGRADED_EQUIVALENT/.test(data))
ok('...and flagged, so a leader knows to grade them', /ungraded: !u\.collectorGrade/.test(data))

/* ================= an account already in a diary still moves ================= */

/*
 * THE FIRM'S INSTRUCTION, and they are right: handing an account to somebody IS moving the work,
 * so refusing to move a date a previous holder set defeats the point. I had it skipping them out
 * of a caution that turned out to be unfounded — diarise() supersedes the old entry, which keeps
 * its original date and records who moved it and when. Nothing was ever silent.
 *
 * The planner still SUPPORTS skipping, because the option costs nothing and a future caller may
 * want it. What matters is that the screen does not ask for it.
 */
{
  const p = plan(
    [acc('a', 1000), acc('b', 1000, { alreadyBooked: true })],
    [col('Solo', 'Senior')],
    { skipAlreadyBooked: false },
  )
  check('an account already in a diary is handed out too', p.placements.length, 2)
  check('...and nothing is left behind', p.unplaced.length, 0)
}

const handOutModal = readFileSync(new URL('../../src/pages/accounts/HandOutModal.tsx', import.meta.url), 'utf8')
ok('the screen hands out everything', /skipAlreadyBooked: false/.test(handOutModal))
ok('...and says the old date is kept', /the old entry keeps its date and records who moved it/.test(handOutModal))
ok('...rather than claiming they were left alone', !/are left alone/.test(handOutModal))

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
