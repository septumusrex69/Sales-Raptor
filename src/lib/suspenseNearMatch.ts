/**
 * SUSPENSE: THE ACCOUNTS A RECEIPT PROBABLY MEANT (S21 · Raptor H19).
 *
 * Stephan, 9 Nov: "proceed with the suspense near match. Give options still a search option." A debtor copies the case
 * number off a notice and slips one character, and the receipt lands in suspense because nothing matches exactly. The
 * database tries every one-slip form of each reference-like word EXACTLY (near_reference_accounts); this file picks the
 * words to try and orders what comes back. NOTHING HERE PLACES MONEY: the screen offers the options and a person
 * confirms one, or searches with Place it.
 *
 * THE NAME IS THE CHECK. Case numbers run in sequence, so "one digit different" nearly always finds a real account --
 * the debtor's neighbour, DRC0019 for DRC0018. An option whose debtor's surname is on the bank line is shown first and
 * says so; one without it says that too, so a near-miss pointing at somebody else is visibly different from one that
 * agrees with the bank.
 *
 * PURE, so a check can hold it.
 */

export interface NearMatchRow {
  token: string
  accountId: string
  caseNumber: string
  accountNumber: string | null
  debtor: string | null
  client: string | null
  matchedOn: 'case number' | 'account number'
  how: string
  rank: number
}

export interface NearMatch extends NearMatchRow {
  /** The debtor's surname (or a name word) appears in what the bank said. */
  nameOnLine: boolean
}

/** Words on the receipt shaped like a reference: letters and digits, a digit in it, separators taken out. */
export function referenceTokens(r: { reference: string | null; description: string }): string[] {
  const out = new Set<string>()
  const text = `${r.reference ?? ''} ${r.description ?? ''}`
  for (const m of text.matchAll(/[A-Za-z]{1,6}[\s\-/.]?\d{2,8}|\d{4,9}/g)) {
    const t = m[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    if (t.length >= 4 && t.length <= 14 && /\d/.test(t)) out.add(t)
  }
  return [...out]
}

/** Whether any word of the debtor's name (three letters or more) is on the bank line. */
export function nameOnLine(debtor: string | null, bankSaid: string): boolean {
  if (!debtor) return false
  const line = ` ${bankSaid.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `
  return debtor.toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 3).some((w) => line.includes(` ${w} `))
}

/**
 * The options for one receipt: every account any of its words nearly names, once each, the name on the bank line
 * first, then the smallest slip (same reference, swapped, one digit, missing, extra), at most `limit`.
 */
export function optionsFor(
  r: { reference: string | null; description: string },
  rows: NearMatchRow[],
  limit = 3,
): NearMatch[] {
  const tokens = new Set(referenceTokens(r))
  const best = new Map<string, NearMatch>()
  for (const row of rows) {
    if (!tokens.has(row.token)) continue
    const m: NearMatch = { ...row, nameOnLine: nameOnLine(row.debtor, `${r.description} ${r.reference ?? ''}`) }
    const had = best.get(row.accountId)
    if (!had || m.rank < had.rank) best.set(row.accountId, m)
  }
  return [...best.values()]
    .sort((a, b) => Number(b.nameOnLine) - Number(a.nameOnLine) || a.rank - b.rank || a.caseNumber.localeCompare(b.caseNumber))
    .slice(0, limit)
}

/** The slip, in the firm's words, beside the option. */
export function slipWords(m: Pick<NearMatch, 'how' | 'token' | 'matchedOn'>): string {
  if (m.how === 'same reference') return `${m.token} is this ${m.matchedOn}`
  return `${m.token} is this ${m.matchedOn} with ${m.how}`
}
