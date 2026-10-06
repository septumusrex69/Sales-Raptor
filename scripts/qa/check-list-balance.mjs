/**
 * THE BOOK SHOWS WHAT EACH ACCOUNT OWES — AND IT IS THE ACCOUNT PAGE'S OWN NUMBER.
 *
 * THE FIRM, of the accounts list: "in here, I want to see what the current balance is. So put it
 * capital, fees, interest, paid, balance, rate, position."
 *
 * ------------------------------------------------------------------------------------------------
 * THERE WAS A CHEAPER ANSWER AND IT WAS THE WRONG ONE
 * ------------------------------------------------------------------------------------------------
 *
 * `engine_balances` returns capital, interest and costs per account in one SQL call, which is
 * exactly the shape a paged list wants. It gives R817,01 on RRC00005 where the account page gives
 * R760,00: it applies the in duplum ceiling to the INTEREST alone, while computeBalance caps the
 * AGGREGATE of non-capital. The R57,01 between them is the VAT on fees already standing at the
 * ceiling, and which reading is the firm's is a question they have not answered.
 *
 * WHICHEVER IT TURNS OUT TO BE, a list saying R817,01 beside the account page it links to saying
 * R760,00 is the failure CLAUDE.md names in as many words. So the list runs computeBalance over the
 * ledgers for the rows it is showing, and this file holds that it keeps doing so.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-list-balance.mjs
 */
import { readFileSync } from 'node:fs'
import { computeBalance } from '../../src/lib/accountBalance.ts'
import { balanceInputFor } from '../../src/lib/balanceInput.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

const never = () => false

/* ---------------------------------------------------------------------------------------------
 * RRC00005, WHICH IS THE ACCOUNT THE TWO READINGS DISAGREE ON
 * ------------------------------------------------------------------------------------------- */

/*
 * THE REAL FIGURES off staging: R380,00 of capital handed over, R437,01 of Annexure B fees
 * (R380,00 plus R57,01 of VAT), and the interest the rate has earned since. Non-capital comes to
 * R441,91 against a R380,00 ceiling.
 */
const rrc5 = balanceInputFor({
  account: {
    capitalHandedOver: 380,
    handoverDate: '2026-09-01',
    interestRateAnnual: 24,
    status: 'Active',
    lastActionAt: null,
  },
  ledgers: {
    payments: [],
    fees: [{
      incurredAt: '2026-09-02T08:00:00Z', description: 'Costs, items 1-7',
      amountExclVat: 380, vatAmount: 57.01, billed: true,
      annexureItem: '3', paymentId: null, cancelledAt: null, legacyName: null,
    }],
    accruals: [{ accruedOn: '2026-09-02', days: 30, amountAccrued: 4.90 }],
  },
  today: '2026-10-02',
  writtenOff: never,
})
const b5 = computeBalance(rrc5)
check('the list’s balance on RRC00005 is the account page’s', b5.balance, 760)
/* NOT WHAT THE SQL SIDE SAYS, and the gap is the whole reason this is computed here. */
ok('...and not engine_balances’ R817,01', b5.balance !== 817.01)
check('...capped, and it says so', b5.cappedBy, 'in duplum')
check('...withholding R61,91', b5.withheld, 61.91)
/* THE FIVE COLUMNS THE FIRM ASKED FOR, each off the same reading. */
check('...capital', b5.capital, 380)
check('...fees, items 1-7 and the receipt fees together, including VAT',
  b5.fees + b5.receiptFees, 437.01)
check('...paid', b5.payments, 0)

/* ---------------------------------------------------------------------------------------------
 * AND AN ACCOUNT NOWHERE NEAR ITS CEILING, WHICH IS MOST OF THE BOOK
 * ------------------------------------------------------------------------------------------- */

const b1 = computeBalance(balanceInputFor({
  account: {
    capitalHandedOver: 770.45, handoverDate: '2026-09-01', interestRateAnnual: 24,
    status: 'Active', lastActionAt: null,
  },
  ledgers: {
    payments: [],
    fees: [{
      incurredAt: '2026-09-02T08:00:00Z', description: 'Costs', amountExclVat: 250.01,
      vatAmount: 37.50, billed: true, annexureItem: '3', paymentId: null,
      cancelledAt: null, legacyName: null,
    }],
    accruals: [{ accruedOn: '2026-09-02', days: 30, amountAccrued: 9.03 }],
  },
  today: '2026-10-02',
  writtenOff: never,
}))
check('an account under its ceiling adds up to its parts', b1.balance, 1066.99)
check('...and is not capped', b1.cappedBy, undefined)
check('...so nothing is withheld', b1.withheld, 0)

/* ---------------------------------------------------------------------------------------------
 * WHAT THE SHARED ASSEMBLY HAS TO KEEP DOING
 * ------------------------------------------------------------------------------------------- */

/*
 * WHAT THE DEBT EARNED, NOT WHAT MAY BE TAKEN. `amount_accrued`, never `amount_recoverable`:
 * computeBalance caps the aggregate, so interest open_interest has already clipped would cap the
 * same account twice -- once on the way in and once on the way out.
 */
const lib = read('src/lib/balanceInput.ts')
ok('the assembly hands over what the debt earned', /amount: i\.amountAccrued/.test(lib))
ok('...and never the pre-clipped figure', !/amountRecoverable/.test(lib))
/* A REVERSED PAYMENT IS NOT A PAYMENT. Left in, every reversal would reduce a balance twice. */
ok('a reversed payment is left out', /\.filter\(\(p\) => !p\.reversedAt\)/.test(lib))
/* THE PAYMENT'S ID TRAVELS, so an item 9 fee row can be matched to the payment it was raised on
   and the receipt fee is not counted here AND computed again. */
ok('the payment id travels with it', /id: p\.id,/.test(lib))
/* THE FIRM'S DAY, not the first ten characters of a UTC string -- a payment dated 29 September is
   stored as 22:00 on the 28th and read back a day early. */
ok('dates are read as the firm’s day', /firmDay\(p\.receivedAt\)/.test(lib)
  && /firmDay\(f\.incurredAt\)/.test(lib))
/* AND IT HAS NO CLOCK OF ITS OWN: a pure function that asked `new Date()` could not be checked,
   and the firm's day is not the server's. */
ok('...and the day is passed in rather than read', !/new Date\(\)/.test(lib))

/* A WRITTEN-OFF ACCOUNT STOPS ACCRUING, and on the same day for both screens. */
const off = balanceInputFor({
  account: {
    capitalHandedOver: 1000, handoverDate: '2026-01-01', interestRateAnnual: 24,
    status: 'Written off', lastActionAt: '2026-03-01',
  },
  ledgers: { payments: [], fees: [], accruals: [] },
  today: '2026-10-02',
  writtenOff: (s) => /written.off/i.test(s),
})
check('a written-off account stops where it was written off', off.writtenOffAt, '2026-03-01')
check('...and a live one does not stop at all', rrc5.writtenOffAt, null)

/* ---------------------------------------------------------------------------------------------
 * THE LIST
 * ------------------------------------------------------------------------------------------- */

const list = read('src/pages/accounts/AccountsList.tsx')
/* THE FIVE COLUMNS, IN THE ORDER THE FIRM GAVE THEM: they build to the balance left to right. */
const headings = [...list.matchAll(/font-medium text-right">([A-Za-z]+)</g)].map((m) => m[1])
check('the five money columns are in the firm’s own order',
  headings.slice(0, 5), ['Capital', 'Fees', 'Interest', 'Paid', 'Balance'])
ok('...with the rate after them', headings[5] === 'Rate')

/*
 * AND THE DAY IT CAME IN. THE FIRM: "something on there that can be added is the hand-over date as
 * well." It is how old the matter is -- the first thing asked of a row nobody has worked -- and it
 * is what prescription runs from.
 */
/* A resizable heading now (columnWidths.ts) -- the column is the same, its edge can be dragged. */
ok('the book says when each account was handed over', /font-medium">Handed over<\/ResizableTh>/.test(list))
ok('...off the account’s own handover date', /a\.handoverDate \? formatDate\(a\.handoverDate\)/.test(list))
/* A DASH WHERE THERE IS NONE, not a blank: half the inherited book arrived without one, and a
   column that quietly shows nothing reads as a rendering fault. */
ok('...and a dash where there is none',
  /a\.handoverDate \? formatDate\(a\.handoverDate\) : '—'/.test(list))

ok('the list computes with the account page’s own function', /computeBalance\(balanceInputFor\(/.test(list))
ok('...over the ledgers for the rows it is showing', /fetchLedgersForAccounts\(missing\)/.test(list))
/* ONLY THE ROWS IT HAS NOT GOT, so Load more fetches fifty ledgers and not two hundred and fifty. */
ok('...only the rows it has not got',
  /accounts\.map\(\(a\) => a\.id\)\.filter\(\(id\) => !balances\.has\(id\)\)/.test(list))
/*
 * AND IT CANNOT FAIL THE LIST. A collector came for the book; a ledger query that will not answer
 * costs them five columns, and losing the page with it would be the app deciding a figure matters
 * more than the work.
 */
ok('...and a ledger that will not load does not take the book with it',
  /\} catch \{\s*\n\s*\/\* Deliberately silent/.test(list))

/*
 * A DASH UNTIL IT KNOWS, NEVER A NOUGHT. On these columns nought is a real figure -- an account
 * with no fees, nothing paid -- so showing one before the ledger lands states something false for
 * as long as the request takes.
 *
 * ASSERTED PER COLUMN AND AGAINST THE FALLBACK, not as "the guard appears somewhere". The loose
 * version passed while one cell was rewritten to `?? 0`, because the other three still carried the
 * guard -- CLAUDE.md's vacuous-assertion trap, found by breaking this one.
 */
/* FOUR: fees, interest, paid and balance. Capital is on the row itself and needs no ledger. */
const guarded = list.match(/balances\.has\(a\.id\)/g) ?? []
check('every computed column waits for the ledger before it says anything', guarded.length, 4)
ok('...and none of them falls back to a nought', !/balances\.get\(a\.id\)\?\.\w+ \?\? 0/.test(list))

/* THE CAP IS EXPLAINED WHERE IT BITES. A balance smaller than its own parts with nothing saying
   why is a figure people quietly stop trusting. */
ok('a capped balance says what stopped it', /At the in duplum ceiling\./.test(list))
/* AND WHICH CHARGE GAVE WAY, now that the firm has decided it: "interest precedes Annexure B fees
   in an in duplum scenario", because interest carries no VAT. */
ok('...naming the fees as what is pushed out',
  /withheldFees\)\} of Annexure B fees cannot be recovered/.test(list))
ok('...and why they are', /interest takes the ceiling first/.test(list))

/*
 * PAID COMES OFF THE SAME READING AS THE REST. `paymentsToDate` is the imported figure and is not
 * net of a reversal, so the two disagree the day somebody reverses a payment -- and the column
 * beside it would still be right.
 */
ok('paid is the computed figure, not the imported one',
  !/a\.paymentsToDate \? formatCurrency\(a\.paymentsToDate\)/.test(list))

/* AND THE ACCOUNT PAGE USES THE SAME ASSEMBLY, which is the whole guarantee. Written out twice,
   the two would eventually disagree about one debtor -- and that is what the firm would be looking
   at when they noticed. */
const detail = read('src/pages/accounts/AccountDetail.tsx')
ok('the account page assembles it the same way', /balanceInputFor\(\{/.test(detail))
ok('...rather than building the input by hand', !/const input: BalanceInput = \{/.test(detail))

console.log(`\ncheck-list-balance: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
