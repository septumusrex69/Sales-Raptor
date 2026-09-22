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

const byDayOf = (p) => {
  const out = {}
  for (const x of p.placements) out[x.dueOn] = (out[x.dueOn] ?? 0) + 1
  return out
}

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
 *
 * WHAT THE LIFT DOES AND NO LONGER DOES. Since the firm opened High value to every grade it no
 * longer changes WHO may take the account — it changes what the account is CALLED. That is worth
 * keeping and worth checking: the lift was comparing the grades each band requires, so the moment
 * both bands read Junior it stopped firing altogether and a disputed account quietly fell back to
 * Generic. It compares the rungs themselves now.
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
/*
 * A JUNIOR MAY TAKE HIGH VALUE, and this check asserted the opposite until the firm changed it.
 * Their reasoning, against the obvious objection, and it is theirs to make: "yes, it is a risk to
 * allocate bigger accounts to smaller people, but you want to take that risk to help them grow,
 * give them confidence and give some fairness." One line now, at R50 000.
 */
ok('a junior may take high value', mayTake('Junior', band('high_value')))
ok('a junior may NOT take a major account', !mayTake('Junior', band('major')))
ok('a skilled collector may take high value', mayTake('Skilled', band('high_value')))
ok('a skilled collector may NOT take a major account', !mayTake('Skilled', band('major')))
ok('a senior may take anything', ACCOUNT_BANDS.every((b) => mayTake('Senior', b)))
ok('an elite may take anything', ACCOUNT_BANDS.every((b) => mayTake('Elite', b)))

/* ================= the even split, when the firm asks for one ================= */

/*
 * THE FIRM'S OWN ARITHMETIC, verbatim: "a hundred accounts over ten users means each one should
 * get ten. Exactly." It is how a shuffle is shared out, and the ordinary rule — a share of the
 * room each person has — deliberately does not do this, because it is protecting books that are
 * nearly full. When somebody ticks the box they are saying that is not what they want today.
 */
{
  const p = plan(
    Array.from({ length: 100 }, (_, i) => acc(`a${i}`, 1000)),
    Array.from({ length: 10 }, (_, i) => col(`C${i}`, 'Senior', { inPlay: 100, capacity: 50 })),
    { windowDays: 5, evenSplit: true },
  )
  check('everything is placed', p.placements.length, 100)
  ok('a hundred across ten is ten each', p.collectors.every((c) => c.taking === 10))
  /*
   * Note for whoever breaks this to check it: ten identical desks get ten each under the ordinary
   * rule too, so this block records the firm's arithmetic and does NOT discriminate between the
   * two. The block below, with one book nearly full and one nearly empty, is the one that fails
   * when the box stops working.
   */
}

/* And the second of their examples: a thousand over ten people over five days. */
{
  const p = plan(
    Array.from({ length: 1000 }, (_, i) => acc(`a${i}`, 1000)),
    Array.from({ length: 10 }, (_, i) => col(`C${i}`, 'Senior', { inPlay: 0, capacity: 200 })),
    { windowDays: 5, evenSplit: true },
  )
  const byDay = byDayOf(p)
  check('everything is placed', p.placements.length, 1000)
  ok('a thousand across ten is a hundred each', p.collectors.every((c) => c.taking === 100))
  check('...over the five days asked for', Object.keys(byDay).length, 5)
  ok('...at two hundred a day', Object.values(byDay).every((n) => n === 200))
}

/*
 * THE WHOLE POINT IS THAT IT IGNORES WHAT THEY CARRY. Without the box, a desk on 480 of 500 is
 * spared and a desk on 20 takes nearly everything — that is the ordinary rule working correctly.
 * With it, they take fifty each, and the one who goes over is reported rather than avoided:
 * "even if it goes over, it should just indicate that it's going over".
 */
{
  const floor = () => [
    col('Full', 'Senior', { inPlay: 480, ceiling: 500, capacity: 100 }),
    col('Empty', 'Senior', { inPlay: 20, ceiling: 500, capacity: 100 }),
  ]
  const stack = () => Array.from({ length: 100 }, (_, i) => acc(`a${i}`, 1000))

  const ordinary = plan(stack(), floor(), { windowDays: 5 })
  ok('without the box the full book is spared', takenBy(ordinary, 'Full') < takenBy(ordinary, 'Empty'))

  const even = plan(stack(), floor(), { windowDays: 5, evenSplit: true })
  check('with it, the full book takes its half', takenBy(even, 'Full'), 50)
  check('...and so does the empty one', takenBy(even, 'Empty'), 50)
  const full = even.collectors.find((c) => c.name === 'Full')
  check('...and the plan owns what it pushed past the ceiling', full.overBy, 30)
  ok('...and says so', /over their book ceiling/.test(planSummary(even)))
  ok('...while the one with room is not flagged',
    even.collectors.find((c) => c.name === 'Empty').overBy === 0)
}

/*
 * BUT NOT THE GRADE GATE. Equal shares are about fairness between desks; a major account on a
 * junior desk is a client relationship and a year's commission. The firm's rule that grade
 * decides WHICH accounts is not a preference this box may override — so an even split across a
 * junior and a senior still sends the big ones to the senior, and evens out what it can.
 */
{
  const p = plan(
    [acc('big', 400000), acc('small1', 1000), acc('small2', 1000), acc('small3', 1000)],
    [col('Junior', 'Junior'), col('Senior', 'Senior')],
    { windowDays: 5, evenSplit: true },
  )
  check('the major account still goes to the senior', takenBy(p, 'Senior'), 2)
  check('...and the junior takes the generic ones', takenBy(p, 'Junior'), 2)
  ok('...and it is the big one the junior did not get',
    p.placements.find((x) => x.accountId === 'big')?.userId === 'u-Senior')
}

/* Off unless asked for. The ordinary hand-out protects a full book, and that is the default. */
{
  const floor = () => [
    col('Full', 'Senior', { inPlay: 480, ceiling: 500, capacity: 100 }),
    col('Empty', 'Senior', { inPlay: 20, ceiling: 500, capacity: 100 }),
  ]
  const stack = () => Array.from({ length: 100 }, (_, i) => acc(`a${i}`, 1000))
  const off = plan(stack(), floor(), { windowDays: 5, evenSplit: false })
  const unset = plan(stack(), floor(), { windowDays: 5 })
  check('unticked and absent are the same plan',
    JSON.stringify(off.collectors), JSON.stringify(unset.collectors))
  ok('...and neither splits it evenly', takenBy(unset, 'Full') !== takenBy(unset, 'Empty'))
}

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
 * THE WINDOW IS THE AGGRESSION OF THE ALLOCATION, in the firm's own words. The same stack handed
 * out over one day, two days, five and ten must arrive at four different paces — that is the
 * whole point of the box, and it is what the person setting it is weighing: a diary filled to
 * capacity today has no room for what they hand out tomorrow.
 *
 * A hundred accounts across TWENTY-FIVE collectors who each work fifty a day, so nothing here is
 * limited by capacity and the only thing shaping the answer is the window. The floor size is part
 * of the check, not scenery: with ten collectors these same four assertions pass even with the
 * quota deleted, because ten people taking ten each and levelling their own diaries happens to
 * land on the same numbers. Twenty-five people take four each, which every window from three days
 * up has to stretch — so the assertions fail when the pacing does.
 */
{
  const floor = () => Array.from({ length: 25 }, (_, i) => col(`C${String(i).padStart(2, '0')}`, 'Senior', { inPlay: 100, capacity: 50 }))
  const stack = () => Array.from({ length: 100 }, (_, i) => acc(`a${i}`, 1000))
  const shape = (windowDays) => {
    const p = plan(stack(), floor(), { windowDays })
    const byDay = byDayOf(p)
    return { placed: p.placements.length, days: Object.keys(byDay).length, busiest: Math.max(...Object.values(byDay)) }
  }
  const one = shape(1)
  const two = shape(2)
  const five = shape(5)
  const ten = shape(10)

  check('everything is placed either way', [one.placed, two.placed, five.placed, ten.placed].join(), '100,100,100,100')
  check('one day means one day', one.days, 1)
  check('...all hundred of them', one.busiest, 100)
  check('two days halves it', two.days, 2)
  check('...fifty a day', two.busiest, 50)
  check('five days is twenty a day', five.days, 5)
  check('...twenty', five.busiest, 20)
  check('ten days is ten a day', ten.days, 10)
  check('...ten', ten.busiest, 10)
  /*
   * Stated as the relationship rather than four separate numbers, because THAT is the property:
   * more days must never mean a heavier day. Four passing constants could all be wrong together
   * in the same direction and this could not.
   */
  ok('more days is never a busier day',
    one.busiest >= two.busiest && two.busiest >= five.busiest && five.busiest >= ten.busiest)
  ok('...and never fewer days used', ten.days > five.days && five.days > two.days && two.days > one.days)
}

/*
 * AND IT IS THE AGGREGATE THAT IS PACED, not each person's own diary. This is the case that made
 * the last attempt look right and behave wrong: thirty-nine collectors taking two or three each
 * spread their own two or three across days one, two and three, so a five-day window finished in
 * three and the firm asked why. A hundred accounts over thirty-nine people is still twenty a day
 * over five days — twenty different people booked on Monday, twenty more on Tuesday.
 */
{
  const p = plan(
    Array.from({ length: 100 }, (_, i) => acc(`a${i}`, 1000)),
    Array.from({ length: 39 }, (_, i) => col(`C${String(i).padStart(2, '0')}`, 'Senior', { inPlay: 150, capacity: 50 })),
    { windowDays: 5 },
  )
  const byDay = byDayOf(p)
  check('everything is placed', p.placements.length, 100)
  check('the whole window is used', Object.keys(byDay).length, 5)
  ok('...at the pace it was asked for', Object.values(byDay).every((n) => n === 20))
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

/* ================= grade does not decide HOW MANY, room does ================= */

/*
 * THE QUESTION THE FIRM ASKED, in their words: "Bongani Zulu, she's a junior collector and she
 * has 490 of 500 accounts. Ayanda Buthelezi, a senior collector, has 470 of 500. Why would Ayanda
 * be distributed more and Bongani less?"
 *
 * Because the share is proportional to the ROOM ON THE BOOK and to nothing else. Ayanda has three
 * times the room, so Ayanda takes about three times the work. The grades are a coincidence of who
 * happened to be fuller, and this check is built to prove exactly that: two desks with identical
 * room and opposite grades must take the SAME number, and two desks with identical grades and
 * different room must not.
 *
 * Their real figures, off the screen they were looking at.
 */
{
  const p = plan(
    Array.from({ length: 120 }, (_, i) => acc(`a${i}`, 1000)),
    [
      col('Bongani', 'Junior', { inPlay: 490, capacity: 35 }),
      col('Musa', 'Elite', { inPlay: 490, capacity: 50 }),
      col('Ayanda', 'Senior', { inPlay: 470, capacity: 50 }),
      col('Hanlie', 'Junior', { inPlay: 470, capacity: 50 }),
    ],
  )
  /* Same room, opposite ends of the ladder: the same share. */
  check('a junior and an elite with the same room take the same',
    takenBy(p, 'Bongani'), takenBy(p, 'Musa'))
  check('...and so do a junior and a senior', takenBy(p, 'Hanlie'), takenBy(p, 'Ayanda'))
  /* Three times the room, near enough three times the work. */
  const ratio = takenBy(p, 'Ayanda') / takenBy(p, 'Bongani')
  ok('three times the room is about three times the work', ratio > 2.5 && ratio < 3.5)
  /*
   * AND A SMALLER WORKING DAY DOES NOT MEAN A SMALLER SHARE. Bongani works 35 a day where Musa
   * works 50; that changes which days the work lands on, never how much of it there is. The two
   * are separate rules and the firm's question is exactly what happens when they get conflated.
   */
  check('a shorter working day does not shrink the share',
    takenBy(p, 'Bongani'), takenBy(p, 'Musa'))
}

/* ================= what the work is, as against whose it is ================= */

/*
 * "THERE SHOULD ALSO BE AN OPTION TO KEEP IT ON THE ORIGINAL DIARY STATUS AS IT WAS." The firm's
 * words. A hand-out is usually a decision that an account needs working, and then the ladder
 * should decide where it lands. But sometimes it is only a change of desk — somebody leaves, a
 * team is rebalanced — and re-filing everything as the import thinks it should be throws away
 * what the last collector actually found out.
 */
{
  const accounts = [
    { ...acc('kept', 1000, { kind: 'review' }), currentKind: 'promise_broken', alreadyBooked: true },
    { ...acc('fresh', 1000, { kind: 'trace' }) },
  ]
  const off = plan(accounts, [col('Solo', 'Senior', { capacity: 10 })], { windowDays: 5 })
  const on = plan(accounts, [col('Solo', 'Senior', { capacity: 10 })], { windowDays: 5, keepKind: true })

  const kindOf = (p, id) => p.placements.find((x) => x.accountId === id)?.kind ?? '(not placed)'
  check('by default the ladder re-decides it', kindOf(off, 'kept'), 'review')
  check('...and with the box on it keeps what it was', kindOf(on, 'kept'), 'promise_broken')
  /*
   * An account with nothing in a diary has nothing to keep, so it falls back to the derived kind
   * whatever the box says. A silent 'review' for those would be the box quietly doing something
   * other than what it claims.
   */
  check('an account not in a diary is still worked out', kindOf(on, 'fresh'), 'trace')
  check('...the same either way', kindOf(off, 'fresh'), 'trace')
}

/*
 * AND THE QUEUE IS ORDERED ON THE KIND IT WILL ACTUALLY BOOK. Sorting by the derived kind and
 * then writing a different one would deal the work in an order that does not match the diary it
 * produces — the broken promise would be booked as a broken promise and dealt as a review.
 *
 * Here the kept account is a broken promise and the derived one a routine follow-up, with one
 * slot a day: with the box on, the broken promise has to come first.
 */
{
  const accounts = [
    { ...acc('routine', 900000, { kind: 'review' }) },
    { ...acc('kept', 1000, { kind: 'review' }), currentKind: 'promise_broken', alreadyBooked: true },
  ]
  const p = plan(accounts, [col('Solo', 'Senior', { capacity: 1 })], { windowDays: 5, keepKind: true })
  const order = [...p.placements].sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1)).map((x) => x.accountId)
  check('the kept broken promise is dealt first', order[0], 'kept')
  check('...and the routine one after it', order[1], 'routine')
}

/* ================= arguing with the plan ================= */

/*
 * A LEADER KNOWS THINGS THE DISTRIBUTOR CANNOT. The training course, the disciplinary, the
 * resignation on Friday — none of it is in the database. The firm's case, in their words: "if I
 * think Ayanda shouldn't get 19, rather get like 7, because I know something else is happening."
 * A plan that cannot be argued with is one they will stop trusting and do by hand.
 */
const floor6 = () => [
  col('Ayanda', 'Senior', { inPlay: 470 }), col('Lerato', 'Skilled', { inPlay: 480 }),
  col('Shireen', 'Senior', { inPlay: 480 }), col('Kagiso', 'Senior', { inPlay: 485 }),
  col('Ryno', 'Skilled', { inPlay: 485 }), col('Nomsa', 'Senior', { inPlay: 485 }),
]
const stack100 = () => Array.from({ length: 100 }, (_, i) => acc(`a${i}`, 1000 + (100 - i) * 500))

{
  const before = plan(stack100(), floor6(), { windowDays: 5 })
  const after = plan(stack100(), floor6(), { windowDays: 5, pinned: { 'u-Ayanda': 7 } })

  ok('the rule gives Ayanda more than seven to begin with', takenBy(before, 'Ayanda') > 7)
  check('pinned, she takes exactly seven', takenBy(after, 'Ayanda'), 7)
  check('...and nothing is dropped', after.placements.length, 100)
  /*
   * THE FREED WORK GOES SOMEWHERE, which is the whole point — "it automatically redistributes it
   * to some others". Every other desk must come out at least as high as it was.
   */
  ok('...the rest is shared out, not lost', after.collectors
    .filter((c) => c.name !== 'Ayanda')
    .every((c) => c.taking >= before.collectors.find((x) => x.name === c.name).taking))
  ok('...and the plan marks the figure as set by hand',
    after.collectors.find((c) => c.name === 'Ayanda').pinned)
  ok('...only that one', after.collectors.filter((c) => c.pinned).length === 1)
}

/*
 * PINNED WORK IS DEALT THROUGH THE QUEUE, NOT OFF THE TOP. The queue is ordered
 * broken-promises-first and then by balance, so taking the pinned share first would hand somebody
 * pinned DOWN to seven the seven most valuable accounts on the stack — the opposite of what
 * pinning them down was for.
 */
{
  const accounts = stack100()
  const p = planHandOut({
    accounts, collectors: floor6(), startOn: MONDAY, windowDays: 5, pinned: { 'u-Ayanda': 7 },
  })
  const at = p.placements.filter((x) => x.userId === 'u-Ayanda')
    .map((x) => accounts.findIndex((a) => a.id === x.accountId))
  check('she gets the seven she was pinned to', at.length, 7)
  ok('...spread through the queue rather than its head', Math.max(...at) > 50)
  ok('...and not as the top seven', !at.every((i) => i < 7))
}

/* Both directions, and several at once. */
{
  const up = plan(stack100(), floor6(), { windowDays: 5, pinned: { 'u-Ryno': 40 } })
  check('somebody can be given more, not only less', takenBy(up, 'Ryno'), 40)
  const both = plan(stack100(), floor6(), { windowDays: 5, pinned: { 'u-Ayanda': 7, 'u-Ryno': 40 } })
  check('two hand-set figures both hold', takenBy(both, 'Ayanda'), 7)
  check('...both of them', takenBy(both, 'Ryno'), 40)
  check('...and the rest still adds up', both.placements.length, 100)
}

/* Zero is a real answer: give this person nothing today, without unticking them. */
{
  const p = plan(stack100(), floor6(), { windowDays: 5, pinned: { 'u-Ayanda': 0 } })
  check('nothing is a number somebody may set', takenBy(p, 'Ayanda'), 0)
  ok('...and it is still marked as a decision', p.collectors.find((c) => c.name === 'Ayanda').pinned)
  check('...with the work going to the others', p.placements.length, 100)
}

/*
 * A PIN THAT CANNOT BE HONOURED IS REPORTED, never silently rounded down. Somebody typing more
 * than the whole stack gets the whole stack and is told so — a number a person set that quietly
 * came out different is the one thing worse than refusing it.
 */
{
  const p = plan(stack100(), floor6(), { windowDays: 5, pinned: { 'u-Ayanda': 200 } })
  check('a pin past the stack takes the stack', takenBy(p, 'Ayanda'), 100)
  ok('...and says it fell short', p.collectors.find((c) => c.name === 'Ayanda').pinShort)
  ok('...while a pin that fits does not',
    !plan(stack100(), floor6(), { windowDays: 5, pinned: { 'u-Ayanda': 7 } })
      .collectors.find((c) => c.name === 'Ayanda').pinShort)
}

/*
 * AND THE GRADE GATE STILL WINS. A pin is an argument about HOW MANY; it was never a way to put
 * a major account on a junior desk, which is the one thing on this screen that costs a client.
 */
{
  const p = plan(
    [acc('big', 400000), acc('s1', 1000), acc('s2', 1000)],
    [col('Junior', 'Junior'), col('Senior', 'Senior')],
    { windowDays: 5, pinned: { 'u-Junior': 3 } },
  )
  ok('the major account is still the senior\'s',
    p.placements.find((x) => x.accountId === 'big')?.userId === 'u-Senior')
  check('...so the pin cannot be filled', takenBy(p, 'Junior'), 2)
  ok('...and says so rather than pretending', p.collectors.find((c) => c.name === 'Junior').pinShort)
}

/*
 * PINS THAT DO NOT ADD UP TO THE STACK LEAVE THE REST UNPLACED, and say why in its own words.
 *
 * This is the case that proves the cap is a cap. With everybody pinned and the numbers totalling
 * less than the stack, a pin that were only a floor would quietly hand out all hundred anyway —
 * which is exactly what happened when this was broken on purpose, and the earlier checks all
 * passed because the budget arithmetic landed on the right totals by itself.
 *
 * The reason matters as much as the count. "Nobody is graded for it" and "everybody is at the
 * number you set" point at opposite fixes.
 */
{
  const p = plan(
    stack100(),
    [col('Ayanda', 'Senior', { inPlay: 470 }), col('Ryno', 'Skilled', { inPlay: 485 })],
    { windowDays: 5, pinned: { 'u-Ayanda': 7, 'u-Ryno': 40 } },
  )
  check('only what was asked for is handed out', p.placements.length, 47)
  check('...exactly', takenBy(p, 'Ayanda') + takenBy(p, 'Ryno'), 47)
  check('...and the remainder is reported, not lost', p.unplaced.length, 53)
  check('...for the right reason', reasonOf(p), 'pinned_out')
  ok('...which is not the grade one', p.unplaced.every((u) => u.reason !== 'no_one_graded'))
}

/* No pins at all must plan exactly as before. A feature nobody asked for is not allowed to
 * change the answer for everybody who did not use it. */
{
  const none = plan(stack100(), floor6(), { windowDays: 5 })
  const empty = plan(stack100(), floor6(), { windowDays: 5, pinned: {} })
  check('an empty set of pins changes nothing',
    JSON.stringify(none.collectors), JSON.stringify(empty.collectors))
}

/* ================= an overrun has to SAY it overran ================= */

/*
 * THE REPORT THIS EXISTS FOR. Somebody set ten working days, switched back to four, and the plan
 * underneath still spanned ten — so the screen looked like it had not noticed. It had: every
 * diary in those four days was full and the planner had nowhere else to put the work, which is
 * the documented behaviour. What was missing is that NOTHING SAID SO. The summary named the days
 * it used, which reads as an answer rather than as a report that the window could not be kept.
 */
{
  const week = {}
  for (const d of [MONDAY, '2026-09-22', '2026-09-23', '2026-09-25']) week[d] = 40
  const p = plan(
    Array.from({ length: 40 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Solo', 'Senior', { capacity: 40, booked: week })],
    { windowDays: 4 },
  )
  ok('it ran past the window', p.ranPastWindow)
  ok('...and the sentence says so', /past the 4 you asked for/.test(planSummary(p)))
  ok('...naming the window, not the days it used', /past the 4 /.test(planSummary(p)))
  check('...and the plan carries what was asked for', p.windowDays, 4)
}

/* And when it fits, it must NOT claim an overrun. A warning that fires on the plan that did the
 * right thing is one people stop reading, and then it is worse than no warning at all. */
{
  const p = plan(
    Array.from({ length: 4 }, (_, i) => acc(`a${i}`, 1000)),
    [col('Solo', 'Senior', { capacity: 40 })],
    { windowDays: 5 },
  )
  ok('a plan that fits does not claim to have run past', !p.ranPastWindow)
  ok('...and says nothing about asking', !/you asked for/.test(planSummary(p)))
  check('...but still reports the window', p.windowDays, 5)
}

/* The window the plan reports is the one it USED, clamped the way the planner clamped it —
 * otherwise the sentence quotes a number the plan never honoured. */
{
  const p = plan(
    [acc('a', 1000)], [col('Solo', 'Senior')],
    { windowDays: 30, maxWindowDays: 5 },
  )
  check('a window longer than the limit is reported as the limit', p.windowDays, 5)
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
ok('...and high value too, since the firm opened it', mayTake(UNGRADED_EQUIVALENT, band('high_value')))
ok('...but not a major account', !mayTake(UNGRADED_EQUIVALENT, band('major')))

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

/* ---------------------------------------------------- refer-only needs there to be an owner */

/*
 * THE FIRM, on the accounts a handover has just opened: "there's no option of just referring. It
 * should be allocated and referred."
 *
 * AND IT IS A RULE RATHER THAN A PREFERENCE ABOUT IMPORTS. This file already refuses "allocate
 * but do not book", because an account on a desk with nobody diarised is how 355 accounts arrived
 * from Swordfish owned by somebody and rung by nobody. Refer-only on an account NOBODY owns is
 * the same fault from the other side: a diary entry against a book that is not anybody's.
 *
 * SO THE QUESTION IS ASKED OF THE BOOK, not of where the person came from. A batch fresh off an
 * import is the common case and not the rule -- and an account allocated on the way in, which a
 * linked account now can be, is owned and may be referred like any other.
 */
const modal = readFileSync('src/pages/accounts/HandOutModal.tsx', 'utf8')
ok('the screen counts what is on nobody’s desk', /unallocatedCount\(selection\)/.test(modal))
ok('...and withholds refer-only when they all are',
  /const referOnlyPossible = unowned === null \|\| unowned < selectedCount/.test(modal))
ok('...offering it again the moment one of them has an owner',
  /referOnlyPossible && \(/.test(modal))
/*
 * A FAILED COUNT LEAVES THE CHOICE OPEN. A count that did not come back is not evidence that
 * these accounts have no owner, and taking somebody's option away on no information is the screen
 * deciding for them.
 */
ok('...and a count that failed does not remove the option',
  /unowned === null \|\|/.test(modal))
/*
 * AND A CHOICE THAT STOPS BEING POSSIBLE GOES BACK, rather than being submitted as something the
 * screen no longer offers. The selection can change under it -- the modal stays open while it is
 * re-counted.
 */
ok('...and refer-only reverts if it stops being possible',
  /if \(!referOnlyPossible && mode === 'refer'\) setMode\('allocate_and_refer'\)/.test(modal))
/* SAID, not a button that quietly is not there. Somebody who has used this screen will look. */
ok('...and the screen says why it is not on offer',
  /no owner for a referral to leave in place/.test(modal))

/*
 * THE COUNT ITSELF IS A COUNT IN THE DATABASE, not a filter over the accounts already loaded.
 * That list is capped at BULK_CEILING and is fetched for the diary planner, so counting inside it
 * would answer "are the first five thousand unowned" and say yes on a bigger batch.
 */
const alloc = readFileSync('src/lib/accountAllocation.ts', 'utf8')
ok('the count is taken in the database',
  /export async function unallocatedCount[\s\S]{0,700}?count: 'exact', head: true/.test(alloc))
ok('...over the same filters the selection means',
  /\{ \.\.\.selection\.query, assignedTo: 'nobody' \}/.test(alloc))
/* Chunked, like every other id query here: PostgREST gives up on a long `in` long before
   Postgres does, and a five-thousand-account batch is exactly what this is for. */
ok('...and chunked when it is a list of ids',
  /export async function unallocatedCount[\s\S]{0,400}?idChunks\(selection\.ids\)/.test(alloc))

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
