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
import type { RepaymentPlan } from './repaymentPlan.ts'
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
      ],
    },
    /*
     * AND WHAT OF IT NEVER TOUCHES THE DEBT. The figure a debtor has never been shown, and the one
     * that makes a shorter arrangement worth agreeing to -- which is the conversation the firm is
     * actually trying to have.
     */
    {
      kind: 'table',
      borders: 'rows',
      widths: [55, 45],
      rows: [
        pair('Of that, interest', money(plan.totalInterest)),
        pair('Of that, receipt fees', money(plan.totalReceiptFees)),
        pair('Which leaves, off the debt', money(
          Math.round((plan.totalPaid - plan.totalInterest - plan.totalReceiptFees) * 100) / 100,
        )),
      ],
    },
    /* Set small, like the explanatory lines on the firm's other notices: it is the reason the
       figures above look the way they do, not another figure. */
    {
      kind: 'paragraph',
      spans: [{
        text: 'Interest runs on what is still owed, so it costs less the faster the account is '
          + 'paid. A larger payment clears it sooner and for less in total.',
        size: 9,
      }],
    },
  ]

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

  blocks.push(h(2, 'Every payment'))
  blocks.push({
    kind: 'table',
    borders: 'all',
    widths: [10, 24, 22, 22, 22],
    headerRow: true,
    rows: [
      [
        { spans: [{ text: 'NO', bold: true }] },
        { spans: [{ text: 'DUE', bold: true }] },
        { spans: [{ text: 'YOU PAY', bold: true }] },
        { spans: [{ text: 'OF THAT, INTEREST AND FEES', bold: true }] },
        { spans: [{ text: 'STILL OWING AFTER', bold: true }] },
      ],
      ...plan.rows.map((r) => [
        { spans: [{ text: String(r.no) }] },
        { spans: [{ text: longDate(r.dueOn) }] },
        { spans: [{ text: money(r.amount) }] },
        { spans: [{ text: money(Math.round((r.interest + r.receiptFee) * 100) / 100) }] },
        { spans: [{ text: money(r.balanceAfter) }] },
      ]),
    ],
  })

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
