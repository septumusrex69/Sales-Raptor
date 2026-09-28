/**
 * WHERE THE INTEREST CLOCK STARTS, AND WHERE IT MUST NOT.
 *
 * THE FIRM, ASKED HOW INTEREST BEHAVES ACROSS AN IMPORT: "the interest ... has already run. So it's
 * exported from Swordfish. And then we will import it on the same day. So then it should just
 * continue running. But normally, interest starts occurring from the date of handover. Sometimes the
 * client does put their interest in. Sometimes not, but the handover is the capital. Whether or not
 * they charge the interest is up to them. So we will not ask Raptor to calculate this."
 *
 * WHAT WOULD BREAK WITHOUT THIS, and it is one specific thing rather than a general tidiness. There
 * is a column called `interest_from` on every account, it is set on every account either import path
 * has ever written, and it is the obvious thing to reach for the day somebody builds the accrual for
 * an account with no posted history. IT IS THE WRONG COLUMN. It records what the CLIENT told us about
 * their own book, and on 63 of the 738 imported accounts it is 1 to 95 days BEFORE the handover --
 * so accruing from it has Raptor recomputing interest the client already charged and already folded
 * into the capital it handed over, on a file the firm did not yet have. The debtor is then billed
 * twice for the same days, and nothing fails: the balance simply reads high.
 *
 * So the guard is an ABSENCE, and absences are the assertions that rot. It is written here with the
 * firm's words beside it, and it is paired with a positive one -- the engine accrues from the
 * handover perfectly well when it is told to -- so that a reader who finds the absence inconvenient
 * can see what the alternative was meant to be.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-interest-start.mjs
 */
import { readFileSync } from 'node:fs'
import { accrueToDate } from '../../src/lib/interestAccrual.ts'
import { computeBalance } from '../../src/lib/accountBalance.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const near = (name, actual, expected) => {
  if (Math.abs(actual - expected) < 0.005) { pass += 1; return }
  failures.push(`${name}\n    expected ${expected.toFixed(2)}\n    got      ${actual.toFixed(2)}`)
}

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* COMMENTS OFF BEFORE ANY SOURCE ASSERTION. Every file below carries a paragraph explaining why
   interest_from is not accrued from, and a grep for the column cannot tell the explanation from a
   use of it -- which would make the central assertion of this file pass on nothing. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

/* ---------------- the clock starts at the handover ---------------- */

/*
 * BOTH WRITE PATHS ALREADY DO THIS, which is the half that is built: an account captured by hand
 * takes the handover date, and an import takes the client's date where the export carries one and
 * the handover date where it does not. Asserted because the fallback reads as "the day we loaded
 * the file" -- it is loadDate -- and the next person to tidy it needs to know it is deliberate.
 */
const newDebtor = code('src/lib/newDebtor.ts')
ok('an account captured by hand accrues from its handover',
  /interest_from: input\.handoverDate/.test(newDebtor))
const swordfish = code('src/lib/swordfishImport.ts')
ok('an imported account takes the client’s date where there is one',
  /interest_from: isoDate\(r\['Initial Interest Date'\]\) \?\? loadDate/.test(swordfish))
/* AND THE FALLBACK IS THE HANDOVER, not today: the two are the same value on an import, and that is
   the only reason `?? loadDate` satisfies the firm's rule. If handover_date stopped being loadDate
   the fallback would quietly become "the day of the import" on every row without a client date. */
ok('...and the handover is that same day', /handover_date: loadDate/.test(swordfish))

/* ---------------- and never before it ---------------- */

/*
 * THE CENTRAL ASSERTION. Neither the balance nor the accrual engine may read `interest_from`. The
 * firm: "whether or not they charge the interest is up to them. So we will not ask Raptor to
 * calculate this."
 */
ok('the balance does not accrue from the client’s own interest date',
  !/interest_from|interestFrom/.test(code('src/lib/accountBalance.ts')))
ok('...nor does the accrual engine', !/interest_from|interestFrom/.test(code('src/lib/interestAccrual.ts')))
/* AND IT IS NOT AN INPUT EITHER, which is the shape the mistake would actually arrive in: a field
   added to BalanceInput is a field every caller starts passing. */
const balanceSrc = read('src/lib/accountBalance.ts')
const inputBlock = balanceSrc.slice(balanceSrc.indexOf('export interface BalanceInput {'),
  balanceSrc.indexOf('export interface BalanceInput {') + 2000)
ok('...and the balance is never handed one', inputBlock.length > 0 && !/interestFrom/.test(inputBlock))

/* ---------------- what the engine does when it IS told to start at a handover ---------------- */

/*
 * THE POSITIVE HALF, and it is also the convention a reader needs: `coveredTo` is the last day
 * ALREADY covered, so the first accruing day is the one after it. To start interest on the handover
 * date you pass the day BEFORE the handover -- which is the one thing about the unbuilt half that is
 * easy to get wrong by a day, and a day of 24% on the book's average capital is not nothing.
 */
const open = accrueToDate({
  openingBalance: 10000, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-09-30',
})
check('a handover on 1 September accrues from 1 September', open?.from, '2026-09-01')
check('...for the whole of September', open?.days, 30)
/* A FULL CALENDAR MONTH LANDS ON THE FLAT MONTHLY FIGURE TO THE CENT -- 2% of 10 000. That is the
   pro-rating convention doing its job, and it is what makes an open period comparable with the
   posted rows the import brings across. */
near('...and a full month is the 2% the book has always charged', open?.amount, 200)

/*
 * AND IT REFUSES TO RUN BACKWARDS. Told to accrue to a date before the clock starts -- a statement
 * reprinted as at the handover, or a pre-handover date reaching the engine by mistake -- it returns
 * nothing rather than a negative.
 */
check('nothing accrues before the clock starts',
  accrueToDate({ openingBalance: 10000, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-08-15' }),
  null)

/* ---------------- the handover figure is the capital ---------------- */

/*
 * "THE HANDOVER IS THE CAPITAL." Whatever interest the client rolled in before handover is inside
 * that number and nobody is asked to separate it -- which is also why in duplum's ceiling is that
 * figure and not twice it. An account with nothing on it owes exactly its handover figure: no
 * reconstructed pre-handover interest, in either direction.
 */
const bare = computeBalance({
  capitalHandedOver: 25000, handoverDate: '2026-09-01', ledgers: { payments: [], fees: [], interest: [] },
  interestRateAnnual: 24, accrueTo: '2026-09-28',
})
near('an account with no posted accrual owes its capital', bare.balance, 25000)
near('...with nothing reconstructed as interest', bare.interest, 0)
/* AND THE CAPITAL IS UNTOUCHED BY THE RATE. A rate on the account is not a licence to restate what
   the client handed over. */
near('...and the capital is what the client handed over', bare.capital, 25000)

/* ---------------- and it runs on the outstanding balance ---------------- */

/*
 * "INTEREST IS CALCULATED ON THE OUTSTANDING BALANCE, WHICH INCLUDES THE HANDOVER PLUS FEES PLUS
 * OTHER INTEREST MINUS PAYMENTS." The firm's answer when asked what the base is, and it is a
 * DECISION rather than an implementation detail: "interest on the capital" is a defensible reading,
 * several creditors work that way, and it would be a smaller number on every account in the book.
 *
 * ASSERTED AS ARITHMETIC, not as the shape of the expression -- the point is which number comes
 * out. A fee on the account has to make the interest bigger, and a payment has to make it smaller.
 */
const month = { handoverDate: '2026-08-01', interestRateAnnual: 24, accrueTo: '2026-09-30' }
const posted = [{ from: '2026-08-01', days: 30, amount: 0 }]
/* A posted accrual of nought closes August, so the open period is the whole of September and lands
   on the flat monthly 2% -- which makes each figure below readable by hand. */
const bare2 = computeBalance({ capitalHandedOver: 10000, ledgers: { payments: [], fees: [], interest: posted }, ...month })
near('a bare account accrues 2% of the capital', bare2.interest, 200)

const withFee = computeBalance({
  capitalHandedOver: 10000,
  ledgers: { payments: [], fees: [{ date: '2026-08-15', exclVat: 1000, vat: 150 }], interest: posted },
  ...month,
})
/* R11 150 at 2% is R223. The fee and ITS VAT are both in the base: a fee is what the debtor owes. */
near('...and a fee on the account is in the base', withFee.interest, 223)

const withPayment = computeBalance({
  capitalHandedOver: 10000,
  ledgers: { payments: [{ date: '2026-08-15', amount: 5000 }], fees: [], interest: posted },
  ...month,
})
/* R5 000 left, less the receipt fee item 9 raises on the payment, so this is "smaller" rather than
   an exact hand figure -- the direction is the assertion, and it is the one that would flip if the
   base ever became the capital. */
ok(`...and a payment takes it out again (${withPayment.interest.toFixed(2)} < 200.00)`,
  withPayment.interest < 200)
/* AND IT IS NOT THE CAPITAL. The one assertion that fails the moment somebody "simplifies" the base
   to capitalHandedOver, which is the change this rule exists to refuse. */
ok('...so the base is not the capital alone', withFee.interest > bare2.interest)
/*
 * INTEREST COMPOUNDS ON INTEREST, which is the "plus other interest" half. A posted accrual of
 * R1 000 is in the base the next period runs on: R11 000 at 2% is R220.
 */
const onInterest = computeBalance({
  capitalHandedOver: 10000,
  ledgers: { payments: [], fees: [], interest: [{ from: '2026-08-01', days: 30, amount: 1000 }] },
  ...month,
})
near('...and interest already posted is in the base too', onInterest.interest - 1000, 220)

console.log(`\ncheck-interest-start: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
