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
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

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
  /*
   * AND THE FIFTH: THE LINES OF A PAYOVER RUN.
   *
   * They arrived with the Finance module and they belong in this set for the same reason as the
   * other four -- once a run is approved its lines ARE the remittance advice a client was paid
   * on, and decision 6 says a later correction is a negative line in the NEXT run rather than an
   * edit to this one. A trigger refuses an edit to an approved run's lines; this is the second
   * lock, and the one that holds even for a draft nobody has approved yet.
   */
  'payover_run_lines',
  /*
   * AND THE SIXTH, WHICH IS NOT MONEY BUT DECIDES IT: who changed a commission rate, the VAT
   * rate, a tariff or the cut-over, from what to what, and why. An audit trail somebody can edit
   * is not an audit trail -- and this one is the only record of a change that silently alters
   * what every debtor is charged and every client is paid.
   */
  'finance_setting_changes',
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

/*
 * ---------------- AND THE BROWSER MUST NOT TRY, BECAUSE TRYING LOOKS LIKE SUCCEEDING ----------
 *
 * THIS IS THE HALF THE RULE WAS MISSING, AND THE FIRM FOUND IT.
 *
 * "So you can't reverse a payment." The Reverse box was PATCHing `account_payments` directly.
 * Postgres does not REFUSE such a write -- with RLS on and no update policy, IT MATCHES NO ROWS.
 * PostgREST answers 204, the client's `error` is null, the modal closes and the list reloads, and
 * the payment is exactly as it was. The immutability held perfectly and the screen reported a
 * reversal that never happened, which on a bounced cheque leaves the debtor credited for money
 * that came back and the client remitted for it.
 *
 * So a write to one of these tables from the browser is a bug whether or not it is refused. Every
 * legitimate one goes through a security-definer function, where the refusal is an exception with
 * a sentence on it. An INSERT is fine -- the ledgers have insert policies, and that is how money
 * gets recorded in the first place.
 */
const SOURCE = ['src', 'api']
function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { yield* files(p); continue }
    if (p.endsWith('.ts') || p.endsWith('.tsx')) yield p
  }
}

const writes = []
let scanned = 0
for (const root of SOURCE) {
  for (const file of files(new URL(`../../${root}`, import.meta.url).pathname)) {
    scanned += 1
    const text = readFileSync(file, 'utf8')
    for (const table of LEDGERS) {
      /*
       * `.from('x')` and the `.update(`/`.delete(` that follows it, within a short span -- the
       * calls are chained and often wrapped over two or three lines. Matched on the span rather
       * than the line for exactly that reason.
       */
      const chain = new RegExp(`from\\(\\s*'${table}'\\s*\\)[\\s\\S]{0,200}?\\.(update|delete)\\(`, 'g')
      for (const m of text.matchAll(chain)) {
        const line = text.slice(0, m.index).split('\n').length
        writes.push(`${file.replace(/^.*\/(src|api)\//, '$1/')}:${line} .${m[1]}() on ${table}`)
      }
    }
  }
}
/* The walk found the app rather than an empty directory -- otherwise the assertion below passes
   over nothing, which is the vacuous pass this file already warns about elsewhere. */
ok('the app was read', scanned > 200)
check('no screen updates or deletes a ledger behind RLS’s back', writes, [])

/* AND THE ONE THAT USED TO DO IT NOW ASKS THE FUNCTION. Assert the replacement is there, not only
   that the old call is gone -- a check written the other way passes when the button is deleted. */
const payover = readFileSync(new URL('../../src/lib/payover.ts', import.meta.url), 'utf8')
ok('reversing goes through a function', /\.rpc\('reverse_payment'/.test(payover))
ok('...which the schema defines',
  /create or replace function public\.reverse_payment\(p_payment uuid, p_reason text\)/.test(clean))
ok('...Administrator only, failing closed on a null role',
  /reverse_payment[\s\S]{0,400}?current_user_role\(\) is distinct from 'Administrator'/.test(clean))
/* ONCE. A second reversal fires the trigger again on a row that has already given its capital
   back, and hands it back twice. */
ok('...and refusing a payment already reversed',
  /reverse_payment[\s\S]{0,900}?has already been reversed/.test(clean))
/* The reason is not decoration: it becomes the cancellation reason on the receipt fee. */
ok('...and refusing a blank reason',
  /reverse_payment[\s\S]{0,700}?Say why the payment is being reversed/.test(clean))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The six ledgers can be read and written to and never changed or deleted -- enforced by
policies that are ABSENT rather than by policies that refuse, which is why it is worth a check:
the next person to add a policy block has nothing to trip over. Searched over the whole of
schema.sql, because it is append-only and a later migration lands at the end.`)
