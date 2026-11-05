/**
 * THE LETTER OF DEMAND BUILDER (Raptor · Handover 16, S13 -- Ryno, 3 Nov).
 *
 * Ryno built this as a page of its own -- "Bredell Ferreira - Letter of Demand Builder" -- and asked for
 * it inside Raptor: "under clients ... a plus new letter ... and then we need to build in this letter of
 * demand builder thing that I made". What he asked for on top of his page:
 *
 *  - the CLIENT found by typing, "like Google search", and the DEBTOR found on that client's book, or by
 *    the account's reference -- "and then it will fetch all the information";
 *  - "or you can manually enter all the information": nothing has to come from Raptor;
 *  - "the person should still be able to make micro edits or edit the document as they go" -- an invoice
 *    list filled from an account is a starting point, never the answer, and the wording is editable;
 *  - send it from Raptor to the debtor's email, "controlled from which email address", or download it and
 *    send it yourself.
 *
 * THIS FILE IS THE PURE HALF: the letter's state, its arithmetic, its wording and what is missing. No DOM,
 * no database, so check-letter-demand can break each rule and watch it fail. The page is
 * src/pages/letters/LetterOfDemandPage.tsx; drawing the PDF is letterPdf.ts.
 *
 * THE LAYOUT AND THE WORDS ARE RYNO'S, carried over as he wrote them: the A4 sheet, the letterhead, the
 * three "what we need from you" options, the acknowledgement of receipt. What changed is where the
 * information comes from and that the wording can be edited.
 */

export interface InvoiceRow {
  inv: string
  date: string
  ref: string
  desc: string
  amt: string
}

/** The paragraphs a person may reword. {field} is filled in; **two asterisks** make bold. */
export interface Wording {
  intro: string
  demand: string
  pay: string
  paid: string
  dispute: string
  reserve: string
  closing: string
}

export interface LetterState {
  date: string
  debtor: string
  client: string
  services: string
  stmt: string
  days: string
  ref: string
  /** Typed only when the amount due is not the invoices' total. */
  amount: string
  col3: string
  rows: InvoiceRow[]
  wording: Wording
  /** Where it was filled from, when it was: the client, and the debtor's account on that client's book. */
  clientId: string | null
  accountId: string | null
}

/**
 * THE STANDARD WORDING, Ryno's own, word for word. A field in braces is filled from the form; a field
 * nobody has filled prints in [brackets], as his page did, so a missing statement date is seen rather than
 * sent as a blank.
 */
export const STANDARD_WORDING: Wording = {
  intro: 'We act on behalf of {client} (“our client”), who rendered {services} to your company. Those services were delivered and invoiced, yet according to our client’s statement dated **{stmt}**, the invoices listed below remain unpaid.',
  demand: 'Our client has delivered on its side; it now expects the same from you. **We hereby demand payment of the full outstanding amount of {total} within {days} ({daysWord}) calendar days of receipt of this letter.**',
  pay: 'Pay {total} into our client’s account as reflected on the invoices, using the reference **{ref}**, and send us proof of payment.',
  paid: 'Send us proof of payment immediately so that the account can be reconciled.',
  dispute: 'Notify us in writing within the same {days}-day period, setting out the basis of the dispute with supporting documentation.',
  reserve: 'Should payment not be received within the period specified, our client reserves the right to consider further lawful recovery steps, subject to the applicable agreements and law. No legal proceedings will be instituted without the necessary authority.',
  closing: 'We would much rather settle this matter promptly and amicably. To discuss the account, call us on **012 348 2156** or email **info@bredellferreira.co.za**. We trust this will receive your urgent attention.',
}

/** What each paragraph is called on the form, in the order it reads on the letter. */
export const WORDING_LABELS: [keyof Wording, string][] = [
  ['intro', 'Opening'], ['demand', 'The demand'], ['pay', 'Option 1 · Pay in full'], ['paid', 'Option 2 · Already paid?'],
  ['dispute', 'Option 3 · Disputing an amount?'], ['reserve', 'If they do not pay'], ['closing', 'Closing'],
]

export const WORDING_FIELDS = ['client', 'debtor', 'services', 'stmt', 'total', 'days', 'daysWord', 'ref', 'date'] as const
export type WordingField = typeof WORDING_FIELDS[number]

export const blankRow = (): InvoiceRow => ({ inv: '', date: '', ref: '', desc: '', amt: '' })

/** "3 November 2026": the date as the letter prints it. The caller passes the FIRM's day (clockNow), never the machine's. */
export function letterDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Johannesburg' })
}

export function freshLetter(today: Date): LetterState {
  return {
    date: letterDate(today), debtor: '', client: '', services: 'services', stmt: '', days: '7', ref: '', amount: '',
    col3: 'REFERENCE', rows: [blankRow()], wording: { ...STANDARD_WORDING }, clientId: null, accountId: null,
  }
}

/* ------------------------------------------- money ------------------------------------------- */

/** "R106,000.00", "106000", "R 1 234,50"? -- digits and one decimal point; anything else is ignored. */
export function parseAmount(t: string | null | undefined): number | null {
  const c = String(t ?? '').replace(/[^\d.-]/g, '')
  if (!c || c === '.' || c === '-') return null
  const n = parseFloat(c)
  return Number.isFinite(n) ? n : null
}

/** Ryno's format: R106,000.00. */
export function formatAmount(n: number): string {
  return `R${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function invoiceTotal(rows: InvoiceRow[]): number {
  /* In cents, so thirty invoices of R0.10 add to R3.00 and not R2.9999999. */
  return rows.reduce((a, r) => a + Math.round((parseAmount(r.amt) ?? 0) * 100), 0) / 100
}

const anyAmount = (rows: InvoiceRow[]) => rows.some((r) => parseAmount(r.amt) !== null)

/** The amount the letter demands: a typed amount where there is one, otherwise what the invoices add up to. */
export function amountDue(s: Pick<LetterState, 'amount' | 'rows'>): number | null {
  const typed = parseAmount(s.amount)
  if (typed !== null) return typed
  return anyAmount(s.rows) ? invoiceTotal(s.rows) : null
}

/** Said beside the amount when a typed figure and the invoices disagree -- the one number a court reads first. */
export function amountMismatch(s: Pick<LetterState, 'amount' | 'rows'>): string | null {
  const typed = parseAmount(s.amount)
  if (typed === null || !anyAmount(s.rows)) return null
  const total = invoiceTotal(s.rows)
  return Math.abs(typed - total) > 0.004
    ? `This doesn’t match the invoice total of ${formatAmount(total)}. Clear this box to use the invoice total.`
    : null
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** "7 (seven) calendar days". Up to 99, which is as long as anybody gives. */
export function numberWord(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 99) return null
  if (n < 20) return ONES[n]
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')
}

/* ------------------------------------------- wording ------------------------------------------- */

/** Each field's value, or '' where nobody has filled it. */
export function fieldValues(s: LetterState): Record<WordingField, string> {
  const due = amountDue(s)
  const d = parseInt(s.days, 10)
  return {
    client: s.client.trim(), debtor: s.debtor.trim(), services: s.services.trim(), stmt: s.stmt.trim(),
    total: due === null ? '' : formatAmount(due), days: Number.isNaN(d) ? '' : String(d), daysWord: numberWord(d) ?? '',
    ref: s.ref.trim(), date: s.date.trim(),
  }
}

/** What a field prints as while it is empty -- Ryno's placeholders. */
export const FIELD_PLACEHOLDERS: Record<WordingField, string> = {
  client: '[Client]', debtor: '[Debtor]', services: '[services]', stmt: '[statement date]', total: '[Amount]',
  days: '[7]', daysWord: '[seven]', ref: '[Reference]', date: '[Date]',
}

export interface Segment { text: string; bold: boolean; field: WordingField | null; empty: boolean }

/**
 * A PARAGRAPH, READY TO DRAW: plain words, bold words, and fields filled in. Pure, so the page and the
 * check read the same thing. A brace that names no field is left as typed, so a mistake shows on the
 * letter instead of vanishing from it.
 */
export function wordingSegments(text: string, values: Record<WordingField, string>): Segment[] {
  const out: Segment[] = []
  const parts = text.split(/(\*\*)/)
  let bold = false
  for (const part of parts) {
    if (part === '**') { bold = !bold; continue }
    for (const piece of part.split(/(\{[a-zA-Z]+\})/)) {
      if (!piece) continue
      const m = /^\{([a-zA-Z]+)\}$/.exec(piece)
      const field = m && (WORDING_FIELDS as readonly string[]).includes(m[1]) ? (m[1] as WordingField) : null
      if (field) {
        const v = values[field]
        out.push({ text: v || FIELD_PLACEHOLDERS[field], bold, field, empty: !v })
      } else {
        out.push({ text: piece, bold, field: null, empty: false })
      }
    }
  }
  return out
}

/** Braces the wording uses that are not fields, so the form can say so before anybody sends them. */
export function unknownFields(w: Wording): string[] {
  const found = new Set<string>()
  for (const text of Object.values(w)) {
    for (const m of text.matchAll(/\{([^}]*)\}/g)) if (!(WORDING_FIELDS as readonly string[]).includes(m[1])) found.add(m[1])
  }
  return [...found]
}

/* ------------------------------------------- what is missing ------------------------------------------- */

/**
 * WHAT IS STILL TO FILL IN, in the form's own words -- Ryno's list, unchanged. Not a refusal: his page let
 * a person download anyway, with the gaps in [brackets], and so does this one. Sending is different (below).
 */
export function missingFor(which: 'letter' | 'ack', s: LetterState): string[] {
  const m: string[] = []
  const need: [keyof LetterState, string][] = which === 'ack'
    ? [['debtor', 'Debtor'], ['client', 'Client'], ['date', 'Date of letter'], ['ref', 'Payment reference'], ['days', 'Days to pay']]
    : [['debtor', 'Debtor'], ['client', 'Client'], ['date', 'Date of letter'], ['stmt', 'Statement date'],
        ['services', 'Description of services'], ['ref', 'Payment reference'], ['days', 'Days to pay']]
  for (const [k, label] of need) if (!String(s[k] ?? '').trim()) m.push(label)
  if (amountDue(s) === null) m.push('Amount due')
  if (which === 'letter') {
    const blank = s.rows.filter((r) => !r.inv.trim() || parseAmount(r.amt) === null).length
    if (blank) m.push(blank === 1 ? '1 invoice' : `${blank} invoices`)
  }
  return m
}

/**
 * NOTHING GOES TO A DEBTOR WITH A HOLE IN IT. A download is a draft the person still holds and can fix; an
 * email is the letter of demand, served. So sending waits for everything the letter needs -- the same list,
 * with no "send anyway".
 */
export function sendBlockers(s: LetterState): string[] {
  return missingFor('letter', s)
}

export function fileName(which: 'letter' | 'ack', s: Pick<LetterState, 'debtor' | 'date'>): string {
  const safe = (t: string) => t.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim()
  const doc = which === 'ack' ? 'Acknowledgement of Receipt' : 'Letter of Demand'
  return `${doc} - ${safe(s.debtor) || 'Debtor'} - ${safe(s.date) || 'undated'}.pdf`
}

/* ------------------------------------------- from Raptor ------------------------------------------- */

/** One account on a client's book, as the debtor search lists it. */
export interface DebtorChoice {
  id: string
  companyId: string
  accountNumber: string | null
  clientReference: string | null
  debtorFirstName: string | null
  debtorSurname: string | null
  debtorKind: 'individual' | 'company'
  capitalHandedOver: number | null
  /** account_balances.balance where it has been worked out; null otherwise. */
  balance: number | null
}

/** A company's name is in the surname column (debtor_kind 'company'); a person's is first name and surname. */
export function debtorDisplayName(d: Pick<DebtorChoice, 'debtorFirstName' | 'debtorSurname' | 'accountNumber'>): string {
  const name = [d.debtorFirstName, d.debtorSurname].filter((x) => x && x.trim()).join(' ').trim()
  return name || d.accountNumber || 'Unnamed account'
}

/**
 * WHAT AN ACCOUNT FILLS IN, and what it does not.
 *
 * The debtor, the reference to pay with (Raptor's own account number: the client's reference is shared by
 * thousands of accounts, see CLAUDE.md's letters), and the amount -- the balance where Raptor has worked
 * one out, else the capital handed over. ONE invoice line, from the handover: Raptor keeps no invoice list
 * (Ryno: "not all the debtors ... the invoicing is going to be so clear"), so the line says where it came
 * from and the person replaces it with the client's statement. The wording, the date, the statement date
 * and the client are left as they are.
 */
export function fillFromAccount(s: LetterState, d: DebtorChoice): LetterState {
  const amount = d.balance ?? d.capitalHandedOver
  const row: InvoiceRow = {
    inv: d.clientReference ?? '', date: '', ref: d.accountNumber ?? '',
    desc: 'As handed over, check against the client’s statement', amt: amount === null ? '' : formatAmount(amount),
  }
  return {
    ...s, accountId: d.id, debtor: debtorDisplayName(d), ref: d.accountNumber ?? s.ref,
    rows: [row], amount: '',
  }
}

/** Typing in the reference box: an exact account number or client reference finds the account. */
export function matchesReference(d: Pick<DebtorChoice, 'accountNumber' | 'clientReference'>, typed: string): boolean {
  const t = typed.trim().toLowerCase()
  if (!t) return false
  return [d.accountNumber, d.clientReference].some((x) => (x ?? '').trim().toLowerCase() === t)
}

/**
 * CLIENTS, AS YOU TYPE ("like Google search ... until I get the client who I want"): a name starting with
 * what was typed first, then one with a word starting with it, then one containing it anywhere; the code
 * counts too. Ten at most.
 */
export function rankClients<T extends { name: string; code?: string | null }>(all: T[], typed: string, limit = 10): T[] {
  const q = typed.trim().toLowerCase()
  if (!q) return []
  const score = (c: T): number => {
    const n = c.name.toLowerCase()
    const code = (c.code ?? '').toLowerCase()
    if (n.startsWith(q) || code === q) return 0
    if (n.split(/[\s(),.-]+/).some((w) => w.startsWith(q)) || code.startsWith(q)) return 1
    if (n.includes(q)) return 2
    return 9
  }
  return all.map((c) => [score(c), c] as const).filter(([s]) => s < 9)
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit).map(([, c]) => c)
}

/* ------------------------------------------- who may send from where ------------------------------------------- */

/**
 * SEND FROM: your own mailbox, or the firm's central one (legal@, chosen under Settings -> Central mailbox).
 * The central mailbox speaks for the firm, so only the people who speak to debtors for clients may use it:
 * an Administrator and the client liaisons. Anybody else sends from their own mailbox, which is still
 * "controlled from which email address" -- theirs. The server holds the same rule (api/_lib/email/send.ts).
 */
export const CENTRAL_MAILBOX_ROLES = ['Administrator', 'Liaison', 'Liaison Manager'] as const

export function maySendFromCentral(role: string | null | undefined): boolean {
  return !!role && (CENTRAL_MAILBOX_ROLES as readonly string[]).includes(role)
}

/** The covering email the letter goes with. Plain, short, and the letter says the rest. */
export function coveringEmail(s: LetterState, withAcknowledgement = true): { subject: string; body: string } {
  const v = fieldValues(s)
  return {
    subject: `Letter of demand: ${v.debtor || 'your account'}${v.client ? ` (on behalf of ${v.client})` : ''}`,
    body: [
      'Dear Sir/Madam,',
      `Please find attached our letter of demand on behalf of ${v.client || 'our client'}${v.total ? `, for ${v.total}` : ''}.`
        + `${v.days ? ` Payment is due within ${v.days} calendar days of receipt.` : ''}`,
      withAcknowledgement
        ? 'Please complete and return the attached acknowledgement of receipt, or contact us if you have any questions about the account.'
        : 'Please contact us if you have any questions about the account.',
      'Kind regards',
    ].join('\n\n'),
  }
}
