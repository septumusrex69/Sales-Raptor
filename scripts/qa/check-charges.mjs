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
  ENFORCE_ITEM_TOTALS, ENFORCE_MONTHLY_LIMITS, feeCeiling, itemTotalRemaining, monthlyLimit,
  monthlyRoom, receiptFeeInclVat, recoverableFee, scheduleFor,
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

  /*
   * Item 3 is charged per occurrence by business decision (see ENFORCE_ITEM_TOTALS). The gazette
   * facts above still hold and are still tested; what changed is whether the total is enforced.
   * Both behaviours are pinned so flipping the flag cannot pass silently.
   */
  if (ENFORCE_ITEM_TOTALS) {
    check('a second charge under item 3 gets nothing',
      near(itemTotalRemaining('3', 25, ANNEXURE_B_2026), 0))
    check('a part-used item 3 gets only the remainder',
      near(itemTotalRemaining('3', 10, ANNEXURE_B_2026), 15))
    check('over-spending item 3 does not produce a negative',
      near(itemTotalRemaining('3', 400, ANNEXURE_B_2026), 0))
  } else {
    check('item 3 charges again on a second query',
      near(itemTotalRemaining('3', 25, ANNEXURE_B_2026), 25))
    check('and again on a tenth', near(itemTotalRemaining('3', 250, ANNEXURE_B_2026), 25))
    check('the gazette still records it as a total', ANNEXURE_B_2026.items.find((i) => i.id === '3')?.isTotal === true,
      'the wording is kept even where the business charges differently')
  }
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
  check('ceiling spent: nothing, however free the item is', near(both(0, 1225, 50000), 0))
  check('near the ceiling: trimmed to what is left', near(both(0, 1220, 50000), 5))
  check('a tenth query on a roomy account still charges',
    near(both(250, 100, 50000), ENFORCE_ITEM_TOTALS ? 0 : 25))
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

  check('a second query charges item 3 again',
    near(itemTotalRemaining('3', 25, s), ENFORCE_ITEM_TOTALS ? 0 : 25))
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

/* ---------------------------------------------------------------- every gazette, not just this one */

/*
 * THE OLDER SCHEDULES ARE PRICED HISTORY, AND HISTORY IS BILLED OFF THEM.
 *
 * scheduleFor() exists precisely so a 2024 letter keeps its 2024 price. Until this loop, the
 * SELECTION was tested and the thing selected was not: the 2020 ceiling could be doubled and
 * every check stayed green. The 2026 column was pinned because somebody was working on 2026.
 *
 * Read off each gazette PDF, one row per schedule, so a figure cannot be changed on one of them
 * quietly.
 */
/*
 * EVERY AMOUNT, READ OFF THE GAZETTE ITSELF.
 *
 * The firm supplied the four notices and every figure below was taken from the PDF, item by item,
 * not copied out of the code. That distinction is the whole point: a check written from the code
 * pins the code to itself and protects a typo as faithfully as it protects the truth. These four
 * tables are the gazettes, and the code is now held against them.
 *
 *   2026  GN 6435, GG 53683 — ceiling R1225,00
 *   2020  GN R.580, GG 43343, 22 May 2020 — ceiling R1023,00
 *   2017  GN R.1141, 27 October 2017 — ceiling R965,00
 *   2015  GN R.1272, GG 39552, 23 December 2015 — ceiling R870,00
 *
 * Items 1(b), 4(a) and 9 carry no amount of their own: 1(b) and 4(a) point at the Magistrates'
 * Courts rules, and 9 is the percentage below rather than a flat fee. They are null in the code
 * and absent here for the same reason.
 */
const SCHEDULES = [
  {
    schedule: ANNEXURE_B_2026, year: '2026', ceiling: 1225, receiptMax: 610, rate: 0.1,
    items: { '1a': 25, '1c': 3.5, 2: 25, 3: 25, '4b': 250, '4c': 16, 5: 50, 6: 13, 7: 60, 8: 98 },
  },
  {
    schedule: ANNEXURE_B_2020, year: '2020', ceiling: 1023, receiptMax: 509, rate: 0.1,
    items: { '1a': 21, '1c': 3, 2: 21, 3: 21, '4b': 210, '4c': 14, 5: 41, 6: 11, 7: 52, 8: 82 },
  },
  {
    schedule: ANNEXURE_B_2017, year: '2017', ceiling: 965, receiptMax: 480, rate: 0.1,
    items: { '1a': 20, '1c': 2.8, 2: 20, 3: 20, '4b': 198, '4c': 13, 5: 39, 6: 10, 7: 49, 8: 78 },
  },
  {
    schedule: ANNEXURE_B_2015, year: '2015', ceiling: 870, receiptMax: 435, rate: 0.1,
    items: { '1a': 18, '1c': 2.5, 2: 18, 3: 18, '4b': 178, '4c': 12, 5: 35, 6: 9, 7: 44, 8: 70 },
  },
]

/* The monthly allowances are worded identically in all four gazettes: ten electronic
   communications, four credit bureau searches. */
const MONTHLY = { '1c': 10, '4c': 4 }

for (const { schedule, year, ceiling, receiptMax, rate, items } of SCHEDULES) {
  check(`the items 1-7 ceiling is R${ceiling} on the ${year} gazette`,
    schedule.itemsOneToSevenCeiling === ceiling,
    `got ${schedule.itemsOneToSevenCeiling}`)
  check(`the receipt fee is capped at R${receiptMax} on the ${year} gazette`,
    schedule.receiptFeeMaximum === receiptMax, `got ${schedule.receiptFeeMaximum}`)
  check(`the receipt fee rate is ${rate * 100}% on the ${year} gazette`,
    schedule.receiptFeeRate === rate, `got ${schedule.receiptFeeRate}`)

  /*
   * AND THE RATE IS EXERCISED BELOW THE CAP. Every existing test of the 2020 receipt fee used an
   * instalment ABOVE the cap, so the ten per cent was never reached on any schedule but the
   * current one -- the arithmetic could have been any number at all. R1 000 is below every cap
   * in the table, so this is the multiplication and not the minimum.
   */
  const belowCap = receiptFeeInclVat(1000, 0.15, schedule)
  check(`10% of R1 000 plus VAT is R115 on the ${year} gazette`,
    near(belowCap, 115), `got ${belowCap}`)
  const aboveCap = receiptFeeInclVat(receiptMax * 20, 0.15, schedule)
  check(`a large instalment is capped at R${receiptMax} plus VAT on the ${year} gazette`,
    near(aboveCap, receiptMax * 1.15), `got ${aboveCap}`)

  /* EVERY PRICED ITEM, not the two or three that happened to be on somebody's mind. */
  for (const [id, amount] of Object.entries(items)) {
    const got = schedule.items.find((i) => i.id === id)?.amount
    check(`item ${id} is R${amount.toFixed(2)} on the ${year} gazette`, got === amount, `got ${got}`)
  }
  /* And nothing has been invented that the gazette does not price. */
  const priced = schedule.items.filter((i) => i.amount !== null && i.amount !== undefined).map((i) => i.id).sort()
  check(`the ${year} gazette prices exactly these items`,
    priced.join(),
    Object.keys(items).sort().join(),
    `got ${priced.join()}`)

  for (const [id, cap] of Object.entries(MONTHLY)) {
    check(`item ${id} is capped at ${cap} a month on the ${year} gazette`,
      schedule.items.find((i) => i.id === id)?.maxPerMonth === cap)
  }

  /*
   * ITEM 1(c), THE SMS, IS PER SEGMENT. A live charging path -- accountSms.ts sets
   * SMS_ITEM = '1c' and the SMS box shows a collector the cost before they send. A template that
   * fits 160 characters against a short name and spills at 161 against a long one charges the
   * second debtor twice for the same words.
   */
  check(`...and a second segment of item 1c is charged again on the ${year} gazette`,
    near(itemTotalRemaining('1c', items['1c'], schedule), items['1c']))
  check(`...and item 1c counts towards the items 1-7 ceiling on the ${year} gazette`,
    schedule.items.find((i) => i.id === '1c')?.countsTowardCap === true)
}

/* ---------------------------------------------------------------- the monthly allowances */

/*
 * PINNED IN BOTH DIRECTIONS, like ENFORCE_ITEM_TOTALS beside it and for the same reason. Its
 * sibling flag had neither: flipping ENFORCE_MONTHLY_LIMITS on -- which makes Raptor refuse to
 * charge a fifth credit-bureau search or an eleventh electronic communication in a month, a
 * direct revenue change the firm instructed against -- left every check green.
 */
{
  const s = ANNEXURE_B_2026
  /* The gazette's own numbers, which are facts about the schedule whatever the flag says. */
  check('the gazette caps item 4c at four a month',
    s.items.find((i) => i.id === '4c')?.maxPerMonth === 4)
  check('...and item 1c at ten a month',
    s.items.find((i) => i.id === '1c')?.maxPerMonth === 10)
  check('...and leaves item 3 uncapped',
    s.items.find((i) => i.id === '3')?.maxPerMonth === undefined)

  if (ENFORCE_MONTHLY_LIMITS) {
    check('with the flag on, item 4c reports its four-a-month limit', monthlyLimit('4c', s) === 4)
    check('...and a fifth search in the month has no room', monthlyRoom(monthlyLimit('4c', s), 4) === 0)
    check('...while a first one has four', monthlyRoom(monthlyLimit('4c', s), 0) === 4)
  } else {
    check('with the flag off, item 4c reports no limit at all', monthlyLimit('4c', s) === null)
    check('...and item 1c none either', monthlyLimit('1c', s) === null)
    check('...so a fifth search in the month still has room',
      monthlyRoom(monthlyLimit('4c', s), 4) === Infinity)
  }
  /* monthlyRoom's own arithmetic, which is true whichever way the flag is set. */
  check('room is what is left of a limit', monthlyRoom(4, 1) === 3)
  check('...never negative', monthlyRoom(4, 9) === 0)
  check('...and unbounded where there is no limit', monthlyRoom(null, 900) === Infinity)
}

console.log(failed === 0 ? '\nAll checks passed.\n' : `\n${failed} check(s) failed.\n`)
process.exit(failed ? 1 : 0)
