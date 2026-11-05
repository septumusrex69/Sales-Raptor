/**
 * SEARCHING SUSPENSE (Raptor · Handover 17, S18; Stephan, 5 Nov: "There also needs to be a search
 * function for the suspense account").
 *
 * Suspense is a QUEUE, not the book -- every receipt nobody has placed yet, already in the browser --
 * so it is filtered here rather than asked of the database again. Trust > Find a payment is the
 * other tool and stays the other tool: it searches every payment Raptor holds, wherever it went.
 * This one narrows the three suspense lists in front of somebody holding a proof of payment.
 *
 * ONE BOX, read the way the proof of payment is read. Every word typed must appear somewhere on the
 * row (the bank's description, the reference, the note, the account it is parked on), EXCEPT that a
 * word which reads as an amount ("1500", "1 500,00", "R1,500.00") may instead match the amount to
 * the cent. Dates are their own two boxes, because "05" in a search box is a reference far more often
 * than a day.
 */
import { parseRandAmount } from './findPaymentAmount.ts'

export interface SuspenseQuery {
  text: string
  /** yyyy-mm-dd, inclusive, on the date the money reached the bank. */
  from: string | null
  to: string | null
}

export interface SuspenseRow {
  date: string
  amount: number
  /** Everything a person might have read on the row. */
  words: (string | null | undefined)[]
}

export const EMPTY_SUSPENSE_QUERY: SuspenseQuery = { text: '', from: null, to: null }

export function isSuspenseQueryEmpty(q: SuspenseQuery): boolean {
  return !q.text.trim() && !q.from && !q.to
}

/**
 * The words of a query. An amount typed with spaces in it ("1 500,00", "R 1 500") is ONE term: split
 * on the spaces it would be "1" and "500,00", and neither is the amount on the proof of payment.
 */
export function queryTerms(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  if (/^R?\s?[\d\s.,]+$/i.test(t) && parseRandAmount(t) !== null) return [t]
  return t.toLowerCase().split(/\s+/).filter(Boolean)
}

export function suspenseMatches(row: SuspenseRow, q: SuspenseQuery): boolean {
  const day = row.date.slice(0, 10)
  if (q.from && day < q.from) return false
  if (q.to && day > q.to) return false
  const hay = row.words.filter(Boolean).join(' ').toLowerCase()
  const hayDigits = hay.replace(/[\s,.]/g, '')
  return queryTerms(q.text).every((term) => {
    const amount = /\d/.test(term) ? parseRandAmount(term) : null
    if (amount !== null && Math.round(amount * 100) === Math.round(row.amount * 100)) return true
    const lower = term.toLowerCase()
    if (hay.includes(lower)) return true
    /* A reference typed without its spaces or dots ("RAP100001" for "RAP-100 001") still finds it. */
    const bare = lower.replace(/[\s,.\-/]/g, '')
    return bare.length >= 3 && hayDigits.replace(/[-/]/g, '').includes(bare)
  })
}
