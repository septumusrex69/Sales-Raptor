/**
 * POSTGREST STOPS AT A THOUSAND ROWS AND DOES NOT SAY SO.
 *
 * THE BUG, FOUND ON THE FIRST TEST IMPORT. The firm: "the Accounts screen shows R0 fees on
 * written-off accounts (BPM0113, BPM20038) while account_fees holds R777.40 and R1 067.20."
 *
 * It was not a write-off rule and not a date cut-off. `fetchLedgersForAccounts` asked for the three
 * ledgers of every account on the page in one request each -- `.in('account_id', ids)` with no
 * range -- and computed each balance from what came back. Supabase sets `db-max-rows` to a
 * thousand: the request SUCCEEDS, the thousand-and-first row is dropped, and there is no error, no
 * flag and no count. 2 281 fee rows went in and a thousand came out. Ten of the twenty-eight test
 * accounts lost most of their fees; four lost all of them. Every one of those balances was short by
 * the missing rows, on the screen the firm reads the book from.
 *
 * AND A CLIENT `.limit()` ABOVE THE CAP IS NOT A LIMIT. `.limit(2000)` and `.limit(5000)` both come
 * back with a thousand rows. One of those fed the next account number in a client's series -- so a
 * big client would have been offered a number already in use -- and the other fed the duplicate
 * check an import runs, where the failure is the same debt imported twice under two case numbers.
 *
 * WHAT THIS GUARDS:
 *
 * 1. THE PAGER EXISTS AND STOPS ON A SHORT PAGE. That is the only honest end-of-rows signal there
 *    is without asking for a count, which is a second pass over every matching row.
 *
 * 2. IT REFUSES RATHER THAN TRUNCATES. A balance built from most of a ledger is a wrong number
 *    that looks like a right one, and this is money on a client statement.
 *
 * 3. NOTHING READS THE BIG TABLES UNPAGED. The three ledgers and the book itself: either the read
 *    goes through the pager, or it is bounded by something at or below the cap, or it is a single
 *    row. A new `.in('account_id', ids)` with no range is this bug again.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-row-cap.mjs
 */
import { readFileSync } from 'node:fs'
import { PAGE, fetchAllRows } from '../../src/lib/fetchAll.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const no = (name, actual) => check(name, actual, false)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/* ------------------------- 1. the pager reads past the cap ------------------------- */

check('a page is PostgREST’s own maximum', PAGE, 1000)

/** A fake builder: `rows` rows in total, handed back a page at a time, counting the round trips. */
function fake(rows, calls = { n: 0 }) {
  return {
    build: () => ({
      range: (from, to) => {
        calls.n += 1
        const out = []
        for (let i = from; i <= to && i < rows; i += 1) out.push({ i })
        return Promise.resolve({ data: out, error: null })
      },
    }),
    calls,
  }
}

{
  const f = fake(2281)
  const all = await fetchAllRows(f.build, { table: 'fees' })
  check('every row comes back, not the first thousand', all.length, 2281)
  check('...in three round trips', f.calls.n, 3)
  check('...and they are the right rows', [all[0].i, all[1000].i, all[2280].i], [0, 1000, 2280])
}

/*
 * EXACTLY ONE PAGE IS THE CASE THAT GOES WRONG. A full page is indistinguishable from a truncated
 * one, so the pager must ask again and only stop on the SHORT page that comes back empty.
 */
{
  const f = fake(1000)
  const all = await fetchAllRows(f.build, { table: 'fees' })
  check('a book of exactly one page is complete', all.length, 1000)
  check('...and it asked a second time to find out', f.calls.n, 2)
}
{
  const f = fake(0)
  check('nothing is nothing', (await fetchAllRows(f.build, { table: 'fees' })).length, 0)
  check('...in one round trip', f.calls.n, 1)
}
{
  const f = fake(999)
  const all = await fetchAllRows(f.build, { table: 'fees' })
  check('a short first page is the whole of it', all.length, 999)
  check('...and it does not ask again', f.calls.n, 1)
}

/* --------------------------- 2. it refuses rather than truncates --------------------------- */

{
  let threw = null
  try { await fetchAllRows(fake(5000).build, { table: 'fees', max: 2000 }) }
  catch (e) { threw = e.message }
  ok('reading past the ceiling refuses', !!threw)
  ok('...and the message names the table', /fees/.test(threw ?? ''))
  /* NO SILENT SHORT ANSWER. The whole point is that a wrong total must not be returned at all. */
  ok('...and says the figures would be short', /short/i.test(threw ?? ''))
}

/* AN ERROR FROM THE DATABASE IS STILL AN ERROR, not an empty page that reads as "no rows". */
{
  let threw = null
  try {
    await fetchAllRows(() => ({ range: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }),
      { table: 'fees' })
  } catch (e) { threw = e.message }
  check('a failed page is raised, not read as empty', threw, 'boom')
}

/* --------------------------- 3. nothing reads the book unpaged --------------------------- */

/*
 * THE FOUR READS THIS WAS FOUND IN. Named one by one rather than by a blanket pattern, because the
 * assertion that matters is that each of these specific screens is complete -- the list's balances,
 * the account page's statement, the next number in a client's series, and the import's duplicate
 * check.
 */
const book = read('src/lib/accountBook.ts')
const queries = read('src/lib/accountQueries.ts')
for (const [what, src, fn] of [
  ["the list's ledgers", book, 'fetchLedgersForAccounts'],
  ["the account page's ledgers", book, 'fetchLedgers'],
  ['the next account number', book, 'fetchAccountReferences'],
  ["the import's duplicate check", book, 'fetchExistingAccounts'],
  ["a client's accounts on a liaison handover", queries, 'moveClientTicketsToLiaison'],
]) {
  const at = src.indexOf(`function ${fn}(`)
  ok(`${fn} is in the file`, at >= 0)
  /* The body, to the next top-level `export` -- enough to hold the reads it makes. */
  const body = at < 0 ? '' : src.slice(at, src.indexOf('\nexport ', at + 10))
  /*
   * EVERY READ IN THE BODY, NOT ONE OF THEM. Written as "does fetchAllRows appear here", this
   * passed with two of the list's three ledgers put back to a single unpaged request -- the fees
   * one, which is the ledger the bug was found in. Counting is what makes the assertion about all
   * of them: one `supabase.from(` per `fetchAllRows`, or something in there is reading unpaged.
   */
  /*
   * EVERY READ OF A BIG TABLE, NOT ONE OF THEM. Written as "does fetchAllRows appear here", this
   * passed with the list's FEES read -- the one the bug was found in -- put back to a single
   * unpaged request, because the other two ledgers still matched. So each `.from(<big table>)` is
   * checked against the text since the previous one, which is where its own pager would be.
   *
   * ONLY THE BIG TABLES. An update is a `.from()` too, and `moveClientTicketsToLiaison` writes to
   * account_queries right after reading the book -- a blanket count read that write as a second
   * unpaged read and failed on correct code.
   */
  const unpaged = []
  const marks = [...body.matchAll(/\.from\('(debtor_accounts|account_fees|account_payments|account_interest_accruals)'\)/g)]
  let since = 0
  for (const m of marks) {
    if (!/fetchAllRows[(<]/.test(body.slice(since, m.index))) unpaged.push(`${fn}: ${m[1]}`)
    since = m.index
  }
  check(`${what} is paged, every read of it`, unpaged, [])
  ok('...and there is at least one such read', marks.length > 0)
}

/*
 * AND NO `.limit()` ANYWHERE ABOVE THE CAP, on any table. Above a thousand the number is a
 * statement about what the author expected rather than about what they get, and the difference
 * between the two is rows that vanish.
 */
const libs = ['src/lib/accountBook.ts', 'src/lib/accountQueries.ts', 'src/lib/accountAllocation.ts',
  'src/lib/accountEnrich.ts', 'src/lib/chargeEngine.ts', 'src/lib/handOutData.ts']
const tooBig = []
for (const f of libs) {
  const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const [, n] of code.matchAll(/\.limit\((\d+)\)/g)) {
    if (Number(n) > PAGE) tooBig.push(`${f}: .limit(${n})`)
  }
}
check('no limit asks for more than one page', tooBig, [])

console.log(`check-row-cap: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
