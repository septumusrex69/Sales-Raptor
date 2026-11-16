/**
 * THE TOP BAR'S SEARCH, OVER EVERYTHING (S14, Raptor H13).
 *
 * THE FIRM, 27 Oct: "You should be able to search on a surname, on a telephone number ... on a
 * reference number, on a client reference number, all of the data, it should be searchable ...
 * First prize, we can search anything anywhere ... if it doesn't affect the speed."
 *
 * The box searched the sales side the browser already holds, by name only, and never the debtor
 * book. Now two halves, merged:
 *   - THE BOOK, in the database (global_search): too big for the browser, and searched through two
 *     trigram indexes -- every reference and number on an account, and the name -- so a "contains"
 *     search stays fast on the whole of production. Tickets (T-1016) and requests (R-6) too.
 *   - THE SALES SIDE, here: leads, contacts, clients, deals and staff, by name AND by email, phone,
 *     mobile, website and client code -- the same "anything" the firm asked of the book.
 *
 * A phone number is matched on its digits, in both the 0... and 27... forms, so "082 123 4567",
 * "0821234567" and "+27 82 123 4567" all find the same person -- the rule contact_search already
 * keeps for the book.
 */

/** The digits of a phone number in every form it is written: 0821234567 <-> 27821234567. */
export function phoneForms(value: string | null | undefined): string[] {
  const d = (value ?? '').replace(/\D/g, '')
  if (d.length < 6) return d ? [d] : []
  if (d.startsWith('27') && d.length >= 11) return [d, `0${d.slice(2)}`]
  if (d.startsWith('0')) return [d, `27${d.slice(1)}`]
  return [d]
}

/**
 * Does what was typed appear in any of these fields? Words are matched in any order ("smith john"
 * finds John Smith); a number of six digits or more is also matched against every phone form.
 */
export function matchesAny(fields: (string | null | undefined)[], typed: string): boolean {
  const q = typed.trim().toLowerCase()
  if (!q) return false
  const text = fields.filter(Boolean).join(' ').toLowerCase()
  if (text.includes(q)) return true
  const words = q.split(/\s+/).filter(Boolean)
  if (words.length > 1 && words.every((w) => text.includes(w))) return true
  const digits = q.replace(/\D/g, '')
  if (digits.length >= 6) {
    const forms = fields.flatMap((f) => phoneForms(f))
    const typedForms = phoneForms(digits)
    return forms.some((f) => typedForms.some((t) => f.includes(t)))
  }
  return false
}

/** How long to wait after the last key before asking the database: short enough to feel instant. */
export const SEARCH_PAUSE_MS = 250

/** The book needs three characters (a trigram index cannot help with fewer); T-/R- numbers two. */
export function asksTheBook(typed: string): boolean {
  const q = typed.trim()
  return q.length >= 3 || /^[tr]-?\d+$/i.test(q)
}

/*
 * PAYMENTS, IN THE ONE SEARCH (S21 · Raptor H19). Stephan, 9 Nov, on the Trust area: "the search a payment. Like, is it
 * necessary to do it there". There were five places to look for a payment (this bar, Find a payment, the Client
 * ledger's box, Payments in's History tab and suspense's own filter); now this bar is the one, for whoever holds the
 * trust account. What is typed is read the way Find a payment read it: an amount when it is one (R1 500,00, 1500.00),
 * otherwise words from the proof of payment or a case number -- three letters at least, as for the book.
 *
 * WHERE IT GOES: the account, where the payment can be reversed or moved; a bank line with no account yet goes to
 * suspense on To sort. PURE, so a check can hold it.
 */
export type PaymentQuery = { amount: number; words: null } | { amount: null; words: string } | null

export function paymentQuery(typed: string, parseAmount: (s: string) => number | null): PaymentQuery {
  const t = typed.trim()
  if (/^R?\s*\d[\d\s.,]*$/i.test(t)) {
    /* A bare number of seven digits or more is an ID or a phone number, not an amount anybody pays. */
    if (/^\d{7,}$/.test(t.replace(/\s/g, ''))) return null
    const amount = parseAmount(t)
    return amount !== null && amount > 0 ? { amount, words: null } : null
  }
  return t.length >= 3 ? { amount: null, words: t } : null
}

export function paymentPath(p: { accountId: string | null }): string {
  return p.accountId ? `/accounts/${p.accountId}` : '/trust/exceptions#suspense'
}
