/**
 * The short code a client is known by.
 *
 * THE FIRM: "does every client get a unique code that is generated for it? I like the fact of
 * giving clients numbers."
 *
 * IT IS NOT DECORATION. `suggestReference` builds a client's next account number off their
 * existing series, and the references on a debtor's own paperwork are the prefix and a number —
 * GPS3/10103, ACF10085, APM20097. A client with no code is a client whose first handover has
 * nothing to number itself from.
 *
 * THE SHAPE IS SWORDFISH'S, because the firm's data already speaks it: three letters, and a digit
 * only where those three are taken. AUF, then AUF2 for the next Alpha-something. Copying a
 * convention people already read is worth more than a tidier one they have to learn.
 */

/**
 * Words that tell you nothing about WHICH client this is.
 *
 * LEGAL FORMS AND ARTICLES ONLY. A longer list was tried first and it lost real signal: with
 * "property" in it, Adowa Property Managers came out ADO instead of the APM the firm actually
 * uses. "Property", "Services", "Trading" are parts of a trading name; (Pty) Ltd is not.
 */
const NOISE = new Set([
  'the', 'and', 'of', 'for', 'a', 'pty', 'ltd', 'limited', 'inc', 'cc', 'rf', 'sa',
])

const words = (name: string): string[] => name
  .replace(/\(.*?\)/g, ' ')
  .split(/[^A-Za-z0-9]+/)
  .filter((w) => w.length > 0 && !NOISE.has(w.toLowerCase()))

/**
 * Three letters from a name.
 *
 * THE RULE WAS FITTED TO THE FIRM'S OWN CODES, not invented and then hoped for. Against the eight
 * that came across from Swordfish it lands on five:
 *
 *   three words or more -> the initials   Alpha Upgrade Fund -> AUF, Adowa Property Managers -> APM
 *   two words           -> two + one      Accelerate Fitness -> ACF
 *   one word            -> its first three  Namco-SA -> NAM
 *
 * AND IT CANNOT REACH THE OTHER THREE, which is the point worth writing down. Daikin
 * Airconditioning is DAK, Agri Saad is AID1, Growthpoint Student Accommodation is GPS1 — none of
 * them derivable from the name by any rule, because a person chose them. That is precisely why
 * what this returns is PROPOSED into a box somebody can overwrite and never written silently: a
 * generator that was always obeyed would have renamed three of the firm's clients.
 *
 * NOTHING USABLE COMES BACK EMPTY rather than as a guess. A code nobody can explain on a
 * remittance is worse than a box somebody has to fill in.
 */
export function stemFor(name: string): string {
  const parts = words(name)
  if (parts.length === 0) return ''
  const stem = parts.length >= 3
    ? parts.slice(0, 3).map((w) => w[0]).join('')
    : parts.length === 2
      ? parts[0].slice(0, 2) + parts[1][0]
      : parts[0].slice(0, 3)
  return stem.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * A code nobody else has.
 *
 * Proposed, never imposed: the screen shows it in a box somebody can overwrite, because the firm
 * sometimes has a code in mind and an app that argues about it is an app people work around.
 *
 * COUNTS FROM 2, NOT 1, because the first of a stem is the bare stem — AUF and then AUF2, which
 * is what the imported data does. Starting at AUF1 would leave AUF looking like a different
 * client from AUF1.
 */
export function proposeClientCode(name: string, taken: Iterable<string>): string {
  const stem = stemFor(name)
  if (!stem) return ''
  const used = new Set([...taken].map((c) => c.trim().toUpperCase()).filter(Boolean))
  if (!used.has(stem)) return stem
  for (let n = 2; n < 100; n += 1) {
    if (!used.has(`${stem}${n}`)) return `${stem}${n}`
  }
  return ''
}

/** What is wrong with a code somebody typed, or null. */
export function codeProblem(code: string, taken: Iterable<string>): string | null {
  const c = code.trim().toUpperCase()
  if (!c) return 'A client needs a code — it is what their account references are built on.'
  if (!/^[A-Z][A-Z0-9]{1,7}$/.test(c)) {
    return 'A code is two to eight letters and digits, starting with a letter.'
  }
  const used = new Set([...taken].map((x) => x.trim().toUpperCase()).filter(Boolean))
  if (used.has(c)) return `${c} already belongs to another client.`
  return null
}
