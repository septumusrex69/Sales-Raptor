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
  /**
   * WHETHER THIS IS AN OFFER BEING WEIGHED UP OR AN ARRANGEMENT THAT HAS BEEN AGREED.
   *
   * ONE DOCUMENT, TWO MOMENTS, AND THE WORDS HAVE TO SAY WHICH. The firm: "this is before you
   * conclude the payment arrangement" -- so from the calculator it is a SIMULATION, sent mid
   * negotiation, and calling it a schedule would hand a debtor a page of figures that reads as
   * settled. It goes out again with the confirmation email once the arrangement is recorded, and
   * there the opposite is true: that one IS the schedule, and "simulation" would read as though
   * the firm had not yet agreed to what it had just agreed to.
   *
   * THE ANNEXURE B EXCLUSION IS ON BOTH, because it is a fact about the ARITHMETIC rather than
   * about the moment -- neither version includes the fees this account will be charged as the
   * work is done. See the note at the top.
   */
  purpose?: 'simulation' | 'schedule'
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
  /*
   * THE SAME FACT IN TWO GRAMMARS, BECAUSE THE PAGE NEEDS BOTH.
   *
   * `each` is the caller's own phrase and it is already right where it belongs -- "R500.00 a week"
   * reads as a sentence. It does NOT read as a sentence anywhere else on the page: the summary row
   * said "You would pay, a week", the ladder's column head said "EACH A WEEK", and the note under
   * it said "asks for more a week". The firm read that column back as "each week total you pay"
   * and said it did not look right, which it did not.
   *
   * SO THE BARE NOUN IS DERIVED HERE RATHER THAN ASKED FOR. One argument, one place it can be
   * wrong -- and a caller cannot pass a frequency in one form and its noun in another.
   */
  const period = each.replace(/^an?\s+/i, '')
  const first = plan.rows[0]
  const last = plan.rows[plan.rows.length - 1]
  /* A simulation unless the caller says otherwise: the calculator is where this is sent from
     nearly every time, and the safer of the two readings is the one that claims less. */
  const simulating = input.purpose !== 'schedule'
  const title = simulating ? 'Payment simulation' : 'Payment arrangement schedule'

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
    /*
     * THE IDENTITY NUMBER AS A PARAGRAPH OF ITS OWN, which is how all four of the firm's notices
     * carry it -- and the reason it can be here at all is documentWithoutOptional: 97% of the book
     * has no ID number, so the block leaves with the field rather than printing braces at a debtor.
     */
    p('Identity number: {{debtor_id_masked}}'),
    h(1, simulating
      ? 'PAYMENT SIMULATION: WHAT AN ARRANGEMENT WOULD COST'
      : 'YOUR PAYMENT ARRANGEMENT: WHAT IT WILL COST'),
    /*
     * THE NOTE AT THE TOP, AND THE COVERING EMAIL SENDS THE DEBTOR TO IT BY NAME: "Please read the
     * note at the top of it." So it is a heading and three sentences in the first third of page
     * one, not small print at the end.
     *
     * THE ANNEXURE B LINE IS THE ONE THAT MATTERS AND IT WAS NOT THERE. Every figure on this page
     * is capital, interest and the receipt fee on each payment -- and nothing else. The Act's
     * prescribed fees for the work done on the account (calls, letters, emails, SMSs, traces) are
     * raised as that work happens and are not in any total here. A debtor handed "Total you would
     * pay R 609,76" on the firm's letterhead, who then receives an account for more, has been
     * misled by a document the firm wrote -- and the firm's own covering email says this four
     * times, which is how seriously they take it.
     */
    h(2, simulating
      ? 'THIS IS A SIMULATION, NOT A STATEMENT OF YOUR ACCOUNT'
      : 'THIS IS NOT A STATEMENT OF YOUR ACCOUNT'),
    p(simulating
      ? 'It shows what it would look like if you paid different amounts towards this account, so '
        + 'that you can see what a longer or shorter arrangement would cost you.'
      : 'It sets out what the arrangement you have agreed will cost if it is kept exactly as '
        + 'agreed.'),
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'The fees prescribed in Annexure B to the Debt Collectors Act 114 of 1998 are '
            + 'not included in these figures.',
          bold: true,
        },
        {
          text: ' Those fees are charged on the account as the collection work is done, and they '
            + 'will be added. The amount you actually pay will therefore be higher than the '
            + 'amounts shown here.',
        },
      ],
    } as Block,
    p(simulating
      ? 'This is not a demand, not an agreement and not a statement of account.'
      : 'This is not a demand and not a statement of account.'),
    /*
     * AND THEN THE SENTENCE THAT SAYS WHAT IS ACTUALLY BEING PROPOSED. Kept after the note rather
     * than before it, which is the order the firm drew: a debtor given a page of figures on a
     * firm's letterhead treats it as settled unless the very first thing they read says otherwise.
     */
    p(`Dear {{debtor_name}} \u2014 this shows what it would cost to settle your account with `
      + `{{client_name}} by paying ${money(first.amount)} ${each}, starting `
      + `${longDate(first.dueOn)}${(input.faster ?? []).length > 0 ? ', and what it would cost to clear it sooner' : ''}.`),

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
        /* THE FREQUENCY TRAVELS WITH THE AMOUNT, not with the label. "You would pay, a week |
           R 500,00" split one phrase across two columns and read as neither half of it. */
        pair('Each payment', `${money(first.amount)} ${each}`),
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
     *
     * WHAT DOES SIT HERE IS THE EXCLUSION, AGAIN, IN ONE LINE. The note at the top says it in
     * full; this is the row of totals somebody photographs and sends to their spouse, and it has
     * to carry the qualification on its own rather than rely on a paragraph two inches above it.
     */
    { kind: 'paragraph', spans: [{ text: 'Annexure B fees are excluded from every figure above.', size: 9 }] } as Block,
  ]

  /*
   * AND A ZERO IN THE INTEREST ROW IS SAID OUT LOUD, because a zero there has two meanings and
   * only one of them is safe.
   *
   * THE FIRM READ THIS PAGE AND ASKED "NO INTEREST?" -- the right question, and the page gave them
   * no way to answer it. An account with no rate, or with a rate and nothing posted for the accrual
   * to run from, produces a schedule with no interest in it: that is correct, and it reads exactly
   * like a schedule where the interest was forgotten. The collector's own panel has said this since
   * it was built (see RepaymentCalculator) and the page that goes to the DEBTOR did not, which is
   * the half a debtor could hold the firm to.
   *
   * IT IS ALSO WHAT EXPLAINS THE LADDER BELOW. With no interest running the only charge is the
   * receipt fee, which is a flat share of whatever is paid -- so paying faster saves almost
   * nothing, and "YOU SAVE R 17,29" beside a payment three times the size reads as an arithmetic
   * mistake rather than as the consequence of a debt that is not growing.
   */
  if (!plan.interestRunning) {
    blocks.push({
      kind: 'paragraph',
      spans: [{
        text: 'No interest is running on this account, so no interest is included in any figure in '
          + 'this document.',
        size: 9,
      }],
    } as Block)
  }

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
          /*
           * "EACH PAYMENT", NOT "EACH A WEEK", and the last row is why. Settling in full is ONE
           * payment, and under a column headed EACH A WEEK its figure told a debtor that clearing
           * the account costs R14 175,89 every week. The frequency is established twice above --
           * in the summary row and in the sentence naming the offer -- so the column only has to
           * be true on all five rows.
           */
          { spans: [{ text: 'EACH PAYMENT', bold: true }] },
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
        /* JOINED RATHER THAN CONCATENATED, so a sentence that does not apply leaves no gap and no
           trailing space behind it. */
        text: [
          /* THE PERIOD IS THE ARRANGEMENT'S OWN, not "month". This sentence said "every month the
             account stands" on a weekly arrangement whose own figures were weekly. */
          'Your own offer is the first line. Every line below it asks for a bigger payment '
            + `every ${period}: that is what makes it shorter, and it is where the saving comes `
            + 'from.',
          /* AND THE ROW THE COLUMN HEAD NO LONGER EXPLAINS. "EACH PAYMENT" is true of settling in
             full and says nothing about it being a single one, which is the row's whole point. */
          ...((input.faster as SettlementOption[]).some((o) => o.instalments === 1)
            ? ['The last line is one payment that closes the account.'] : []),
          /* AND THE SENTENCE ABOUT INTEREST ONLY WHERE THERE IS ANY. On an account that is not
             accruing it contradicted the line four inches above it, which says in terms that no
             interest is running -- and it is the half of the page a debtor is most likely to quote
             back. What is still true there is that the saving is real, and the figures say it. */
          ...(plan.interestRunning
            ? [`Interest runs on what is still owed, so every ${period} the account stands costs `
              + 'you more.'] : []),
        ].join(' '),
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

  /*
   * WHAT THE FIGURES DO NOT INCLUDE, SPELLED OUT, and this is the section the covering email is
   * pointing at when it says the amount actually paid will be higher.
   *
   * THREE THINGS, IN DESCENDING CERTAINTY. The Annexure B fees are certain -- they are being
   * charged already. Further collection work is likely and unquantifiable, which is worth saying
   * plainly rather than leaving the debtor to infer from a total that looks exact. Legal costs are
   * conditional and may never arise, so they are named last and without a figure.
   *
   * AND THE ASSUMPTION GOES HERE RATHER THAN IN A SECTION OF ITS OWN. `plan.assumption` is the
   * firm's own condition -- "in a world where no fees accumulate, however the receipt fee is still
   * applicable" -- and it is the positive half of this list: what IS in the arithmetic. Read apart
   * from the exclusions it was a sentence nobody could place; read under them it is the line that
   * closes the question.
   */
  blocks.push(h(2, 'What these figures do not include'))
  blocks.push({
    kind: 'list',
    ordered: false,
    items: [
      [
        { text: 'Annexure B fees.', bold: true },
        {
          text: ' The Debt Collectors Act 114 of 1998 prescribes what a debt collector may charge '
            + 'for the work done on an account: calls, letters, emails, SMSs, traces and the like. '
            + 'Those fees are raised on the account as that work happens, and they are not in any '
            + 'figure in this document.',
        },
      ],
      [
        { text: 'Further collection costs.', bold: true },
        {
          text: ' The figures assume no further work is charged over the life of the arrangement, '
            + 'which is unlikely if the arrangement runs for months.',
        },
      ],
      [{ text: 'Legal costs, if the account goes further.' }],
    ],
  } as Block)
  blocks.push(p('Because of that, the total you actually pay will be higher than the total shown '
    + 'here. ' + plan.assumption))
  if (plan.hitInDuplum) {
    /* Where the ceiling binds, the debtor is entitled to know that it is what is holding the
       figures down -- and that it is the law doing it rather than the firm's goodwill. */
    blocks.push(p('Interest and fees on this account have reached the limit set by section 103(5) '
      + 'of the National Credit Act, which is the capital outstanding when the account was handed '
      + 'to us. They do not grow beyond it.'))
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
   * THE LAST WORD, UNHEADED AND DIRECTLY UNDER THE BANK DETAILS. It used to be a section called
   * "What this does not do", which put a heading between the debtor and the one sentence that
   * decides whether they think they have an arrangement. Unheaded it is read as part of the page
   * rather than as a clause somebody can skip -- and its two halves are now the only ones left
   * here, the assumption having moved up to sit with the exclusions it belongs beside.
   */
  blocks.push(p('These figures are not a statement of your account and do not replace one. Nothing '
    + 'here changes what you owe, and an arrangement exists only once it is agreed with us and '
    + 'confirmed in writing. If a payment is missed the arrangement lapses and these figures no '
    + 'longer apply.'))

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
    /* THE FOOT NAMES THE DOCUMENT, and it is the one place the two purposes have to differ on
       every page: a printed page that has come away from its first sheet still has to say whether
       the figures on it were agreed or were being weighed up. */
    runningFoot: `${title} \u00b7 Ref {{case_number}} \u00b7 Page {{page}} of {{pages}}`,
    blocks,
  }
}
