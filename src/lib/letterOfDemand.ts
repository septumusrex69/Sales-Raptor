/**
 * THE LETTER OF DEMAND, AS DATA (Raptor · Handover 16, Ryno, 3 Nov).
 *
 * Ryno built a Letter of Demand Builder as a page of its own and asked for it inside Raptor, on the Clients page:
 * "you can manually enter all the information, or you can go at client ... type in a client's name, it will
 * autofill ... then we could go to debtor ... enter in the client's reference number or the debtor's reference
 * number ... fetch all the information and then just like a double check", then send it from Raptor, from a
 * mailbox of his choosing, or download it and send it himself -- and "the person should still be able to make
 * micro edits", because "not all the debtors ... the invoicing is going to be so clear".
 *
 * PURE: the arithmetic, the words for a number of days, what is still missing, and what an ACCOUNT fills in. The
 * page (src/pages/letters/) draws it; a check can hold it without a browser.
 *
 * WHAT AN ACCOUNT CAN AND CANNOT ANSWER. Raptor keeps no invoice lines on an account -- the handover sheet gives a
 * capital figure and the creditor's reference, nothing finer. So an account fills ONE line (its account number,
 * handover date, client reference, capital handed over) and the amount due is TODAY's balance, worked out by
 * computeBalance exactly as the book shows it. Every line can be changed, split or added to; nothing here is
 * stored as the account's own figure.
 */

export interface InvoiceLine { inv: string; date: string; ref: string; desc: string; amt: string }

export interface LetterState {
  date: string
  debtor: string
  client: string
  services: string
  stmt: string
  days: string
  ref: string
  /** Typed only where the amount due should differ from the lines' total. */
  amount: string
  col3: string
  rows: InvoiceLine[]
  /** The debtor's email address, for sending. */
  email: string
}

export const blankRow = (): InvoiceLine => ({ inv: '', date: '', ref: '', desc: '', amt: '' })

/** A date as the letter writes it: "3 November 2026". */
export function letterDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** A short date for an invoice line: "11 Aug 2026". */
export function lineDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function freshLetter(todayIso: string): LetterState {
  return { date: letterDate(todayIso), debtor: '', client: '', services: 'services', stmt: '', days: '7', ref: '', amount: '', col3: 'REFERENCE', rows: [blankRow()], email: '' }
}

/* ------------------------------------------------------------------------------------------------
 * Money -- as the builder had it
 * ---------------------------------------------------------------------------------------------- */

/** "R106 000.00", "106,000", "1 250.5" -> a number; nothing usable -> null. */
export function parseAmt(t: string | null | undefined): number | null {
  const c = String(t ?? '').replace(/[^\d.-]/g, '')
  if (!c || c === '-' || c === '.') return null
  const n = parseFloat(c)
  return Number.isFinite(n) ? n : null
}

/**
 * "R106,000.00". Grouped with a COMMA on purpose, as Ryno's letter writes it -- never en-ZA's non-breaking space,
 * which the letter's fonts would draw as a gap that may break across a line.
 */
export function fmtRand(n: number): string {
  return `R${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function linesTotal(s: Pick<LetterState, 'rows'>): number {
  /* In cents, so twelve lines of R0.10 are R1.20 and not R1.2000000000000002. */
  return s.rows.reduce((a, r) => a + Math.round((parseAmt(r.amt) ?? 0) * 100), 0) / 100
}

export const anyAmount = (s: Pick<LetterState, 'rows'>) => s.rows.some((r) => parseAmt(r.amt) !== null)

/** What is demanded: the amount typed, or the lines' total, or nothing yet. */
export function amountDue(s: Pick<LetterState, 'amount' | 'rows'>): number | null {
  const typed = parseAmt(s.amount)
  if (typed !== null) return typed
  return anyAmount(s) ? linesTotal(s) : null
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** "seven", "twenty-one": the days written out, as a demand writes them beside the figure. */
export function numberWord(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n >= 100) return null
  if (n < 20) return ONES[n]
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')
}

/** What is still blank, in the form's words -- said before a PDF goes, never silently printed as [brackets]. */
export function missingFor(s: LetterState, which: 'letter' | 'ack'): string[] {
  const need: [keyof LetterState, string][] = which === 'ack'
    ? [['debtor', 'Debtor'], ['client', 'Client'], ['date', 'Date of letter'], ['ref', 'Payment reference'], ['days', 'Days to pay']]
    : [['debtor', 'Debtor'], ['client', 'Client'], ['date', 'Date of letter'], ['stmt', 'Statement date'], ['services', 'Description of services'],
      ['ref', 'Payment reference'], ['days', 'Days to pay']]
  const out = need.filter(([k]) => !String(s[k] ?? '').trim()).map(([, l]) => l)
  if (amountDue(s) === null) out.push('Amount due')
  if (which === 'letter') {
    const blank = s.rows.filter((r) => !r.inv.trim() || parseAmt(r.amt) === null).length
    if (blank) out.push(blank === 1 ? '1 invoice' : `${blank} invoices`)
  }
  return out
}

/** A file name a Windows folder will take: "Letter of Demand - Smit & Seun - 3 November 2026.pdf". */
export function letterFileName(kind: 'Letter of Demand' | 'Acknowledgement of Receipt', s: Pick<LetterState, 'debtor' | 'date'>): string {
  const safe = (t: string) => t.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim()
  return `${kind} - ${safe(s.debtor) || 'Debtor'} - ${safe(s.date) || 'undated'}.pdf`
}

/* ------------------------------------------------------------------------------------------------
 * What an account fills in
 * ---------------------------------------------------------------------------------------------- */

export interface AccountForLetter {
  caseNumber: string
  accountNumber: string | null
  clientReference: string | null
  debtorFirstName: string | null
  debtorSurname: string | null
  debtorKind: 'individual' | 'company'
  capitalHandedOver: number
  handoverDate: string | null
}

/** The debtor as a letter addresses them: a company by its name, a person first name then surname. */
export function debtorName(a: Pick<AccountForLetter, 'debtorFirstName' | 'debtorSurname' | 'debtorKind'>): string {
  const first = (a.debtorFirstName ?? '').trim()
  const last = (a.debtorSurname ?? '').trim()
  return (a.debtorKind === 'company' ? (last || first) : [first, last].filter(Boolean).join(' ')).replace(/\s+/g, ' ')
}

/**
 * THE ACCOUNT, POURED INTO THE LETTER -- every field still editable afterwards. The payment reference is
 * RAPTOR's case number, the one every notice quotes (CLAUDE.md: the client's reference is not unique, and a
 * debtor paying against it lands on several files at once). The amount due is today's balance, typed into
 * `amount` only where it differs from the one line, so the letter says why the two figures are not the same.
 */
export function letterFromAccount(
  s: LetterState, a: AccountForLetter, clientName: string, balanceToday: number | null, email: string | null,
): LetterState {
  const line: InvoiceLine = {
    inv: (a.accountNumber ?? '').trim() || a.caseNumber,
    date: lineDate(a.handoverDate),
    ref: (a.clientReference ?? '').trim(),
    desc: 'Amount handed over for collection',
    amt: fmtRand(a.capitalHandedOver),
  }
  const differs = balanceToday !== null && Math.abs(balanceToday - a.capitalHandedOver) > 0.004
  return {
    ...s,
    client: clientName,
    debtor: debtorName(a),
    ref: a.caseNumber,
    rows: [line],
    amount: differs ? fmtRand(balanceToday as number) : '',
    email: email ?? s.email,
  }
}

/** The debtor's email to send to: the primary live one, else the newest live one, else none. */
export function debtorEmail(contacts: { kind: string; value: string; is_primary?: boolean | null; retired_at?: string | null; created_at?: string | null }[]): string | null {
  const live = contacts.filter((c) => c.kind === 'email' && !c.retired_at && /@/.test(c.value))
  if (!live.length) return null
  const primary = live.find((c) => c.is_primary)
  if (primary) return primary.value.trim().toLowerCase()
  return [...live].sort((x, y) => String(y.created_at ?? '').localeCompare(String(x.created_at ?? '')))[0].value.trim().toLowerCase()
}

/**
 * THE WORDS AN EDITED PARAGRAPH MAY KEEP (the "Edit the wording" switch). Plain text, bold, and the bound fields
 * -- `<span class="calc" data-c="total">` -- so an amount typed in the form still flows into a sentence somebody
 * reworded. Everything else a paste or the browser brings is dropped, its text kept. A browser-only function:
 * it parses with the DOM.
 */
export const BOUND_FIELDS = ['total', 'client', 'debtor', 'ref', 'days', 'daysWord', 'date', 'stmt', 'services', 'col3'] as const

export function cleanParagraph(html: string, doc: Document = document): string {
  const box = doc.createElement('div')
  box.innerHTML = html
  const out: string[] = []
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const walk = (n: Node) => {
    if (n.nodeType === 3) { out.push(esc(n.textContent ?? '')); return }
    if (n.nodeType !== 1) return
    const el = n as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style') return
    if (tag === 'span' && el.classList.contains('calc')) {
      const c = el.getAttribute('data-c') ?? ''
      if ((BOUND_FIELDS as readonly string[]).includes(c)) { out.push(`<span class="calc" data-c="${c}" contenteditable="false"></span>`); return }
    }
    if (tag === 'br') { out.push(' '); return }
    /* The builder writes one bold run as <span class="b">; it stays bold. */
    const bold = tag === 'b' || tag === 'strong' || (tag === 'span' && el.classList.contains('b'))
    if (bold) out.push('<b>')
    el.childNodes.forEach(walk)
    if (bold) out.push('</b>')
  }
  box.childNodes.forEach(walk)
  return out.join('').replace(/\s+/g, ' ').trim()
}
