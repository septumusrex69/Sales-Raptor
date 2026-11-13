/**
 * INTEREST ONE MONTH AT A TIME ON THE STATEMENT (Raptor H19, R-30).
 *
 * Rinda (call centre), 10 Nov: "Interest should be added monthly as well as when a payment is allocated". Her screen
 * showed 3 April to 10 November as ONE interest line. Her follow-up, 12 Nov: interest as at the 31st of July, 31st of
 * August, 30th of September, 31st of October and today (part of the month); with a payment on 15 September, interest
 * up to the payment and then from it to the 30th.
 *
 * Stephan, 13 Nov: interest keeps running daily (worked out when it is looked at -- no job, nothing written); the
 * account page keeps the payment month in two pieces "for record keeping purposes or for double checking"; everything
 * the DEBTOR sees has "one entry line per month", so nobody thinks they were charged twice; and the last line is this
 * month to today ("Tomorrow it'll show the 1st to the 14th").
 *
 * Held here:
 *   - accrueToDate's months add up to its amount to the cent, one per calendar month;
 *   - the account page's statement shows the open period month by month, dated at each month's end, the last dated
 *     today and alone in saying "still accruing";
 *   - a period posted at a payment that runs across months is drawn month by month too, adding up to what was posted,
 *     and falls back to one line where its months cannot be worked out honestly;
 *   - the debtor's statement (statementOfAccount, which every debtor-facing statement is drawn through) joins the
 *     payment month into one line; the foot and the total interest do not move.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-interest-monthly.mjs
 */
import { accrueToDate } from '../../src/lib/interestAccrual.ts'
import { buildStatement, oneInterestLinePerMonth } from '../../src/lib/accountBalance.ts'
import { statementOfAccount } from '../../src/lib/accountSummaryLetter.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, !!v, true)
const cents = (n) => Math.round(n * 100) / 100
const sum = (xs) => cents(xs.reduce((t, x) => t + x, 0))
const isInterest = (l) => l.kind === 'interest' || l.kind === 'interest-accruing'

/* ---------------- the engine hands back its months ---------------- */
{
  const a = accrueToDate({ openingBalance: 10000, annualRate: 24, coveredTo: '2026-07-14', asAt: '2026-11-13' })
  check('one piece per calendar month, part-months at both ends',
    a.months.map((m) => [m.from, m.to]),
    [['2026-07-15', '2026-07-31'], ['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-13']])
  check('the months add up to the amount to the cent', sum(a.months.map((m) => m.amount)), a.amount)
  /* A whole month is the flat 2% of the balance it opened on (interestAccrual's own convention). */
  const july = cents(10000 * 0.02 * 17 / 31)
  check('July (15th to 31st) is 17/31 of 2% of R10 000', a.months[0]?.amount, july)
  check('August is 2% of the balance after July joined it', a.months[1].amount, cents((10000 + 10000 * 0.02 * 17 / 31) * 0.02))
  const odd = accrueToDate({ openingBalance: 1234.57, annualRate: 21.5, coveredTo: '2025-12-02', asAt: '2026-11-13' })
  check('...and still to the cent on an awkward balance and rate over a year', sum(odd.months.map((m) => m.amount)), odd.amount)
}

/* ---------------- the account page: the open period month by month ---------------- */
const base = { capitalHandedOver: 10000, handoverDate: '2026-07-15', interestRateAnnual: 24, accrueTo: '2026-11-13' }
{
  const st = buildStatement({ ...base, ledgers: { payments: [], fees: [], interest: [] } })
  const lines = st.lines.filter(isInterest)
  check('no payment: one interest line for each month since the handover', lines.length, 5)
  check('each dated at the month\'s end, the last dated today', lines.map((l) => l.date),
    ['2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-13'])
  check('named by the days they cover', lines.map((l) => l.description), [
    'Interest, 15 to 31 July', 'Interest, 1 to 31 August', 'Interest, 1 to 30 September', 'Interest, 1 to 31 October',
    'Interest, 1 to 13 November — still accruing',
  ])
  check('only today\'s month says it is still accruing', lines.filter((l) => /still accruing/.test(l.description)).length, 1)
  check('the lines add up to the interest running', sum(lines.map((l) => l.debit)), st.breakdown.interestAccruing)
  check('and the statement still ends at the balance', st.lines[st.lines.length - 1].balance, st.breakdown.balance)
  /* "Tomorrow it'll show the 1st to the 14th." */
  const tomorrow = buildStatement({ ...base, accrueTo: '2026-11-14', ledgers: { payments: [], fees: [], interest: [] } })
  check('tomorrow the last line runs to the 14th', tomorrow.lines.filter(isInterest).at(-1)?.description, 'Interest, 1 to 14 November — still accruing')
}

/* ---------------- a payment on 15 September ---------------- */
/* allocate_payment posted everything from the handover to the payment day, with the payment itself left out
   (open_interest is called excluding it): one row, 15 July to 15 September. The engine's own figure is what it holds. */
const posted = accrueToDate({ openingBalance: 10000, annualRate: 24, coveredTo: '2026-07-14', asAt: '2026-09-15' }).amount
const paidLedgers = {
  payments: [{ id: 'p1', date: '2026-09-15', amount: 2000, receiptFeeExclVat: 0 }],
  fees: [],
  interest: [{ from: '2026-07-15', days: 62, amount: posted }],
}
const paid = buildStatement({ ...base, ledgers: paidLedgers })
{
  const lines = paid.lines.filter(isInterest)
  check('the posted period is drawn month by month, then the open period after the payment',
    lines.map((l) => [l.kind, l.description]), [
      ['interest', 'Interest, 15 to 31 July'], ['interest', 'Interest, 1 to 31 August'], ['interest', 'Interest, 1 to 15 September'],
      ['interest-accruing', 'Interest, 16 to 30 September'], ['interest-accruing', 'Interest, 1 to 31 October'],
      ['interest-accruing', 'Interest, 1 to 13 November — still accruing'],
    ])
  /* MONTH BY MONTH THE SAME AS THE ENGINE THAT POSTED IT, not merely the same total: open_interest left the payment it
     was posted for out of the period, so the payment's own day still bore interest on the balance before it. Counting
     the payment in moves cents from September into July and August while the total is scaled back to what was posted. */
  check('each posted month is the month the engine worked out',
    lines.filter((l) => l.kind === 'interest').map((l) => l.debit),
    accrueToDate({ openingBalance: 10000, annualRate: 24, coveredTo: '2026-07-14', asAt: '2026-09-15' }).months.map((m) => m.amount))
  check('the posted months add up to exactly what was posted', sum(lines.filter((l) => l.kind === 'interest').map((l) => l.debit)), posted)
  ok('the account page keeps September in two pieces, either side of the payment',
    lines.filter((l) => l.date.startsWith('2026-09')).length === 2)
  const payAt = paid.lines.findIndex((l) => l.kind === 'payment')
  ok('...with the payment between them', payAt > paid.lines.findIndex((l) => l.description === 'Interest, 1 to 15 September')
    && payAt < paid.lines.findIndex((l) => l.description === 'Interest, 16 to 30 September'))
  check('and the statement still ends at the balance', paid.lines.at(-1)?.balance, paid.breakdown.balance)
}

/* ---------------- what the debtor sees: one line a month ---------------- */
{
  const debtor = oneInterestLinePerMonth(paid.lines)
  const lines = debtor.filter(isInterest)
  check('the debtor reads one interest line a month', lines.map((l) => l.description), [
    'Interest, 15 to 31 July', 'Interest, 1 to 31 August', 'Interest, 1 to 30 September', 'Interest, 1 to 31 October',
    'Interest, 1 to 13 November — still accruing',
  ])
  const sep = lines.find((l) => l.description === 'Interest, 1 to 30 September')
  check('September is both pieces added', sep?.debit,
    sum(paid.lines.filter((l) => isInterest(l) && l.date.startsWith('2026-09')).map((l) => l.debit)))
  check('...dated at the month\'s end', sep?.date, '2026-09-30')
  check('the total interest does not move', sum(lines.map((l) => l.debit)), sum(paid.lines.filter(isInterest).map((l) => l.debit)))
  check('nor does the foot', debtor.at(-1)?.balance, paid.breakdown.balance)
  check('every running balance is the lines above it', debtor.every((l, i) =>
    l.balance === cents(debtor.slice(0, i + 1).reduce((t, x) => t + x.debit - x.credit, 0))), true)
  check('a statement with nothing to join is left as it was', oneInterestLinePerMonth(buildStatement({ ...base, ledgers: { payments: [], fees: [], interest: [] } }).lines).filter(isInterest).length, 5)

  /* THROUGH THE DOCUMENT every debtor-facing statement is drawn by (Documents button, portal, reminder). */
  const doc = JSON.stringify(statementOfAccount({
    breakdown: paid.breakdown, handedOver: 10000, asAt: '2026-11-13', money: (n) => `R${n.toFixed(2)}`, lines: paid.lines, status: null,
  }))
  ok('the debtor\'s statement PDF shows September as one line', doc.includes('Interest, 1 to 30 September'))
  ok('...and not the two pieces', !doc.includes('Interest, 1 to 15 September') && !doc.includes('Interest, 16 to 30 September'))
  ok('...and this month to today', doc.includes('Interest, 1 to 13 November'))
}

/* ---------------- where the months cannot be worked out honestly, one line as before ---------------- */
{
  /* A posted figure nowhere near what the account's own history gives (a rate changed since, say). */
  const odd = buildStatement({ ...base, ledgers: { payments: [], fees: [], interest: [{ from: '2026-07-15', days: 62, amount: 50 }] } })
  check('a posted period whose months would be a guess stays one line', odd.lines.filter((l) => l.kind === 'interest').map((l) => l.description),
    ['Interest, 15 July to 15 September'])
  /* An imported Swordfish month is inside one month already. */
  const sw = buildStatement({ ...base, ledgers: { payments: [], fees: [], interest: [{ from: '2026-08-01', days: 30, amount: 200 }] } })
  check('an imported month is untouched', sw.lines.filter((l) => l.kind === 'interest').map((l) => [l.date, l.debit]), [['2026-08-31', 200]])
}

console.log(`check-interest-monthly: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
