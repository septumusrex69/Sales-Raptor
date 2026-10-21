/* Pure, so check-contact-search can hold it: accountBook.ts pulls in the Supabase client. */

/**
 * A search that is a phone number, as bare digits -- or null where it is not one. "082 123 4567",
 * "+27 82 123 4567" and "(082) 123-4567" are numbers; "Smith" and "KIS0007" are not. Six digits or
 * more, so an account number's tail is not mistaken for a number.
 */
export function contactDigits(search: string): string | null {
  if (!/^[\d\s+()-]+$/.test(search)) return null
  const d = search.replace(/\D/g, '')
  return d.length >= 6 ? d : null
}
