/**
 * THE SETTLEMENT PROPOSAL, AS A LETTER TO THE CLIENT (Stephan, 18 Nov, S22 · Raptor H20).
 *
 * THE FIRM, describing the one they send today: "this is the capital outstanding. So it needs to show the capital
 * outstanding or the money outstanding, our fees, then the capital. Then what would happen, for example, if the
 * person settles, how much capital will be settled minus commission and how much the client will get out if the
 * settlement has been approved."
 *
 * SO THREE TABLES, IN THAT ORDER: what is owed today; what the offer would pay, ending on what the client receives;
 * and what is written off, split between what the CLIENT gives up (capital) and what the FIRM gives up (its fees and
 * interest) -- the second half is the argument for saying yes, and the client has never been shown it.
 *
 * BUILT RATHER THAN MERGED, for repaymentLetter's reason: the figures are the engine's arithmetic for one offer, not
 * values any merge field on the account holds. What stays the firm's is everything else -- letterhead, names,
 * reference, signatory -- through the same merge values every letter uses.
 *
 * TO THE CLIENT, NEVER THE DEBTOR. It names the commission and the firm's share, which the debtor has no business
 * reading, and it is the client's decision it asks for. The covering email goes from the account's compose box, so
 * it is filed to the account and the client's reply comes back there -- which is exactly the written acceptance the
 * Settlement card asks for before it will record an approval.
 */
import type { Block, LetterDocument } from './letterDocument.ts'
import { owedToday, writtenOff, type SettlementBreakdown } from './settlement.ts'
import { longDate } from './messageTemplates.js'

/** The face the firm's own notices are set in. See charter.ts. */
const CHARTER = '"Charter", "Bitstream Charter", Georgia, serif'

const p = (text: string, over: Partial<Block> = {}): Block =>
  ({ kind: 'paragraph', spans: [{ text }], ...over } as Block)
/* A HEADING TRAVELS WITH ITS TABLE: drawn first without this, "What is written off" sat alone at the foot of page one. */
const h = (level: 1 | 2, text: string): Block =>
  ({ kind: 'heading', level, spans: [{ text }], keepWithNext: true, spacing: { before: level === 2 ? 3 : 2, after: 1.5 } } as Block)
const pair = (label: string, value: string, bold = false) => [
  { spans: [{ text: label, ...(bold ? { bold: true } : {}) }] },
  { spans: [{ text: value, ...(bold ? { bold: true } : {}) }], align: 'right' },
]
const table = (rows: ReturnType<typeof pair>[]): Block =>
  ({ kind: 'table', borders: 'rows', widths: [62, 38], keepTogether: true, rows } as unknown as Block)

export interface SettlementProposalInput {
  breakdown: SettlementBreakdown
  /** The caller's money formatter, so the letter and the card agree to the cent. */
  money: (n: number) => string
  /** The collector's note, where it says something the client should hear ("lost his job"). Optional. */
  reason?: string | null
}

/**
 * WHY THIS OFFER CANNOT GO TO THE CLIENT AS IT STANDS, or null where it can.
 *
 * MORE THAN THE ACCOUNT CAN TAKE is the one case: the engine would hold the rest as the debtor's credit, so the
 * "settlement" is an overpayment and the client would be asked to approve a figure that does not mean what it says.
 * Seen on staging the day this was built (RVC0010: R2 500 offered where R1 833.56 could be taken).
 */
export function settlementProposalRefusal(b: SettlementBreakdown): string | null {
  if (b.excess > 0.005) {
    return `R${b.excess.toFixed(2)} of this offer is more than the account can take today, so it would sit as the `
      + 'debtor’s credit. Check the balance with finance before putting it to the client.'
  }
  return null
}

export function settlementProposalLetter({ breakdown: b, money, reason }: SettlementProposalInput): LetterDocument {
  const owed = owedToday(b)
  const off = writtenOff(b)
  const rate = b.commissionRate === null ? '' : ` (${Math.round(b.commissionRate * 10000) / 100}%)`
  /* AN EN DASH, NOT THE TRUE MINUS (U+2212): that one is outside Windows-1252 and the PDF refuses the whole letter
     (winAnsi.ts) -- found by drawing BNP0015's proposal. */
  const minus = (x: number) => `\u2013${money(x)}`

  const blocks: Block[] = [
    {
      kind: 'table',
      borders: 'none',
      widths: [28, 72],
      rows: [
        [{ spans: [{ text: 'TO', bold: true }] }, { spans: [{ text: '{{client_name}}', bold: true }] }],
        [{ spans: [{ text: 'DATE', bold: true }] }, { spans: [{ text: '{{today}}' }] }],
        [{ spans: [{ text: 'OUR REFERENCE', bold: true }] }, { spans: [{ text: '{{case_number}}' }] }],
        [{ spans: [{ text: 'YOUR ACCOUNT', bold: true }] }, { spans: [{ text: '{{account_number}}' }] }],
      ],
    } as unknown as Block,
    h(1, 'SETTLEMENT PROPOSAL FOR YOUR APPROVAL'),
    p(`{{debtor_name}} has offered to settle this account with a single payment of ${money(b.amount)}, in full and `
      + `final settlement of the ${money(owed)} outstanding today. We may not accept it without your written approval.`),
    ...(reason && reason.trim() ? [p(`What the debtor told us: ${reason.trim()}`)] : []),

    h(2, 'What is outstanding today'),
    table([
      pair('Capital', money(b.capital)),
      pair('Interest', money(b.interest)),
      pair('Our fees (Annexure B to the Debt Collectors Act)', money(b.fees)),
      pair('Total outstanding', money(owed), true),
    ]),

    /* THE DATE IS ON THE HEADING, not in a paragraph of its own -- the figures move daily with interest, and the
       client has to know which day's they are reading before the first one. */
    h(2, `If you accept ${money(b.amount)} (figures as at ${longDate(b.asAt)})`),
    table([
      pair('The debtor pays, once, in full', money(b.amount), true),
      /* THE RECEIPT FEE IS INSIDE THE FEES LINE, and said so -- it is raised on this very payment, and a client
         reading it as a separate deduction would count it twice. */
      pair(b.receiptFee > 0
        ? `To our fees (including the ${money(b.receiptFee)} receipt fee on this payment)`
        : 'To our fees', money(b.toFees)),
      pair('To interest', money(b.toInterest)),
      pair('To capital', money(b.toCapital)),
      /* ONE LINE, COMMISSION AND ITS VAT: "minus commission" is how the firm put it, and the VAT is said so the
         figure is not read as a higher rate. */
      pair(`Less our commission on the capital collected${rate}, with VAT of ${money(b.commissionVat)}`,
        minus(b.commission + b.commissionVat)),
      pair('You receive', money(b.toClient), true),
    ]),

    h(2, 'What is written off'),
    table([
      pair('Capital you write off', money(off.byClient)),
      pair('Fees and interest we write off', money(off.byFirm)),
      pair('Total written off', money(off.total), true),
    ]),

    /* TODAY'S FIGURES AND IT SAYS SO: interest runs daily until the money reaches trust, so the split moves by a few
       rand while the client decides. What they receive is always worked out the same way, on the day it arrives. */
    p('Interest runs until the payment reaches our trust account, so the split may move slightly; what you receive is '
      + 'worked out the same way on the day it arrives and paid to you on the next payover. Please reply to this email '
      + 'in writing to say whether you accept, and by which date the debtor must pay. If the full amount is not '
      + 'received by then, the offer lapses and the full balance is owing again.'),
    /* SIGNED OFF IN TWO LINES, NOT ON A SIGNATURE RULE: it is a question put to the client by email, not a document
       anybody signs, and the rule's height is what pushed the sign-off onto a second page by itself. */
    { kind: 'paragraph', spans: [{ text: 'Yours faithfully' }], keepWithNext: true } as Block,
    { kind: 'paragraph', spans: [{ text: '{{signatory_name}}, {{signatory_title}}, for and on behalf of {{firm_name}}', bold: true }] } as Block,
  ]

  return {
    /* A POINT SMALLER THAN THE REPAYMENT LETTER, so the whole proposal is one page: the client reads it as one
       decision, and a decision split over two sheets is read as two. */
    defaults: { font: CHARTER, size: 9.5, colour: '#1f2937', lineHeight: 1.35 },
    runningFoot: 'Settlement proposal · Ref {{case_number}} · Page {{page}} of {{pages}}',
    blocks,
  } as LetterDocument
}
