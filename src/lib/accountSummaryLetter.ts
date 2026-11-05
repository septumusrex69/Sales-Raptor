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
import type { Block, LetterDocument, Span, TableCell } from './letterDocument.ts'
import { BF_LOCKUP_PNG, BF_LOCKUP_RATIO } from './brandLogo.js'
import { BRAND_STACK } from './brandFonts.js'
import type { BalanceBreakdown, StatementLine } from './accountBalance.ts'
import { longDate } from './messageTemplates.js'
import { moneyProgress, progressPercent } from './paymentProgress.js'

const p = (text: string, over: Partial<Block> = {}): Block =>
  ({ kind: 'paragraph', spans: [{ text }], ...over } as Block)

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

/*
 * BOTH DOCUMENTS ARE STATEMENTS NOW, NOT LETTERS (Stephan, 4-5 Nov). Of the statement: "It's not really statementy.
 * Make it statementy ... Still use the Bredell Ferreira logos ... I don't think the letterhead is a good idea to put it
 * on"; then the brand guide; then, of the three weights of the look he chose, "number 2 looks the best. You can also
 * do something similar with the summary of account."
 *
 * So both are laid out the way an account statement is read, on plain paper (`paper: 'plain'`): the lockup top left;
 * the title and the reference facts top right; the account holder and how the balance is made up side by side under
 * gold labels; the progress bar; then -- the statement only -- every movement under ruled lines; the balance owing in
 * a dark navy band; the notes; how to pay, in one box never split over a page. No "Dear ...", no "Yours faithfully",
 * no signature: a statement states. The firm's details are in the running foot.
 *
 * THE BRAND GUIDE'S OWN COLOURS AND FACES, nothing else: navy #101F2C for headings and the balance band, gold #C69F54
 * for the labels and the progress bar, #32404D ink, #525D66 for the quiet words, #F4F4F4 under the summary's total;
 * Open Sans for the words and Raleway Bold for the headings (brandFonts.ts).
 *
 * THE FIGURES ARE UNCHANGED -- the same breakdown and lines, the same progress arithmetic (moneyProgress) as the
 * account screen. Only the summary's made-up table differs, at the firm's word (below).
 */
const NAVY_BF = '#101F2C'
const GOLD_BF = '#C69F54'
const INK_BF = '#32404D'
const GREY_BF = '#525D66'
const LIGHT_BF = '#F4F4F4'
const WHITE = '#FFFFFF'

type AccountDocKind = 'summary' | 'statement'

/** The one-page summary: where the account stands, how the balance is made up, how to pay. */
export function summaryOfAccount(input: AccountLetterInput): LetterDocument {
  return accountDocument(input, 'summary')
}

/**
 * The same page with the working under it: every movement, AFTER the totals -- a debtor opening a statement wants the
 * balance first and the ninety-six lines second.
 */
export function statementOfAccount(input: AccountLetterInput): LetterDocument {
  return accountDocument(input, 'statement')
}

function accountDocument(input: AccountLetterInput, kind: AccountDocKind): LetterDocument {
  const lines = input.lines ?? []
  const b = input.breakdown
  const m = moneyProgress({ payments: b.payments, balance: b.balance, settlementFee: b.settlementFee })
  const pct = progressPercent(m)
  const feesNet = b.fees + b.receiptFees - b.vat
  const t = (text: string, over: Partial<Span> = {}): Span => ({ text, size: 9, ...over })
  const c = (text: string, over: Partial<TableCell> = {}, span: Partial<Span> = {}): TableCell => ({ spans: [t(text, span)], ...over })
  /* A LABEL OVER A RULE: gold, bold, small -- the table's own line underlines it. */
  const label = (text: string, align: TableCell['align'] = 'left'): TableCell => c(text, { align }, { bold: true, colour: GOLD_BF, size: 8.5 })
  const blank: TableCell = { spans: [{ text: '' }] }
  const heading = (text: string): Block =>
    ({ kind: 'paragraph', keepWithNext: true, spans: [{ text, bold: true, size: 11, colour: NAVY_BF }] } as Block)
  const title = kind === 'summary' ? 'SUMMARY OF ACCOUNT' : 'STATEMENT OF ACCOUNT'

  /* ---- the head: the lockup left; the title and the reference facts right, under it ---- */
  const facts: [string, string][] = [
    ['Date', '{{today}}'],
    ['Our reference', '{{case_number}}'],
    ['Account', '{{account_number}}'],
    ['Position as at', longDate(input.asAt)],
  ]
  /* LEFT OUT RATHER THAN PRINTED EMPTY: a "Status:" with nothing after it is a question the debtor will ring about. */
  if (input.status) facts.push(['Status', input.status])
  const head: Block = {
    kind: 'table', borders: 'none', widths: [50, 50],
    rows: [[
      { spans: [{ text: '' }], image: { src: BF_LOCKUP_PNG, widthMm: 72, heightMm: Math.round(72 * BF_LOCKUP_RATIO * 10) / 10 } },
      {
        align: 'right',
        spans: [
          { text: title, bold: true, size: 16, colour: NAVY_BF },
          ...facts.flatMap(([l, v]) => [t(`\n${l}: `, { colour: GREY_BF }), t(v, { bold: true })]),
        ],
      },
    ]],
  }

  /* ---- who, and how the balance is made up, side by side ---- */
  const madeUp: [string, string][] = kind === 'summary'
    ? [
      ['Hand-over balance', input.money(input.handedOver)],
      /* INTEREST AND FEES AS ONE LINE ON THE SUMMARY (Stephan, 5 Nov: "merge interest and fees as one entry in the
         summary"). The summary is the page read at arm's length; the statement keeps them apart, with the VAT, and
         every movement under them, for the debtor who wants the working. VAT is INSIDE the fees, never added. */
      ['Interest and fees (VAT included)', input.money(b.interest + feesNet + b.vat)],
      ['Payments received', `- ${input.money(b.payments)}`],
    ]
    : [
      ['Hand-over balance', input.money(input.handedOver)],
      ['Interest', input.money(b.interest)],
      ['Fees and expenses', input.money(feesNet)],
      ['VAT', input.money(b.vat)],
      ['Payments received', `- ${input.money(b.payments)}`],
    ]
  /* WHERE A RULE HELD THE BALANCE DOWN, BY HOW MUCH -- without it the page does not add up. */
  if (b.withheld > 0) madeUp.push([b.cappedBy === 'written off' ? 'Written off' : 'Not recoverable (in duplum)', `- ${input.money(b.withheld)}`])
  const who: TableCell[] = [
    c('{{debtor_name}}', {}, { bold: true, size: 10 }),
    c('Creditor: {{client_name}}'),
    /* OPTIONAL, AND ITS LINE LEAVES WITH IT (97% of the book has none): documentWithoutOptional empties this cell and
       keeps the row, because the summary beside it is still there. Last, so the gap it leaves is at the foot. */
    c('Identity number: {{debtor_id_masked}}'),
  ]
  const sideRows: TableCell[][] = [[label('Account holder'), blank, label('How the balance is made up'), label('', 'right')]]
  const rowsNeeded = Math.max(madeUp.length + 1, who.length)
  for (let i = 0; i < rowsNeeded; i++) {
    const total = i === madeUp.length
    const [l, v] = madeUp[i] ?? ['', '']
    sideRows.push([
      who[i] ?? blank,
      blank,
      total ? c('BALANCE NOW OWING', { fill: LIGHT_BF }, { bold: true, colour: NAVY_BF }) : c(l),
      total ? c(input.money(b.balance), { fill: LIGHT_BF, align: 'right' }, { bold: true, colour: NAVY_BF }) : c(v, { align: 'right' }),
    ])
  }
  const side: Block = { kind: 'table', borders: 'rows', widths: [42, 4, 34, 20], headerRow: true, keepTogether: true, rows: sideRows }

  /* ---- how far: the same arithmetic as the account screen ---- */
  const progress: Block = {
    kind: 'progress', fraction: m.fraction, fill: GOLD_BF,
    note: `${pct}% paid · ${input.money(m.recovered)} of ${input.money(m.charged)}${m.owed > 0 ? ` · ${input.money(m.owed)} to settle today` : ''}`,
  } as Block

  /* ---- every movement (the statement) ---- */
  const movements: Block[] = kind === 'summary' ? [] : [
    heading('Every movement on the account'),
    ...(lines.length === 0
      ? [p('Nothing has been charged or received on this account yet.')]
      : [{
        kind: 'table', borders: 'rows', headerRow: true, widths: [14, 46, 13, 13, 14],
        rows: [
          /* THE SAME FIVE COLUMNS THE SCREEN SHOWS, in the firm's words. */
          [label('DATE'), label('DETAIL'), label('DEBIT', 'right'), label('CREDIT', 'right'), label('BALANCE', 'right')],
          /* A DASH, NOT R 0.00, in the column this line is not in: a nought reads as a charge of nothing. */
          ...lines.map((l) => [
            c(shortish(l.date)),
            c(l.description),
            c(l.debit > 0 ? input.money(l.debit) : '—', { align: 'right' }),
            c(l.credit > 0 ? input.money(l.credit) : '—', { align: 'right' }),
            c(input.money(l.balance), { align: 'right' }),
          ]),
        ],
      } as Block]),
  ]

  /* ---- THE BALANCE, IN THE DARK NAVY BAND (look B: "number 2 looks the best") -- where the reader's eye ends up.
     10.5pt, under HEADING_FROM_PT: a figure must never be drawn in Raleway, whose numerals are old-style. ---- */
  const band: Block = {
    kind: 'table', borders: 'none', widths: [74, 26], keepTogether: true,
    rows: [[c('BALANCE NOW OWING', { fill: NAVY_BF, align: 'right' }, { bold: true, colour: WHITE, size: 10 }),
      c(input.money(b.balance), { fill: NAVY_BF, align: 'right' }, { bold: true, colour: WHITE, size: 10.5 })]],
  } as Block

  const small = (text: string, over: Partial<Span> = {}): Block =>
    ({ kind: 'paragraph', align: 'center', spans: [{ text, size: 9, ...over }] } as Block)
  const k = (text: string): TableCell => c(text, {}, { bold: true, colour: NAVY_BF, size: 8.5 })
  const v = (text: string, bold = false): TableCell => c(text, {}, bold ? { bold: true } : {})

  return {
    defaults: { font: BRAND_STACK, size: 10, colour: INK_BF, lineHeight: 1.35 },
    paper: 'plain',
    runningFoot: `${kind === 'summary' ? 'Summary' : 'Statement'} of account · Ref {{case_number}} · {{firm_name}} · {{firm_phone}} · {{firm_email}} · Page {{page}} of {{pages}}`,
    blocks: [
      head,
      side,
      heading('Where the account stands'),
      progress,
      ...movements,
      band,
      small('Interest is charged at the rate on the agreement. Fees are those prescribed by Annexure B to the Debt '
        + 'Collectors Act 114 of 1998, plus VAT.'
        + (kind === 'statement' ? ' A line showing no charge is work done that earned nothing, because the Annexure B '
          + 'ceiling for this debt had been reached.' : ''), { size: 8, colour: GREY_BF }),
      /* HOW TO PAY: trust account, OUR reference (21% of client references are shared, so a payment quoting one cannot
         be placed), proof of payment, who to ask -- two across in one box never split over a page. The line above it
         keeps with it: alone at the foot of a page it is an instruction with no account number. */
      { kind: 'spacer', mm: 2 } as Block,
      { ...small('PAYMENT MUST BE MADE INTO OUR LEGAL PRACTITIONER TRUST ACCOUNT', { bold: true, colour: NAVY_BF }), keepWithNext: true } as Block,
      {
        kind: 'table', borders: 'rows', widths: [18, 32, 20, 30], headerRow: true, keepTogether: true,
        rows: [
          [label('How to pay'), blank, blank, blank],
          [k('BANK'), v('{{firm_bank_name}}'), k('ACCOUNT NUMBER'), v('{{firm_bank_account}}')],
          [k('ACCOUNT NAME'), v('{{firm_bank_holder}}'), k('BRANCH CODE'), v('{{firm_bank_branch}}')],
          [k('REFERENCE'), v('{{case_number}}', true), k('PROOF OF PAYMENT'), v('Email it to {{firm_email}} on the day you pay')],
          [k('QUESTIONS'), v('Speak to {{collector_name}}, who handles this account, on {{firm_phone}}'),
            k('SOMETHING WRONG?'), v('If anything here does not agree with your own record, tell us in writing and we will check it.')],
        ],
      } as Block,
    ],
  }
}

/** "10 Sep 2026" -- short enough for a five-column table, long enough to be unambiguous. */
function shortish(iso: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`
}
