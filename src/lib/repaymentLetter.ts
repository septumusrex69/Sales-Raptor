/**
 * THE REPAYMENT SCHEDULE AS A LETTER THE DEBTOR CAN BE SENT.
 *
 * THE FIRM, HAVING ASKED FOR THE CALCULATOR: "even if possible, we can create a document that we
 * can send him."
 *
 * BUILT RATHER THAN MERGED, AND THAT IS WHY IT IS CODE AND NOT A LIBRARY TEMPLATE. Every other
 * notice in Raptor is wording the firm wrote with `{{fields}}` in it, and that is the right shape
 * for a notice: the words are theirs, the values are ours. This one cannot be: a merge field is a
 * scalar, and the body of this letter is a table whose LENGTH is the answer -- thirty-one rows on
 * one arrangement and six on another. So the blocks are assembled here.
 *
 * WHAT STAYS THE FIRM'S: everything that is not the schedule. The letterhead, the bank details, the
 * signatory, the debtor's name and reference all come through the same merge values every other
 * letter uses, so a change to the trust account reaches this document the day it is made.
 *
 * IT IS AN ILLUSTRATION AND IT SAYS SO TWICE. This is not a demand, not a statement, and not an
 * agreement -- it is what the arrangement being discussed would cost if it were kept exactly. A
 * debtor who receives a schedule of figures on a firm's letterhead will reasonably treat it as
 * binding unless it is told otherwise in plain words, and the figures move the moment anything on
 * the account does.
 *
 * ONLY FOR AN ARRANGEMENT THAT ACTUALLY SETTLES. See repaymentLetterRefusal: a schedule with no
 * end is not a document to send anybody.
 */
import type { Block, LetterDocument } from './letterDocument.ts'
import type { RepaymentPlan, SettlementOption } from './repaymentPlan.ts'
import { moneyProgress, progressPercent } from './paymentProgress.js'
import { longDate } from './messageTemplates.js'

/** The face the firm's own notices are set in. See charter.ts. */
const CHARTER = '"Charter", "Bitstream Charter", Georgia, serif'

/**
 * WHY THIS ARRANGEMENT CANNOT BE PUT ON PAPER, or null where it can.
 *
 * THE ANSWER IS A SENTENCE, NOT A BOOLEAN, because the button that is refused has to say why. And
 * every refusal here is about the DEBTOR rather than about the code: a schedule that never ends is
 * not a document, and neither is one for an offer that does not clear the account.
 */
export function repaymentLetterRefusal(plan: RepaymentPlan): string | null {
  if (plan.outcome === 'never') {
    return 'This offer does not cover the interest, so there is no schedule to send: the account '
      + 'would never be settled by it.'
  }
  if (plan.outcome === 'not_within') {
    return plan.rows.length <= 1
      ? 'A single payment that does not settle the account has no schedule to send.'
      : 'This offer does not clear the account, so a schedule of it would have no end to show.'
  }
  if (plan.rows.length === 0) return 'There is nothing to put on a schedule yet.'
  return null
}

const p = (text: string, over: Partial<Block> = {}): Block =>
  ({ kind: 'paragraph', spans: [{ text }], ...over } as Block)
const h = (level: 1 | 2, text: string): Block =>
  ({ kind: 'heading', level, spans: [{ text }] } as Block)
const pair = (label: string, value: string, bold = false) => [
  { spans: [{ text: label, bold: true }] },
  { spans: [{ text: value, ...(bold ? { bold: true } : {}) }] },
]

export interface RepaymentLetterInput {
  plan: RepaymentPlan
  /** What is owed today, before any of this. Printed so the debtor can see where it starts. */
  balanceToday: number
  /** "a month" / "a week", already in the firm's words. */
  each: string
  /**
   * WHAT THE SAME DEBT COSTS AT DIFFERENT SPEEDS, and what paying faster saves them.
   *
   * THE FIRM: "show how it would look like in, for example, settling this in three or four
   * instalments... so that we can negotiate and the people can see how fast they would pay it off
   * and how much they would save -- kind of as a motivational thing that they pay more faster."
   *
   * PASSED IN RATHER THAN WORKED OUT HERE, like every other figure on this page: settlementLadder
   * bisects the same projection the schedule below is drawn from, so the two cannot disagree about
   * what a month costs. Empty is fine and common -- a debtor already settling in one payment has
   * nothing faster to be shown.
   */
  faster?: SettlementOption[]
  /** Payments received on the account, for the progress line. Omitted where none have been. */
  paidSoFar?: number
  /** The caller's own money formatter, so this letter and the screen agree to the cent. */
  money: (n: number) => string
}

/**
 * The schedule, as a document.
 *
 * THE SUMMARY COMES BEFORE THE TABLE, because the three figures at the top are the whole point and
 * a debtor who reads nothing else should still have read them: what they pay in all, and how much
 * of it never touches the debt.
 */
export function repaymentLetter(input: RepaymentLetterInput): LetterDocument {
  const { plan, money, each } = input
  const first = plan.rows[0]
  const last = plan.rows[plan.rows.length - 1]

  const blocks: Block[] = [
    {
      kind: 'table',
      borders: 'none',
      widths: [28, 72],
      rows: [
        pair('DATE', '{{today}}'),
        pair('OUR REFERENCE', '{{case_number}}'),
        pair('ACCOUNT', '{{account_number}}'),
      ],
    },
    { kind: 'paragraph', spans: [{ text: '{{debtor_name}}', bold: true }] },
    h(1, 'WHAT THIS PAYMENT ARRANGEMENT WOULD COST'),
    /*
     * THE FIRST CAVEAT, IN THE OPENING SENTENCE rather than in small print at the end. A debtor
     * given a page of figures on a firm's letterhead will treat it as settled unless the very
     * first thing they read says otherwise.
     */
    p(`This sets out what it would cost to settle your account with {{client_name}} by paying `
      + `${money(first.amount)} ${each}, starting ${longDate(first.dueOn)}. It is an illustration `
      + 'of the arrangement we discussed, not a demand and not an agreement.'),

    h(2, 'In summary'),
    /*
     * ONE TABLE, AND THE LAST THREE ROWS ARE WHAT NEVER TOUCHES THE DEBT -- the figure a debtor has
     * never been shown, and the one that makes a shorter arrangement worth agreeing to.
     *
     * IT WAS TWO TABLES, split so the second read as a breakdown of the first. On the page they
     * drew as one table with a gap in it, and the gap cost three millimetres the document could not
     * spare -- see the note about the signature below.
     */
    {
      kind: 'table',
      borders: 'rows',
      widths: [55, 45],
      rows: [
        pair('Outstanding today', money(input.balanceToday)),
        pair(`You would pay, ${each}`, money(first.amount)),
        pair('Number of payments', String(plan.rows.length)),
        pair('Final payment', `${money(last.amount)} on ${longDate(last.dueOn)}`),
        pair('Total you would pay', money(plan.totalPaid), true),
        pair('Of that, interest', money(plan.totalInterest)),
        pair('Of that, receipt fees', money(plan.totalReceiptFees)),
        pair('Which leaves, off the debt', money(
          Math.round((plan.totalPaid - plan.totalInterest - plan.totalReceiptFees) * 100) / 100,
        )),
      ],
    },
    /*
     * AND NOT A LINE HERE ABOUT INTEREST COSTING LESS THE FASTER IT IS PAID, which used to sit under
     * this table. The comparison further down says the same thing in the same words and has the
     * figures beside it, so on the page it read as the document repeating itself -- and the
     * duplicate was four lines the letter could not afford.
     */
  ]

  /*
   * AND WHAT PAYING FASTER WOULD SAVE THEM, which is the reason this page exists at all.
   *
   * THE SAVING IS MEASURED AGAINST THEIR OWN OFFER, so it is the difference between what they said
   * and what is being suggested rather than a number the firm chose. Only options FASTER than the
   * offer appear: showing a debtor how to pay less each month and more in total is not a
   * negotiation, it is an invitation.
   */
  if ((input.faster ?? []).length > 0) {
    blocks.push(h(2, 'What it would cost to clear it sooner'))
    /*
     * THE TABLE GOES STRAIGHT UNDER THE HEADING, with nothing between them, and the explaining is
     * done below it.
     *
     * NOT A PREFERENCE. A paragraph in between defeats the layout's own rule that a heading is not
     * left alone at the foot of a page: the rule reserves room for the heading and the two lines
     * that follow it, those two lines are the paragraph, they fit -- and the table then moves
     * overleaf, leaving a page that ends on a heading and a promise. With the table adjacent, the
     * heading reserves the header and two rows of it and the whole group travels together.
     */
    blocks.push({
      kind: 'table',
      borders: 'all',
      widths: [22, 26, 26, 26],
      headerRow: true,
      /* THE ONE TABLE IN RAPTOR THAT MUST NOT BREAK. It is five rows and it is the argument: split
         after the third, the debtor turns the page having seen their own offer and the two smallest
         savings, and the two rows worth the most to them are overleaf. */
      keepTogether: true,
      rows: [
        [
          { spans: [{ text: 'PAYMENTS', bold: true }] },
          { spans: [{ text: `EACH ${each.toUpperCase()}`, bold: true }] },
          { spans: [{ text: 'TOTAL YOU PAY', bold: true }] },
          { spans: [{ text: 'YOU SAVE', bold: true }] },
        ],
        ...(input.faster as SettlementOption[]).map((o) => [
          /*
           * NAMED, NOT NUMBERED, AT BOTH ENDS OF THE LADDER. "31" under a PAYMENTS heading is a
           * number a debtor reads past; "Your offer" is the line they recognise as their own, and
           * it is what makes the three rows under it a comparison rather than a demand.
           */
          {
            spans: [{
              text: o.theirs ? 'Your offer' : (o.instalments === 1 ? 'Settle now' : String(o.instalments)),
              bold: Boolean(o.theirs),
            }],
          },
          { spans: [{ text: money(o.each), bold: Boolean(o.theirs) }] },
          { spans: [{ text: money(o.totalPaid), bold: Boolean(o.theirs) }] },
          /*
           * The one figure on the page that is good news, and it is theirs. A DASH ON THEIR OWN
           * ROW rather than R 0.00: a nought in a column headed YOU SAVE reads as a saving that
           * happens to be nothing, when what is true is that there is nothing to measure yet.
           */
          { spans: [{ text: o.theirs ? '\u2014' : money(o.saving), bold: !o.theirs }] },
        ]),
      ],
    })
    /* WHAT THE TABLE DOES NOT SAY ON ITS OWN. Every row asks for more a month than they offered --
       that is what paying faster means -- and a debtor who reads only the saving column will be
       surprised by the first figure. Said here rather than left to be discovered. */
    blocks.push({
      kind: 'paragraph',
      spans: [{
        text: 'Your own offer is the first line. Every line below it asks for more '
          + `${each}: that is what makes it shorter, and it is where the saving comes from. `
          + 'Interest runs on what is still owed, so every month the account stands costs you more.',
        size: 9,
      }],
    })
  }

  /*
   * HOW FAR THEY ALREADY ARE, where anything has been paid -- AFTER the comparison, not before it.
   *
   * The firm described the page in order: their own offer at the top, "and then 10 instalments, six
   * instalments, three instalments, settle". So the summary and the ladder are the first page and
   * the bar opens the second. It is also what makes the letter two pages rather than three: the
   * ladder cannot be broken (see keepTogether), so anything between it and the summary pushes the
   * whole table over and leaves a hole at the foot of page one.
   *
   * THE FIRM: "how far are they with their payments? What is the progress and the percentage of
   * what's been paid?" This used to be figures and a percentage, on the argument that there was no
   * bar to draw on a page -- the letter engine had no fill, and the block characters that would
   * fake one are outside Windows-1252, which is the whole repertoire a PDF in the standard faces
   * may contain. The firm read that and said what they had actually meant: "the percentage is nice,
   * but there should be an image." So the engine grew a filled rectangle. See ProgressBlock.
   *
   * AGAINST EVERYTHING CHARGED, not the capital handed over. A debtor who has paid the capital and
   * owes three thousand in interest is not finished, and a line reading 100% would tell them so.
   *
   * NOTHING PAID IS NOT PROGRESS, and is left off: "you have paid 0%" on a page asking somebody for
   * money is a sentence that makes an arrangement less likely, not more.
   */
  if ((input.paidSoFar ?? 0) > 0) {
    const m = moneyProgress({ payments: input.paidSoFar as number, balance: input.balanceToday })
    blocks.push(h(2, 'What you have paid so far'))
    /*
     * A DRAWN BAR, WHICH THE FIRM ASKED FOR BY NAME: "the bar, it should be literally like a
     * physical bar... how far are you in terms of your payment? Not the percentage. The percentage
     * is nice, but there should be an image. On the PDF created like an image."
     *
     * The percentage stays, under it, because it is the evidence for the picture -- but the picture
     * is what a debtor reads first, and it was the half that was missing. See ProgressBlock for why
     * two rectangles rather than an actual image.
     */
    blocks.push({
      kind: 'progress',
      fraction: m.fraction,
      note: `${money(m.recovered)} paid of ${money(m.charged)} charged, including interest and `
        + `fees \u00b7 ${progressPercent(m)}% of the account`,
    } as Block)
    /*
     * AND NO TABLE UNDER IT. The three rows that used to sit here -- paid to date, charged in all,
     * which is N% -- are the same three figures the note already carries, in the same order, four
     * lines further down the page. The bar plus its own line IS the section now.
     */
  }

  /*
   * THE FIRM'S OWN WARNING, WORD FOR WORD OFF THEIR ARRANGEMENT LETTERS, and only where it
   * applies. A debtor deciding between six payments and thirty is entitled to know that the choice
   * is reported to the credit bureaus, and they are told exactly what the confirmation letter tells
   * them -- one firm, one sentence.
   */
  if (plan.readsAsSlowPaying) {
    blocks.push(h(2, 'How this is reported'))
    blocks.push(p('An arrangement that takes more than six instalments to settle the account is '
      + 'reported to the registered credit bureaus as slow paying, which every credit provider who '
      + 'assesses you can see. A shorter arrangement reads better on your profile.'))
  }

  blocks.push(h(2, 'How to pay'))
  blocks.push({
    kind: 'table',
    borders: 'rows',
    widths: [34, 66],
    rows: [
      pair('BANK', '{{firm_bank_name}}'),
      pair('ACCOUNT NAME', '{{firm_bank_holder}}'),
      pair('BRANCH CODE', '{{firm_bank_branch}}'),
      pair('ACCOUNT NUMBER', '{{firm_bank_account}}'),
      pair('PAYMENT REFERENCE', '{{case_number}}'),
      pair('QUESTIONS', 'Speak to {{collector_name}} on {{firm_phone}}'),
    ],
  })

  /*
   * THE SECOND CAVEAT, AND THE ONE THAT MATTERS MOST. The figures are exact arithmetic on stated
   * assumptions, and both of those are worth saying: exact, so a debtor can check them, and on
   * assumptions, so nobody treats them as a balance. `plan.assumption` is the same sentence the
   * screen shows the collector, so the debtor and the person who quoted them are reading one thing.
   */
  blocks.push(h(2, 'What this does not do'))
  blocks.push(p('These figures are worked out exactly, on two assumptions. ' + plan.assumption))
  blocks.push(p('They are not a statement of your account and they do not replace one. Nothing '
    + 'here changes what you owe, and an arrangement only exists once it has been agreed with us '
    + 'and confirmed in writing. If a payment is missed the arrangement lapses and these figures '
    + 'no longer apply.'))
  if (plan.hitInDuplum) {
    /* Where the ceiling binds, the debtor is entitled to know that it is what is holding the
       figures down -- and that it is the law doing it rather than the firm's goodwill. */
    blocks.push(p('Interest and fees on this account have reached the limit set by section 103(5) '
      + 'of the National Credit Act, which is the capital outstanding when the account was handed '
      + 'to us. They do not grow beyond it.'))
  }

  blocks.push({ kind: 'paragraph', spans: [{ text: 'Yours faithfully' }], keepWithNext: true })
  blocks.push({
    kind: 'signature',
    widthMm: 70,
    spans: [{
      text: '{{collector_name}}\nfor and on behalf of {{firm_name}}\n'
        + 'duly authorised agent of {{client_name}}',
    }],
  } as Block)

  return {
    defaults: { font: CHARTER, size: 10.5, colour: '#1f2937', lineHeight: 1.45 },
    runningFoot: 'Payment arrangement illustration · Ref {{case_number}} · Page {{page}} of {{pages}}',
    blocks,
  }
}
