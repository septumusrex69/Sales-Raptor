/**
 * A person or a company, and the app knowing which.
 *
 * ALMOST EVERYTHING A COLLECTOR DOES TURNS ON IT. A person is rung on their own numbers. A
 * company is reached through its DIRECTORS — a different trace, a different set of people, and a
 * different afternoon. The firm's two newest accounts are both companies and until now nothing
 * could say so: the registration number sat in the ID-number column reading as an ID number.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-account-kind.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, actual) => {
  if (actual === true) { pass += 1; return }
  failures.push(`${name}\n    expected true\n    got      ${JSON.stringify(actual)}`)
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const schema = read('../../supabase/schema.sql')
const book = read('../../src/lib/accountBook.ts')
const detail = read('../../src/pages/accounts/AccountDetail.tsx')

/* ---------- the column, and only two things it may be ---------- */

ok('the account says which it is', /add column if not exists debtor_kind/.test(schema))
ok('...and nothing else', /check \(debtor_kind in \('individual', 'company'\)\)/.test(schema))
/*
 * NOT NULL WITH A DEFAULT. A nullable third state would mean "nobody has said", and every screen
 * downstream would have to decide what to do about it — which is how a two-valued fact becomes a
 * three-valued one. The whole imported book is individuals, so that is the default.
 */
ok('every account has one', /debtor_kind text not null default 'individual'/.test(schema))

/*
 * ONE FIELD, TWO MEANINGS, AND SOMETHING THAT SAYS WHICH. debtor_id_number carries an ID number
 * for a person and a registration number for a company. That is cheaper than two columns of which
 * one is always null — but only if the disambiguator is written down where somebody will find it.
 */
ok('the id column says it doubles as a registration number',
  /comment on column public\.debtor_accounts\.debtor_id_number/.test(schema))

/* ---------- and it survives the hand-written mapper ---------- */

/*
 * THE TRAP THIS CODEBASE ALREADY HAS A NAME FOR. accountBook.toAccount lists every field by hand,
 * so a column in the database, in the type and in the select('*') but missing HERE reads as
 * undefined for ever and nothing fails. diary_capacity sat in that state for months.
 */
ok('the type carries it', /debtorKind: 'individual' \| 'company'/.test(book))
ok('the mapper carries it', /debtorKind: r\.debtor_kind/.test(book))
/*
 * Defaulted in the mapper too, not only in the database. A row read from a cache or a fixture
 * written before the migration has no such column, and `undefined` would render as neither.
 */
ok('...and an unset one reads as a person',
  /r\.debtor_kind === 'company' \? 'company' : 'individual'/.test(book))

/* ---------- a collector can see it without reading the number ---------- */

ok('the account band says which kind it is',
  /account\.debtorKind === 'company' \? 'Company debtor' : 'Debtor'/.test(detail))

/* ---------- the directors of a company are people, not phone numbers ---------- */

/*
 * A SEPARATE TABLE, NOT account_contacts, and the distinction is the point. A director is not a
 * way of reaching the company: they are a person with their own ID number, traceable in their own
 * right, whose directorship can end. Truestone's bureau profile carries six directors of whom
 * four have resigned — filed as contacts they would be four dead ends a collector cannot tell
 * from the two who still matter.
 */
ok('directors have their own table', /create table if not exists public\.account_directors/.test(schema))
ok('...keyed to the account', /account_id uuid not null references public\.debtor_accounts/.test(schema))
/*
 * THE ID NUMBER IS THE POINT OF STORING THEM. A director's own consumer report is keyed on it, so
 * without it a director is a name nobody can trace.
 */
ok('...carrying the id that makes them traceable',
  /create table if not exists public\.account_directors[\s\S]{0,600}id_number text/.test(schema))
/*
 * ACTIVE OR RESIGNED, and only those two. A free-text status would let the bureau's wording drift
 * into the column and a collector could no longer filter on it — which is the only thing that
 * separates the two people worth ringing from the four who left.
 */
ok('...and whether they are still there',
  /status text check \(status in \('Active', 'Resigned'\)\)/.test(schema))
ok('...indexed on it, because that is what gets filtered',
  /account_directors_account_idx[\s\S]{0,80}\(account_id, status\)/.test(schema))
/*
 * A trace costs money under Annexure B item 4(c). Recording when a director was last traced is
 * what stops the firm paying for the same search twice.
 */
ok('...and when they were last traced', /traced_at timestamptz/.test(schema))
/* One row per person per account: a re-imported profile must update, never duplicate. */
ok('a re-import cannot duplicate a director',
  /unique \(account_id, id_number, full_name\)/.test(schema))
ok('the table is not readable by the world', /alter table public\.account_directors enable row level security/.test(schema))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
An account knows whether it is a person or a company. A company's directors are people with their
own ID numbers and their own directorship status, kept apart from the ways of reaching the
company, because four resigned directors filed as contacts are four dead ends.`)
