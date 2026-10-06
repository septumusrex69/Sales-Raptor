import { supabase } from './supabase'
import type { ClientBookTotals } from './companyRollup.ts'
import type { BookChoice } from './accountBooks.ts'

/**
 * EVERY CLIENT'S REAL FIGURES, IN ONE QUERY.
 *
 * Counted in the DATABASE, not by loading the book: the clients list is a dozen rows and the book
 * behind it is hundreds of thousands, and a list that loads the book to count it stops working the
 * month it matters. `client_book_totals` groups by company and comes back one row per client.
 *
 * FAILS TO AN EMPTY MAP RATHER THAN THROWING. A clients list that refused to draw because a count
 * did not come back would trade the thing people came for against a decoration; the columns read
 * as a dash, which is what they already did.
 */
export async function fetchClientBookTotals(
  book?: BookChoice,
): Promise<Map<string, ClientBookTotals>> {
  const out = new Map<string, ClientBookTotals>()
  const { data, error } = await supabase.rpc('client_book_totals', {
    p_book: !book || book === 'whole' ? null : book,
  })
  if (error) return out
  for (const r of ((data ?? []) as Record<string, unknown>[])) {
    out.set(String(r.company_id), {
      accounts: Number(r.accounts ?? 0),
      capital: Number(r.capital ?? 0),
      outstanding: Number(r.outstanding ?? 0),
      paid: Number(r.paid ?? 0),
    })
  }
  return out
}
