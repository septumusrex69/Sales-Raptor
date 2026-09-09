/**
 * The Annexure B caps that decide what a charge is worth.
 *
 * These matter more than most: over-recovering from a debtor is the kind of error the Council for
 * Debt Collectors exists to hear about, and the two rules involved are both easy to state and
 * easy to get wrong in code.
 *
 *   node --experimental-strip-types scripts/qa/check-charges.mjs
 */
import {
  ANNEXURE_B_2015, ANNEXURE_B_2017, ANNEXURE_B_2020, ANNEXURE_B_2026,
  feeCeiling, itemTotalRemaining, recoverableFee, scheduleFor,
} from '../../src/lib/annexureB.ts'

let failed = 0
const near = (a, b) => Math.abs(a - b) < 0.005
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${detail}` : ''}`)
}

/*
 * Item 3 is priced "a total amount of" in every gazette since 2015 — R25 now, R21 from 2020,
 * R20 from 2017, R18 from 2015. Each figure was read off the gazette PDF, not inferred.
 */
{
  const amounts = [[ANNEXURE_B_2026, 25], [ANNEXURE_B_2020, 21], [ANNEXURE_B_2017, 20], [ANNEXURE_B_2015, 18]]
  for (const [schedule, expected] of amounts) {
    check(`item 3 is R${expected} on the ${schedule.effectiveFrom.slice(0, 4)} schedule`,
      near(itemTotalRemaining('3', 0, schedule), expected),
      `got ${itemTotalRemaining('3', 0, schedule)}`)
  }

  check('a second charge under item 3 gets nothing',
    near(itemTotalRemaining('3', 25, ANNEXURE_B_2026), 0))
  check('a part-used item 3 gets only the remainder',
    near(itemTotalRemaining('3', 10, ANNEXURE_B_2026), 15))
  check('over-spending item 3 does not produce a negative',
    near(itemTotalRemaining('3', 400, ANNEXURE_B_2026), 0))
}

/* A per-occurrence item has no such limit: a phone call is R25 every time it is made. */
{
  check('item 2 is not a total — the tenth call still costs R25',
    near(itemTotalRemaining('2', 250, ANNEXURE_B_2026), 25))
  check('item 1a is not a total either',
    near(itemTotalRemaining('1a', 96, ANNEXURE_B_2026), 25))
}

/* The items 1–7 ceiling: the capital, or R1,225, whichever is less. */
{
  check('the ceiling is R1,225 on a large debt', near(feeCeiling(50000, ANNEXURE_B_2026), 1225))
  check('the ceiling is the capital on a small one', near(feeCeiling(400, ANNEXURE_B_2026), 400))

  check('a charge inside the ceiling is recoverable in full',
    near(recoverableFee(25, 100, 50000, ANNEXURE_B_2026), 25))
  check('a charge is trimmed to what is left of the ceiling',
    near(recoverableFee(25, 1215, 50000, ANNEXURE_B_2026), 10))
  check('a charge past the ceiling recovers nothing',
    near(recoverableFee(25, 1225, 50000, ANNEXURE_B_2026), 0))
  check('a small debt hits its own lower ceiling first',
    near(recoverableFee(25, 390, 400, ANNEXURE_B_2026), 10))
}

/* The two caps compose: whichever bites first wins, and neither goes negative. */
{
  const both = (spentOnItem, towardsCeiling, capital) =>
    recoverableFee(itemTotalRemaining('3', spentOnItem, ANNEXURE_B_2026), towardsCeiling, capital, ANNEXURE_B_2026)

  check('fresh account, plenty of room: full R25', near(both(0, 0, 50000), 25))
  check('item 3 spent, ceiling free: nothing', near(both(25, 100, 50000), 0))
  check('item 3 free, ceiling spent: nothing', near(both(0, 1225, 50000), 0))
  check('both partly used: the tighter one wins', near(both(15, 1220, 50000), 5),
    'R10 left on item 3, R5 left under the ceiling')
}

/* A charge is priced on the schedule in force the day it is raised, never today's. */
{
  check('a 2019 charge uses the 2017 schedule', scheduleFor('2019-06-01').effectiveFrom === '2017-10-27')
  check('a 2021 charge uses the 2020 schedule', scheduleFor('2021-06-01').effectiveFrom === '2020-05-22')
  check('a charge today uses the 2026 schedule', scheduleFor('2026-09-09').effectiveFrom === '2026-03-06')
  check('the day the 2026 schedule came in is on the new rate',
    near(itemTotalRemaining('3', 0, scheduleFor('2026-03-06')), 25))
  check('the day before it is still on the old one',
    near(itemTotalRemaining('3', 0, scheduleFor('2026-03-05')), 21))
}

/*
 * The three items a query's lifecycle charges, and why they are three different items.
 *
 * Item 3 is a total, so it can only pay once. The other two are per-occurrence, which is what
 * makes them the right home for work that genuinely repeats — a query chased three times is
 * three letters.
 */
{
  const s = ANNEXURE_B_2026
  check('raising a query: item 3 at R25', near(itemTotalRemaining('3', 0, s), 25))
  check('sending it to the client: item 1a at R25', near(itemTotalRemaining('1a', 0, s), 25))
  check('the client answering: item 6 at R13', near(itemTotalRemaining('6', 0, s), 13))

  check('a second query charges nothing under item 3', near(itemTotalRemaining('3', 25, s), 0))
  check('a second letter to the client still charges item 1a',
    near(itemTotalRemaining('1a', 25, s), 25),
    'item 1a is per occurrence — a chased query is another letter')
  check('a second reply still charges item 6', near(itemTotalRemaining('6', 13, s), 13))

  // All three count towards the R1,225 ceiling, so a busy account eventually stops earning.
  for (const id of ['3', '1a', '6']) {
    const item = s.items.find((i) => i.id === id)
    check(`item ${id} counts towards the items 1-7 ceiling`, item?.countsTowardCap === true)
  }

  const lifecycle = itemTotalRemaining('3', 0, s) + itemTotalRemaining('1a', 0, s) + itemTotalRemaining('6', 0, s)
  check('a full query lifecycle is R63 excluding VAT', near(lifecycle, 63), `got ${lifecycle}`)
  check('and R72.45 including VAT', near(lifecycle * 1.15, 72.45))
}

console.log(failed === 0 ? '\nAll checks passed.\n' : `\n${failed} check(s) failed.\n`)
process.exit(failed ? 1 : 0)
