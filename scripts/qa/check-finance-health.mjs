/**
 * THE ALARM ON THE MONEY, checked against rows built by hand.
 *
 * The firm asked for "a trigger that says that something is messing with the finances, or one of
 * the fees are not charging, or something is not there, broken, whatever, and influences the
 * remittance". financeHealth.ts is that; this is what holds it honest.
 *
 * AN ALARM HAS TWO FAILURE MODES AND BOTH ARE HERE. It can miss something — an account whose
 * ledgers contradict each other and it says nothing. And it can cry wolf — a warning on an
 * account where nothing is wrong, which is worse than no alarm at all, because people stop
 * reading it and then miss the real one. Every rule below is tested in both directions.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-finance-health.mjs
 */
import {
  auditAccount, auditBook, headline, randsAtStake,
} from '../../src/lib/financeHealth.ts'
import { ANNEXURE_B_2017, ANNEXURE_B_2026, scheduleFor } from '../../src/lib/annexureB.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/** A sound account: everything adds up, nothing is in default, one correctly priced fee. */
const sound = (over = {}) => ({
  accountId: 'a1',
  reference: 'GPS3/10103',
  capitalOutstanding: 10000,
  inDuplum: false,
  inDuplumCeiling: 0,
  breakdown: {
    capital: 10000, interest: 500, fees: 25, receiptFees: 0, payments: 1000,
    balance: 9525, withheld: 0,
  },
  fees: [{ id: 'f1', annexureItem: '1a', amountExclVat: 25, incurredAt: '2026-09-01T00:00:00Z', countsTowardFeeCap: true }],
  payments: [],
  ...over,
})

const rules = (r) => r.findings.map((f) => `${f.severity}:${f.rule}`).sort()

/**
 * The first finding's message, or a sentence saying there wasn't one.
 *
 * NEVER `findings[0].message`. CLAUDE.md names this trap: indexing an empty array throws a
 * TypeError two lines below the check that should have reported it, so a deaf alarm is reported
 * as a crash in the test rather than as "the alarm did not fire". Found by breaking the
 * reconciliation rule and watching this file die instead of fail.
 */
const firstMessage = (r) => r.findings[0]?.message ?? '(nothing was reported)'
const firstRands = (r) => r.findings[0]?.randsOut ?? null

/* ---------- a sound account raises nothing ---------- */

/*
 * THE HALF THAT MATTERS MOST. A warning that fires when nothing is wrong is worse than no
 * warning, because people stop reading it -- CLAUDE.md says so in as many words, and an alarm on
 * the firm's money is the one nobody can afford to learn to ignore.
 */
check('a sound account raises nothing', auditAccount(sound()).findings, [])
check('...and says so, with what it looked at', headline(auditAccount(sound())),
  'Nothing wrong across 2 checks.')
check('...and nothing is at stake', randsAtStake(auditAccount(sound())), 0)

/* ---------- 1. the ledgers reconcile ---------- */

check('a balance that does not match its parts is broken',
  rules(auditAccount(sound({
    breakdown: { ...sound().breakdown, balance: 9000 },
  }))), ['broken:reconciles'])
/* The message names BOTH numbers, or it is a siren with no address on it: somebody reading it
   has to know what the ledgers say and what the balance says to know where to look. */
{
  const m = firstMessage(auditAccount(sound({ breakdown: { ...sound().breakdown, balance: 9000 } })))
  ok(`...naming both figures (${m})`, m.includes('9525.00') && m.includes('9000.00'))
}
check('...and the gap in rands',
  firstRands(auditAccount(sound({ breakdown: { ...sound().breakdown, balance: 9000 } }))),
  525)

/*
 * A CAP IS NOT A CONTRADICTION. Where in duplum withheld interest, the balance is deliberately
 * below the sum of its parts and `withheld` is the difference -- so subtracting it first is what
 * tells the rule doing its job apart from the ledgers disagreeing. Without this the alarm would
 * fire on every capped account in the book, which is every account that matters.
 */
check('a balance held down by a cap is not a contradiction',
  auditAccount(sound({
    breakdown: { capital: 10000, interest: 3000, fees: 25, receiptFees: 0, payments: 0, balance: 12525, withheld: 500 },
  })).findings, [])

/* ---------- 2. in duplum ---------- */

const defaulted = (over = {}) => sound({
  inDuplum: true,
  inDuplumCeiling: 10000,
  breakdown: { capital: 10000, interest: 4000, fees: 25, receiptFees: 0, payments: 0, balance: 14025, withheld: 0 },
  ...over,
})
check('an account in default within the cap raises nothing', auditAccount(defaulted()).findings, [])

/*
 * NCA s103(5). Interest and fees at R10 100 against capital of R10 000 is over-recovery, and it
 * is the kind of error the Council for Debt Collectors exists to hear about.
 */
check('interest and fees above the capital breach in duplum',
  rules(auditAccount(defaulted({
    breakdown: { capital: 10000, interest: 10000, fees: 100, receiptFees: 0, payments: 0, balance: 20100, withheld: 0 },
  }))), ['broken:in-duplum'])
check('...by what it is over',
  firstRands(auditAccount(defaulted({
    breakdown: { capital: 10000, interest: 10000, fees: 100, receiptFees: 0, payments: 0, balance: 20100, withheld: 0 },
  }))), 100)
/* Exactly at the capital is allowed: the Act says may not EXCEED. An off-by-one here would fire
   on every account that reached its ceiling correctly, which is the cry-wolf failure. */
check('exactly at the capital is not a breach',
  auditAccount(defaulted({
    breakdown: { capital: 10000, interest: 9975, fees: 25, receiptFees: 0, payments: 0, balance: 20000, withheld: 0 },
  })).findings, [])

/*
 * A CEILING OF ZERO ON AN ACCOUNT IN DEFAULT is the exact shape of a mapper dropping the column
 * -- the fault check-row-mappers.mjs now guards against, seen from the data side. Reported as
 * SUSPECT rather than broken: it is the stored figure that is wrong, not the money.
 */
check('a ceiling that disagrees with the capital is suspect',
  rules(auditAccount(defaulted({ inDuplumCeiling: 250 }))), ['suspect:in-duplum'])
/* Zero means "none struck yet" rather than "struck at nothing", so it is not reported -- or every
   account before its first default would raise a warning. */
check('a ceiling of zero is not yet a ceiling',
  auditAccount(defaulted({ inDuplumCeiling: 0 })).findings, [])
check('and nothing in duplum is checked on an account not in default',
  auditAccount(sound()).checked['in-duplum'], 0)

/* ---------- 3. fees against the gazette of their own day ---------- */

const withFee = (fee) => sound({ fees: [{ id: 'f1', countsTowardFeeCap: true, ...fee }] })

check('a fee at the gazette price raises nothing',
  auditAccount(withFee({ annexureItem: '1a', amountExclVat: 25, incurredAt: '2026-09-01T00:00:00Z' })).findings, [])
/*
 * THE HISTORICAL HALF, and the reason scheduleAt takes the FEE's date. A 2019 letter is priced on
 * the 2017 gazette at R20. Charging it at today's R25 is an overcharge on an account the firm has
 * already remitted on.
 */
check('a 2019 letter is priced on the 2017 gazette',
  auditAccount(withFee({ annexureItem: '1a', amountExclVat: 20, incurredAt: '2019-06-01T00:00:00Z' })).findings, [])
check('...and charging it at 2026 prices is broken',
  rules(auditAccount(withFee({ annexureItem: '1a', amountExclVat: 25, incurredAt: '2019-06-01T00:00:00Z' }))),
  ['broken:fee-tariff'])
ok('...saying which gazette and what it prices',
  firstMessage(auditAccount(withFee({ annexureItem: '1a', amountExclVat: 25, incurredAt: '2019-06-01T00:00:00Z' })))
    .includes('2017'))

check('a fee with no Annexure B item is suspect',
  rules(auditAccount(withFee({ annexureItem: null, amountExclVat: 40, incurredAt: '2026-09-01T00:00:00Z' }))),
  ['suspect:fee-tariff'])
check('a fee under an item the gazette does not price is broken',
  rules(auditAccount(withFee({ annexureItem: '99', amountExclVat: 40, incurredAt: '2026-09-01T00:00:00Z' }))),
  ['broken:fee-tariff'])
/* Items 1(b), 4(a) and 9 carry no flat amount -- they point at the Magistrates' Courts rules or
   at a percentage -- so there is nothing to compare and nothing to report. */
check('an item the gazette prices by reference is not compared',
  auditAccount(withFee({ annexureItem: '1b', amountExclVat: 137, incurredAt: '2026-09-01T00:00:00Z' })).findings, [])

/*
 * THE ITEMS 1-7 CEILING: the capital or R1 225, whichever is lower. On a small debt the cap IS
 * the debt, which is the case that catches a book of small accounts being over-charged.
 */
{
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: `f${i}`, annexureItem: '1a', amountExclVat: 25,
    incurredAt: '2026-09-01T00:00:00Z', countsTowardFeeCap: true,
  }))
  check('fees past the items 1-7 ceiling are broken',
    rules(auditAccount(sound({ fees: many }))).filter((r) => r.includes('fee-tariff')),
    ['broken:fee-tariff'])
  /* A small debt has a smaller ceiling than the gazette's, and that is the point of the rule. */
  check('...and on a small debt the ceiling is the debt',
    auditAccount(sound({
      capitalOutstanding: 200,
      breakdown: { capital: 200, interest: 0, fees: 300, receiptFees: 0, payments: 0, balance: 500, withheld: 0 },
      fees: Array.from({ length: 12 }, (_, i) => ({
        id: `f${i}`, annexureItem: '1a', amountExclVat: 25,
        incurredAt: '2026-09-01T00:00:00Z', countsTowardFeeCap: true,
      })),
    })).findings.some((f) => f.message.includes('R 200.00')), true)
  /* And a fee that does not count towards the cap does not push anything over it. */
  check('fees outside the cap do not breach it',
    auditAccount(sound({
      fees: many.map((f) => ({ ...f, countsTowardFeeCap: false })),
    })).findings.filter((f) => f.rule === 'fee-tariff'), [])
}

/* ---------- 4. payments, and what reaches the client ---------- */

const paid = (allocation) => sound({ payments: [{ id: 'p1', amount: 1000, allocation }] })
const split = (over = {}) => ({
  toInterest: 500, toReceiptFee: 100, toFees: 25, toCapital: 375,
  commission: 760.87, commissionVat: 114.13, toClient: 0, ...over,
})

/*
 * A SOUND SPLIT. R1 000 comes in: R500 to interest, R100 receipt fee, R25 to fees, R375 to
 * capital -- and of that, what the firm keeps (commission plus its VAT plus the fees it earned)
 * and what goes to the client must also come to R1 000.
 */
check('a payment split to exactly itself raises nothing',
  auditAccount(paid(split({
    toInterest: 500, toReceiptFee: 100, toFees: 25, toCapital: 375,
    commission: 0, commissionVat: 0, toClient: 875,
  }))).findings, [])

check('a payment split into parts that do not add up is broken',
  rules(auditAccount(paid(split({ toCapital: 900, toClient: 875, commission: 0, commissionVat: 0 })))).length > 0,
  true)
ok('...and it is the allocation rule that says so',
  auditAccount(paid(split({ toCapital: 900, toClient: 875, commission: 0, commissionVat: 0 })))
    .findings.every((f) => f.rule === 'allocation'))

/*
 * THE REMITTANCE HALF. A split that adds up to the payment but remits the wrong amount is money
 * that either appears on a remittance advice or disappears before it -- which is the fault the
 * firm asked for this alarm to catch by name.
 */
check('a payment that remits more than came in is broken',
  rules(auditAccount(paid(split({
    toInterest: 500, toReceiptFee: 100, toFees: 25, toCapital: 375,
    commission: 0, commissionVat: 0, toClient: 2000,
  })))), ['broken:allocation'])
check('a negative allocation is broken',
  auditAccount(paid(split({
    toInterest: 500, toReceiptFee: 100, toFees: 25, toCapital: 375,
    commission: -10, commissionVat: 0, toClient: 885,
  }))).findings.some((f) => f.message.includes('negative')), true)

/*
 * A PAYMENT WITH NO ALLOCATION IS NOT A FAULT AND IS NOT A PASS. The remittance engine is not
 * built, so payment_allocations is empty today -- every payment in the book is in this state. An
 * alarm that counted those as checked would report a clean bill of health on a rule that has
 * never once run.
 */
{
  const unallocated = sound({ payments: [{ id: 'p1', amount: 1000, allocation: null }] })
  check('a payment not yet allocated raises nothing', auditAccount(unallocated).findings, [])
  check('...and is not counted as checked', auditAccount(unallocated).checked.allocation, 0)
  check('...while an allocated one is', auditAccount(paid(split({ toClient: 875, commission: 0, commissionVat: 0 }))).checked.allocation, 1)
}

/* ---------- the headline, which is what a person reads ---------- */

/*
 * "NOTHING WRONG" AND "NOTHING CHECKED" MUST NOT READ THE SAME. The second is the more urgent
 * sentence of the two, and it is the one an empty table produces.
 */
check('an empty book says nothing was checked', headline(auditBook([])), 'Nothing has been checked yet.')
check('...and so does an account with nothing to look at',
  headline(auditAccount({
    accountId: 'x', reference: null, capitalOutstanding: 0, inDuplum: false, inDuplumCeiling: 0,
    breakdown: { capital: 0, interest: 0, fees: 0, receiptFees: 0, payments: 0, balance: 0, withheld: 0 },
    fees: [], payments: [],
  })).startsWith('Nothing wrong'), true)
check('a broken book counts the broken and the suspect apart',
  headline(auditBook([
    sound({ accountId: 'a', breakdown: { ...sound().breakdown, balance: 1 } }),
    defaulted({ accountId: 'b', inDuplumCeiling: 250 }),
  ])), '1 broken, 1 to look at across 5 checks.')

/* Every account in the book is audited, not the first one. */
check('the whole book is audited',
  auditBook([sound({ accountId: 'a' }), sound({ accountId: 'b' }), sound({ accountId: 'c' })])
    .checked.reconciles, 3)
check('...and rands at stake add up across it',
  randsAtStake(auditBook([
    sound({ accountId: 'a', breakdown: { ...sound().breakdown, balance: 9000 } }),
    sound({ accountId: 'b', breakdown: { ...sound().breakdown, balance: 9025 } }),
  ])), 1025)

/* The resolver is a parameter, and the default is the real one -- or every historical fee would
   be measured against today's gazette. */
check('the default schedule resolver is the real one',
  scheduleFor('2019-06-01') === ANNEXURE_B_2017 && scheduleFor('2026-09-01') === ANNEXURE_B_2026, true)

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
An alarm on real rows rather than on the code: ledgers that do not add up, in duplum breached,
a fee priced on the wrong gazette, and a payment that remits more or less than came in. Every
rule tested in both directions, because an alarm that cries wolf is worse than none -- and
"nothing checked" is kept a different sentence from "nothing wrong", since the remittance table
is empty until that engine is built.`)
