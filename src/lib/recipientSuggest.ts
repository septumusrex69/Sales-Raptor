/**
 * Finding the person you meant from three letters.
 *
 * THE FIRM'S WORDS: "if I've sent an email to Reno, I can paste in R, E, N, and then it picks it
 * up and shows me automatically." So typing REN has to find Reno, whose address is probably
 * r.buitendag@something — which means matching the NAME as well as the address, and matching the
 * start of any word in either rather than the start of the whole string.
 *
 * WHY THIS IS NOT A `<datalist>`, which is what it replaces. A datalist's matching belongs to the
 * browser: Chrome matches anywhere in the string, Safari matches the prefix only, and neither
 * will show you a name beside an address or let you take an entry OUT of the list. The firm asked
 * for both — "you should be able to press a little X button next to it".
 *
 * Pure: no database, no clock, no network. Given a list and a query it returns the order.
 */

export interface Suggestion {
  address: string
  /** How they were addressed the last time. Null where only the address was ever seen. */
  name: string | null
  /** How many messages have gone to them, which is what ranks the list. */
  uses: number
  lastUsed: string | null
  /**
   * ON THE RECORD IN FRONT OF YOU, rather than remembered out of sent mail.
   *
   * The two are offered differently on an empty box -- see rankOf -- and the distinction is not
   * the use count: a contextual entry is given a use count high enough to lead, and reading that
   * number back as "this one is on the record" is a guess about how the caller built the list.
   */
  onRecord?: boolean
}

/**
 * Words to match the start of.
 *
 * A NAME AND AN ADDRESS BOTH BREAK INTO WORDS, and the useful boundaries are not the same. A name
 * splits on spaces; an address splits on the punctuation people put in them — r.buitendag,
 * reno_b, reno-buitendag — and the domain is its own word so that typing a company name finds
 * everybody there.
 */
export function wordsOf(suggestion: Suggestion): string[] {
  const words: string[] = []
  const push = (s: string) => { const t = s.trim().toLowerCase(); if (t) words.push(t) }

  for (const part of (suggestion.name ?? '').split(/\s+/)) push(part)
  const at = suggestion.address.indexOf('@')
  const local = at === -1 ? suggestion.address : suggestion.address.slice(0, at)
  const domain = at === -1 ? '' : suggestion.address.slice(at + 1)
  for (const part of local.split(/[._\-+]/)) push(part)
  /* The domain whole and by label: "bredell" and "bredellferreira.co.za" both find the firm. */
  push(domain)
  for (const part of domain.split('.')) push(part)
  return [...new Set(words)]
}

/**
 * How well this suggestion answers the query. Lower is better; null is no match at all.
 *
 * THE ORDER OF THE TIERS IS THE WHOLE BEHAVIOUR. Somebody typing three letters is not searching,
 * they are recognising — so what they have typed is nearly always the start of something, and a
 * match in the middle of a word is a distant third. Putting a substring match level with a prefix
 * match is how "an" offers you every address in the book before the one person called Andries.
 */
export function rankOf(suggestion: Suggestion, query: string): number | null {
  const q = query.trim().toLowerCase()
  /*
   * AN EMPTY BOX IS NOT A QUERY, SO HISTORY DOES NOT ANSWER IT -- BUT THE RECORD IN FRONT OF YOU
   * DOES.
   *
   * History used to match everything, and the panel opened on focus with the six most-written-to
   * addresses in it. That was deliberate and it was wrong in use: the firm opened New email and
   * got a list before typing a character -- "it shouldn't automatically already throw you out all
   * the options that there is, because there's just too many. Literally just after you start
   * typing. So if you type R, then all the R's should start to come up."
   *
   * The reasoning that replaced was that a box which only remembers once you guess the first
   * letter remembers nobody. It holds for a box that CANNOT match a name -- and this one can: one
   * letter already finds Reno by his name as well as by r.buitendag@, which is the whole point of
   * the tiers below. The first letter is not a guess.
   *
   * WHAT IS ON THE RECORD IS A DIFFERENT LIST AND A DIFFERENT SIZE. THE FIRM: "if you're on a
   * debtor's file and it asks you to CC someone and there's an alternative email address, it
   * should kind of give you the option to do that." Nobody can guess the first letter of an
   * address they have never seen -- the alternative on a debtor's file is usually a private
   * address at a domain with nothing to do with the one above it, so RRC00004's Stephan@gmail.com
   * is not found by typing the letters of Stephan@urbanhausgroup.co.za. The objection the rule
   * above answers was about VOLUME: two hundred remembered addresses on a box nobody had typed in
   * yet. An account's own contacts are one or two rows, they are the answer nearly every time the
   * box is a Cc on a debtor's file, and they are the one list a person cannot search for.
   */
  if (q === '') return suggestion.onRecord ? 0 : null
  const address = suggestion.address.toLowerCase()
  const name = (suggestion.name ?? '').toLowerCase()

  if (address === q) return 0
  if (address.startsWith(q)) return 1
  /* The start of the name as typed — "reno b" finds "Reno Buitendag". */
  if (name.startsWith(q)) return 1
  if (wordsOf(suggestion).some((w) => w.startsWith(q))) return 2
  /*
   * Anywhere at all, and only for a query long enough to mean something. Two letters match
   * somewhere inside nearly every address, so a substring tier that took them would bury the
   * prefix matches under noise on exactly the keystroke where the list is most useful.
   */
  if (q.length >= 3 && (address.includes(q) || name.includes(q))) return 3
  return null
}

/**
 * The suggestions to show, in order.
 *
 * Ranked first by how well they match and then by how often they have been used — frequency, not
 * recency, because the person you write to every week should lead even on a day you happened to
 * write to somebody else. `limit` is the number of rows the list can show without becoming
 * something to scroll rather than glance at.
 *
 * AN EMPTY BOX GETS WHAT IS ON THE RECORD AND NOTHING ELSE — see rankOf. Remembered addresses
 * appear on the first letter and not before it.
 */
export function suggestRecipients(
  all: Suggestion[],
  query: string,
  limit = 6,
): Suggestion[] {
  const scored: { s: Suggestion; rank: number }[] = []
  for (const s of all) {
    const rank = rankOf(s, query)
    if (rank !== null) scored.push({ s, rank })
  }
  scored.sort((a, b) =>
    a.rank - b.rank
    || b.s.uses - a.s.uses
    || (b.s.lastUsed ?? '').localeCompare(a.s.lastUsed ?? '')
    || a.s.address.localeCompare(b.s.address))
  return scored.slice(0, Math.max(0, limit)).map((x) => x.s)
}

/**
 * Whether what has been typed is already an address, rather than the start of a search.
 *
 * Used to stop the list reopening over a finished address: somebody who has typed a whole address
 * and is reaching for Send does not want a panel appearing under their cursor.
 */
export function looksLikeAddress(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())
}

/** "Reno Buitendag <reno@x.co.za>", or just the address where no name was ever seen. */
export function describe(s: Suggestion): string {
  return s.name ? `${s.name} <${s.address}>` : s.address
}
