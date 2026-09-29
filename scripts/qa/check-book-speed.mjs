/**
 * WHAT MAKES THE BOOK'S LIST FAST, AND WHAT WOULD QUIETLY MAKE IT SLOW AGAIN.
 *
 * The book is the screen the firm opens most, and its query was reading the whole table to hand
 * back fifty rows. Measured on staging at 23 772 accounts, signed in, with the policies in force:
 *
 *   the page   Seq Scan -> Sort -> Limit 50   1 269 ms   ->  Index Scan -> Limit 50   0.56 ms
 *   the count  two policies, per row              484 ms   ->  one policy, InitPlan     6.3 ms
 *
 * NONE OF THE THREE THINGS THAT DID IT IS VISIBLE IN THE CODE THAT BENEFITS FROM IT, which is
 * exactly why they need holding:
 *
 *   - AN INDEX ON THE SORT COLUMN. debtor_accounts had fifteen indexes and none on
 *     `account_number`. Nothing fails without it; the list simply reads the whole book. It is the
 *     sort order in fetchAccounts that makes it load-bearing, so the two are held together here.
 *   - ONE PERMISSIVE POLICY PER COMMAND. A `for all` policy also covers SELECT, so a second one
 *     alongside the select policy is evaluated on every row of every read and can never change
 *     the answer. Re-adding a `for all` policy to this table would undo the larger half.
 *   - `(select auth.uid())`, NOT `auth.uid()`. Per row it reads a GUC and parses JSON out of it.
 *     Postgres hoists the bare call where it can, which is why the page never showed this and the
 *     count did.
 *
 * AND THE COUNT ITSELF IS OPTIONAL NOW. The list keeps it -- "1 to 50 of 735" is what makes the
 * page trustworthy -- but the search boxes were paying for a second pass over every matching row
 * on each keystroke and throwing the number away.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-book-speed.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const sql = code('supabase/schema.sql')
const book = code('src/lib/accountBook.ts')
const mail = code('src/pages/mail/MailPage.tsx')

/* ---------------- the sort column is indexed ---------------- */

ok('the book sorts by account_number', /\.order\('account_number'\)/.test(book))
ok('...and that column is indexed',
  /create index if not exists debtor_accounts_account_number_idx\s*\n\s*on public\.debtor_accounts \(account_number\)/.test(sql))
/* THE OTHER FILTER THAT READS THE WHOLE BOOK WITHOUT ONE. */
ok('the batch filter is indexed too',
  /create index if not exists debtor_accounts_handover_idx/.test(sql))
ok('...and the filter that uses it exists', /out\.eq\('handover_id', q\.handoverId\)/.test(book))

/* ---------------- one permissive policy per command ---------------- */

/*
 * READ THE LAST DEFINITIONS. schema.sql is append-only, so the superseded `for all` policy is
 * still in the file above these -- asserting with indexOf would assert against the very thing
 * this replaced.
 */
const selAt = sql.lastIndexOf('create policy debtor_accounts_select on public.debtor_accounts')
ok('the book has a select policy', selAt > 0)
const sel = selAt > 0 ? sql.slice(selAt, selAt + 220) : ''
ok('...for select only', /for select to authenticated/.test(sel))
/*
 * THE SUBSELECT IS THE POINT. `auth.uid()` bare is re-read per row; wrapped, it is an InitPlan
 * evaluated once. A rewrite that drops the parentheses looks identical and costs the count 50 ms
 * per page at this size, and more as the book grows.
 */
ok('...reading the signed-in user once', /using \(\(select auth\.uid\(\)\) is not null\)/.test(sel))

/* AND NO `for all` POLICY ON THIS TABLE, in the live definitions. That is the half that made the
   subselect worth anything: a second permissive policy runs per row whatever the first says. */
const tail = sql.slice(selAt)
ok('nothing grants all commands at once any more',
  !/create policy [a-z_]+ on public\.debtor_accounts\s*\n?\s*for all/.test(tail))
/* THE THREE WRITES ARE STILL GRANTED -- the split must not have taken a permission with it. */
for (const cmd of ['insert', 'update', 'delete']) {
  ok(`...and ${cmd} is still permitted`,
    new RegExp(`create policy debtor_accounts_${cmd} on public\\.debtor_accounts\\s*\\n\\s*for ${cmd} to authenticated`).test(sql))
}

/* ---------------- the count is paid for only where it is read ---------------- */

ok('the list still counts exactly', /counted \? \{ count: 'exact' \} : undefined/.test(book))
/* THE DEFAULT IS TO COUNT. A caller that forgets the flag gets the honest number, not a silently
   wrong one -- the failure of the opposite default is a pager that reads "1 to 50 of 50". */
ok('...and a caller that says nothing gets it', /q\.countRows !== false/.test(book))
/* AND THE SEARCH BOXES DO NOT. They draw eight rows and never say how many matched. */
check('neither debtor lookup counts the book',
  (mail.match(/fetchAccounts\(\{ search: q, pageSize: 8, countRows: false \}\)/g) ?? []).length, 2)
ok('...and none of them counts by accident',
  !/fetchAccounts\(\{ search: q, pageSize: 8 \}\)/.test(mail))

console.log(`\ncheck-book-speed: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
