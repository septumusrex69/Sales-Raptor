/**
 * WHAT AN INSTALMENT ACTUALLY DOES TO A DEBT, AND WHAT A COLLECTOR IS TOLD ABOUT IT.
 *
 * THE FIRM ASKED FOR THIS BESIDE THE PROMISE TO PAY: "the guy owes 10 000 rand, he wants to pay
 * 500 rand a month, take into account interest... how long will it take him?"
 *
 * THE NUMBER GOES TO A DEBTOR, WHICH IS WHY IT IS CHECKED THIS HARD. A collector reads it down the
 * phone and an arrangement is agreed on it; quoted short, the firm has told somebody their account
 * clears in twenty months when it clears in thirty-one, and the arrangement they signed was built
 * on it. Every failure below was real in a first cut of this file:
 *
 *   - INTEREST COUNTED GROSS RATHER THAN CHARGED. In duplum caps what is recoverable, and totalling
 *     the raw accrual quoted R49 331 of interest on a debt whose ceiling is R10 000.
 *   - "NOTHING IS MOVING" MEASURED INSIDE A PERIOD. Every payment reduces the balance the instant it
 *     lands, so the test passed while the next month's interest put more back -- it reported that
 *     R100 a month settles a debt growing by two hundred a month.
 *   - "NEVER" SAID OF AN ACCOUNT IN DUPLUM, where the debt stops growing at the ceiling and does
 *     settle, sixteen years later. A lie a debtor could disprove by paying.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-repayment-plan.mjs
 */
import {
  MAX_INSTALMENTS, NO_FURTHER_FEES, instalmentToSettleIn, minimumInstalment, repaymentPlan,
} from '../../src/lib/repaymentPlan.ts'
import { computeBalance } from '../../src/lib/accountBalance.ts'
import { coveredTo } from '../../src/lib/interestAccrual.ts'
import { receiptFeeInclVat } from '../../src/lib/annexureB.ts'
import { SLOW_PAYING_FROM } from '../../src/lib/ptpSchedule.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const near = (name, actual, expected, tol = 0.02) => {
  if (Math.abs(actual - expected) <= tol) { pass += 1; return }
  failures.push(`${name}\n    expected ${expected} +/- ${tol}\n    got      ${actual}`)
}

/*
 * THE FIRM'S OWN EXAMPLE, as the real book looks: capital handed over, a posted monthly accrual to
 * run the open period from, 2% a month, in duplum on. The posted accrual matters -- openAccrual
 * needs a covered day and an account with none accrues nothing however high its rate.
 */
const account = (over = {}) => ({
  capitalHandedOver: 10000,
  handoverDate: '2026-09-01',
  ledgers: { payments: [], fees: [], interest: [{ from: '2026-09-01', days: 29, amount: 200 }] },
  inDuplum: true,
  interestRateAnnual: 24,
  vatRate: 0.15,
  ...over,
})
const monthly = (over = {}) => ({
  arrangement: 'monthly', dueOn: '2026-10-05', dayOfMonth: 5, onLastDay: false, dayOfWeek: null, ...over,
})
const plan = (instalment, acc = account(), schedule = monthly(), over = {}) =>
  repaymentPlan({ account: acc, instalment, schedule, ...over })

/* ---------- the offer on the table ---------- */

const five = plan(500)
check('R500 a month on R10 200 settles', five.outcome, 'settles')
check('...in 31 instalments', five.rows.length, 31)
check('...on 5 August 2029', five.settlesOn, '2029-04-05')
/*
 * AND THE TOTAL IS THE SENTENCE THAT CHANGES THE CONVERSATION. R500 a month is not R10 200 over
 * twenty months; it is R15 267 over thirty-one, because R200 of the first payment is interest
 * before anything touches the debt and item 9 takes R57.50 more.
 */
near('...costing R15 267 in all', five.totalPaid, 15267.01)
near('...of which R3 314 is interest', five.totalInterest, 3314.47)
near('...and R1 752 receipt fees', five.totalReceiptFees, 1752.54)

/*
 * THE PARTS OF EVERY ROW ADD UP TO THE WHOLE, which is the arithmetic a debtor is entitled to
 * check: what they hand over is interest, plus the receipt fee, plus what comes off the debt.
 */
for (const r of five.rows) {
  near(`row ${r.no} adds up`, r.interest + r.receiptFee + r.offDebt, r.amount, 0.011)
}
/* AND THE SCHEDULE ADDS UP TO THE DEBT. Everything paid, less what went on interest and fees, is
   the balance the account started with -- the one figure the whole projection is about. */
near('the schedule clears exactly what was owed',
  five.totalPaid - five.totalInterest - five.totalReceiptFees,
  computeBalance({ ...account(), accrueTo: null }).balance, 0.05)
check('...and nothing is left on it', five.leftOwing, 0)

/*
 * THE FIRST ROW IS A PART MONTH AND THE SECOND IS A WHOLE ONE. Interest runs from the day after the
 * last posted accrual, so an arrangement starting on the 5th picks up five days first -- and if
 * this ever became a full month the whole schedule would be quoting a month of interest nobody had
 * accrued yet.
 */
near('the first period is the days since the last posting', five.rows[0].interest, 32.90, 0.05)
near('...and the second is a full month on what is left', five.rows[1].interest, 197.41, 0.05)
/* INTEREST FALLS AS THE DEBT DOES, which is the whole shape of an amortising arrangement and the
   thing a flat "2% of the original" would get wrong. */
ok('interest falls as the balance falls', five.rows[2].interest < five.rows[1].interest)
ok('...and the last row charges least of all',
  five.rows[five.rows.length - 1].interest < five.rows[1].interest)
/* THE BALANCE FALLS EVERY MONTH, never sideways and never up. */
ok('the balance falls on every row of a working arrangement',
  five.rows.every((r, i) => i === 0 || r.balanceAfter < five.rows[i - 1].balanceAfter))

/* ---------- the last payment settles, it does not merely pay the balance ---------- */

/*
 * SETTLING COSTS THE BALANCE PLUS ITEM 9 ON IT. A final instalment that paid only the balance would
 * leave the debtor a receipt fee short and the account open on a few rand -- which is exactly the
 * kind of residue that turns a kept arrangement into a broken one.
 */
const last = five.rows[five.rows.length - 1]
check('the final payment closes the account', last.balanceAfter, 0)
ok('...and is smaller than the instalment', last.amount < 500)
/*
 * AND NO PAYMENT ANYWHERE IS EVER MORE THAN THE DEBTOR AGREED TO. The invariant that catches the
 * version of this that settles against the BALANCE instead of the settlement figure: where the
 * balance is just under the offer and the fee for settling puts it just over, that version quotes
 * a final instalment ABOVE the arrangement -- the debtor promised R500 and is asked for R535.
 * Swept across offers because the boundary is a narrow one and lands on a different row each time;
 * a single offer passed on the broken code, which is how this assertion came to exist.
 */
for (const offer of [300, 400, 500, 600, 750, 900, 1100, 1500, 2000, 3000]) {
  const p = plan(offer)
  ok(`no payment at R${offer} exceeds what was agreed`,
    p.rows.every((r) => r.amount <= offer + 0.001))
}
near('...being the balance plus the fee for settling it',
  last.receiptFee, receiptFeeInclVat(last.amount - last.receiptFee, 0.15), 0.05)

/* ---------- a payment that does not cover the interest ---------- */

/*
 * THE ANSWER A COLLECTOR NEEDS MOST. At 2% a month R10 200 charges R204 before anything else, so
 * R150 never touches the debt -- and the first cut of this said it settled, because it measured
 * the balance inside the period rather than from one period to the next.
 */
const small = plan(150, account({ inDuplum: false }))
check('R150 a month on R10 200 never settles', small.outcome, 'never')
ok('...and says why', small.belowTheInterest)
ok('...stopping rather than walking ten years to prove it', small.rows.length <= 3)
/* BIGGER THAN WHERE THE LAST PAYMENT LEFT IT, which is the comparison that means anything -- not
   bigger than the opening balance, because the first period is only the few days since the last
   posting and a single payment does dent it. Found by this assertion failing on right code. */
ok('...with the debt bigger than where the last payment left it',
  small.leftOwing > small.rows[0].balanceAfter)
/*
 * AND IT NAMES THE FLOOR, which is a floor and not a counter-offer: interest is pro-rated by days
 * in the calendar month, so an amount sitting exactly on this line stalls in a short month. What
 * is asserted is the only thing that is certainly true of it -- BELOW it, nothing moves.
 */
ok('...and names the floor', small.minimumInstalment >= 226 && small.minimumInstalment <= 240)
for (const under of [1, 6, 20, 50]) {
  check(`R${under} below the floor never moves`,
    plan(small.minimumInstalment - under, account({ inDuplum: false })).outcome, 'never')
}
/* The floor is not sold as an answer: what to ask for is instalmentToSettleIn, below. */

/*
 * IN DUPLUM CHANGES THE VERDICT WITHOUT CHANGING THE FACT. The debt climbs to the ceiling, interest
 * stops, and every payment above its own receipt fee then chips at it -- so it does settle,
 * eventually. "Never" there would be a lie a debtor could disprove by paying.
 */
const capped = plan(150)
check('the same offer under in duplum is not called never', capped.outcome, 'not_within')
ok('...but still says the payment does not cover the interest', capped.belowTheInterest)
ok('...and that the ceiling was reached', capped.hitInDuplum)
/*
 * AND THE INTEREST QUOTED IS WHAT IS CHARGED, NOT WHAT ACCRUED. The ceiling is the capital handed
 * over, so non-capital can never exceed R10 000 however long this runs. Totalling the raw accrual
 * put R49 331 on this schedule.
 */
ok(`the interest quoted stays under the in duplum ceiling (${capped.totalInterest})`,
  capped.totalInterest <= 10000)
ok('...and the receipt fees with it', capped.totalInterest + capped.totalReceiptFees <= 10000.01)

/* ---------- the horizon ---------- */

check('it does not walk further than the horizon', capped.rows.length, MAX_INSTALMENTS)
check('...which is ten years of monthly payments', MAX_INSTALMENTS, 120)
ok('...and says what is still owing at the end of it', capped.leftOwing > 0)
/* A CALLER MAY SHORTEN IT, which is what keeps this check quick, and may not lengthen it. */
check('a caller can shorten the horizon', plan(500, account(), monthly(), { maxInstalments: 5 }).rows.length, 5)
check('...but not lengthen it past the cap',
  plan(150, account(), monthly(), { maxInstalments: 9999 }).rows.length, MAX_INSTALMENTS)

/* ---------- a once-off is one payment, not a short arrangement ---------- */

const once = plan(2000, account(), monthly({ arrangement: 'once_off' }))
check('a once-off that does not settle leaves a balance', once.outcome, 'not_within')
check('...after exactly one payment', once.rows.length, 1)
ok('...and says what is left', once.leftOwing > 8000)
check('a once-off that does settle settles',
  plan(20000, account(), monthly({ arrangement: 'once_off' })).outcome, 'settles')

/* ---------- interest that is not running is said out loud ---------- */

/*
 * A ZERO HAS TWO MEANINGS AND ONLY ONE OF THEM IS SAFE. An account with no rate produces a schedule
 * with no interest in it, which is correct and reads exactly like a schedule where the interest was
 * forgotten. A quotation that silently omits interest is one the debtor can hold the firm to.
 */
ok('an account that is accruing says so', five.interestRunning)
const noRate = plan(500, account({ interestRateAnnual: 0 }))
ok('an account with no rate says it is not accruing', !noRate.interestRunning)
check('...and charges none', noRate.totalInterest, 0)
/* NOR CAN IT ACCRUE WITH NOTHING POSTED TO RUN FROM, whatever the rate says -- openAccrual needs a
   covered day, so this is a real zero too and must read as one. */
const noPosting = plan(500, account({ ledgers: { payments: [], fees: [], interest: [] } }))
ok('an account with nothing posted says it is not accruing', !noPosting.interestRunning)
check('...and charges none either', noPosting.totalInterest, 0)

/* ---------- the periods do not drift ---------- */

/*
 * THE OFF-BY-ONE THAT WOULD HAVE MOVED EVERY DATE. `interestAccruingDays` counts BOTH ends of the
 * open period; a POSTED row's days is exclusive, so that from + days is the last day covered. Post
 * the open figure unchanged and every projected period covers a day into the next -- the schedule
 * quietly shortens and the debtor is quoted a settlement date that is wrong by a month by the end.
 *
 * CHECKED BY REBUILDING THE LEDGER THE PROJECTION WOULD HAVE BUILT and asking coveredTo where it
 * lands: it must be the instalment date itself, never the day after.
 */
{
  const led = { payments: [], fees: [], interest: [{ from: '2026-09-01', days: 29, amount: 200 }] }
  const b = computeBalance({ ...account(), ledgers: led, accrueTo: '2026-10-05' })
  led.interest.push({ from: b.interestAccruingFrom, days: Math.max(0, b.interestAccruingDays - 1), amount: b.interestAccruing })
  check('a posted period covers up to the instalment date and no further',
    coveredTo(led.interest), '2026-10-05')
  /* And the naive version, kept so the check fails if somebody "fixes" it back. */
  const naive = [{ from: '2026-09-01', days: 29, amount: 200 },
    { from: b.interestAccruingFrom, days: b.interestAccruingDays, amount: b.interestAccruing }]
  check('...where the uncorrected count would run a day over', coveredTo(naive), '2026-10-06')
}
/* The dates on the rows are the arrangement's own, walked by nextDueDate -- so the schedule a
   debtor is quoted is the schedule the arrangement will actually run. */
check('the rows carry the arrangement’s own dates',
  five.rows.slice(0, 4).map((r) => r.dueOn),
  ['2026-10-05', '2026-11-05', '2026-12-05', '2027-01-05'])

/* ---------- what it would take to settle in six ---------- */

/*
 * THE OTHER HALF OF THE CONVERSATION. Six is the number that matters: the firm's own letters tell
 * the debtor that an arrangement running longer is reported to the bureaus as slow paying.
 */
const six = instalmentToSettleIn({ account: account(), schedule: monthly() }, 6)
ok(`six payments would be about R2 020 (${six})`, six >= 1950 && six <= 2100)
check('...and that amount really does settle in six',
  plan(six).outcome === 'settles' && plan(six).rows.length <= 6, true)
/*
 * EXACT TO THE RAND, which is what makes it a number to read out rather than an estimate: one rand
 * less must not settle in six.
 */
check('...while a rand less does not',
  plan(six - 1, account(), monthly(), { maxInstalments: 6 }).outcome === 'settles', false)
for (const n of [1, 3, 12, 24]) {
  const r = instalmentToSettleIn({ account: account(), schedule: monthly() }, n)
  const p = plan(r, account(), monthly(), { maxInstalments: n })
  ok(`settling in ${n} at R${r} works`, p.outcome === 'settles' && p.rows.length <= n)
  check(`...and a rand less does not`,
    plan(r - 1, account(), monthly(), { maxInstalments: n }).outcome === 'settles', false)
}
/* PAYING SLOWLY COSTS MORE, and the figures have to show it or the screen is not worth reading. */
ok('a longer arrangement costs the debtor more',
  plan(instalmentToSettleIn({ account: account(), schedule: monthly() }, 24)).totalPaid
  > plan(six).totalPaid)

/* ---------- what the screen must say beside the figures ---------- */

ok('the slow paying warning fires past six instalments', five.readsAsSlowPaying)
check('...on the firm’s own threshold', SLOW_PAYING_FROM, 7)
ok('...and not on a short one',
  !plan(instalmentToSettleIn({ account: account(), schedule: monthly() }, 6)).readsAsSlowPaying)
/* THE ASSUMPTION GOES WITH THE NUMBER, because the firm chose it and a debtor is entitled to it. */
ok('the assumption says no further collection fees', /no further collection fees/i.test(five.assumption))
ok('...and that the receipt fee is still charged', /receipt fee on each payment/i.test(five.assumption))
check('...and it is the same sentence everywhere', five.assumption, NO_FURTHER_FEES)

/* ---------- the floor, on its own ---------- */

check('no balance needs no instalment', minimumInstalment(0, 24), 0)
check('no rate needs no floor', minimumInstalment(10000, 0), 0)
near('R10 000 at 24% needs about R226', minimumInstalment(10000, 24), 226, 0.5)
ok('...and a bigger debt needs more', minimumInstalment(20000, 24) > minimumInstalment(10000, 24))
ok('...and a higher rate needs more', minimumInstalment(10000, 36) > minimumInstalment(10000, 24))
/* Rounded UP to the rand: it is read out over a telephone, and R225.42 invites an offer of R225. */
check('the floor is a whole rand', minimumInstalment(10000, 24) % 1, 0)

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-repayment-plan: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
