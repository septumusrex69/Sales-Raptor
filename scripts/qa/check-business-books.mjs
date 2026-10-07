/**
 * THE FIRM'S OWN BOOKS: WHAT IT SPENT, AND WHAT IT THEREFORE MADE.
 *
 * Until `business_expenses` there was no answer to "what did we spend", so Raptor could say what
 * the firm EARNED and not what it MADE -- and the business overview said so in words, because an
 * empty expenses table reads as a firm that spent nothing, which is a figure and a wrong one.
 *
 * WHAT THIS GUARDS:
 *
 * 1. MADE IS EARNED LESS SPENT, NOT DRAWN LESS SPENT. Money earned and still sitting in trust has
 *    been earned. A month read on DRAWINGS would say the firm made nothing in any month it chose
 *    not to transfer -- a statement about a bank transfer dressed up as one about the business.
 *
 * 2. CALENDAR MONTHS, NOT THE PAYOVER CYCLE. The payover runs the 11th to the 10th because that is
 *    when clients are paid; the firm's own books run on calendar months because that is what VAT,
 *    the accountant and the year end run on. Mixing them puts eleven days of one month's rent into
 *    the previous month's result.
 *
 * 3. AN EXPENSE IS CANCELLED, NEVER DELETED. "What did we spend in March" has to keep answering the
 *    same way next year. The table has NO delete policy, so Postgres refuses one -- the same shape
 *    the four trust ledgers have, which check-financial-immutability asserts of them.
 *
 * 4. THE CAPABILITY IS REALLY ENFORCED. business.view was added deliberately unflagged because
 *    nothing checked it; this is the table that changed that, so every policy must ask for it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-business-books.mjs
 */
import { readFileSync } from 'node:fs'
import {
  EXPENSE_CATEGORIES, expenseTotal, monthBounds, monthLabel, thisMonth,
} from '../../src/lib/businessMonth.ts'

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
const sql = read('supabase/schema.sql')

function liveBody(name) {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return null
  const opens = sql.indexOf('as $$', at)
  const ends = sql.indexOf('$$;', opens)
  /* COMMENTS STRIPPED FIRST (HANDOFF section 6): a comment is not code, and the sums below are
     matched on their shape -- a note placed between two terms broke the match on correct SQL. */
  return opens < 0 || ends < 0 ? null
    : sql.slice(opens, ends).replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
}

/* -------------------------- 1. made is earned less spent -------------------------- */

const month = liveBody('business_month')
ok('business_month is in schema.sql', !!month)
/*
 * THE SUM ITSELF, READ OUT OF THE FUNCTION. `f.earned + c.invoiced - s.ex` -- earned, plus what was
 * invoiced to clients, less what was spent. `f.drawn` must NOT appear in it.
 */
ok('made is earned plus invoiced, less spent',
  /select f\.earned, f\.drawn, h\.bal, c\.invoiced, c\.paid, o\.bal, s\.ex, s\.vat,\s*f\.earned \+ c\.invoiced - s\.ex/.test(month ?? ''))
no('...and drawings are not in that sum',
  /f\.earned \+ c\.invoiced - s\.ex[^\n]*f\.drawn/.test(month ?? ''))
/* Drawings are still REPORTED -- the firm wants to know what moved -- just not counted as profit. */
ok('drawings are still reported', /as drawn/.test(month ?? ''))

/* WHAT IS IN TRUST IS NOT PERIOD-BOUND. The firm's balance there is whatever it is today, whenever
   it was earned; filtering it by month would make it read as this month's earnings twice. */
ok('what is held in trust ignores the period',
  /held as \(\s*(--[^\n]*\n\s*)?select coalesce\(sum\(amount\), 0\) as bal from public\.trust_creditor_entries where party = 'firm'\s*\)/.test(month ?? ''))

/* AND IT IS GATED. */
ok('business_month asks the business capability',
  /has_capability\('business\.view'\)/.test(month ?? ''))

/* -------------------------- 2. calendar months -------------------------- */

check('January', monthBounds(2026, 1), { from: '2026-01-01', to: '2026-01-31' })
check('February in a common year', monthBounds(2026, 2), { from: '2026-02-01', to: '2026-02-28' })
/* A LEAP YEAR, because the one month that is not always the same length is the one a hand-written
   bound gets wrong. */
check('February in a leap year', monthBounds(2028, 2), { from: '2028-02-01', to: '2028-02-29' })
check('a thirty-day month', monthBounds(2026, 9), { from: '2026-09-01', to: '2026-09-30' })
check('December', monthBounds(2026, 12), { from: '2026-12-01', to: '2026-12-31' })

/*
 * AND IT IS NOT THE PAYOVER CYCLE. That one runs the 11th to the 10th; if these ever started on an
 * 11th somebody has read the wrong rule across.
 */
for (const m of [1, 6, 12]) {
  ok(`month ${m} starts on the first`, monthBounds(2026, m).from.endsWith('-01'))
  no(`...and not on the eleventh`, monthBounds(2026, m).from.endsWith('-11'))
}

check('this month is read off the date', thisMonth(new Date('2026-10-05T12:00:00Z')),
  { year: 2026, month: 10 })
/* THE LAST DAY OF A MONTH IS STILL THAT MONTH, which an off-by-one in the month index breaks. */
check('...including its last day', thisMonth(new Date('2026-10-31T22:00:00Z')),
  { year: 2026, month: 10 })
ok('and the label names the month', /2026/.test(monthLabel(2026, 10)))

/* -------------------------- 3. cancelled, never deleted -------------------------- */

ok('the expenses table exists', /create table if not exists public\.business_expenses/.test(sql))
ok('it carries a cancel reason', /cancelled_reason text/.test(sql))
/*
 * NO DELETE POLICY AT ALL. Asserted as an absence: with RLS on and no policy, Postgres refuses
 * every delete, which is what keeps last year's March answering the same way.
 */
no('and no delete policy exists', /create policy business_expenses_delete/.test(sql))
ok('row level security is on', /alter table public\.business_expenses enable row level security/.test(sql))

const api = read('src/lib/businessApi.ts')
ok('the app cancels an expense', /\.update\(\{ cancelled_at:/.test(api))
no('...and never deletes one', /\.delete\(\)/.test(api))

/* -------------------------- 4. the capability is enforced -------------------------- */

/*
 * BOUNDED TO THE STATEMENT, by excluding the semicolon that ends it. Written as [\s\S]{0,200} the
 * span ran straight past a policy that had been loosened to `using (true)` and matched the NEXT
 * policy's has_capability -- so the break test that removed the guard passed.
 */
for (const cmd of ['select', 'insert', 'update']) {
  ok(`the ${cmd} policy asks business.view`,
    new RegExp(`create policy business_expenses_${cmd} on public\\.business_expenses[^;]{0,200}?has_capability\\('business\\.view'\\)`).test(sql))
}

/*
 * AND THE TICK NOW CLAIMS IT. capabilities.ts's rule is that only what is enforced goes in; the
 * capability was added without `inDatabase` because nothing checked it, and this table is what
 * changed that. The flag and the policies have to arrive together or one of them is lying.
 */
const caps = read('src/lib/capabilities.ts')
const businessMeta = caps.slice(caps.indexOf("'business.view': {"))
  .slice(0, caps.slice(caps.indexOf("'business.view': {")).indexOf('},') + 2)
ok('business.view claims the database enforces it', /inDatabase: true/.test(businessMeta))

/* -------------------------- the firm's own words -------------------------- */

/*
 * THE CATEGORIES ARE THE LIST THE FIRM GAVE when describing what was missing: "salaries, rent, the
 * bureau's invoices, the SMS gateway, bank charges on both accounts."
 */
check('the categories the firm named', [...EXPENSE_CATEGORIES].sort(), [
  'Bank charges', 'Bureau and gateway', 'Communications', 'Other',
  'Payroll', 'Premises', 'Professional fees', 'Technology',
].sort())
/* AND THE DATABASE AGREES, in both directions -- a category the screen offers and the constraint
   refuses is a form that fails on save. */
const constraint = sql.slice(sql.indexOf('business_expenses_category_check'))
  .slice(0, 400)
for (const c of EXPENSE_CATEGORIES) {
  ok(`'${c}' is allowed by the constraint`, constraint.includes(`'${c}'`))
}

/* VAT IS SPLIT OUT BECAUSE THE FIRM RECLAIMS IT, so the cash that left is the inclusive figure and
   the two are never confused. */
check('the total that left the account', expenseTotal({ amount: 18000, vat: 2700 }), 20700)
check('...and nil VAT is fine', expenseTotal({ amount: 450.5, vat: 0 }), 450.5)
check('...rounded to the cent', expenseTotal({ amount: 0.1, vat: 0.2 }), 0.3)

console.log(`check-business-books: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
