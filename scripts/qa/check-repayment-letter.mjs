/**
 * THE REPAYMENT SCHEDULE AS A DOCUMENT THE DEBTOR IS SENT.
 *
 * THE FIRM: "even if possible, we can create a document that we can send him."
 *
 * WHAT THIS GUARDS IS NOT THE LAYOUT, IT IS WHAT THE PAGE CLAIMS. A debtor who receives a page of
 * figures on a debt collector's letterhead will reasonably treat it as binding, and every figure on
 * it moves the moment anything on the account does. So the caveats are asserted harder than the
 * arithmetic is: that it says it is an illustration, that it says what it assumes, that it says an
 * arrangement exists only once confirmed in writing, and that it is REFUSED outright for an offer
 * that never clears the account -- a schedule with no end is not a document.
 *
 * AND THE FIGURES ON IT ARE THE ONES ON THE SCREEN, to the cent: the collector quotes from one and
 * the debtor reads the other, and the day they disagree is the day the firm is held to the smaller.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-repayment-letter.mjs
 */
import { repaymentLetter, repaymentLetterRefusal } from '../../src/lib/repaymentLetter.ts'
import { repaymentPlan, settlementLadder } from '../../src/lib/repaymentPlan.ts'
import {
  canUseLetter, letterProblems, lettersText, PRINTER_FIELDS,
} from '../../src/lib/letterDocument.ts'
import { unknownFields } from '../../src/lib/messageTemplates.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

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
const money = (n) => `R ${n.toFixed(2)}`
const letterFor = (instalment, acc = account(), schedule = monthly()) => {
  const plan = repaymentPlan({ account: acc, instalment, schedule })
  return {
    plan,
    doc: repaymentLetter({ plan, balanceToday: 10200, each: 'a month', money }),
  }
}

const { plan, doc } = letterFor(500)
const text = lettersText(doc)

/* Asserted present before anything about its contents, or an empty document passes vacuously. */
ok('there is a document to read', doc.blocks.length > 12)
check('...and every payment is on it', plan.rows.length, 31)

/* ---------- it is a letter the firm can actually send ---------- */

/*
 * THE SAME GATE THE LIBRARY USES. letterProblems is what says a letter's merge fields can be
 * filled from this side, and canUseLetter is the gate letterPdfBytes runs before it draws
 * anything -- so a document that passes here is one that will attach, not merely one that parses.
 */
const problems = letterProblems(doc, 'collections')
check('the schedule has no problems the library would refuse', problems.map((p) => p.message ?? p), [])
ok('...so it can be sent', canUseLetter(problems))
/* EVERY FIELD ON IT IS ONE THE COLLECTIONS SIDE OFFERS. The document is BUILT rather than written
   in the Library, so nothing has ever checked its field names until now -- a typo here resolves to
   a literal {{brace}} on a page going to a debtor. */
const unknown = unknownFields('collections', JSON.stringify(doc), null)
  .filter((f) => !PRINTER_FIELDS.includes(f))
check('...using only fields the collections side offers', unknown, [])
/* And the printer's two are in the running foot, where letterPdf fills them. */
ok('the running foot numbers the pages',
  PRINTER_FIELDS.every((f) => (doc.runningFoot ?? '').includes(`{{${f}}}`)))
/* THE FIRM'S OWN FACE, not a default. A schedule set in something else is visibly not theirs. */
ok('it is set in Charter', /Charter/.test(doc.defaults.font))

/* ---------- what the page claims about itself ---------- */

/*
 * IT SAYS IT IS AN ILLUSTRATION IN THE OPENING SENTENCE, not in small print at the end. A debtor
 * given a page of figures on a firm's letterhead treats it as settled unless the first thing they
 * read says otherwise.
 */
ok('the first paragraph says it is not a demand', /not a demand and not an agreement/.test(text))
ok('...and calls it an illustration', /illustration of the arrangement we discussed/.test(text))
const opening = lettersText({ ...doc, blocks: doc.blocks.slice(0, 5) })
ok('...and it is in the OPENING, not the small print', /not a demand/.test(opening))

/* AND AGAIN AT THE END, where somebody who read only the figures will land. */
ok('it says an arrangement exists only once confirmed in writing',
  /only exists once it has been agreed with us and confirmed in writing/.test(text))
ok('...that it is not a statement of the account',
  /not a statement of your account/.test(text))
ok('...and that a missed payment ends it', /If a payment is missed the arrangement lapses/.test(text))

/*
 * THE ASSUMPTION IS THE SAME SENTENCE THE COLLECTOR IS SHOWN. The firm chose it -- "in a world
 * where no fees accumulate, however the receipt fee is still applicable" -- and the debtor and the
 * person who quoted them must be reading one thing.
 */
ok('the assumption is on the page', text.includes(plan.assumption))
ok('...saying no further collection fees', /no further collection fees/i.test(text))

/* ---------- the figures are the ones on the screen ---------- */

/*
 * TO THE CENT, because the collector quotes from the screen and the debtor reads the page, and the
 * day they disagree is the day the firm is held to the smaller number.
 */
ok('the total on the page is the total on the screen', text.includes(money(plan.totalPaid)))
ok('...and the interest', text.includes(money(plan.totalInterest)))
ok('...and the receipt fees', text.includes(money(plan.totalReceiptFees)))
ok('...and how many payments it is', new RegExp(`\\b${plan.rows.length}\\b`).test(text))
/*
 * AND THE ARITHMETIC PROVES ITSELF ON THE PAGE: everything paid, less interest and fees, is what
 * was owed at the start. A debtor is entitled to add it up, and it has to come out.
 */
const offDebt = Math.round((plan.totalPaid - plan.totalInterest - plan.totalReceiptFees) * 100) / 100
check('what comes off the debt is what was owed', offDebt, 10200)
ok('...and that line is on the page', text.includes(`Which leaves, off the debt`))

/* EVERY ROW IS THERE, not a summary of them. A debtor asked to sign up to thirty-one payments is
   entitled to see thirty-one payments. */
for (const r of [plan.rows[0], plan.rows[15], plan.rows[plan.rows.length - 1]]) {
  ok(`payment ${r.no} is on the schedule`, text.includes(money(r.balanceAfter)))
}
/* The last row closes the account, which is the line the whole document exists to reach. */
check('the last row leaves nothing owing', plan.rows[plan.rows.length - 1].balanceAfter, 0)

/* ---------- the firm's own warning, where it applies ---------- */

/*
 * WORD FOR WORD OFF THE ARRANGEMENT CONFIRMATION LETTER. One firm, one sentence: a debtor told one
 * thing on the schedule and another on the confirmation has been told the firm does not know.
 */
ok('a long arrangement warns about slow paying', /reported to the registered credit bureaus as slow paying/.test(text))
const shortText = lettersText(letterFor(2020).doc)
ok('...and a short one does not', !/slow paying/.test(shortText))

/* ---------- in duplum, where it binds ---------- */

const capped = letterFor(250)
ok('the capped arrangement reached the ceiling', capped.plan.hitInDuplum)
ok('...and the page says which law is holding the figures down',
  /section 103\(5\) of the National Credit Act/.test(lettersText(capped.doc)))
ok('...while an uncapped one does not mention it',
  !/section 103\(5\)/.test(text))

/* ---------- and it is refused where there is nothing to send ---------- */

/*
 * A SCHEDULE WITH NO END IS NOT A DOCUMENT. The refusal is a SENTENCE rather than a boolean,
 * because the button it disables has to say why -- a collector who cannot find it once stops
 * looking for it.
 */
check('a schedule that settles is not refused', repaymentLetterRefusal(plan), null)
const never = repaymentPlan({ account: account({ inDuplum: false }), instalment: 150, schedule: monthly() })
check('an offer that never clears the account is refused', never.outcome, 'never')
ok('...in words a collector can read out', /never be settled/.test(repaymentLetterRefusal(never) ?? ''))
const shortOnce = repaymentPlan({
  account: account(), instalment: 2000, schedule: monthly({ arrangement: 'once_off' }),
})
ok('a once-off that leaves a balance is refused',
  /single payment that does not settle/.test(repaymentLetterRefusal(shortOnce) ?? ''))
const outran = repaymentPlan({ account: account(), instalment: 150, schedule: monthly() })
ok('an arrangement that outruns the horizon is refused',
  /no end to show/.test(repaymentLetterRefusal(outran) ?? ''))

/* ---------- the money formatter is the caller's ---------- */

/*
 * SO THE LETTER AND THE SCREEN AGREE TO THE CENT AND TO THE SEPARATOR. Formatted inside this file
 * it would be a second opinion about how the firm writes a rand amount, and en-ZA's thousands
 * separator is a non-breaking space -- which is deliberate on a letter, so it must come from the
 * one place that decides it.
 */
const odd = lettersText(repaymentLetter({
  plan, balanceToday: 10200, each: 'a month', money: (n) => `ZZZ${n.toFixed(2)}`,
}))
ok('every amount comes from the caller’s formatter', /ZZZ15267\.01/.test(odd))
ok('...and nothing is formatted any other way', !/R 15,267/.test(odd))
/* The shape of the arrangement is the caller's word too: "a week" on a weekly one. */
ok('a weekly arrangement is described as weekly',
  /R 500\.00 a week/.test(lettersText(repaymentLetter({
    plan, balanceToday: 10200, each: 'a week', money,
  }))))

/* ---------- what paying faster would save, on the page ---------- */

/*
 * THE FIRM ASKED FOR THIS ON THE DOCUMENT, not only on the collector's screen: "so that we can
 * negotiate and the people can see how fast they would pay it off and how much they would save --
 * kind of as a motivational thing that they pay more faster." It is the one thing on the page that
 * is good news, and it is the debtor's own money.
 */
const faster = settlementLadder({ account: account(), schedule: monthly() }, plan)
const withLadder = lettersText(repaymentLetter({
  plan, balanceToday: 10200, each: 'a month', money, faster,
}))
ok('the page shows what clearing it sooner would cost', /What it would cost to clear it sooner/.test(withLadder))
ok('...with a column for what they save', /YOU SAVE/.test(withLadder))
for (const o of faster) {
  ok(`...the saving on ${o.instalments} payments`, withLadder.includes(money(o.saving)))
  ok(`...and what each one would be`, withLadder.includes(money(o.each)))
}
/* SETTLING IN ONE PAYMENT IS NOT "1 payments". */
ok('one payment reads as settling now', /Settle now/.test(withLadder))
/* AND IT IS ABSENT WHERE THERE IS NOTHING FASTER TO SHOW, rather than an empty table: a heading
   over nothing reads as a page that failed to load. */
ok('no ladder, no heading', !/What it would cost to clear it sooner/.test(text))

/* ---------- how far they already are ---------- */

/*
 * THE FIRM: "how far are they with their payments? What is the progress and the percentage of
 * what's been paid?" There is no bar to draw on a page -- the letter engine has no cell fill, and
 * the block characters that would fake one are outside Windows-1252, which is the whole repertoire
 * a PDF in the standard faces may contain. So the figures and the percentage carry it.
 */
const withPaid = lettersText(repaymentLetter({
  plan, balanceToday: 8300, each: 'a month', money, paidSoFar: 2000,
}))
ok('the page says what has been paid so far', /What you have paid so far/.test(withPaid))
ok('...how much', withPaid.includes(money(2000)))
/*
 * AGAINST EVERYTHING CHARGED, not the capital handed over: a debtor who has paid the capital and
 * owes three thousand in interest is not finished, and a line reading 100% would tell them so.
 */
ok('...against everything the account has been charged', withPaid.includes(money(10300)))
ok('...as a percentage', /19% of the account/.test(withPaid))
/*
 * NOTHING PAID IS NOT PROGRESS, and is left off entirely. "You have paid 0%" on a page asking
 * somebody for money makes an arrangement less likely, not more.
 */
ok('a debtor who has paid nothing is not told they are at nought',
  !/What you have paid so far/.test(text))
ok('...nor one whose payments are unknown',
  !/What you have paid so far/.test(lettersText(repaymentLetter({
    plan, balanceToday: 10200, each: 'a month', money, paidSoFar: 0,
  }))))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-repayment-letter: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
