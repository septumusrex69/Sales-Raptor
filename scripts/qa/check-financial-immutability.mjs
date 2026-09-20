/**
 * "FINANCIAL RECORDS ARE IMMUTABLE ONCE REMITTANCE HAS RUN OR A PAYMENT HAS BEEN PROCESSED."
 *
 * The firm's own words, and CLAUDE.md lists it as law rather than preference. What actually
 * enforces it is unusual and worth stating plainly: FOUR TABLES HAVE RLS ENABLED WITH SELECT AND
 * INSERT POLICIES ONLY. Update and delete are denied by OMISSION — there is no policy for them,
 * so Postgres refuses. That is sound, and it is enforced by something NOT BEING WRITTEN DOWN.
 *
 * Which is exactly why it needs a check more than most rules do. The audit of this suite appended
 * an `account_fees_update` policy to schema.sql and the whole suite stayed green: the next
 * session adding a policy block has nothing to trip over, and a ledger that can be edited after
 * remittance is a ledger the firm cannot defend to a client or to the Council.
 *
 * SEARCHED OVER THE WHOLE FILE, not over the block where the table is created. schema.sql is
 * append-only — CLAUDE.md says so — so a later migration lands at the END, hundreds of lines away
 * from the table it loosens.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-financial-immutability.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
/* Comments stripped first, or the prose explaining why there is no update policy reads as one --
   the comment-satisfies-the-regex trap, running backwards. */
const clean = sql.replace(/--.*$/gm, '')

/**
 * The money ledgers.
 *
 * account_payments is what a debtor paid; payment_allocations is how it was split between
 * capital, interest, fees and commission; account_fees is what was charged under Annexure B;
 * account_interest_accruals is what interest was posted and when. Between them they are the
 * statement the debtor is holding and the remittance the client was paid on.
 */
const LEDGERS = [
  'account_payments',
  'payment_allocations',
  'account_fees',
  'account_interest_accruals',
]

for (const table of LEDGERS) {
  ok(`${table} exists`, new RegExp(`create table if not exists public\\.${table}\\b`).test(clean))
  ok(`...with row level security on`,
    new RegExp(`alter table public\\.${table} enable row level security`).test(clean))

  /*
   * NO POLICY ANYWHERE IN THE FILE FOR UPDATE, DELETE OR ALL. `for all` is the one that is easy
   * to add without meaning to: it reads as "the usual policy" and it grants update and delete
   * along with the rest.
   */
  const loosened = [...clean.matchAll(
    new RegExp(`create policy\\s+"?([\\w]+)"?\\s+on\\s+public\\.${table}\\s+for\\s+(update|delete|all)\\b`, 'gi'),
  )].map((m) => `${m[1]} (for ${m[2]})`)
  check(`...and nothing anywhere in schema.sql may update or delete ${table}`, loosened, [])

  /* The insert and select policies ARE expected. Asserted so that "no update policy" cannot be
     satisfied by a table nobody wrote any policy for at all, which would mean nobody can read
     the ledger either -- a different bug that this check would otherwise call a pass. */
  ok(`...while it can still be read`,
    new RegExp(`create policy\\s+"?[\\w]+"?\\s+on\\s+public\\.${table}\\s+for\\s+select\\b`, 'i').test(clean))
  ok(`...and written to in the first place`,
    new RegExp(`create policy\\s+"?[\\w]+"?\\s+on\\s+public\\.${table}\\s+for\\s+insert\\b`, 'i').test(clean))
}

/*
 * AND THE GRANTS DO NOT GIVE BACK WHAT THE POLICIES WITHHOLD. A `grant update` is not enough on
 * its own -- RLS still refuses without a policy -- but the pair of them is how this rule would
 * actually be lost, one half at a time, by two people who each thought the other half held.
 */
for (const table of LEDGERS) {
  const grants = [...clean.matchAll(new RegExp(`grant ([^;]+?) on public\\.${table}\\b`, 'gi'))]
    .map((m) => m[1].toLowerCase())
  const loose = grants.filter((g) => /\b(update|delete|all)\b/.test(g))
  check(`no grant hands out update or delete on ${table}`, loose, [])
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The four money ledgers can be read and written to and never changed or deleted -- enforced by
policies that are ABSENT rather than by policies that refuse, which is why it is worth a check:
the next person to add a policy block has nothing to trip over. Searched over the whole of
schema.sql, because it is append-only and a later migration lands at the end.`)
