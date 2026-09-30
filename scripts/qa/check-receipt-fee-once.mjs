/**
 * A RECEIPT FEE IS CHARGED ONCE.
 *
 * THE FIRM, LOOKING AT THE REPAYMENT CALCULATOR: "I think this thing is broken, this calculator."
 * The calculator was the only part of the screen telling the truth.
 *
 * ITEM 9 IS A FEE ROW LIKE ANY OTHER. `allocate_payment` writes it into account_fees when a
 * payment is split -- so it arrived in `ledgers.fees` AND was computed a second time off the
 * payment by `receiptFeeOn`. computeBalance added both. Every balance carrying receipt fees was
 * overstated by exactly those fees, and buildStatement printed the same fee on two lines, so the
 * running balance at the foot of the statement ended at the doubled figure too.
 *
 * ON STAGING: 331 accounts, R 209 468,82 overstated in total, R 13 169,80 on the worst of them.
 *
 * THE FIRM FOUND IT BY READING TWO PANELS ON ONE SCREEN. "What is left to take" said R 624,51 of
 * capital outstanding and nothing else; the summary beside it said the balance was R 1 211,01.
 * The difference is R 586,50 -- their receipt fees, counted twice. Then they typed the overstated
 * settlement figure into the calculator, which correctly answered that it would overpay by
 * R 570,49, and that is what read as broken.
 *
 * THE STRONGEST ASSERTION HERE IS THAT THE STATEMENT ADDS UP. Debits less credits must equal the
 * balance at the foot of it; a statement whose lines do not is the one thing a statement may never
 * be, and it is what catches this class of fault whatever shape the next one takes.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-receipt-fee-once.mjs
 */
import { readFileSync } from 'node:fs'
import { computeBalance, buildStatement } from '../../src/lib/accountBalance.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const cents = (n) => Math.round(n * 100) / 100

/*
 * THE FIRM'S OWN TEST ACCOUNT, to the cent, off the database rows behind the screenshot they sent.
 *
 * R 5 000 handed over. Two payments on 28 September -- R 100 and R 5 000 -- each with its item 9
 * row beside it, R 11,50 and R 575,00 including VAT. R 138,01 of items 1-7. No interest.
 *
 * 5 000 + 138,01 + 586,50 - 5 100 = R 624,51, which is what the account's own "What is left to
 * take" panel has been saying all along.
 */
const PAY_A = 'db0cbc62-5317-4ffe-b498-ebc7cd63879e'
const PAY_B = 'df9ed569-b4d6-49db-a3ec-c9550c7808a3'
const THEIRS = {
  capitalHandedOver: 5000,
  handoverDate: '2026-09-01',
  interestRateAnnual: 24,
  ledgers: {
    payments: [
      { id: PAY_A, date: '2026-09-28', amount: 100 },
      { id: PAY_B, date: '2026-09-28', amount: 5000 },
    ],
    fees: [
      /* Items 1-7: two emails, two texts, a dispute and a received email. R 138,01 in all. */
      { date: '2026-09-20', description: 'Email', exclVat: 50, vat: 7.5, billed: true, annexureItem: '1a' },
      { date: '2026-09-20', description: 'SMS', exclVat: 7, vat: 1.06, billed: true, annexureItem: '1c' },
      { date: '2026-09-29', description: 'ONE', exclVat: 50, vat: 7.5, billed: true, annexureItem: '3' },
      { date: '2026-09-29', description: 'Email received', exclVat: 13, vat: 1.95, billed: true, annexureItem: '6' },
      /* Item 9, one row per payment, which is what allocate_payment writes. */
      { date: '2026-09-28', description: 'Receipt of instalment', exclVat: 10, vat: 1.5, billed: true, annexureItem: '9', paymentId: PAY_A },
      { date: '2026-09-28', description: 'Receipt of instalment', exclVat: 500, vat: 75, billed: true, annexureItem: '9', paymentId: PAY_B },
    ],
    interest: [],
  },
}

const b = computeBalance(THEIRS)

check('the balance is what the account actually owes', b.balance, 624.51)
/* WHICH IS THE FIGURE THE OTHER PANEL HAD ALL ALONG: capital charged less capital taken. */
check('...the same figure "What is left to take" prints', b.balance, cents(5000 - 4375.49))
/* AND IT WAS OVERSTATED BY THE RECEIPT FEES, EXACTLY. 1 211,01 was the number on their screen. */
check('...where it used to be the receipt fees larger', cents(b.balance + b.receiptFees), 1211.01)

/* THE TWO LINES ARE STILL TWO LINES. Items 1-7 and item 9 are different things on the firm's own
   breakdown, and folding them together would trade one wrong figure for another. */
check('costs are items 1 to 7', b.fees, 138.01)
check('...and the receipt fees are item 9, once', b.receiptFees, 586.50)

/* THE SETTLEMENT FOLLOWS THE BALANCE, so the figure a collector quotes down the telephone moves
   with it. 10% of 624,51 plus VAT. */
check('the settlement is quoted off the real balance', b.settlementFee, cents(62.451 * 1.15))

/* ---------------- the statement adds up, which is the assertion that generalises ------------- */

const st = buildStatement(THEIRS)
const debits = cents(st.lines.reduce((t, l) => t + l.debit, 0))
const credits = cents(st.lines.reduce((t, l) => t + l.credit, 0))
check('debits less credits equal the balance at the foot of it', cents(debits - credits), b.balance)
check('...and the running balance ends there too', st.lines[st.lines.length - 1].balance, b.balance)

/*
 * ONE RECEIPT-FEE LINE PER PAYMENT. The statement used to print the item 9 ROW as an ordinary fee
 * and then print the computed fee under the payment as well -- the same money on two lines, which
 * a debtor adding up their own statement would have queried.
 */
const receiptLines = st.lines.filter((l) => l.kind === 'receipt-fee')
check('one receipt-fee line per payment', receiptLines.length, 2)
check('...adding to the receipt fees and no more',
  cents(receiptLines.reduce((t, l) => t + l.debit, 0)), 586.50)
/* AND NOT ALSO AS AN ORDINARY FEE. Four fee lines, which is items 1-7 and nothing else. */
check('item 9 is not an ordinary fee line as well',
  st.lines.filter((l) => l.kind === 'fee').length, 4)

/* ---------------- the computed figure is still there for the payments that need it ----------- */

/*
 * A PAYMENT WITH NO ROW STILL GETS ONE. The repayment calculator projects instalments that have
 * not happened, and an invented payment has no fee row -- the computed figure is exactly what it
 * is for. Take the firm's account and add a future payment with nothing beside it.
 */
const projected = computeBalance({
  ...THEIRS,
  ledgers: {
    ...THEIRS.ledgers,
    payments: [...THEIRS.ledgers.payments, { date: '2026-10-28', amount: 1000 }],
  },
})
check('a payment with no row of its own is still charged item 9',
  cents(projected.receiptFees - b.receiptFees), cents(100 * 1.15))

/*
 * AND THE ROW WINS WHERE THE TWO DISAGREE, which is receiptFeeOn's own rule stated one level up.
 * Swordfish billed a maximum of R 502 for over two years, seven rand under the gazetted figure,
 * because the number was entered wrong -- and recomputing history from the gazette would produce a
 * balance the debtor was never billed and the client has never seen. A row saying R 100 on a
 * R 5 000 payment is what was charged, whatever ten percent would have been.
 */
const recorded = computeBalance({
  ...THEIRS,
  ledgers: {
    ...THEIRS.ledgers,
    fees: THEIRS.ledgers.fees.map((f) => (f.paymentId === PAY_B
      ? { ...f, exclVat: 100, vat: 15 }
      : f)),
  },
})
check('what was actually charged beats what would be computed',
  recorded.receiptFees, cents(11.50 + 115))

/* ---------------- and the real data path supplies what the split needs ---------------- */

/*
 * WITHOUT THESE TWO COLUMNS THE FIX DOES NOTHING IN THE APP. annexureItem undefined reads as "not
 * item 9", which is the old behaviour exactly -- deliberately, so a synthesised ledger is not
 * silently reclassified. That safety is also the way this could be quietly lost, so the one path
 * that carries real money is asserted to supply them.
 */
const book = read('src/lib/accountBook.ts')
const detail = read('src/pages/accounts/AccountDetail.tsx')
/* NOT ANCHORED TO THE END OF THE SELECT. This used to require payment_id to be the LAST column --
   `annexure_item,payment_id'` with the closing quote -- so adding legacy_name after it failed a
   check about something else entirely. What matters is that both columns are asked for. */
ok('the fee ledger is fetched with its annexure item',
  /select\('id,incurred_at[^']*annexure_item[^']*'\)/.test(book)
  && /select\('id,incurred_at[^']*payment_id[^']*'\)/.test(book))
ok('...and mapped rather than dropped on the floor',
  /annexureItem: r\.annexure_item \?\? null/.test(book) && /paymentId: r\.payment_id \?\? null/.test(book))
ok('the account page passes the item through', /annexureItem: f\.annexureItem/.test(detail))
ok('...and the payment ids, or nothing can be matched', /id: p\.id,/.test(detail))

/* ONE SPLIT, SHARED. The balance and the statement have to agree about which fee is which, or the
   statement's lines stop adding up to its own total. */
const bal = read('src/lib/accountBalance.ts')
check('the split is written once', (bal.match(/function splitFeeLedger/g) ?? []).length, 1)
check('...and read by both the balance and the statement',
  (bal.match(/splitFeeLedger\(ledgers\)/g) ?? []).length, 2)

/* ---------------- and the statement opens where a statement opens ---------------- */

/*
 * THE FIRM, READING THE TRANSACTION LIST: "it looks funny, like and disorganized. Things should
 * happen chronologically, and it didn't happen here."
 *
 * Two payments dated 28 September sat ABOVE "Capital handed over" on the 29th. Correct by date,
 * and unreadable: the page opened with money coming off a debt that did not exist yet, and the
 * running balance went four thousand rand negative before the first debit.
 *
 * THE HANDOVER IS THE OPENING BALANCE, NOT A MOVEMENT. Sorting it among the movements by date is
 * what let a back-dated payment get above it.
 */
const backDated = buildStatement({
  ...THEIRS,
  handoverDate: '2026-09-29',
  ledgers: {
    ...THEIRS.ledgers,
    /* Received the day BEFORE the account arrived -- which is what their test capture did. */
    payments: [{ id: PAY_A, date: '2026-09-28', amount: 100 }],
    fees: [],
  },
})
check('the handover opens the statement whatever its date',
  backDated.lines[0].kind, 'handover')
/* AND THE RUNNING BALANCE NEVER STARTS BELOW NOUGHT because of it. */
ok('...so the balance does not open negative', backDated.lines[0].balance > 0)

/* THE ORDINARY CASE IS UNCHANGED: a handover on the first day is still first, and everything
   after it is still in date order. */
const normal = buildStatement(THEIRS)
check('...and on an ordinary account it is still first', normal.lines[0].kind, 'handover')
ok('...with the rest in date order',
  normal.lines.slice(1).every((l, i, a) => i === 0 || a[i - 1].date <= l.date))
/*
 * A RECEIPT FEE SORTS UNDER THE PAYMENT THAT CAUSED IT. It used to be an ordinary `fee` line,
 * which ranks ABOVE a payment -- so the firm's list opened with two receipt fees before the two
 * payments they were charged on.
 */
const dayLines = normal.lines.filter((l) => l.date === '2026-09-28')
check('a payment comes before the fee it produced',
  dayLines.map((l) => l.kind), ['payment', 'payment', 'receipt-fee', 'receipt-fee'])

/* ---------------- and the press that adds a line is on the page the line lands ------------- */

/*
 * THE FIRM: "record a payment, I think should be in this pane. Like you put it on the overview,
 * but it should be in here. On the transactions list." A captured payment becomes a line on this
 * table, so the press and its result belong on one screen.
 */
const page = read('src/pages/accounts/AccountDetail.tsx')
ok('Record a payment is on the transactions pane',
  /onRecordPayment && \([\s\S]{0,400}?Record a payment/.test(page))
ok('...offered only to whoever may capture one',
  /onRecordPayment=\{canRecordPayment\(currentUser\?\.role\) \? \(\) => setPayingIn\(true\) : null\}/.test(page))
/* AND NOT IN TWO PLACES. Two buttons doing one thing is how the firm ends up asking which is
   which; it was moved, not copied. */
check('...and it is not still on the overview as well',
  (page.match(/Record a payment/g) ?? []).length, 1)

/* ---------------- a message that went out and was not recorded says so ---------------- */

/*
 * THE FIRM: "I sent an email to this account and the charges didn't immediately add."
 *
 * ON THE ACCOUNT THEY WERE LOOKING AT, NOTHING WAS LOST. The R 28,75 under item 1(a) was raised a
 * second BEFORE the email row itself, and every one of the last week's messages carries its
 * charge. But the chain that does it -- charge, file the message, write the note, refetch -- was
 * fired with `void` and no catch. The one case where it DOES fail is therefore silent: the debtor
 * has been emailed, no fee is raised, nothing is filed, the page never refreshes, and the screen
 * says nothing -- which from the outside is exactly what they described.
 *
 * THE SEND IS NOT RETRIED AND MUST NOT LOOK FAILED. The message has gone. What failed is the
 * RECORD, and the two need different things done about them: a failed send is sent again, an
 * unrecorded one is entered by hand before the client is invoiced. So it says which.
 */
ok('a failed recording is caught rather than dropped',
  /\.then\(reload\)[\s\S]{0,600}?\.catch\(\(e: unknown\) => \{[\s\S]{0,120}?setSendProblem/.test(page))
ok('...and says the message did go', /The email went out, but it was not recorded/.test(page))
ok('...and what to do about it', /Add it by hand before the client is invoiced/.test(page))
/* AND THE HAPPY PATH STILL REFETCHES, or the charge really would not appear until a reload. */
ok('a sent message still refreshes the account', /\}\)\s*\n\s*\.then\(reload\)/.test(page))

console.log(`\ncheck-receipt-fee-once: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
