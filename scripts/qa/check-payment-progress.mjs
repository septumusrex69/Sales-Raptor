/**
 * How far through a debt a paying debtor is — the one arithmetic behind every bar.
 *
 * THE FIRM asked for it on the account, on the section 129, on the reports and on the invoices.
 * Three renderers computing "how much is paid off" separately is three chances to tell one person
 * a different number from another — and the two who would compare them are the client and the
 * debtor.
 *
 * WHAT IS WORTH CHECKING is the arithmetic at its edges, because that is where a bar lies:
 * against the wrong denominator, past its own end, rounded to 100 short of it, or drawn full on
 * an empty ledger.
 *
 * Run: node --experimental-strip-types scripts/qa/check-payment-progress.mjs
 */
import { readFileSync } from 'node:fs'
import {
  hasProgress, instalmentProgress, moneyProgress, progressPercent,
} from '../../src/lib/paymentProgress.ts'
import { instalmentsDue } from '../../src/lib/arrangements.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass += 1
  else failures.push(`${name}\n    expected ${e}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------- the money ---------- */

const m = moneyProgress({ payments: 4200, balance: 8280 })
check('what has come in', m.recovered, 4200)
check('what is still owed', m.owed, 8280)
/*
 * CHARGED IS RECOVERED PLUS OWED, not the capital handed over, and the difference matters on
 * every account that has run a while. An account handed over at R12 480 that has accrued R3 000
 * of interest and R600 of fees has been charged R16 080; measured against the CAPITAL, a debtor
 * who has paid R12 480 reads as fully settled while still owing R3 600.
 */
check('...and what the account has been charged in total', m.charged, 12480)
check('...as a fraction', Math.round(m.fraction * 1000) / 1000, 0.337)

/*
 * MONOTONIC IN THE RIGHT DIRECTION, both ways. A payment raises recovered and lowers owed by the
 * same amount, so the bar advances. Interest raises owed alone, so it retreats -- which is true,
 * and is the thing a debtor paying the minimum needs to see.
 */
ok('a payment advances the bar',
  moneyProgress({ payments: 5200, balance: 7280 }).fraction > m.fraction)
ok('...and interest accruing moves it back',
  moneyProgress({ payments: 4200, balance: 9280 }).fraction < m.fraction)

/* NEVER PAST ITS OWN END. An overpayment awaiting refund would otherwise draw past 100%. */
check('an overpayment does not draw past the end',
  moneyProgress({ payments: 13000, balance: 0 }).fraction, 1)
/* NEVER BELOW NOUGHT. A credit balance would otherwise draw a negative bar. */
check('a credit balance does not draw backwards',
  moneyProgress({ payments: 500, balance: -200 }).fraction, 1)
check('...and reports nothing owed rather than a negative',
  moneyProgress({ payments: 500, balance: -200 }).owed, 0)

/*
 * AN EMPTY LEDGER IS NOT A SETTLED ONE. 0/0 drawn as 100% would be a full green bar on an
 * account with no capital on it, which is the worst possible thing for it to say.
 */
check('nothing charged is no progress, not full progress',
  moneyProgress({ payments: 0, balance: 0 }).fraction, 0)
check('nothing paid is nought', moneyProgress({ payments: 0, balance: 12480 }).fraction, 0)

/* ---------- what it says beside itself ---------- */

check('a third reads as a third', progressPercent(moneyProgress({ payments: 4160, balance: 8320 })), 33)
check('paid in full reads as full', progressPercent(moneyProgress({ payments: 12480, balance: 0 })), 100)
/*
 * NEVER ROUNDED TO 100 SHORT OF IT. R12 479 of R12 480 is 99.99%, and a notice telling somebody
 * they have paid 100% while demanding a rand is the kind of thing that gets read out in court.
 */
check('a rand short is not "paid in full"',
  progressPercent(moneyProgress({ payments: 12479, balance: 1 })), 99)
/* And nor is a rand paid nothing: a debtor who has started must not read as one who has not. */
check('a rand paid is not "nothing"',
  progressPercent(moneyProgress({ payments: 1, balance: 12479 })), 1)
check('nothing paid really is nothing',
  progressPercent(moneyProgress({ payments: 0, balance: 12480 })), 0)

/* ---------- the instalments ---------- */

/*
 * HOW MANY INSTALMENTS IS DERIVED, and rounded UP: an arrangement of R1 000 at R300 a month is
 * four payments, not three and a third, and a debtor who has made three has not finished.
 */
const run = instalmentProgress({
  amount: 300, totalPromised: 1000, instalmentsKept: 2, arrangement: 'monthly', due: 3,
})
check('the instalments are counted off the arrangement', run?.planned, 4)
check('...how many were kept', run?.kept, 2)
check('...how many are due and unpaid', run?.missed, 1)
check('...and how many are still to come', run?.toCome, 1)

/*
 * PAYING EARLY IS NOT A NEGATIVE NUMBER OF MISSED INSTALMENTS. Somebody who has paid four of four
 * with three due is ahead, and clamped it reads as nought missed rather than minus one.
 */
const early = instalmentProgress({
  amount: 300, totalPromised: 1000, instalmentsKept: 4, arrangement: 'monthly', due: 3,
})
check('paying ahead is nought missed', early?.missed, 0)
check('...and nothing left to come', early?.toCome, 0)

/* A once-off is ONE instalment whatever the totals say -- there is no schedule to divide. */
check('a once-off is one instalment',
  instalmentProgress({ amount: 5000, totalPromised: 5000, instalmentsKept: 0, arrangement: 'once_off', due: 1 })?.planned, 1)
/* An arrangement with no total agreed is at least the one instalment in front of you. */
check('an arrangement with no total is still one instalment',
  instalmentProgress({ amount: 300, totalPromised: null, instalmentsKept: 0, arrangement: 'monthly', due: 0 })?.planned, 1)
/* No instalment amount is no arrangement: there is nothing to divide and nothing to keep. */
check('no instalment amount is no instalment run',
  instalmentProgress({ amount: 0, totalPromised: 1000, instalmentsKept: 0, arrangement: 'monthly', due: 0 }), null)
/* Kept can never exceed planned, whatever a stale counter says. */
check('kept is bounded by the arrangement',
  instalmentProgress({ amount: 300, totalPromised: 900, instalmentsKept: 99, arrangement: 'monthly', due: 3 })?.kept, 3)

/* ---------- whether to draw it at all ---------- */

/*
 * NOTHING PAID IS NOT PROGRESS. An empty bar on every account in the book is a thing people stop
 * seeing, and on a section 129 it would be a graphic whose message is "you have paid nothing" --
 * which the notice already says in words, twice, and better.
 */
ok('an account that has paid something has progress to show',
  hasProgress({ money: moneyProgress({ payments: 100, balance: 12380 }), instalments: null }))
check('an account that has paid nothing has none',
  hasProgress({ money: moneyProgress({ payments: 0, balance: 12480 }), instalments: null }), false)
/* But an arrangement being KEPT is progress even before the first payment clears. */
ok('...unless an instalment has been kept',
  hasProgress({
    money: moneyProgress({ payments: 0, balance: 12480 }),
    instalments: instalmentProgress({ amount: 300, totalPromised: 900, instalmentsKept: 1, arrangement: 'monthly', due: 1 }),
  }))

/* ---------- how many have actually fallen due ---------- */

/*
 * COUNTED FROM THE SCHEDULE, never from a flag. An arrangement taken in June at R300 a month has
 * had four instalments due by October whatever anybody has recorded against it -- and a count
 * that waited to be told would report a debtor as current on the very day they stopped paying,
 * which is the day it matters.
 */
const monthly = (over = {}) => ({
  arrangement: 'monthly', dueOn: '2026-06-25', dayOfMonth: 25, onLastDay: false, dayOfWeek: null, ...over,
})
check('an instalment due today is due', instalmentsDue(monthly(), '2026-06-25'), 1)
check('...and one due tomorrow is not', instalmentsDue(monthly(), '2026-06-24'), 0)
check('four months later, four are due', instalmentsDue(monthly(), '2026-09-25'), 4)
check('...and the day before the fourth, three are', instalmentsDue(monthly(), '2026-09-24'), 3)

/*
 * WALKED WITH nextDueDate RATHER THAN DIVIDED BY 30. An instalment arrangement is a date in the
 * month, not an interval: the last day is the 28th in February and the 31st in March. Dividing
 * drifts, and a drifting count is one the debtor is right to argue about.
 */
const lastDay = monthly({ dueOn: '2026-01-31', dayOfMonth: null, onLastDay: true })
check('the last day of the month does not drift', instalmentsDue(lastDay, '2026-02-28'), 2)
check('...and does not count February twice', instalmentsDue(lastDay, '2026-02-27'), 1)
/* The 31st clamps into a 30-day month and comes back out again -- it must not slide to the 1st. */
const thirtyFirst = monthly({ dueOn: '2026-03-31', dayOfMonth: 31, onLastDay: false })
check('a 31st in a 30-day month is still one instalment', instalmentsDue(thirtyFirst, '2026-04-30'), 2)
check('...and not two', instalmentsDue(thirtyFirst, '2026-04-29'), 1)

const weekly = { arrangement: 'weekly', dueOn: '2026-09-01', dayOfMonth: null, onLastDay: false, dayOfWeek: 2 }
check('a weekly arrangement counts weeks', instalmentsDue(weekly, '2026-09-22'), 4)

/* A ONCE-OFF IS ONE, and is answered before the walk -- nextDueDate returns null for it, and a
   loop waiting for a date that never comes is a page that never renders. */
check('a once-off is one instalment due', instalmentsDue({ ...monthly(), arrangement: 'once_off' }, '2027-01-01'), 1)
check('...and none before its day',
  instalmentsDue({ ...monthly(), arrangement: 'once_off' }, '2026-06-01'), 0)

/* BOUNDED. A long-running weekly arrangement must return rather than walk for ever. */
ok('a five-year weekly arrangement still answers',
  instalmentsDue(weekly, '2031-09-22') > 200)

/* ---------- and it is on the account page ---------- */

const detail = readFileSync(new URL('../../src/pages/accounts/AccountDetail.tsx', import.meta.url), 'utf8')
/*
 * THE MONEY HALF COMES OFF THE BALANCE, so the bar cannot disagree with the figures printed
 * above it. `payments` and `balance` are the same two the statement shows; the bar is their ratio
 * rather than a second opinion about the account.
 */
ok('the bar is the ratio of the figures beside it',
  /moneyProgress\(\{ payments: bal\.payments, balance: bal\.balance \}\)/.test(detail))
/*
 * AND THE HOOK IS ABOVE THE EARLY RETURNS. Placed beside the panel it feeds -- which is after the
 * `loading` branch -- it ran on some renders and not others; React refuses that outright, the
 * whole account screen threw, and the browser check found the page empty. Lint catches it too,
 * and this says why so the next person does not move it back.
 */
ok('...and it is worked out before the early returns',
  detail.indexOf('const progress = useMemo(') < detail.indexOf('if (loading) return'))
ok('...and the instalments come off the arrangement the account is on',
  /due: instalmentsDue\(live,/.test(detail))
/* The OPEN one: a kept or broken promise from last year is not what they are on now. */
ok('...the one that is still running',
  /\.find\(\(x\) => x\.status === 'open'\)/.test(detail))
/* DRAWN ONLY WHERE SOMETHING HAS BEEN PAID. An empty bar on every account is a thing people
   stop seeing, and on a section 129 it would be a graphic saying "you have paid nothing". */
ok('...and only where there is progress to show', /progress && hasProgress\(progress\)/.test(detail))
/* NO PERCENTAGE WITHOUT ITS FIGURES: the words under it are what somebody checks the bar
   against, and this arithmetic goes to a debtor and to a client next. */
ok('...with the two figures it was worked out from',
  /\{formatMoney\(progress\.money\.recovered\)\} of \{formatMoney\(progress\.money\.charged\)\}/.test(detail))
/* MISSED INSTALMENTS ARE MARKED, because that is the half a money bar cannot say: 60% paid and
   current is not the same account as 60% paid having missed the last three. */
ok('...and a missed instalment is marked rather than merely counted',
  /run\.missed > 0 \? 'font-medium text-\[var\(--c-gold-dark\)\]' : ''/.test(detail))

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
