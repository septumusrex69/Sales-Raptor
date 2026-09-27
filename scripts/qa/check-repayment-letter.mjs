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
 * IT SAYS WHAT IT IS IN A NOTE AT THE TOP, not in small print at the end -- and the firm's own
 * covering email sends the debtor there by name: "Please read the note at the top of it." A debtor
 * given a page of figures on a firm's letterhead treats it as settled unless the first thing they
 * read says otherwise.
 */
ok('it calls itself a simulation in the heading',
  /PAYMENT SIMULATION: WHAT AN ARRANGEMENT WOULD COST/.test(text))
ok('the note says it is not a statement of the account',
  /THIS IS A SIMULATION, NOT A STATEMENT OF YOUR ACCOUNT/.test(text))
ok('...and not a demand or an agreement either',
  /not a demand, not an agreement and not a statement of account/.test(text))
/*
 * THE ANNEXURE B EXCLUSION, WHICH IS THE ONE THAT COSTS MONEY TO GET WRONG.
 *
 * Every figure on the page is capital, interest and the receipt fee on each payment -- and nothing
 * else. The Act's prescribed fees for the work done on the account are raised as that work happens
 * and are in no total here. A debtor handed "Total you would pay R 609,76" who then receives an
 * account for more has been misled by a document the firm wrote, and the firm's own covering email
 * says so four times.
 */
ok('the note excludes the Annexure B fees',
  /fees prescribed in Annexure B to the Debt Collectors Act 114 of 1998 are not included/.test(text))
ok('...and says the amount actually paid will be higher',
  /amount you actually pay will therefore be higher/.test(text))
/* AND AGAIN UNDER THE TOTALS, because that table is the part somebody photographs. */
ok('...and the summary carries it on its own',
  /Annexure B fees are excluded from every figure above/.test(text))
/* THE NOTE IS AT THE TOP. The block window is generous because the address table, the name and the
   identity paragraph come first; it is still nowhere near the small print. */
const opening = lettersText({ ...doc, blocks: doc.blocks.slice(0, 8) })
ok('...and it is in the OPENING, not the small print',
  /not a demand, not an agreement/.test(opening))
ok('...with the Annexure B exclusion up there too',
  /Annexure B/.test(opening))

/* AND A SECTION SPELLING OUT WHAT IS LEFT OUT, which is what the covering email points at. */
ok('it lists what the figures do not include', /What these figures do not include/.test(text))
ok('...naming the Act by name', /Debt Collectors Act 114 of 1998 prescribes what a debt collector may charge/.test(text))
ok('...and the collection work that has not happened yet',
  /assume no further work is charged over the life of the arrangement/.test(text))
ok('...and legal costs', /Legal costs, if the account goes further/.test(text))

/* AND AGAIN AT THE END, where somebody who read only the figures will land. */
ok('it says an arrangement exists only once confirmed in writing',
  /an arrangement exists only once it is agreed with us and confirmed in writing/.test(text))
ok('...that it is not a statement of the account',
  /not a statement of your account and do not replace one/.test(text))
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

/*
 * AND THE ROW-BY-ROW SCHEDULE IS GONE, WHICH THE FIRM ASKED FOR: "inside the schedule, I would
 * remove all of that, that big thing where every single payment is shown."
 *
 * IT WAS THERE ON A REASONABLE ARGUMENT -- a debtor asked to agree to thirty-one payments is
 * entitled to see thirty-one payments -- and the firm, who have the conversation, say it buries the
 * page. Thirty-one rows of arithmetic between the offer and the comparison is where a reader stops,
 * and the comparison is the half that changes what they do. The working is still on the collector's
 * own panel, where the person who has to defend the figure can read it.
 *
 * ASSERTED BY THE HEADING AND BY A MIDDLE ROW'S FIGURE, in that order. The heading alone would pass
 * on a table whose heading somebody renamed; a figure alone would be a coincidence away from
 * passing, because a running balance can repeat a summary figure. Payment 16's closing balance
 * appears nowhere else on the page.
 */
ok('the every-payment table is not on the schedule any more', !/Every payment/.test(text))
ok('...not even a middle row of it', !text.includes(money(plan.rows[15].balanceAfter)))
/* WHERE IT ENDS IS STILL ON THE PAGE, in the summary: the last payment and its date. Removing the
   table must not remove the answer to "when am I finished", which is the question the debtor asked. */
ok('the final payment is still named', text.includes(money(plan.rows[plan.rows.length - 1].amount)))
ok('...with the day it falls', text.includes('Final payment'))
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
/*
 * THEIR OWN OFFER IS THE FIRST LINE, which is what the firm asked for: "I'll just put that one in
 * the top, like it's 500 rand. And then 10 instalments, six instalments, three instalments, settle."
 * Without it the three rows below are a price list; with it they are what their own offer costs and
 * what each step up would save.
 */
ok('their own offer is named on the ladder', /Your offer/.test(withLadder))
ok('...and it is the instalment they actually offered',
  withLadder.includes(money(faster[0].each)) && faster[0].theirs === true)
/* A DASH ON THEIR OWN ROW, NOT R 0.00. A nought in a column headed YOU SAVE reads as a saving that
   happens to be nothing; what is true is that it is the row everything else is measured from. */
ok('...and saves nothing, said as a dash rather than a nought',
  /\u2014/.test(withLadder))
for (const o of faster.filter((x) => !x.theirs)) {
  ok(`...the saving on ${o.instalments} payments`, withLadder.includes(money(o.saving)))
  ok(`...and what each one would be`, withLadder.includes(money(o.each)))
  /* THE FIRM'S RULE, ON THE PAGE: no line asks for less a month than they already offered. */
  ok(`...which is not less than they offered (${o.instalments})`, o.each >= faster[0].each)
}
/* AND THE PAGE SAYS SO, rather than leaving a debtor to notice that every figure went up. */
ok('the page says every line below asks for more',
  /asks for a bigger payment every month/.test(withLadder))
/* SETTLING IN ONE PAYMENT IS NOT "1 payments". */
ok('one payment reads as settling now', /Settle now/.test(withLadder))

/*
 * ---------- THE COLUMN HEAD THAT TOLD A DEBTOR A SETTLEMENT WAS WEEKLY ----------
 *
 * The head was `EACH ${each.toUpperCase()}`, so a weekly arrangement drew "EACH A WEEK" -- and the
 * last row of that column is the figure for settling in FULL, in one payment. The firm read it back
 * as "each week total you pay" and said it did not look right: the page was telling a debtor that
 * clearing the account costs fourteen thousand rand every week.
 *
 * ASSERTED IN BOTH DIRECTIONS, and the absence is the half that matters -- a head that is merely
 * present tells us nothing about what else is printed beside the settlement figure.
 */
const weeklyLadderDoc = () => {
  const acc = account()
  const sched = { arrangement: 'weekly', dueOn: '2026-10-05', dayOfWeek: 1, dayOfMonth: null, onLastDay: false }
  const p = repaymentPlan({ account: acc, instalment: 500, schedule: sched })
  return {
    plan: p,
    text: lettersText(repaymentLetter({
      plan: p, balanceToday: 10200, each: 'a week', money,
      faster: settlementLadder({ account: acc, schedule: sched }, p),
    })),
  }
}
const weekly = weeklyLadderDoc()
ok('the ladder has a column for what one payment would be', /EACH PAYMENT/.test(weekly.text))
ok('...which never carries the frequency', !/EACH A WEEK|EACH A MONTH/i.test(weekly.text))
ok('...and the monthly page says it the same way', /EACH PAYMENT/.test(withLadder))
/* AND THE SETTLEMENT FIGURE IS STILL THERE. Renaming the head is only honest if the number it
   heads survived -- a column emptied of its figures would pass the assertion above. */
const settleNow = (weekly.plan.rows.length > 0
  ? settlementLadder(
    { account: account(), schedule: { arrangement: 'weekly', dueOn: '2026-10-05', dayOfWeek: 1, dayOfMonth: null, onLastDay: false } },
    weekly.plan,
  ).find((o) => o.instalments === 1)
  : null)
ok('...over the figure for settling in one payment',
  settleNow !== null && settleNow !== undefined && weekly.text.includes(money(settleNow.each)))
/* AND THE NOTE SAYS THAT ROW IS ONE PAYMENT, since the head no longer says anything about how
   often. Without it the column is honest and silent, which on a five-row ladder is not enough. */
ok('the note says the last line is a single payment',
  /The last line is one payment that closes the account\./.test(weekly.text))

/*
 * THE PERIOD IN THE PROSE IS THE ARRANGEMENT'S OWN. "every month the account stands costs you more"
 * was hard-coded, and printed under a table of weekly figures.
 */
ok('a weekly page talks in weeks', /every week the account stands/.test(weekly.text))
ok('...and never in months', !/every month the account stands/.test(weekly.text))
ok('a monthly page talks in months', /every month the account stands/.test(withLadder))

/*
 * ---------- A ZERO IN THE INTEREST ROW IS SAID OUT LOUD ----------
 *
 * THE FIRM READ A SIMULATION AND ASKED "NO INTEREST?" The account carried 24% a year and every
 * figure on the page was capital and receipt fees, because openAccrual has nothing to run from
 * until an accrual has been posted -- and 23 009 of the 23 781 accounts on the book are in that
 * state. The arithmetic was right and the page gave nobody a way to know it.
 *
 * THE COLLECTOR'S PANEL HAS SAID THIS SINCE IT WAS BUILT and the page that goes to the DEBTOR did
 * not, which is the half a debtor could hold the firm to: a quotation that silently omits interest
 * is one the firm is stuck with.
 */
const NO_INTEREST = 'No interest is running on this account, so no interest is included in any '
  + 'figure in this document.'
const bare = account({
  /* A new account, or one imported without its accrual history: a rate, and nothing posted. */
  ledgers: { payments: [], fees: [], interest: [] },
  inDuplum: false,
})
const barePlan = repaymentPlan({ account: bare, instalment: 500, schedule: monthly() })
/* THE PREMISE FIRST. Asserted before the sentence, or a fixture that quietly started accruing
   would make the absence below pass for the wrong reason. */
ok('the bare account really is not accruing', !barePlan.interestRunning)
check('...so every figure on it is capital and receipt fees', barePlan.totalInterest, 0)
const bareText = lettersText(repaymentLetter({
  plan: barePlan, balanceToday: 10000, each: 'a month', money,
  faster: settlementLadder({ account: bare, schedule: monthly() }, barePlan),
}))
ok('a page with no interest in it says so', bareText.includes(NO_INTEREST))
/*
 * AND NOTHING ELSE ON IT CLAIMS THE OPPOSITE. The note under the ladder ended "Interest runs on
 * what is still owed, so every week the account stands costs you more", which on a page that has
 * just said no interest is running is the firm contradicting itself in two adjacent paragraphs --
 * and a debtor would be entitled to pick whichever half suits them.
 */
ok('...and nothing under the ladder says interest is running',
  !/Interest runs on what is still owed/.test(bareText))
ok('...which an accruing page does say', /Interest runs on what is still owed/.test(withLadder))
/* AND ONLY THERE. The same sentence on an accruing account is a lie in the debtor's favour, which
   is still a lie -- and the row above it would contradict it on the same page. */
ok('...and a page with interest in it does not', !withLadder.includes(NO_INTEREST))
ok('the accruing fixture really is accruing', plan.interestRunning && plan.totalInterest > 0)

/*
 * ---------- THE FREQUENCY TRAVELS WITH THE AMOUNT ----------
 *
 * The summary row was labelled "You would pay, a week" with R 500.00 in the next column, which
 * split one phrase across two cells and read as neither half.
 */
ok('the summary names the payment and how often it falls in one cell',
  /R 500\.00 a week/.test(weekly.text))
ok('...under a label that is not half a sentence', !/You would pay, a week/.test(weekly.text))
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

/* ---------- one document, two moments ---------- */

/*
 * THE SAME PAGE GOES OUT TWICE AND THE WORDS HAVE TO SAY WHICH TIME IT IS.
 *
 * From the calculator it is a SIMULATION -- the firm: "this is before you conclude the payment
 * arrangement" -- and calling it a schedule would hand a debtor a page of figures that reads as
 * settled. It goes again behind the confirmation email once the arrangement is recorded, and there
 * the opposite is true: "simulation" would read as though the firm had not yet agreed to what it
 * had just agreed to.
 */
const agreed = repaymentLetter({ plan, balanceToday: 10200, each: 'a month', money, purpose: 'schedule' })
const agreedText = lettersText(agreed)
ok('the confirmation copy is a schedule, not a simulation',
  /YOUR PAYMENT ARRANGEMENT: WHAT IT WILL COST/.test(agreedText))
ok('...and never calls itself a simulation', !/simulation/i.test(agreedText))
ok('...and the running foot says so on every page',
  /^Payment arrangement schedule /.test(agreed.runningFoot ?? ''))
ok('the calculator copy is a simulation', /^Payment simulation /.test(doc.runningFoot ?? ''))
/* A SIMULATION UNLESS THE CALLER SAYS OTHERWISE, which is the safer of the two readings: it is the
   one that claims less, and it is what the calculator sends nearly every time. */
ok('...which is what an unmarked one is',
  (repaymentLetter({ plan, balanceToday: 10200, each: 'a month', money }).runningFoot ?? '')
    === (repaymentLetter({ plan, balanceToday: 10200, each: 'a month', money, purpose: 'simulation' }).runningFoot ?? ''))
/*
 * BUT THE EXCLUSION IS ON BOTH. It is a fact about the ARITHMETIC rather than about the moment --
 * neither version includes the fees the account will be charged as the work is done -- and a
 * confirmed arrangement is the one a debtor is MORE likely to treat as the final figure.
 */
ok('the Annexure B exclusion is on the confirmation copy too',
  /fees prescribed in Annexure B to the Debt Collectors Act 114 of 1998 are not included/.test(agreedText))
ok('...including the line under the totals',
  /Annexure B fees are excluded from every figure above/.test(agreedText))
ok('...and the section spelling it out', /What these figures do not include/.test(agreedText))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-repayment-letter: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
