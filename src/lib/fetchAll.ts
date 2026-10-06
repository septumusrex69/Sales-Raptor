/**
 * EVERY ROW, OR SAY SO. PostgREST STOPS AT A THOUSAND AND DOES NOT MENTION IT.
 *
 * THE BUG THIS WAS WRITTEN FOR. The accounts list fetches the three ledgers for the fifty accounts
 * on the page in one request each -- `.in('account_id', ids)` with no range -- and computes each
 * balance from what comes back. PostgREST applies a server-side maximum (`db-max-rows`, a thousand
 * on Supabase) and returns the first thousand rows with **no error and no flag**. On the twenty
 * eight test accounts, 2 281 fee rows go in and a thousand come out: BPM0113 gets 1 of its 52 rows,
 * BPM20038 1 of 64, MSH4/20014 and MSH3/10107 none of their 136 and 139. Their fees read as R 0.00
 * and their balances are understated by the whole fee ledger.
 *
 * IT IS THE EXACT FAILURE accountBook's OWN COMMENT SAYS THE LIST EXISTS TO AVOID -- "a list and an
 * account page disagreeing about one debtor" -- because the account page fetches one account and
 * stays under the cap. The list was wrong and the page was right, and nothing anywhere said so.
 *
 * WHY A PAGER AND NOT A BIGGER LIMIT. `.limit(5000)` is the same bug with a bigger number: it is a
 * guess about a table that grows, and the day it is passed the rows go missing again in silence.
 * This asks for a page at a time and stops when a short page comes back, so "all of them" is a
 * fact about the answer rather than a hope about the size.
 *
 * AND IT REFUSES RATHER THAN TRUNCATES. A caller that would need more than `max` rows gets an
 * error naming the table, because a balance built from most of a ledger is a wrong number that
 * looks like a right one -- and this is money on a client statement.
 */

/** PostgREST's own default. A page larger than this is silently cut back to it, so never ask. */
export const PAGE = 1000

/**
 * The shape this needs off a PostgREST builder: `range` narrows it and awaiting it runs it.
 * Typed structurally rather than against the Supabase types, which are generic over the table.
 */
export interface Rangeable<Row> {
  range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
}

/**
 * Every row a query matches, a page at a time.
 *
 * `build` is called once per page because a PostgREST builder is single-use -- awaiting one twice
 * sends the second request with the first one's state. The caller hands over a function that makes
 * a fresh one.
 */
export async function fetchAllRows<Row>(
  build: () => Rangeable<Row>,
  options: { table: string; max?: number } = { table: 'rows' },
): Promise<Row[]> {
  const max = options.max ?? 100_000
  const out: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    /*
     * A SHORT PAGE IS THE END, and it is the only honest signal there is: PostgREST returns no
     * total unless `count` is asked for, and asking for one is a second pass over every matching
     * row on each page.
     */
    if (rows.length < PAGE) return out
    if (out.length >= max) {
      throw new Error(
        `Reading ${options.table} stopped at ${out.length} rows. That is more than this screen can `
        + 'add up, so the figures would be short. Narrow the list and try again.',
      )
    }
  }
}
