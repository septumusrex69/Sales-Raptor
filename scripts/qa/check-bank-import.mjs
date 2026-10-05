/**
 * WHAT THE BANK IMPORT MUST NEVER DO.
 *
 * This is the front door the allocation engine never had: the only thing that could write a
 * payment was the Swordfish migration, so the firm asked where to import payments and the honest
 * answer was nowhere. `check-bank-statement` holds the reading of the file. This holds what the
 * DATABASE does with it, which is where the money rules live.
 *
 * FIVE THINGS, EACH OF WHICH WOULD BE FOUND BY A CLIENT RATHER THAN BY A SCREEN:
 *
 *   - CREDITING A DEBTOR TWICE. Statements overlap at month ends -- September, then September
 *     plus the first week of October -- so a re-upload is the ordinary case, not the exception.
 *     account_payments has no update or delete policy, so a duplicated receipt cannot be tidied
 *     away; it can only be reversed, leaving both rows on the ledger for ever, after the client
 *     has been remitted for it.
 *   - CREDITING A DEBTOR ONCE WHEN THEY PAID TWICE. The opposite failure, and the one a coarser
 *     key produces: a debtor paying R500 twice in a day is two receipts, not one.
 *   - PLACING MONEY ON THE WRONG ACCOUNT. A reference naming two accounts must place nothing.
 *   - IMPORTING MONEY THAT LEFT. 343 of the firm's 2 160 lines are payments OUT. One imported as
 *     a receipt credits a debtor with money the firm paid away.
 *   - MARKING A PAYOVER PAID FOR THE WRONG FIGURE. The bank's debit and the run's net payover
 *     must agree exactly, or the firm has recorded a client as settled for a figure that never
 *     left the account.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-bank-import.mjs
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

const sql = read('supabase/schema.sql')
const lib = read('src/lib/payover.ts')

/* schema.sql is append-only: the LAST definition is the live one. */
function liveFn(name) {
  const at = Math.max(
    sql.lastIndexOf(`create or replace function public.${name}(`),
    sql.lastIndexOf(`create function public.${name}(`),
  )
  if (at < 0) return null
  const end = sql.indexOf('$$;', at)
  return end < 0 ? null : sql.slice(at, end + 3)
}

/* ---------------- the statement is stored, not just read ---------------- */

ok('the statement has a table of its own', /create table if not exists public\.bank_statement_lines/.test(sql))
/*
 * THE UNIQUE INDEX IS THE WHOLE DUPLICATE PROTECTION. A screen that checks before inserting still
 * races with a double-click, and with a colleague uploading the same file at the next desk.
 */
ok('a line can only be imported once',
  /create unique index if not exists bank_statement_lines_key_idx\s*\n\s*on public\.bank_statement_lines \(line_key\)/.test(sql))
/* ONE LINE PRODUCES AT MOST ONE PAYMENT, so a placement cannot be run twice into two receipts. */
ok('...and produces at most one payment',
  /create unique index if not exists bank_statement_lines_payment_idx[\s\S]{0,140}?\(payment_id\) where payment_id is not null/.test(sql))
/* THE THREE KINDS ARE STORED APART. Reading direction back out of a description later is how a
   remittance becomes a receipt. */
ok('credit, debit and note are a stored fact',
  /direction text not null check \(direction in \('credit', 'debit', 'note'\)\)/.test(sql))

/* ---------------- the bank's facts are frozen ---------------- */

const guard = liveFn('protect_bank_statement_line')
ok('a trigger protects what the bank said', guard !== null)
for (const col of ['line_key', 'txn_date', 'amount', 'description', 'direction', 'bank_account']) {
  ok(`...reverting ${col}`, new RegExp(`new\\.${col} := old\\.${col};`).test(guard ?? ''))
}
/*
 * AND A PAYMENT ONCE MADE IS NOT UNMADE FROM HERE. Reversing a receipt is the ledger's job, with
 * a reason written on it -- not a field somebody clears.
 *
 * WITH ONE EXCEPTION, ADDED WHEN REJECTING BECAME POSSIBLE: a REJECTED payment never reached
 * allocate_payment, so there is no ledger to reverse it through, and a line still pointing at it
 * is money claimed by a payment nobody is going to make. The exception is deliberately narrow and
 * this asserts the narrowness rather than just its presence -- it is a CLEARING only
 * (new.payment_id is null), and it asks the payment table whether the rejection is real instead of
 * trusting the caller. check-reject-payment holds the other half.
 */
ok('...and a placed payment cannot be detached',
  /new\.payment_id := old\.payment_id;/.test(guard ?? ''))
ok('...except by a rejection, and only by clearing it',
  /if old\.payment_id is not null\s*\n\s*and not \(new\.payment_id is null/.test(guard ?? ''))
ok('...which is read off the payment rather than taken on trust',
  /p\.id = old\.payment_id and p\.rejected_at is not null/.test(guard ?? ''))
ok('the trigger is attached',
  /create trigger protect_bank_statement_line\s*\n\s*before update on public\.bank_statement_lines/.test(sql))

/* ---------------- importing ---------------- */

const imp = liveFn('import_bank_lines')
ok('the import exists', imp !== null)
/* ADMINISTRATOR ONLY, in the database -- see check-finance-is-administrator-only for the rule. */
ok('...Administrator only', /is distinct from 'Administrator'/.test(imp ?? ''))
/* THE RE-UPLOAD IS SKIPPED RATHER THAN REFUSED: uploading September plus a week of October is the
   ordinary way the firm works, and a statement that refuses wholesale is one nobody can use. */
ok('...a line already imported is skipped', /on conflict \(line_key\) do nothing/.test(imp ?? ''))

/*
 * EXACTLY ONE ACCOUNT, OR NOBODY. account_number is what the DEBTOR types, and it is not unique
 * the way case_number is. Guessing between two credits one debtor with another's money.
 */
ok('...a reference must name exactly one account',
  /array_length\(v_ids, 1\) <> 1/.test(imp ?? ''))
ok('...and an ambiguous one is counted rather than placed',
  /ambiguous := ambiguous \+ 1/.test(imp ?? ''))
/* `min(uuid)` is not a Postgres aggregate -- the first draft of this failed at runtime. */
ok('...using an aggregate that exists', !/min\(a\.id\)/.test(imp ?? ''))

/* ONLY A CREDIT BECOMES A PAYMENT. */
ok('a debit never becomes a payment',
  /if v_dir = 'debit' then debits := debits \+ 1; continue; end if;/.test(imp ?? ''))
ok('...and neither does a zero-amount notice',
  /if v_dir = 'note' then notes := notes \+ 1; continue; end if;/.test(imp ?? ''))

/*
 * paid_to_client IS FALSE. That flag means the debtor paid the CLIENT directly, and this is money
 * in the firm's own TRUST account -- the opposite. Set true, every imported receipt would be
 * remitted as though the client already had it.
 */
ok('an imported receipt is trust money, not paid to the client',
  /'EFT', v_ref, ln->>'description', 'bank', false/.test(imp ?? ''))
/*
 * received_at IS THE BANK'S DATE. When the money landed is a fact about the bank, not about when
 * somebody uploaded the file -- and the payover cycle is cut on it, so defaulting to now() would
 * move receipts into the wrong month's remittance.
 */
ok('...dated when the bank says it landed, at the firm’s own timezone',
  /\(\(ln->>'date'\)::date::timestamp at time zone 'Africa\/Johannesburg'\)/.test(imp ?? ''))

/* ---------------- placing what could not be matched ---------------- */

const place = liveFn('place_bank_line')
ok('an unplaced receipt can be placed by hand', place !== null)
ok('...Administrator only', /is distinct from 'Administrator'/.test(place ?? ''))
/* THE THREE WAYS THIS COULD PUT MONEY SOMEWHERE IT DOES NOT BELONG. */
ok('...refusing anything that is not money received',
  /direction <> 'credit'/.test(place ?? ''))
ok('...refusing one already placed', /payment_id is not null/.test(place ?? ''))
ok('...and refusing an account that is gone',
  /not exists \(select 1 from public\.debtor_accounts where id = p_account\)/.test(place ?? ''))
ok('...and it is trust money too', /'bank', false/.test(place ?? ''))

/* ---------------- confirming a payover left the bank ---------------- */

const rec = liveFn('reconcile_bank_debit')
ok('a payment out can settle a run', rec !== null)
ok('...Administrator only', /is distinct from 'Administrator'/.test(rec ?? ''))
ok('...only money that actually left', /direction <> 'debit'/.test(rec ?? ''))
ok('...only a run that was approved or sent',
  /v_status not in \('approved', 'sent'\)/.test(rec ?? ''))
/*
 * THE AMOUNTS MUST AGREE EXACTLY, and this is the sharpest assertion here. A tolerance would let
 * the firm record a client as settled for a figure that never left the trust account -- and the
 * remittance advice the client already has quotes the other one.
 */
ok('...and only for the exact amount', /abs\(v_line\.amount\) <> v_net/.test(rec ?? ''))
ok('...which marks the run paid', /set status = 'paid'/.test(rec ?? ''))
/* WITNESSED, NOT OVERWRITTEN: a run already carrying a paid date keeps it. */
ok('...without rewriting a date it already had', /paid_at = coalesce\(paid_at,/.test(rec ?? ''))

/* ---------------- and the browser cannot do any of it another way ---------------- */

/* EVERY WRITE GOES THROUGH THE GUARDED RPCS. A direct insert into account_payments from the
   browser would bypass the duplicate protection entirely, because the unique index is on the
   STATEMENT LINE rather than on the payment. */
ok('the Finance library writes payments only through the import',
  !/from\('account_payments'\)[\s\S]{0,60}\.insert/.test(lib))
ok('...and reads the queue through its own function', /rpc\('unallocated_receipts'\)/.test(lib))
ok('...and the payouts through theirs', /rpc\('unreconciled_payouts'\)/.test(lib))

/*
 * AMOUNTS CROSS AS STRINGS. The column is numeric and a JSON number is a double -- this is the
 * one place between the bank's file and the ledger where a cent could be lost to binary floating
 * point, on every receipt, silently.
 */
ok('amounts are sent as decimal strings, not JSON numbers',
  /amount: l\.amount\.toFixed\(2\)/.test(lib))

/* ---------------- capture by hand is a different rule, held elsewhere ---------------- */

/*
 * record_manual_payment USED TO BE ASSERTED HERE and has moved to check-record-payment, because
 * it stopped belonging to this file's subject. The bank import is Administrator-only Finance
 * work; capture by hand is allowed to whoever works the book or talks to the client, and the
 * firm asked for it on the account page as well. Two different rules -- keeping both in one file
 * is how the weaker one quietly becomes the assertion for both.
 */
ok('capture by hand is held in its own check',
  /record_manual_payment/.test(read('scripts/qa/check-record-payment.mjs')))

console.log(`\ncheck-bank-import: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
