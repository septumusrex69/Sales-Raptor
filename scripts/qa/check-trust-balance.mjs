/**
 * DOES THE TRUST BALANCE, AND CAN THE SCREEN EVER SAY NO?
 *
 * THE FIRM, on the overview they sketched: "it shows all the money that's currently in the trust
 * fund and where that money should go. If the trust fund balances in the overview, then everything
 * is fine."
 *
 * WHAT THIS GUARDS, and the first one is the reason the file exists:
 *
 * 1. THE PANEL CAN GO RED. The reconciliation the firm's sketch drew -- ledger balance LESS the
 *    four owners = unexplained difference -- is an algebraic identity in Raptor, because
 *    trust_position derives the ledger balance by adding those four up. Built as drawn it would be
 *    a green light wired to nothing. So every check here is handed a failing case and asserted to
 *    report it, which is the only thing that distinguishes this panel from the one it replaced.
 *
 * 2. SHORT AND OVER ARE NOT THE SAME WORD. A bank short of the ledger is money gone from a trust
 *    account; a bank over it is a receipt nobody has recorded. One is a breach and the other is
 *    filing, and a single "difference" sentence over both is how the first gets left for a week.
 *
 * 3. A TRUST DEBTOR IS NOT A SHORTFALL. A PTC makes a client owe the trust. The cash is all still
 *    there -- it is money to collect back, not money missing -- and drawn in the same red as a
 *    shortfall it sends somebody to the bank for nothing.
 *
 * 4. "BALANCES" MEANS THE ARITHMETIC, NOT THE WORK. An unplaced receipt and a late payover are
 *    both jobs; neither makes the account wrong. Folding them into the verdict would put the page
 *    in the red on a day when nothing is actually missing, and the firm's sentence is specifically
 *    about whether it BALANCES.
 *
 * 5. LATE IS ASKED OF cycleState. "Past its payover day" is not "closed": there is a settable lag
 *    between the two, so a second copy of the comparison drifts the day the lag changes.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trust-balance.mjs
 */
import {
  trustBalances, trustChecks, trustTodo, trustVerdict,
} from '../../src/lib/trustBalance.ts'
import { cycleCollected, cycleTotals, overdueCycles } from '../../src/lib/trustCycles.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (Object.is(actual, expected)) pass += 1
  else failures.push(`${name}\n    expected ${expected}\n    got      ${actual}`)
}
const ok = (name, actual) => check(name, actual, true)

/** A trust account with nothing wrong with it. Each case below spoils exactly one thing. */
const CLEAN = {
  trustCash: 180000, netOwed: 180000, difference: 0, unidentified: 0, owedByClients: 0,
}
const by = (checks, id) => checks.find((c) => c.id === id)

/* ------------------------------------------------ the clean account ------------------------- */

const clean = trustChecks(CLEAN)
check('four checks, always', clean.length, 4)
check('...in the firm’s reading order',
  clean.map((c) => c.id).join(), 'bank,unidentified,owed_in,overdue')
ok('a clean account passes every one', clean.every((c) => c.tone === 'clear'))
ok('...and balances', trustBalances(clean))
check('...with nothing to do', trustTodo(clean).length, 0)
check('...and says so in one line',
  trustVerdict(clean).line, 'The trust account balances and there is nothing outstanding.')
check('...in green', trustVerdict(clean).tone, 'clear')
/*
 * EVERY CHECK IS SHOWN EVEN WHEN IT PASSES. A panel that drew only problems cannot be told apart
 * from one that failed to load, and the firm asked to be told that everything IS fine.
 */
ok('a passing check still carries its question', clean.every((c) => c.question.length > 10))
ok('...and an answer rather than a label', clean.every((c) => c.answer.length > 10))

/* ------------------------------------------------ 1. the bank against the ledger ------------- */

/*
 * THE CHECK THAT HAD TO BE ABLE TO FAIL. Asserted on a REAL shortfall rather than on the identity
 * the sketch drew: the bank holds less than the ledger says is owed.
 */
const short = trustChecks({ ...CLEAN, trustCash: 179000, difference: -1000 })
check('a bank short of the ledger is reported', by(short, 'bank').tone, 'bad')
ok('...named as money gone from the account',
  /less than is owed/.test(by(short, 'bank').answer)
  && /nothing accounts for/.test(by(short, 'bank').answer))
ok('...and the account does NOT balance', !trustBalances(short))
check('...which is the verdict', trustVerdict(short).line, 'The trust account does not balance.')
check('...in red', trustVerdict(short).tone, 'bad')
/* THE AMOUNT IS THE SIGNED DIFFERENCE, so the screen can draw it however it likes without the
   sentence and the figure disagreeing about direction. */
check('...carrying the amount', by(short, 'bank').amount, -1000)

const over = trustChecks({ ...CLEAN, trustCash: 181000, difference: 1000 })
check('a bank over the ledger is also reported', by(over, 'bank').tone, 'bad')
/*
 * AND IT IS A DIFFERENT SENTENCE. Over is a receipt nobody has recorded; short is money gone. The
 * first draft of the screen said "difference" over both.
 */
ok('...but not as money gone', !/nothing accounts for/.test(by(over, 'bank').answer))
ok('...as something unrecorded coming in', /more than is owed/.test(by(over, 'bank').answer))

/* ------------------------------------------------ 2. money nobody owns ---------------------- */

const unknown = trustChecks({ ...CLEAN, unidentified: 7600 })
check('an unplaced receipt is reported', by(unknown, 'unidentified').tone, 'warn')
ok('...naming the amount', /7600|7 600/.test(by(unknown, 'unidentified').answer.replace(/ /g, ' ')))
/*
 * BUT THE ACCOUNT STILL BALANCES. The money is there and the ledger knows about it; what is
 * missing is a name against it. Marked as not balancing, this would put the page in the red on
 * every day a receipt arrives before anybody files it -- which is most days.
 */
ok('...and the account still balances', trustBalances(unknown))
check('...so the verdict is work, not a breach', trustVerdict(unknown).tone, 'warn')
check('...counted as one thing to do', trustTodo(unknown).length, 1)
check('...and said that way',
  trustVerdict(unknown).line, 'The trust account balances. One thing still needs doing.')

/* ------------------------------------------------ 3. a client in debit ---------------------- */

const ptc = trustChecks({ ...CLEAN, owedByClients: 2500 })
check('a client in debit is reported', by(ptc, 'owed_in').tone, 'warn')
/*
 * NOT A SHORTFALL, AND IT SAYS SO. The cash is all there; the firm has paid a client ahead of
 * recovering it. Drawn as a shortfall it sends somebody to the bank over a collection job.
 */
ok('...explicitly not as a shortfall', /not a shortfall/.test(by(ptc, 'owed_in').answer))
ok('...saying the cash is still there', /cash is still/.test(by(ptc, 'owed_in').answer))
ok('...and the account balances', trustBalances(ptc))

/* ------------------------------------------------ 4. a payover past its day ----------------- */

const late1 = trustChecks(CLEAN, [{ label: '11 Aug – 10 Sep', toClients: 85000 }])
check('a cycle past its payover day is reported', by(late1, 'overdue').tone, 'warn')
ok('...naming which one', /11 Aug – 10 Sep/.test(by(late1, 'overdue').answer))
const late2 = trustChecks(CLEAN, [
  { label: 'A', toClients: 100 }, { label: 'B', toClients: 200 },
])
/* TWO IS A COUNT, NOT TWO NAMES. A list of every late cycle in one sentence is unreadable the
   month three of them are late; the table below the panel is where they are named one by one. */
ok('...and counted once there is more than one', /across 2 cycles/.test(by(late2, 'overdue').answer))
check('...summing what is late', by(late2, 'overdue').amount, 300)
ok('...and still balancing', trustBalances(late2))

/* ------------------------------------------------ the verdict counts ------------------------ */

const several = trustChecks(
  { ...CLEAN, unidentified: 100, owedByClients: 50 },
  [{ label: 'A', toClients: 10 }],
)
check('three outstanding things are counted', trustTodo(several).length, 3)
check('...and said as a number',
  trustVerdict(several).line, 'The trust account balances. 3 things still need doing.')
/*
 * AND A SHORTFALL BEATS THEM ALL. However much else is outstanding, the headline is the one thing
 * that means the account is wrong rather than behind.
 */
const worst = trustChecks(
  { ...CLEAN, difference: -5, unidentified: 100, owedByClients: 50 },
  [{ label: 'A', toClients: 10 }],
)
check('a shortfall is the headline whatever else is open',
  trustVerdict(worst).line, 'The trust account does not balance.')

/* ------------------------------------------------ the money is formatted once --------------- */

/*
 * THE SENTENCES ARE FORMATTED BY THE CALLER'S OWN MONEY FUNCTION. The screen passes `rand`, so a
 * sentence reading "7873.6" beside tiles reading "R 7 873,60" cannot happen -- which is what a
 * default toFixed baked into this file would have produced.
 */
const formatted = trustChecks({ ...CLEAN, unidentified: 7600 }, [], (v) => `[${v}]`)
ok('the caller’s money function is the one used',
  /\[7600\]/.test(by(formatted, 'unidentified').answer))

/* ------------------------------------------------ the cycle arithmetic ---------------------- */

const cyc = (over) => ({
  periodStart: '2026-08-11', periodEnd: '2026-09-10', paysOn: '2026-10-11', isOpen: false,
  toClients: 85000, firmEarned: 39800, firmMoved: 0, toDebtors: 3600, unplaced: 0,
  held: 128400, runs: 0, runsPaid: 0, runsToDo: 0, ...over,
})

/*
 * COLLECTED IS THE SHARES ADDED UP, AND THE FIRM'S DRAWINGS ARE NOT ONE OF THEM. firmMoved is a
 * drawing to the business account or a correction; counted as a collection, a month would look
 * bigger the more the firm took out of it.
 */
check('collected is the gross before it was split', cycleCollected(cyc()), 128400)
check('...and a drawing does not inflate it', cycleCollected(cyc({ firmMoved: -20000 })), 128400)
check('...while a receipt nobody has placed is still a collection',
  cycleCollected(cyc({ unplaced: 500 })), 128900)
check('the totals row adds the same figure up',
  cycleTotals([cyc(), cyc({ toClients: 1000, firmEarned: 0, toDebtors: 0 })]).collected,
  128400 + 1000)

/*
 * LATE IS PAST THE PAYOVER DAY, NOT MERELY CLOSED -- there is a settable lag between the two, and
 * a cycle inside it is holding client money entirely properly.
 */
check('a closed cycle before its payover day is not late',
  overdueCycles([cyc()], '2026-10-06').length, 0)
check('...and is late the day after', overdueCycles([cyc()], '2026-10-12').length, 1)
check('an open cycle is never late', overdueCycles([cyc({ isOpen: true })], '2026-12-01').length, 0)
/* A cycle owing clients nothing has nothing to be late with. */
check('a cycle with no client money is not late',
  overdueCycles([cyc({ toClients: 0 })], '2026-10-12').length, 0)

console.log(`check-trust-balance: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
