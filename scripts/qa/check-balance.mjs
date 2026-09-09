/**
 * Check the balance engine's arithmetic.
 *
 * The formula itself was verified against 735 migrated accounts in SQL. What that cannot catch
 * is a transcription error between the query that proved it and the TypeScript the app runs —
 * so these are the cases where the two could silently disagree, each with an answer worked out
 * by hand rather than by the code under test.
 *
 *   node scripts/qa/check-balance.mjs
 */
import { computeBalance, buildStatement } from '../../src/lib/accountBalance.ts'
import { accrueToDate, coveredTo } from '../../src/lib/interestAccrual.ts'

let failed = 0
const near = (a, b) => Math.abs(a - b) < 0.005

function check(name, actual, expected) {
  const ok = near(actual, expected)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`        expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`)
}

const empty = { payments: [], fees: [], interest: [] }

/* An account with nothing on it owes its capital, and settling adds 10% + VAT. */
{
  const b = computeBalance({ capitalHandedOver: 1000, handoverDate: '2026-01-01', ledgers: empty })
  check('bare account: balance is the capital', b.balance, 1000)
  check('bare account: settlement fee is 10% + VAT', b.settlementFee, 115)
  check('bare account: settlement', b.settlement, 1115)
}

/*
 * The receipt fee is priced on the schedule in force the DAY THE PAYMENT ARRIVED, not today.
 * A R6,100 instalment is exactly at the 2026 maximum of R610 and well past the 2020 one of R509,
 * so the same payment costs different amounts either side of 6 March 2026. Getting this wrong
 * would be invisible on small payments and wrong on every large one.
 */
{
  const before = computeBalance({
    capitalHandedOver: 0, handoverDate: '2025-01-01',
    ledgers: { ...empty, payments: [{ date: '2025-11-29', amount: 6100 }] },
  })
  check('payment in 2025 caps at the R509 maximum', before.receiptFees, 585.35)

  const after = computeBalance({
    capitalHandedOver: 0, handoverDate: '2026-01-01',
    ledgers: { ...empty, payments: [{ date: '2026-04-28', amount: 6100 }] },
  })
  check('the same payment in 2026 caps at R610', after.receiptFees, 701.5)

  const small = computeBalance({
    capitalHandedOver: 0, handoverDate: '2026-01-01',
    ledgers: { ...empty, payments: [{ date: '2026-04-28', amount: 1000 }] },
  })
  check('a payment under the cap is 10% + VAT', small.receiptFees, 115)
}

/* Unbilled actions are history, not money: an action past the ceiling must not reach a balance. */
{
  const b = computeBalance({
    capitalHandedOver: 1000, handoverDate: '2026-01-01',
    ledgers: {
      ...empty,
      fees: [
        { date: '2026-02-01', description: 'Phone Call', exclVat: 25, vat: 3.75, billed: true },
        { date: '2026-02-02', description: 'Phone Call', exclVat: 0, vat: 0, billed: false },
      ],
    },
  })
  check('only charged fees reach the balance', b.fees, 28.75)
}

/*
 * In duplum: non-capital may not exceed the capital handed over. Here interest alone is double
 * the capital, so half of it is withheld and the balance stops at twice capital.
 */
{
  const b = computeBalance({
    capitalHandedOver: 1000, handoverDate: '2024-01-01', inDuplum: true,
    ledgers: { ...empty, interest: [{ from: '2024-06-01', days: 30, amount: 2000 }] },
  })
  check('in duplum: balance stops at twice the capital', b.balance, 2000)
  check('in duplum: the excess is reported, not hidden', b.withheld, 1000)
}

/* A written-off account stops accruing on the day it stopped. */
{
  const b = computeBalance({
    capitalHandedOver: 1000, handoverDate: '2024-01-01', writtenOffAt: '2024-06-30',
    ledgers: {
      ...empty,
      interest: [
        { from: '2024-06-01', days: 30, amount: 100 },
        { from: '2024-07-01', days: 30, amount: 100 },
      ],
    },
  })
  check('write-off: interest after the date is excluded', b.interest, 100)
  check('write-off: the excluded amount is reported', b.withheld, 100)
}

/*
 * The statement has to end where the balance says it does. If these ever disagree, one of the
 * two is lying to a debtor — and the statement is the document they are entitled to.
 */
{
  const input = {
    capitalHandedOver: 5000, handoverDate: '2026-01-01',
    ledgers: {
      payments: [{ date: '2026-03-01', amount: 1000 }, { date: '2026-05-01', amount: 500 }],
      fees: [
        { date: '2026-02-01', description: 'Letter', exclVat: 25, vat: 3.75, billed: true },
        { date: '2026-04-01', description: 'SMS', exclVat: 3.5, vat: 0.53, billed: true },
        { date: '2026-04-02', description: 'Phone Call', exclVat: 0, vat: 0, billed: false },
      ],
      interest: [{ from: '2026-02-01', days: 28, amount: 200 }],
    },
  }
  const s = buildStatement(input)
  const last = s.lines[s.lines.length - 1]
  check('the statement ends at the balance', last.balance, s.breakdown.balance)

  const debits = s.lines.reduce((t, l) => t + l.debit, 0)
  const credits = s.lines.reduce((t, l) => t + l.credit, 0)
  check('debits less credits equal the balance', debits - credits, s.breakdown.balance)

  const payments = s.lines.filter((l) => l.kind === 'payment').length
  const receiptFees = s.lines.filter((l) => l.kind === 'receipt-fee').length
  check('every payment carries its receipt fee line', receiptFees, payments)

  const dates = s.lines.map((l) => l.date)
  check('lines are in date order', [...dates].sort().join() === dates.join() ? 1 : 0, 1)
}

/*
 * Daily interest.
 *
 * The migrated book charges a flat 2% of the running balance a month — 24% a year over twelve
 * months, not 365 days — so a full month accrued day by day has to land on exactly that 2%, or
 * the running figure and the posted figure would disagree the moment the month closed. Every
 * expectation below was worked out by hand from that rule.
 */
{
  /* A full 30-day month is exactly 2%. */
  const full = accrueToDate({ openingBalance: 10000, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-09-30' })
  check('a full month accrues the flat monthly rate', full.amount, 200)
  check('a full month is 30 days in September', full.days, 30)

  /* February is shorter, and still exactly 2%: the rate is monthly, not daily. */
  const feb = accrueToDate({ openingBalance: 10000, annualRate: 24, coveredTo: '2026-01-31', asAt: '2026-02-28' })
  check('a short month accrues the same flat monthly rate', feb.amount, 200)
  check('February is 28 days', feb.days, 28)

  /* Part of a month is pro-rated: 7 of September's 30 days on R28,167.53. */
  const part = accrueToDate({ openingBalance: 28167.53, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-09-07' })
  check('a part month is pro-rated by days elapsed', part.amount, 131.45)
  check('1 to 7 September is 7 days', part.days, 7)

  /* One day moves the number. This is the whole point of the exercise. */
  const d1 = accrueToDate({ openingBalance: 10000, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-09-01' })
  const d2 = accrueToDate({ openingBalance: 10000, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-09-02' })
  check('one day of interest on R10,000', d1.amount, 6.67)
  check('the balance moves every day', d2.amount, 13.33)

  /* Crossing a month boundary capitalises, as the posted history does. */
  const across = accrueToDate({ openingBalance: 10000, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-10-31' })
  check('two months compound rather than add', across.amount, 404)

  /* Nothing to accrue is nothing, not zero-dressed-as-something. */
  check('a book already current accrues nothing',
    accrueToDate({ openingBalance: 10000, annualRate: 24, coveredTo: '2026-09-09', asAt: '2026-09-09' }) === null ? 1 : 0, 1)
  check('no rate accrues nothing',
    accrueToDate({ openingBalance: 10000, annualRate: 0, coveredTo: '2026-08-31', asAt: '2026-09-09' }) === null ? 1 : 0, 1)
  check('a settled account accrues nothing',
    accrueToDate({ openingBalance: 0, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-09-09' }) === null ? 1 : 0, 1)

  /* Swordfish stores `days` as an exclusive count: 1 August for 30 days covers to the 31st. */
  check('the covered day is the last day of the posted period',
    coveredTo([{ from: '2026-08-01', days: 30 }, { from: '2026-02-01', days: 27 }]) === '2026-08-31' ? 1 : 0, 1)
  check('a stub covers to its own end',
    coveredTo([{ from: '2026-09-01', days: 6 }]) === '2026-09-07' ? 1 : 0, 1)
}

/* The balance engine has to carry the accrual through to the settlement figure and the statement. */
{
  const base = {
    capitalHandedOver: 10000, handoverDate: '2026-08-01',
    interestRateAnnual: 24,
    ledgers: { payments: [], fees: [], interest: [{ from: '2026-08-01', days: 30, amount: 200 }] },
  }

  const posted = computeBalance(base)
  check('without accrueTo the book shows only what is posted', posted.interest, 200)
  check('and nothing is running', posted.interestAccruing, 0)

  /* 7 days of September on the closed balance of R10,200. */
  const live = computeBalance({ ...base, accrueTo: '2026-09-07' })
  check('with accrueTo the interest runs to today', live.interestAccruing, 47.6)
  check('the running figure is inside the interest total', live.interest, 247.6)
  check('and inside the balance', live.balance, 10247.6)
  // The receipt fee on a balance this size is at the R610 maximum, plus VAT.
  check('so the settlement moves with it', live.settlement, 10247.6 + 701.5)

  /* An account written off stopped accruing when it stopped. */
  const dead = computeBalance({ ...base, accrueTo: '2026-09-07', writtenOffAt: '2026-08-15' })
  check('a written-off account accrues nothing further', dead.interestAccruing, 0)

  /* In duplum caps the running figure with everything else, rather than sneaking past it. */
  const capped = computeBalance({
    capitalHandedOver: 100, handoverDate: '2024-01-01', inDuplum: true, interestRateAnnual: 24,
    accrueTo: '2026-09-30',
    ledgers: { payments: [], fees: [], interest: [{ from: '2026-08-01', days: 30, amount: 500 }] },
  })
  check('in duplum caps the running interest too', capped.balance, 200)

  const s = buildStatement({ ...base, accrueTo: '2026-09-07' })
  const running = s.lines.filter((l) => l.kind === 'interest-accruing')
  check('the statement shows the open period as one line', running.length, 1)
  check('dated today', running[0].date === '2026-09-07' ? 1 : 0, 1)
  check('the statement still ends at the balance', s.lines[s.lines.length - 1].balance, s.breakdown.balance)
}

/*
 * Where an interest line is dated, and what it says.
 *
 * Interest is earned across a period and posted at the close of it, which is where Swordfish puts
 * it and where a debtor looks for it. It used to be dated at the START of the period, which put
 * August's interest on 1 August, sorted it above the fees it had accrued on, and left a reissued
 * statement not matching the original.
 *
 * The count is Swordfish's exclusive offset rather than a number of days: 1 September for 6
 * covers to the 7th. It used to print as "6 days", which is the field read as if it meant what
 * it says, and is what made a debtor ask why September only had six days in it.
 */
{
  const line = (st, kind) => st.lines.find((l) => l.kind === kind)
  const acc = (from, days, amount) => ({ from, days, amount })
  const at = (asAt, interest) => buildStatement({
    capitalHandedOver: 5000, handoverDate: '2026-01-10', interestRateAnnual: 24, accrueTo: asAt,
    ledgers: { payments: [], fees: [], interest },
  })

  const posted = line(at('2026-09-09', [acc('2026-08-01', 30, 100)]), 'interest')
  check('a posted accrual is dated at the end of its period', posted.date === '2026-08-31' ? 1 : 0, 1)
  check('and names the period, not a day count', posted.description === 'Interest, 1 to 31 August' ? 1 : 0, 1)

  const stub = line(at('2026-09-09', [acc('2026-09-01', 6, 3.71)]), 'interest')
  check('the six-day September stub really covers seven days, to the 7th', stub.date === '2026-09-07' ? 1 : 0, 1)
  check('and says so', stub.description === 'Interest, 1 to 7 September' ? 1 : 0, 1)

  const crossing = line(at('2026-09-09', [acc('2026-07-20', 13, 9)]), 'interest')
  check('a period crossing a month names both', crossing.description === 'Interest, 20 July to 2 August' ? 1 : 0, 1)

  const oneDay = line(at('2026-09-09', [acc('2026-08-31', 0, 1)]), 'interest')
  check('a single day is not written as a range', oneDay.description === 'Interest, 31 August' ? 1 : 0, 1)

  /* Pull the statement mid-month and the days since the last posting are on the page, named. */
  const mid = at('2026-09-07', [acc('2026-08-01', 30, 100)])
  const open = line(mid, 'interest-accruing')
  check('a statement pulled on the 7th shows the days since the last posting', open.date === '2026-09-07' ? 1 : 0, 1)
  check('labelled with the period it covers', open.description === 'Interest, 1 to 7 September — still accruing' ? 1 : 0, 1)
  check('and the two lines meet without a gap or an overlap', mid.lines.filter((l) => l.kind.startsWith('interest')).length, 2)

  /* Where the posted stub already reaches the pull date there is nothing left running. */
  const covered = at('2026-09-07', [acc('2026-09-01', 6, 3.71)])
  check('nothing is still accruing when the posting already reaches the pull date',
    covered.lines.filter((l) => l.kind === 'interest-accruing').length, 0)
}

/*
 * In duplum binds the settlement fee too.
 *
 * The cap used to be applied to the balance and then abandoned one line later: the receipt fee
 * for settling was worked out on the capped balance and added on top, putting the figure the
 * debtor was actually quoted back above the ceiling. Non-capital may not exceed the capital, and
 * a receipt fee is non-capital.
 */
{
  const capped = {
    capitalHandedOver: 1000, handoverDate: '2024-01-01', inDuplum: true,
    ledgers: { payments: [], fees: [], interest: [{ from: '2024-02-01', days: 30, amount: 5000 }] },
  }
  const b = computeBalance(capped)
  check('in duplum: the balance stops at twice the capital', b.balance, 2000)
  check('in duplum: no room is left for a settlement fee', b.settlementFee, 0)
  check('in duplum: so settling costs the ceiling and no more', b.settlement, 2000)

  /* Part-way to the ceiling, only the part of the fee that still fits is charged. */
  const nearly = computeBalance({
    ...capped,
    ledgers: { payments: [], fees: [], interest: [{ from: '2024-02-01', days: 30, amount: 950 }] },
  })
  // R50 of headroom left under the R1,000 ceiling; the fee on R1,950 would be R224.25.
  check('near the ceiling: the fee is trimmed to the headroom', nearly.settlementFee, 50)
  check('near the ceiling: settlement lands exactly on the ceiling', nearly.settlement, 2000)

  /* An account not subject to in duplum is untouched by any of this. */
  const free = computeBalance({
    capitalHandedOver: 1000, handoverDate: '2024-01-01',
    ledgers: { payments: [], fees: [], interest: [{ from: '2024-02-01', days: 30, amount: 5000 }] },
  })
  // 10% of R6,000 is R600, still under the R610 maximum, so it is not the cap that applies here.
  check('without in duplum the fee is charged in full', free.settlementFee, 690)
  check('and the balance is not capped', free.balance, 6000)
}

console.log(failed === 0 ? '\nAll checks passed.\n' : `\n${failed} check(s) failed.\n`)
process.exit(failed ? 1 : 0)
