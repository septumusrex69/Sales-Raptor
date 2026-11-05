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
import type { BalanceBreakdown, StatementLine } from './accountBalance.ts'
import { longDate } from './messageTemplates.js'
import { moneyProgress, progressPercent } from './paymentProgress.js'

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
/*
 * THE STATEMENT IS A STATEMENT, NOT A LETTER (Stephan, 4 Nov, sending a statement template: "I'm not happy with how the
 * statement looks. It's not really statementy. Make it statementy ... Still use the Bredell Ferreira logos ... but I
 * don't think the letterhead is a good idea to put it on").
 *
 * So it is laid out the way an account statement is read: the firm's name and the word STATEMENT across the top, the
 * reference facts in a box to the right; the debtor and the account summary side by side under navy bars; every
 * movement in a ruled, striped table under a navy heading; the balance owing in a navy bar at the foot of it; then how
 * to pay and who to ask, short. No "Dear ...", no "Yours faithfully" and no signature: a statement states. Plain
 * paper (`paper: 'plain'`), with the lockup in the corner and the firm's details in the running foot.
 *
 * THE FIGURES ARE UNCHANGED -- the same breakdown and lines, the same progress arithmetic (moneyProgress) as before and
 * as the account screen. Only the page changed.
 */
/*
 * FIVE LOOKS, ONE STATEMENT (Stephan, 5 Nov, of the first navy version: "You're pretty much copied it ... this is too
 * much blue ... In our branding ... colour shades ... You can maybe build me 5 and then show them to me so that I can
 * see what's the best"). The CONTENT and the order are one; only the palette, the face and how heavy the bars are
 * change. All five are drawn from the firm's own colours: navy #101F2C, gold #C69F54 and its champagne tints, the
 * portal's slate #3F5F86, warm paper. A PDF can embed Charter (the firm's face) and every reader has Helvetica, so
 * those are the two faces on offer.
 *
 * The firm picks one; the others go. Until then STATEMENT_LOOK_DEFAULT is what every caller gets.
 */
export type StatementLookId = 'gold-rule' | 'champagne' | 'navy-gold' | 'ledger' | 'slate'

export interface StatementLook {
  id: StatementLookId
  name: string
  font: string
  /** Body ink, headings, and the big title. */
  ink: string
  title: string
  /** Heading bars over the tables: background and text. A bar with no fill is a coloured label over a rule. */
  barFill: string | null
  barText: string
  /** Striped rows, the total row, the balance bar. */
  stripe: string | null
  total: string
  balanceFill: string
  balanceText: string
  /** The movements grid and the progress fill. */
  grid: 'all' | 'rows' | 'none'
  progress: string
  /** Small labels (Date:, Creditor:). */
  muted: string
}

const NAVY_BF = '#101F2C'
const GOLD_BF = '#C69F54'
const GOLD_DEEP = '#8A6A26'
const CHAMPAGNE = '#F4EAD3'
const CHAMPAGNE_PALE = '#FAF5EA'
const SLATE = '#3F5F86'
const HELVETICA = 'Helvetica, Arial, sans-serif'

export const STATEMENT_LOOKS: Record<StatementLookId, StatementLook> = {
  /* 1. White page, navy words, gold only as accent: gold labels over thin rules, a champagne balance band. */
  'gold-rule': {
    id: 'gold-rule', name: '1 · Gold rule', font: CHARTER, ink: '#1f2937', title: NAVY_BF,
    barFill: null, barText: GOLD_DEEP, stripe: null, total: CHAMPAGNE_PALE,
    balanceFill: CHAMPAGNE, balanceText: NAVY_BF, grid: 'rows', progress: GOLD_BF, muted: '#6b7280',
  },
  /* 2. Warm: champagne bars with navy words, the softest stripe, a navy balance band with the figure in gold. */
  champagne: {
    id: 'champagne', name: '2 · Champagne', font: CHARTER, ink: '#1f2937', title: NAVY_BF,
    barFill: CHAMPAGNE, barText: NAVY_BF, stripe: CHAMPAGNE_PALE, total: CHAMPAGNE,
    balanceFill: NAVY_BF, balanceText: '#E4C68A', grid: 'rows', progress: GOLD_BF, muted: '#6b7280',
  },
  /* 3. The firm's two colours at full strength, used once each: navy heading bars in gold type, a gold balance band. */
  'navy-gold': {
    id: 'navy-gold', name: '3 · Navy and gold', font: HELVETICA, ink: '#1f2937', title: NAVY_BF,
    barFill: NAVY_BF, barText: '#E4C68A', stripe: '#F5F6F7', total: '#EDEFF2',
    balanceFill: GOLD_BF, balanceText: NAVY_BF, grid: 'none', progress: GOLD_BF, muted: '#6b7280',
  },
  /* 4. A bank statement: Helvetica, no colour blocks, grey labels, hairlines, gold only in the bar and the total. */
  ledger: {
    id: 'ledger', name: '4 · Ledger', font: HELVETICA, ink: '#111827', title: NAVY_BF,
    barFill: null, barText: '#6b7280', stripe: null, total: CHAMPAGNE_PALE,
    balanceFill: CHAMPAGNE_PALE, balanceText: NAVY_BF, grid: 'rows', progress: GOLD_BF, muted: '#6b7280',
  },
  /* 5. The portal's slate in place of navy -- lighter than navy, still the firm's -- with champagne for the balance. */
  slate: {
    id: 'slate', name: '5 · Slate', font: CHARTER, ink: '#1f2937', title: SLATE,
    barFill: SLATE, barText: '#FFFFFF', stripe: '#F2F5F8', total: '#E8EDF3',
    balanceFill: CHAMPAGNE, balanceText: NAVY_BF, grid: 'rows', progress: SLATE, muted: '#5A6B80',
  },
}
export const STATEMENT_LOOK_DEFAULT: StatementLookId = 'gold-rule'

export function statementOfAccount(input: AccountLetterInput, lookId: StatementLookId = STATEMENT_LOOK_DEFAULT): LetterDocument {
  const L = STATEMENT_LOOKS[lookId]
  const lines = input.lines ?? []
  const b = input.breakdown
  const m = moneyProgress({ payments: b.payments, balance: b.balance, settlementFee: b.settlementFee })
  const pct = progressPercent(m)
  const feesNet = b.fees + b.receiptFees - b.vat
  const t = (text: string, over: Partial<Span> = {}): Span => ({ text, size: 9, ...over })
  const c = (text: string, over: Partial<TableCell> = {}, span: Partial<Span> = {}): TableCell => ({ spans: [t(text, span)], ...over })
  /* A HEADING BAR: filled where the look fills them; otherwise a coloured label, which the table's own rule underlines. */
  const bar = (text: string, align: TableCell['align'] = 'left'): TableCell =>
    c(text, { align, ...(L.barFill ? { fill: L.barFill } : {}) }, { bold: true, colour: L.barText, ...(L.barFill ? {} : { size: 8.5 }) })
  const stripe = (i: number): Partial<TableCell> => (L.stripe && i % 2 ? { fill: L.stripe } : {})
  const blank: TableCell = { spans: [{ text: '' }] }
  const heading = (text: string): Block =>
    ({ kind: 'paragraph', keepWithNext: true, spans: [{ text, bold: true, size: 11, colour: L.title }] } as Block)

  /* ---- the head: the lockup left; the title and the reference facts right, under it, as a statement carries them ---- */
  const facts: [string, string][] = [
    ['Date', '{{today}}'],
    ['Our reference', '{{case_number}}'],
    ['Account', '{{account_number}}'],
    ['Position as at', longDate(input.asAt)],
  ]
  if (input.status) facts.push(['Status', input.status])
  const head: Block = {
    kind: 'table', borders: 'none', widths: [50, 50],
    rows: [[
      { spans: [{ text: '' }], image: { src: BF_LOCKUP_PNG, widthMm: 72, heightMm: Math.round(72 * BF_LOCKUP_RATIO * 10) / 10 } },
      {
        align: 'right',
        spans: [
          { text: 'STATEMENT OF ACCOUNT', bold: true, size: 16, colour: L.title },
          ...facts.flatMap(([label, value]) => [t(`\n${label}: `, { colour: L.muted }), t(value, { bold: true })]),
        ],
      },
    ]],
  }

  /* ---- who, and the summary, side by side ---- */
  const summary: [string, string, boolean][] = [
    ['Hand-over balance', input.money(input.handedOver), false],
    ['Interest', input.money(b.interest), false],
    ['Fees and expenses', input.money(feesNet), false],
    ['VAT', input.money(b.vat), false],
    ['Payments received', `- ${input.money(b.payments)}`, false],
  ]
  /* WHERE A RULE HELD THE BALANCE DOWN, BY HOW MUCH -- without it the page does not add up. */
  if (b.withheld > 0) summary.push([b.cappedBy === 'written off' ? 'Written off' : 'Not recoverable (in duplum)', `- ${input.money(b.withheld)}`, false])
  summary.push(['BALANCE NOW OWING', input.money(b.balance), true])
  const who: TableCell[] = [
    c('{{debtor_name}}', {}, { bold: true, size: 10 }),
    c('Creditor: {{client_name}}', {}, { colour: L.ink }),
    /* OPTIONAL, AND ITS LINE LEAVES WITH IT (97% of the book has none): documentWithoutOptional empties this cell and
       keeps the row, because the summary beside it is still there. Last, so the gap it leaves is at the foot. */
    c('Identity number: {{debtor_id_masked}}'),
  ]
  const sideRows: TableCell[][] = [[bar('Account holder'), blank, bar('How the balance is made up'), bar('', 'right')]]
  for (let i = 0; i < summary.length; i++) {
    const [label, value, total] = summary[i]
    const shade = total ? { fill: L.total } : {}
    sideRows.push([
      who[i] ?? blank,
      blank,
      c(label, shade, total ? { bold: true, colour: L.title } : {}),
      c(value, { align: 'right', ...shade }, total ? { bold: true, colour: L.title } : {}),
    ])
  }
  const side: Block = { kind: 'table', borders: L.barFill ? 'none' : 'rows', widths: [42, 4, 34, 20], headerRow: true, keepTogether: true, rows: sideRows }

  /* ---- how far: the same arithmetic as the account screen, in the look's colour ---- */
  const progress: Block = {
    kind: 'progress', fraction: m.fraction, fill: L.progress,
    note: `${pct}% paid · ${input.money(m.recovered)} of ${input.money(m.charged)}${m.owed > 0 ? ` · ${input.money(m.owed)} to settle today` : ''}`,
  } as Block

  /* ---- every movement ---- */
  const movements: Block[] = lines.length === 0
    ? [p('Nothing has been charged or received on this account yet.')]
    : [{
      kind: 'table', borders: L.grid, headerRow: true, widths: [14, 46, 13, 13, 14],
      rows: [
        /* THE SAME FIVE COLUMNS THE SCREEN SHOWS, in the firm's words. */
        [bar('DATE'), bar('DETAIL'), bar('DEBIT', 'right'), bar('CREDIT', 'right'), bar('BALANCE', 'right')],
        ...lines.map((l, i) => {
          const s = stripe(i)
          /* A DASH, NOT R 0.00, in the column this line is not in: a nought reads as a charge of nothing. */
          return [
            c(shortish(l.date), s),
            c(l.description, s),
            c(l.debit > 0 ? input.money(l.debit) : '—', { ...s, align: 'right' }),
            c(l.credit > 0 ? input.money(l.credit) : '—', { ...s, align: 'right' }),
            c(input.money(l.balance), { ...s, align: 'right' }),
          ]
        }),
      ],
    } as Block,
    /* THE BALANCE, IN A BAND AT THE FOOT OF THE MOVEMENTS -- where a statement's reader's eye ends up. */
    {
      kind: 'table', borders: 'none', widths: [74, 26], keepTogether: true,
      rows: [[c('BALANCE NOW OWING', { fill: L.balanceFill, align: 'right' }, { bold: true, colour: L.balanceText, size: 10 }),
        c(input.money(b.balance), { fill: L.balanceFill, align: 'right' }, { bold: true, colour: L.balanceText, size: 11 })]],
    } as Block]

  const small = (text: string, over: Partial<Span> = {}): Block =>
    ({ kind: 'paragraph', align: 'center', spans: [{ text, size: 9, ...over }] } as Block)
  const label = (text: string, i: number): TableCell => c(text, stripe(i), { bold: true, colour: L.title, size: 8.5 })
  const value = (text: string, i: number, bold = false): TableCell => c(text, stripe(i), bold ? { bold: true } : {})

  return {
    defaults: { font: L.font, size: 10, colour: L.ink, lineHeight: 1.35 },
    paper: 'plain',
    runningFoot: 'Statement of account · Ref {{case_number}} · {{firm_name}} · {{firm_phone}} · {{firm_email}} · Page {{page}} of {{pages}}',
    blocks: [
      head,
      side,
      heading('Where the account stands'),
      progress,
      heading('Every movement on the account'),
      ...movements,
      small('Interest is charged at the rate on the agreement. Fees are those prescribed by Annexure B to the Debt '
        + 'Collectors Act 114 of 1998, plus VAT. A line showing no charge is work done that earned nothing, because the '
        + 'Annexure B ceiling for this debt had been reached.', { size: 8, colour: L.muted }),
      /* HOW TO PAY: the summary's own rows and words -- trust account, OUR reference (21% of client references are
         shared, so a payment quoting one cannot be placed), proof of payment, who to ask -- two across in one box that
         is never split over a page. */
      { kind: 'spacer', mm: 2 } as Block,
      /* Kept with the box it introduces: alone at the foot of a page it is an instruction with no account number. */
      { ...small('PAYMENT MUST BE MADE INTO OUR LEGAL PRACTITIONER TRUST ACCOUNT', { bold: true, colour: L.title }), keepWithNext: true } as Block,
      {
        kind: 'table', borders: L.barFill ? 'none' : 'rows', widths: [18, 32, 20, 30], headerRow: true, keepTogether: true,
        rows: [
          [bar('How to pay'), bar(''), bar(''), bar('')],
          [label('BANK', 0), value('{{firm_bank_name}}', 0), label('ACCOUNT NUMBER', 0), value('{{firm_bank_account}}', 0)],
          [label('ACCOUNT NAME', 1), value('{{firm_bank_holder}}', 1), label('BRANCH CODE', 1), value('{{firm_bank_branch}}', 1)],
          [label('REFERENCE', 0), value('{{case_number}}', 0, true), label('PROOF OF PAYMENT', 0), value('Email it to {{firm_email}} on the day you pay', 0)],
          [label('QUESTIONS', 1), value('Speak to {{collector_name}}, who handles this account, on {{firm_phone}}', 1),
            label('SOMETHING WRONG?', 1), value('If anything here does not agree with your own record, tell us in writing and we will check it.', 1)],
        ],
      } as Block,
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
  /*
   * SMALL AND ACROSS, NOT TALL AND DOWN (Stephan, 4 Nov, previewing a statement: "the date, our reference, account
   * ... takes up half the page. I think that can be small, and spread out at the top. So that you can get down to
   * business ... the important stuff is the summary of account"). Six facts were six full-size rows down the left, a
   * third of the first page before a single figure; then, the same day, a band of three across -- superseded below.
   */
  const facts: [string, string][] = [
    ['DATE', '{{today}}'],
    ['OUR REFERENCE', '{{case_number}}'],
    ['ACCOUNT', '{{account_number}}'],
    ['CREDITOR', '{{client_name}}'],
  ]
  /* LEFT OUT RATHER THAN PRINTED EMPTY. A cell reading "STATUS" with nothing under it is a
     question the debtor will ring about. */
  if (input.status) facts.push(['STATUS', input.status])
  facts.push(['POSITION AS AT', longDate(input.asAt)])
  /*
   * ...AND THEN AS THE FIRM DREW IT (Stephan, 4 Nov, sending a page: "make the statement look like this"): the facts
   * as a block on the RIGHT, "Date:" beside its value in the body's own type, set apart by one vertical rule -- a
   * letter's reference block, where a reader looks for it, and out of the way of the summary below. `aside` borders
   * draw the rule; the empty first column is what puts the block on the right.
   */
  const rows: TableCell[][] = facts.map(([label, value]) => [
    { spans: [{ text: '' }] },
    { spans: [{ text: '' }] },
    { spans: [{ text: `${label.charAt(0)}${label.slice(1).toLowerCase()}:`, size: 9.5 }] },
    { spans: [{ text: value, size: 9.5 }] },
  ])
  return [
    { kind: 'table', borders: 'aside', widths: [50, 4, 20, 26], rows },
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
 * MEASURED AGAINST WHAT IT TAKES TO CLEAR THE ACCOUNT, and this used to be measured against the
 * HAND-OVER BALANCE instead -- deliberately, on the argument that this page is about the debt the
 * client gave us rather than about everything since.
 *
 * THE FIRM SENT THAT BACK, looking at the same bar on the account screen: "all across the board,
 * wherever this bar is visible, it should be calculated like that." And on this page the old
 * measure was the worse of the two by a long way. A debtor handed over at R 5 000 who has paid
 * R 5 100 read as 100% PAID on a letter that went on to ask them for R 1 350,28 -- the exact
 * thing progressPercent refuses to do a rand short of the end, undone here by a different
 * denominator. Capital is not the debt; interest, fees and the receipt fee on settling are the
 * rest of it, and a bar that leaves them out finishes early.
 *
 * THE SAME ARITHMETIC AS EVERY OTHER BAR, through moneyProgress, so the letter and the screen
 * cannot disagree about how far somebody is.
 */
function standsBlock(input: AccountLetterInput): Block[] {
  const m = moneyProgress({
    payments: input.breakdown.payments,
    balance: input.breakdown.balance,
    settlementFee: input.breakdown.settlementFee,
  })
  const pct = progressPercent(m)
  return [
    h(2, 'Where the account stands'),
    {
      kind: 'progress',
      fraction: m.fraction,
      /* THE FIGURES THE PERCENTAGE CAME FROM, because this goes to a debtor and they are entitled
         to add it up. "To settle today" rather than "still owed": the larger figure is what
         closing the account costs, fee included. */
      note: `${pct}% paid · ${input.money(m.recovered)} of ${input.money(m.charged)}`
        + `${m.owed > 0 ? ` · ${input.money(m.owed)} to settle today` : ''}`,
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
