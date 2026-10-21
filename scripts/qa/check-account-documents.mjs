/**
 * THE SUMMARY OF ACCOUNT AND THE STATEMENT BEHIND IT.
 *
 * THE FIRM DREW BOTH ON ONE SCREEN -- "summary or statement", pencilled twice, once over the
 * account's action bar and once beside the Print button on the transactions list -- and sent over
 * their own letterhead template for the first. They answer two questions a debtor asks: where do
 * I stand, and show me the working.
 *
 * WHAT THIS HOLDS. The arithmetic on the page is the account's own and is never recomputed here;
 * VAT is a COMPONENT of the fees and not a seventh addend; the trust account is the only bank
 * account a debtor is shown; and the two documents share one skeleton so they cannot disagree
 * about what is owed.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-account-documents.mjs
 */
import { readFileSync } from 'node:fs'
import { summaryOfAccount, statementOfAccount } from '../../src/lib/accountSummaryLetter.ts'
import { lettersText, letterProblems, canUseLetter, PRINTER_FIELDS } from '../../src/lib/letterDocument.ts'
import { MERGE_FIELDS, unknownFields } from '../../src/lib/messageTemplates.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const money = (n) => `R ${n.toFixed(2)}`

/*
 * THE FIRM'S OWN TEMPLATE, TO THE CENT. R6 000 handed over, R1 000 paid, R182.40 interest,
 * R486.00 fees and R72.90 of VAT inside them -- which is R5 741.30 owing, the figure printed on
 * the page they sent. Asserting the total rather than the parts is what makes this a check of the
 * arithmetic on a debtor's page rather than of a struct.
 */
const BREAKDOWN = {
  capital: 5000, interest: 182.40, fees: 558.90, receiptFees: 0, vat: 72.90,
  payments: 1000, balance: 5741.30, settlementFee: 0, settlement: 5741.30,
  withheld: 0, interestAccruing: 0, interestAccruingDays: 0, interestAccruingFrom: null,
}
const LINES = [
  { date: '2026-08-14', kind: 'handover', description: 'Capital handed over', debit: 6000, credit: 0, balance: 6000 },
  { date: '2026-08-20', kind: 'fee', description: 'Email', debit: 28.75, credit: 0, balance: 6028.75 },
  { date: '2026-09-01', kind: 'payment', description: 'Payment received', debit: 0, credit: 1000, balance: 5028.75 },
  /* THE ZERO-CHARGE LINE, at the firm's own instruction. See the statement's own note. */
  { date: '2026-09-13', kind: 'fee-no-charge', description: 'Correspondence', debit: 0, credit: 0, balance: 5028.75 },
]
const INPUT = {
  breakdown: BREAKDOWN, handedOver: 6000, asAt: '2026-09-27', money,
  status: 'Pre-legal', lines: LINES,
}

const summary = summaryOfAccount(INPUT)
const statement = statementOfAccount(INPUT)
const sText = lettersText(summary)
const tText = lettersText(statement)

/* ------------------------------------------------ the firm's own three sections */

ok('the summary is headed as one', /SUMMARY OF ACCOUNT/.test(sText))
ok('...and opens with the date the figures were struck',
  /as it stands on 27 September 2026/.test(sText))
ok('...carrying the firm’s own three sections', /Where the account stands/.test(sText)
  && /How the balance is made up/.test(sText) && /How to pay/.test(sText))
/* THE STATUS ROW IS THE FIRM'S WORD FOR THE RUNG, off the derived position and never a column. */
ok('...and says where the account stands in the firm’s words', /Pre-legal/.test(sText))
/* LEFT OUT RATHER THAN PRINTED EMPTY: a STATUS row with nothing beside it is a question the
   debtor rings about. */
ok('...left out entirely where it cannot be read',
  !/STATUS/.test(lettersText(summaryOfAccount({ ...INPUT, status: null }))))

/* ------------------------------------------------ the arithmetic a debtor can check */

/*
 * VAT IS A COMPONENT OF THE FEES, NEVER A SEVENTH ADDEND. BalanceBreakdown says so and the row
 * has to mean it: printed as an addend the page overstates the debt by the VAT, and a debtor
 * adding the column up would be right to query it. So the fees row is NET and the VAT row says
 * how much tax is inside it.
 */
ok('the fees row is net of the VAT beside it', sText.includes(money(558.90 - 72.90)))
ok('...with the VAT said separately', sText.includes(money(72.90)))
const addsUp = 6000 + 182.40 + (558.90 - 72.90) + 72.90 - 1000
check('...and the column adds to the balance printed', Math.round(addsUp * 100) / 100, 5741.30)
ok('the balance now owing is on the page', /BALANCE NOW OWING/.test(sText) && sText.includes(money(5741.30)))
/*
 * THE HAND-OVER BALANCE NEVER MOVES, which is the whole reason it is not {{capital}}.
 *
 * READ OUT OF THE ROW, NOT OFF THE PAGE. R6 000 appears in the bar's note and in the statement's
 * first movement as well, so a text search passes with the row itself showing the capital still
 * outstanding -- which is a different number on every account that has ever paid anything.
 */
const madeUp = summary.blocks.find(
  (b) => b.kind === 'table' && b.rows.some((r) => r[0].spans[0].text === 'Hand-over balance'))
ok('the balance table is there to read', madeUp !== undefined)
const rowFor = (label) => (madeUp.rows.find((r) => r[0].spans[0].text === label) ?? [])[1]?.spans[0].text
check('...measured from what was handed over', rowFor('Hand-over balance'), money(6000))
check('...and not from the capital still outstanding',
  rowFor('Hand-over balance') === money(BREAKDOWN.capital), false)

/*
 * AND WHERE A RULE HELD THE BALANCE DOWN, THE DEBTOR IS TOLD BY HOW MUCH. `withheld` is what in
 * duplum or a write-off refused to let grow; omitted, the page would not add up against the
 * account's own fee list and the difference would look like an error.
 */
const capped = lettersText(summaryOfAccount({
  ...INPUT, breakdown: { ...BREAKDOWN, withheld: 240, cappedBy: 'in duplum' },
}))
ok('a capped account says what was not recoverable', /Not recoverable \(in duplum\)/.test(capped))
ok('...and a written-off one says that instead',
  /Written off/.test(lettersText(summaryOfAccount({
    ...INPUT, breakdown: { ...BREAKDOWN, withheld: 240, cappedBy: 'written off' },
  }))))
ok('...and an ordinary account says neither',
  !/Not recoverable|Written off/.test(sText))

/* ------------------------------------------------ the bar the firm asked for */

/*
 * MEASURED AGAINST WHAT IT TAKES TO CLEAR THE ACCOUNT -- and it used to be measured against the
 * HAND-OVER BALANCE, on the argument that this page is about the debt the client gave us.
 *
 * THE FIRM SENT THAT BACK: "all across the board, wherever this bar is visible, it should be
 * calculated like that." And on this page the old measure was the worse of the two. Their own
 * test account was handed over at R 5 000 and has paid R 5 100 -- so the summary letter read
 * 100% PAID and then asked the debtor for R 1 350,28. progressPercent refuses to round to 100 a
 * rand short of the end precisely so that cannot happen, and a different denominator one line
 * lower undid it.
 *
 * R 1 000 paid, R 5 741.30 owing and no fee to settle is R 1 000 of R 6 741.30 -- 15%, where the
 * hand-over measure said 17%.
 */
const bar = summary.blocks.find((b) => b.kind === 'progress')
ok('the summary carries a drawn bar', bar !== undefined)
check('...at the proportion of what it takes to clear it', Math.round(bar.fraction * 100), 15)
ok('...with the percentage under it as the evidence', /15% paid/.test(sText))
/* THE FIGURES THE PERCENTAGE CAME FROM, because this page goes to a debtor and they are entitled
   to add it up themselves. */
ok('...and the two figures beside it', /R 1000\.00 of R 6741\.30/.test(sText))
ok('...named as what settling costs rather than as what is "still owed"',
  /R 5741\.30 to settle today/.test(sText))

/*
 * AND THE HAND-OVER FIGURE NO LONGER MOVES IT, which is what proves the old rule is gone rather
 * than merely agreeing by coincidence. R 1 000 of R 2 000 handed over used to read as half; the
 * balance is unchanged, so the bar must not move at all.
 */
const smallerHandover = summaryOfAccount({ ...INPUT, handedOver: 2000 })
check('the hand-over balance no longer decides it',
  Math.round(smallerHandover.blocks.find((b) => b.kind === 'progress').fraction * 100), 15)

/*
 * AND THE FEE ON SETTLING IS IN IT. The firm: "the receipt fee should be added and also included
 * always in that bar if the person settles the full amount." R 1 000 of R 6 741.30 is 15%; with a
 * R 610 fee to settle it is R 1 000 of R 7 351.30, which is 14.
 */
const withFee = summaryOfAccount({
  ...INPUT,
  breakdown: { ...BREAKDOWN, settlementFee: 610, settlement: 6351.30 },
})
check('the fee for settling is counted as still to come',
  Math.round(withFee.blocks.find((b) => b.kind === 'progress').fraction * 100), 14)

/* A SETTLED ACCOUNT IS FULL. It owes nothing and costs nothing to close, so the bar reaches its
   end rather than stopping short of it by a fee that will never be charged. */
check('...and a settled account is full',
  summaryOfAccount({
    ...INPUT,
    breakdown: { ...BREAKDOWN, payments: 6741.30, balance: 0, settlementFee: 610, settlement: 0 },
  }).blocks.find((b) => b.kind === 'progress').fraction, 1)

/* ------------------------------------------------ the statement is the working */

ok('the statement is headed as one', /STATEMENT OF ACCOUNT/.test(tText))
ok('...and carries every movement', /Every movement on the account/.test(tText))
for (const l of LINES) ok(`...including ${l.description} on ${l.date}`, tText.includes(l.description))
/*
 * A DASH, NOT R 0.00, IN THE COLUMN A LINE IS NOT IN. A nought in a debit column reads as a charge
 * of nothing rather than as no charge at all, and every second row of a statement carries one.
 *
 * ASSERTED ON BOTH COLUMNS OF BOTH KINDS OF LINE. Checking that SOME cell on some row holds a dash
 * passes while the debit column prints R 0.00 on every payment -- the credit column of a charge is
 * blank either way and satisfies it on its own.
 */
/*
 * FOUND BY ITS OWN HEADER, NOT BY COUNTING ROWS. A row count matched the balance table the moment
 * a row was taken off it, and the check then read column 3 of a two-column row and threw a
 * TypeError -- which prints a stack and NO COUNT, and run-all reads the count. CLAUDE.md's second
 * trap, met head-on.
 */
/* FIVE COLUMNS AND A HEADER READING DATE. "DATE" alone matches the ADDRESS table at the top of
   the page, whose first row is the letter's own date -- found by that, every assertion below was
   reading the wrong table. */
const movements = statement.blocks.find(
  (b) => b.kind === 'table' && b.rows[0]?.length === 5 && b.rows[0][0]?.spans?.[0]?.text === 'DATE')
ok('the movements table is there to read', movements !== undefined)
/* Read defensively past that, for the same reason. */
const cellText = (row, col) => movements?.rows?.[row]?.[col]?.spans?.[0]?.text ?? '(missing)'
/* Row 1 is the handover: a debit of R6 000 and nothing on the credit side. */
check('a charge shows its debit', cellText(1, 2), money(6000))
check('...and a dash where there is no credit', cellText(1, 3), '—')
/* Row 3 is the payment: the other way round. */
check('a payment shows its credit', cellText(3, 3), money(1000))
check('...and a dash where there is no debit', cellText(3, 2), '—')
/*
 * THE ZERO-CHARGE LINE IS PRINTED AND EXPLAINED. The firm: "the last one was charged the 13th of
 * September but a lot of things happened after that, now I can't see them... maybe we put it
 * there and we have a zero charge that reflects on the statement."
 */
ok('...and a no-charge line says why it earned nothing',
  /Annexure B ceiling for this debt had been reached/.test(tText))
/* NOT keepTogether, unlike the arrangement ladder: ninety-six rows is a record read down a page,
   and held together it would refuse to start until a page had room for all of it. */
ok('the movements table may break across pages', movements.keepTogether !== true)
/* AN ACCOUNT WITH NOTHING ON IT IS SAID, not drawn as an empty table. */
ok('a statement with no movements says so',
  /Nothing has been charged or received on this account yet/.test(
    lettersText(statementOfAccount({ ...INPUT, lines: [] }))))

/*
 * ONE SKELETON, TWO DOCUMENTS. The day they drift is the day a debtor holds a summary and a
 * statement side by side that disagree about what they owe -- so everything except the movements
 * is asserted to be on both.
 */
for (const shared of ['Where the account stands', 'How the balance is made up', 'How to pay',
  'BALANCE NOW OWING', 'PAYMENT MUST BE MADE INTO OUR LEGAL PRACTITIONER TRUST ACCOUNT']) {
  ok(`both carry "${shared}"`, sText.includes(shared) && tText.includes(shared))
}
ok('...and only the statement carries the movements',
  tText.includes('Every movement on the account') && !sText.includes('Every movement on the account'))

/* ------------------------------------------------ what a debtor may be shown */

/*
 * THE TRUST ACCOUNT AND NOTHING ELSE. companies.banking_details is where remittance goes OUT to
 * the client and the business account is where a client pays commission IN; neither belongs on a
 * page a debtor reads. The closed merge vocabulary is the real protection -- no collections field
 * names the business account -- and this is the second half of it.
 */
for (const doc of [sText, tText]) {
  ok('the trust account is named', /\{\{firm_bank_name\}\}/.test(doc))
  ok('...and the business account is not', !/firm_business_bank/.test(doc))
  /*
   * OURS, NOT THE CLIENT'S: 21% of client references are shared between accounts, so a payment
   * quoting one cannot be allocated.
   *
   * ANCHORED ON THE PAY BLOCK'S OWN ROW. "OUR REFERENCE {{case_number}}" sits in the address table
   * at the top of both documents, so a loose search passes while the row a debtor actually types
   * into their banking app says something else entirely.
   */
  ok('...with our own case number to pay against',
    /PAYMENT MUST BE MADE[\s\S]*?\nREFERENCE\n\{\{case_number\}\}/.test(doc))
  ok('...and not the client’s reference',
    !/\nREFERENCE\n\{\{reference\}\}/.test(doc))
}

/*
 * EVERY FIELD IS ONE THE COLLECTIONS VOCABULARY OFFERS. A typo, or a field written for the sales
 * side, resolves to a literal {{brace}} on a page a debtor reads -- and letterPdfBytes refuses to
 * draw it at all, so the failure is a button that does nothing.
 */
for (const [name, doc] of [['summary', summary], ['statement', statement]]) {
  check(`the ${name} asks for nothing outside its scope`,
    unknownFields('collections', lettersText(doc)), [])
  const problems = letterProblems(doc, 'collections')
  ok(`...and nothing stops it being sent`, canUseLetter(problems))
  check(`...with no problems at all`, problems.map((p) => p.message ?? p), [])
  /* The printer's two, which letterPdf fills. */
  ok(`...and its foot numbers the pages`,
    PRINTER_FIELDS.every((f) => (doc.runningFoot ?? '').includes(`{{${f}}}`)))
  ok(`...naming which document it is`, /^(Summary|Statement) of account /.test(doc.runningFoot))
  /* THE FIRM'S OWN FACE. A page set in something else is visibly not theirs. */
  ok(`...set in Charter`, /Charter/.test(doc.defaults.font))
}

/* THE IDENTITY NUMBER IS OPTIONAL AND ITS LINE LEAVES WITH IT -- 97% of the book has none. */
ok('the identity number is the optional field it is everywhere else',
  MERGE_FIELDS.collections.find((f) => f.key === 'debtor_id_masked')?.optional === true)
ok('...and both documents carry it as a paragraph of its own',
  /Identity number: \{\{debtor_id_masked\}\}/.test(sText)
  && /Identity number: \{\{debtor_id_masked\}\}/.test(tText))

/* ------------------------------------------------ the new merge field */

/*
 * {{balance_handover}} IS NOT {{capital}} AND NOT {{balance}}. The covering email's three lines
 * only read as a story if the first never moves: {{capital}} falls as payments are allocated to
 * it, and {{balance}} is everything owed today.
 */
const keys = MERGE_FIELDS.collections.map((f) => f.key)
ok('what was handed over is its own field', keys.includes('balance_handover'))
const values = read('../../src/lib/messageTemplates.ts')
ok('...read off the handover, never derived from the balance',
  /balance_handover: input\.money\(a\.capitalHandedOver\)/.test(values))
ok('...and the account screen passes it', /capitalHandedOver: account\.capitalHandedOver/
  .test(read('../../src/pages/accounts/AccountDetail.tsx')))

/* ------------------------------------------------ and it can actually be sent */

const panel = read('../../src/components/collections/AccountDocuments.tsx')
const desk = read('../../src/pages/accounts/AccountDetail.tsx')
/*
 * IT DOES NOT SEND FROM HERE. The account's compose box sends through the collector's mailbox,
 * files the message and raises item 1(a) -- one path, one charge, one record. A sender here would
 * be a second place that has to remember the R25.
 */
ok('the control hands the drawn PDF up rather than sending it', /onEmail\(\{/.test(panel))
ok('...through letterPdfBytes, like every other notice', /letterPdfBytes\(\{/.test(panel))
ok('...refusing a document this account cannot fill', /filled: true/.test(panel))
ok('...with the firm’s own covering wording merged', /renderTemplate\(template\.body/.test(panel))
/* THE AUDIENCE PICKS THE HALF, like every other collections template. */
ok('...chosen for the debtor in front of the collector',
  /audience === 'company' \? SEEDS\[kind\]\.company : SEEDS\[kind\]\.individual/.test(panel))
/* THE WHOLE TAG, or the assertion passes on a renamed component that does not exist. */
ok('the transactions tab draws it beside Print', /<AccountDocuments\s/.test(desk))
ok('...and imports it', /import \{ AccountDocuments \} from/.test(desk))
ok('...and opens the one compose box on the account', /setComposeTo\(emailContact\?\.value \?\? ''\)/.test(desk))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-account-documents: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
