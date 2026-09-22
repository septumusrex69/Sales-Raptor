/**
 * Finding a client by typing at it.
 *
 * THE FIRM: "I don't like the drop down. I think we can have a definitely a better drop down and
 * I should be able to search the client as well. There are other places in the app where I should
 * also be able to search the client where I can't see it currently."
 *
 * A NATIVE <select> IS UNSEARCHABLE ON THE DEVICE THE FIRM USES. On a desktop it at least jumps
 * to the letter you press; on an iPad it is a wheel you scroll, and the book is going to hold
 * hundreds of clients. So the matching moves here, where it can be about more than the first
 * letter of the name.
 *
 * THREE THINGS PEOPLE TYPE, and all three have to work:
 *
 *   - THE CODE. The firm gives every client one and uses it in conversation -- "BRF" is Bredell
 *     Ferreira, and somebody who knows the code should not have to remember the spelling.
 *   - ANY WORD OF THE NAME, not only the first. "ferreira" finds Bredell Ferreira, which a
 *     starts-with match never would, and it is what people actually type.
 *   - A RUN OF LETTERS ANYWHERE, last, because it finds things the other two miss and finds a lot
 *     else besides.
 */

export interface Searchable {
  id: string
  name: string
  code?: string | null
}

/** Case, accents and punctuation removed, so "O'Brien" and "OBrien" meet. */
export function fold(v: string | null | undefined): string {
  return (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Split for word-start matching, on the same folding. */
const words = (v: string) => (v ?? '').split(/[^A-Za-z0-9]+/).map(fold).filter(Boolean)

/**
 * How well this client answers what was typed, or null for not at all.
 *
 * LOWER IS BETTER, and the gaps are wide on purpose: a code somebody typed exactly must never
 * sort below a name that merely contains those letters. "BRF" matches the code of Bredell
 * Ferreira and appears inside "Brookfield Rentals" as a run of letters, and the client whose code
 * it is has to come first.
 */
export function rankClient(client: Searchable, query: string): number | null {
  const q = fold(query)
  if (!q) return 0
  const code = fold(client.code)
  const name = fold(client.name)

  if (code && code === q) return 0
  if (code && code.startsWith(q)) return 1
  if (name.startsWith(q)) return 2
  if (words(client.name).some((w) => w.startsWith(q))) return 3
  if (name.includes(q)) return 4
  if (code && code.includes(q)) return 5
  return null
}

/**
 * The clients worth offering, best first.
 *
 * TIES KEEP ALPHABETICAL ORDER rather than whatever order the store happened to load in. A list
 * that reshuffles between two identical searches is one nobody trusts, and with nothing typed
 * this is the whole list -- which has to read as the alphabetical list it replaced.
 */
export function matchClients<T extends Searchable>(clients: T[], query: string, limit = 50): T[] {
  return clients
    .map((c) => ({ c, rank: rankClient(c, query) }))
    .filter((x): x is { c: T; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map((x) => x.c)
}

/** What the box shows once one is chosen: the name, and the code where there is one. */
export function clientLabel(client: Searchable | null | undefined): string {
  if (!client) return ''
  return client.code ? `${client.name} (${client.code})` : client.name
}
