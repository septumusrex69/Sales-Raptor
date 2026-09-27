/**
 * THE SUMMARY OF ACCOUNT, AND THE FULL STATEMENT BEHIND IT.
 *
 * THE FIRM DREW BOTH ON ONE SCREEN: "summary or statement", pencilled twice -- once over the
 * account's action bar and once beside the Print button on the transactions list. They are two
 * answers to two different questions and the debtor asks both:
 *
 *   - THE SUMMARY is one page. Where the account stands, how the balance is made up, how to pay.
 *     It is what goes out with an arrangement discussion or a query, and it is the document the
 *     firm's own letterhead template was written for.
 *   - THE STATEMENT is the working. Every movement in date order with a running balance -- the
 *     page a debtor is entitled to and a client asks for when they query a figure.
 *
 * ONE SKELETON, TWO DOCUMENTS, which is the whole reason they live in one file. The address
 * block, the "how the balance is made up" table, the trust account and the closing sentence are
 * identical on both; written twice they would drift, and the day they drift is the day a debtor
 * holds a summary and a statement side by side that disagree about what they owe.
 *
 * BUILT RATHER THAN MERGED, for the reason repaymentLetter gives: a merge field is a scalar and
 * the body of a statement is a table whose LENGTH is the answer -- ninety-six lines on one
 * account and four on another. What stays the firm's is everything that is not the figures: the
 * letterhead, the bank details, the signatory and the debtor's own name all come through the same
 * merge values every other letter uses.
 *
 * THE FIGURES ARE THE STATEMENT'S OWN. computeBalance and buildStatement are passed in already
 * assembled, so the page a debtor receives and the table the collector is looking at are one
 * piece of arithmetic. Recomputed here it would be a second opinion about the same money, and the
 * drift would be invisible because both would look like figures about this account.
 */
import type { Block, LetterDocument, TableCell } from './letterDocument.ts'
import type { BalanceBreakdown, StatementLine } from './accountBalance.ts'
import { longDate } from './messageTemplates.js'

/** The face the firm's own notices are set in. See charter.ts. */
const CHARTER = '"Charter", "Bitstream Charter", Georgia, serif'

const p = (text: string, over: Partial<Block> = {}): Block =>
  ({ kind: 'paragraph', spans: [{ text }], ...over } as Block)
const h = (level: 1 | 2, text: string): Block =>
  ({ kind: 'heading', level, spans: [{ text }] } as Block)
const pair = (label: string, value: string, bold = false): TableCell[] => [
  { spans: [{ text: label, bold: true }] },
  { spans: [{ text: value, ...(bold ? { bold: true } : {}) }] },
]

export interface AccountLetterInput {
  /** The balance, already assembled. Never recomputed here -- see the note above. */
  breakdown: BalanceBreakdown
  /** What was handed to us. Not on the breakdown, because it is not part of what is owed today. */
  handedOver: number
  /** The day the figures were struck, as yyyy-mm-dd. Printed, never assumed to be today. */
  asAt: string
  money: (n: number) => string
  /** Every movement, for the statement. Ignored by the summary. */
  lines?: StatementLine[]
  /**
   * WHAT THE FIRM CALLS THIS ACCOUNT'S STAGE -- "Pre-legal", "Legal". Off the account's position,
   * which is derived and never stored; null where it cannot be read, and then the row is left out
   * rather than printed empty.
   */
  status?: string | null
}

/**
 * THE ONE-PAGE SUMMARY.
 *
 * THREE SECTIONS AND THE FIRM NUMBERED THEM: where the account stands, how the balance is made
 * up, how to pay. Nothing else fits on a page that has to be readable at arm's length, and the
 * firm's template has nothing else on it.
 */
export function summaryOfAccount(input: AccountLetterInput): LetterDocument {
  return {
    defaults: { font: CHARTER, size: 10.5, colour: '#1f2937', lineHeight: 1.45 },
    runningFoot: 'Summary of account · Ref {{case_number}} · Page {{page}} of {{pages}}',
    blocks: [
      ...addressBlock(input, 'SUMMARY OF ACCOUNT'),
      p('Dear {{debtor_name}} — this is a summary of your account with {{client_name}} as it '
        + `stands on ${longDate(input.asAt)}.`),
      ...standsBlock(input),
      ...madeUpBlock(input),
      ...payBlock(),
      ...closing(),
    ],
  }
}

/**
 * THE SAME PAGE WITH THE WORKING UNDER IT.
 *
 * THE MOVEMENTS COME LAST, AFTER THE TOTALS, and that order is deliberate. A debtor opening a
 * statement wants the balance first and the ninety-six lines second; led with the table, the one
 * figure they are looking for is on page three. It is also what makes the first page of a
 * statement identical to the summary -- same skeleton, same numbers, one arithmetic.
 */
export function statementOfAccount(input: AccountLetterInput): LetterDocument {
  const lines = input.lines ?? []
  return {
    defaults: { font: CHARTER, size: 10.5, colour: '#1f2937', lineHeight: 1.45 },
    runningFoot: 'Statement of account · Ref {{case_number}} · Page {{page}} of {{pages}}',
    blocks: [
      ...addressBlock(input, 'STATEMENT OF ACCOUNT'),
      p('Dear {{debtor_name}} — this is a full statement of your account with {{client_name}} '
        + `as it stands on ${longDate(input.asAt)}. Every movement on it is set out below.`),
      ...standsBlock(input),
      ...madeUpBlock(input),
      ...movementsBlock(input, lines),
      ...payBlock(),
      ...closing(),
    ],
  }
}

/* ---------------- the parts both documents are built from ---------------- */

/**
 * THE HEAD OF THE PAGE: what this is, whose it is, and when the figures were struck.
 *
 * POSITION AS AT IS ITS OWN ROW and is not the date at the top. A statement printed on Monday
 * about Friday's position is an ordinary thing to send, and a page carrying one date is a page
 * somebody will read as both.
 */
function addressBlock(input: AccountLetterInput, title: string): Block[] {
  const rows: TableCell[][] = [
    pair('DATE', '{{today}}'),
    pair('OUR REFERENCE', '{{case_number}}'),
    pair('ACCOUNT', '{{account_number}}'),
    pair('CREDITOR', '{{client_name}}'),
  ]
  /* LEFT OUT RATHER THAN PRINTED EMPTY. A row reading "STATUS" with nothing beside it is a
     question the debtor will ring about. */
  if (input.status) rows.push(pair('STATUS', input.status))
  rows.push(pair('POSITION AS AT', longDate(input.asAt)))
  return [
    { kind: 'table', borders: 'none', widths: [28, 72], rows },
    { kind: 'paragraph', spans: [{ text: '{{debtor_name}}', bold: true }] },
    /* The identity number as a paragraph of its own, the way all four of the firm's notices carry
       it -- and it leaves with the field on the 97% of the book that has none. See
       documentWithoutOptional. */
    p('Identity number: {{debtor_id_masked}}'),
    h(1, title),
  ]
}

/**
 * WHERE THE ACCOUNT STANDS: three figures and a bar.
 *
 * THE FIRM'S TEMPLATE LEADS WITH THE PROPORTION PAID -- "17% paid" over "R1 000,00 paid since
 * handover" over "R6 000,00 handed over to us". A debtor who has paid a sixth of it reads that
 * faster than three amounts, and the bar is the same one the arrangement schedule carries, for
 * the same reason the firm gave: "the percentage is nice, but there should be an image."
 *
 * MEASURED AGAINST THE HAND-OVER BALANCE, not against everything charged. That is a different
 * question from the arrangement bar deliberately: this page is about the debt the client gave us,
 * and a bar that moved backwards as interest accrued would be answering "how much of the total
 * have you paid" when the debtor asked "how much of my debt have I paid off".
 */
function standsBlock(input: AccountLetterInput): Block[] {
  const paid = input.breakdown.payments
  const fraction = input.handedOver > 0 ? Math.min(1, Math.max(0, paid / input.handedOver)) : 0
  const pct = Math.round(fraction * 100)
  return [
    h(2, 'Where the account stands'),
    {
      kind: 'progress',
      fraction,
      note: `${pct}% of the handed-over balance has been paid · ${input.money(paid)} paid of `
        + `${input.money(input.handedOver)} handed over`,
    } as Block,
  ]
}

/**
 * HOW THE BALANCE IS MADE UP -- the firm's own six rows, in their order.
 *
 * VAT IS A COMPONENT OF THE FEES ABOVE IT, NEVER ADDED TO THEM, which is what BalanceBreakdown
 * says and what the row has to mean: printed as a seventh addend the page would overstate the
 * debt by the VAT and a debtor adding the column up would be right to query it. So the fees row
 * carries the fees net and the VAT row says how much tax is inside them.
 *
 * THE RECEIPT FEE IS FOLDED INTO FEES, because on this page the debtor's question is what they
 * are being charged, not which item of Annexure B it came from. The statement below shows each
 * one on its own line, which is where that distinction belongs.
 */
function madeUpBlock(input: AccountLetterInput): Block[] {
  const b = input.breakdown
  const feesNet = b.fees + b.receiptFees - b.vat
  const rows: TableCell[][] = [
    pair('Hand-over balance', input.money(input.handedOver)),
    pair('Interest', input.money(b.interest)),
    pair('Fees and expenses', input.money(feesNet)),
    pair('VAT', input.money(b.vat)),
    pair('Payments received', `- ${input.money(b.payments)}`),
  ]
  /*
   * AND WHERE A RULE HELD THE BALANCE DOWN, THE DEBTOR IS TOLD BY HOW MUCH. `withheld` is what in
   * duplum or a write-off refused to let grow -- money the firm would otherwise be owed -- and a
   * page that silently omitted it would not add up against the account's own fee list.
   */
  if (b.withheld > 0) {
    rows.push(pair(b.cappedBy === 'written off' ? 'Written off' : 'Not recoverable (in duplum)',
      `- ${input.money(b.withheld)}`))
  }
  rows.push(pair('BALANCE NOW OWING', input.money(b.balance), true))
  return [
    h(2, 'How the balance is made up'),
    { kind: 'table', borders: 'rows', widths: [55, 45], rows },
    {
      kind: 'paragraph',
      spans: [{
        text: 'Interest is charged at the rate on the agreement. Fees are those prescribed by '
          + 'Annexure B to the Debt Collectors Act 114 of 1998, plus VAT.',
        size: 9,
      }],
    } as Block,
  ]
}

/**
 * EVERY MOVEMENT, ON THE STATEMENT ONLY.
 *
 * FIVE COLUMNS, THE SAME ONES THE SCREEN SHOWS: date, detail, debit, credit, balance. A debtor
 * holding the PDF and a collector reading the tab are looking at one table, which is the point --
 * a statement the firm cannot follow on their own screen is one nobody can answer questions about.
 *
 * NOT `keepTogether`, UNLIKE THE ARRANGEMENT LADDER. That table is five rows and an argument; this
 * one is ninety-six rows and a record, and a record is read down a page. Held together it would
 * refuse to start until a page had room for all of it.
 *
 * A ZERO-CHARGE LINE IS PRINTED, at the firm's own instruction: "the last one was charged the 13th
 * of September but a lot of things happened after that, now I can't see them... maybe we put it
 * there and we have a zero charge that reflects on the statement." Past the Annexure B ceiling
 * every further action earns nothing, and a firm that emails a debtor eleven times after that and
 * shows a page with nothing on it looks like a firm that stopped working.
 */
function movementsBlock(input: AccountLetterInput, lines: StatementLine[]): Block[] {
  if (lines.length === 0) {
    return [
      h(2, 'Every movement on the account'),
      p('Nothing has been charged or received on this account yet.'),
    ]
  }
  const cell = (text: string, bold = false): TableCell => ({ spans: [{ text, size: 9, ...(bold ? { bold: true } : {}) }] })
  return [
    h(2, 'Every movement on the account'),
    {
      kind: 'table',
      borders: 'rows',
      widths: [16, 44, 14, 13, 13],
      headerRow: true,
      rows: [
        [cell('DATE', true), cell('DETAIL', true), cell('DEBIT', true), cell('CREDIT', true), cell('BALANCE', true)],
        ...lines.map((l) => [
          cell(shortish(l.date)),
          cell(l.description),
          /* A DASH, NOT R 0.00, in the column this line is not in. A nought in a debit column
             reads as a charge of nothing rather than as no charge at all, and every second row of
             a statement would carry one. */
          cell(l.debit > 0 ? input.money(l.debit) : '—'),
          cell(l.credit > 0 ? input.money(l.credit) : '—'),
          cell(input.money(l.balance)),
        ]),
      ],
    } as Block,
    {
      kind: 'paragraph',
      spans: [{
        text: 'A line showing no charge is work done on the account that earned nothing, because '
          + 'the Annexure B ceiling for this debt had been reached. It is shown so that the record '
          + 'of what was done is complete.',
        size: 9,
      }],
    } as Block,
  ]
}

/** "10 Sep 2026" -- short enough for a five-column table, long enough to be unambiguous. */
function shortish(iso: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`
}

/**
 * HOW TO PAY -- the firm's trust account, drawn from firm_settings like every other notice.
 *
 * THE TRUST ACCOUNT AND NOTHING ELSE. `companies.banking_details` is where remittance goes OUT to
 * the client and the business account is where a client pays commission IN; neither belongs on a
 * page a debtor reads. The merge vocabulary is what enforces that -- no collections field names
 * the business account -- but it is worth saying here too.
 */
function payBlock(): Block[] {
  return [
    h(2, 'How to pay'),
    {
      kind: 'paragraph',
      spans: [{ text: 'PAYMENT MUST BE MADE INTO OUR LEGAL PRACTITIONER TRUST ACCOUNT', bold: true }],
    } as Block,
    {
      kind: 'table',
      borders: 'rows',
      widths: [34, 66],
      rows: [
        pair('BANK', '{{firm_bank_name}}'),
        pair('ACCOUNT NAME', '{{firm_bank_holder}}'),
        pair('BRANCH CODE', '{{firm_bank_branch}}'),
        pair('ACCOUNT NUMBER', '{{firm_bank_account}}'),
        /* OURS, NOT THE CLIENT'S. 21% of client references are shared between accounts, so a
           payment quoting one cannot be allocated. */
        pair('REFERENCE', '{{case_number}}'),
        pair('PROOF OF PAYMENT', 'Email it to {{firm_email}} on the day you pay'),
        pair('QUESTIONS', 'Speak to {{collector_name}}, who handles this account, on {{firm_phone}}'),
      ],
    } as Block,
  ]
}

/**
 * THE CLOSING SENTENCE, WHICH IS THE FIRM'S OWN AND IS AN INVITATION TO DISPUTE.
 *
 * "If anything in this summary does not agree with your own record, tell us in writing and we will
 * check it." IN WRITING is the firm's line everywhere and it is the same rule the dispute trigger
 * runs on -- a written objection holds the sequence, a telephone call does not -- so the page
 * tells the debtor how to raise one in the terms that will actually work.
 */
function closing(): Block[] {
  return [
    p('If anything in this does not agree with your own record, tell us in writing and we will '
      + 'check it.'),
    { kind: 'paragraph', spans: [{ text: 'Yours faithfully' }], keepWithNext: true } as Block,
    {
      kind: 'signature',
      widthMm: 70,
      spans: [{
        text: '{{collector_name}}\nfor and on behalf of {{firm_name}}\n'
          + 'duly authorised agent of {{client_name}}',
      }],
    } as Block,
  ]
}
