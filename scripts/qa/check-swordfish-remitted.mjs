/**
 * A receipt Swordfish already paid over is never split, posted, reversed or moved (prompt 8).
 *
 * THE BUG, found on staging re-importing the test book: the import writes a settled receipt already
 * approved, the insert trigger runs allocate_payment on it, and allocate_payment never asked
 * `paid_over_in_swordfish` -- its own comment named the reason and the code did not. Only
 * approve_payment refused, and imported receipts never pass through approval. Every one was split:
 * 90 allocations, 90 extra receipt fees, 185 trust creditor entries, 62 engine interest postings,
 * and the import died on the interest index the engine's postings collided with.
 *
 * THIS READS THE LAST DEFINITIONS IN schema.sql (append-only: the last one is live). What the
 * database actually DOES is proved by scripts/qa/live/swordfish-cutoff-probe.sql, and what is in it
 * now by scripts/qa/live/check-swordfish-leaks.mjs -- both need a real database, which this layer
 * deliberately has not.
 *
 * Run: node scripts/qa/check-swordfish-remitted.mjs
 */
import { readFileSync, existsSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* COMMENTS STRIPPED FIRST. The comment above allocate_payment's gates always NAMED this reason --
   which is exactly how a check reading text would have passed over the missing code. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
const schema = strip(read('supabase/schema.sql'))

/* The LAST definition, anchored on the full phrase -- a bare name lands on a grant and tests an
   empty string, which fails OPEN. */
const lastFn = (name) => {
  const at = schema.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const open = schema.indexOf('$$', at)
  return schema.slice(at, schema.indexOf('$$', open + 2) + 2)
}

/* ---------- 1. allocate_payment: the FIRST gate, before anything is posted ---------- */

const alloc = lastFn('allocate_payment')
ok('allocate_payment is defined', alloc.length > 1000)
const gate = alloc.indexOf('if v_pay.paid_over_in_swordfish then return null; end if;')
const demo = alloc.indexOf('if v_pay.is_demo or v_pay.reversed_at is not null then return null; end if;')
const accrue = alloc.indexOf('perform public.accrue_interest_to(')
const fee = alloc.indexOf('insert into public.account_fees')
const split = alloc.indexOf('insert into public.payment_allocations')
/* PRESENCE BEFORE ORDER: indexOf is -1 for a missing line, and -1 is "before" everything. */
ok('it asks whether Swordfish already paid this one over', gate > 0)
ok('...and the steps it must precede are all still there', demo > 0 && accrue > 0 && fee > 0 && split > 0)
ok('...as its first gate, before even the demo and reversed one', gate > 0 && demo > 0 && gate < demo)
/* THE INTEREST IS THE ONE THAT KILLED THE IMPORT: the engine posted the open period first, and the
   Swordfish interest rows written next collided with it on account_interest_accruals_period_idx. */
ok('...before the open-period interest is posted', gate > 0 && accrue > 0 && gate < accrue)
ok('...before the receipt fee', gate > 0 && fee > 0 && gate < fee)
ok('...and before the split', gate > 0 && split > 0 && gate < split)

/* EVERY OTHER PATH THAT SPLITS GOES THROUGH IT -- so the one gate covers them. Asserted, because
   the day one of them inserts an allocation of its own, this gate stops covering it. */
for (const name of ['allocate_payment_on_insert', 'approve_payment', 'reallocate_account']) {
  const body = lastFn(name)
  ok(`${name} splits only through allocate_payment`,
    body.length > 0 && /public\.allocate_payment\(/.test(body) && !/insert into public\.payment_allocations/.test(body))
}
const writers = [...schema.matchAll(/create or replace function public\.(\w+)\(/g)]
  .map((m) => m[1]).filter((n, i, all) => all.indexOf(n) === i)
  .filter((n) => /insert into public\.payment_allocations/.test(lastFn(n)))
check('nothing but allocate_payment writes an allocation', writers, ['allocate_payment'])

/* ---------- 2. reversal and moving refuse it ---------- */

const reverse = lastFn('reverse_payment')
const refuseRev = reverse.indexOf('if v_pay.paid_over_in_swordfish then')
const copy = reverse.indexOf('insert into public.account_payments')
ok('reverse_payment refuses a remitted receipt', refuseRev > 0
  && /already paid over in Swordfish[^']*cannot be reversed/.test(reverse))
/* Before the copy, which is what the engine would split -- and which does not carry the flag. */
ok('...before it writes the copy the engine would split', refuseRev > 0 && copy > 0 && refuseRev < copy)

const move = lastFn('move_payment_to_cycle')
const refuseMove = move.indexOf('if v_pay.paid_over_in_swordfish then')
const moveWrite = move.indexOf('update public.account_payments set allocated_on')
ok('move_payment_to_cycle refuses a remitted receipt', refuseMove > 0 && /belongs to no Raptor cycle/.test(move))
ok('...before it moves anything', refuseMove > 0 && moveWrite > 0 && refuseMove < moveWrite)

/* approve_payment already refused; kept refusing. */
ok('approve_payment still refuses one', /if v_pay\.paid_over_in_swordfish then\s+raise exception/.test(lastFn('approve_payment')))

/* ---------- 3. the leak counter ---------- */

const leaks = lastFn('swordfish_remitted_leaks')
ok('swordfish_remitted_leaks() is defined', leaks.length > 0)
for (const [what, re] of [
  ['allocations', /from ra\)/],
  ['Raptor receipt fees', /from account_fees f join r on r\.id = f\.payment_id where f\.source = 'raptor'/],
  ['trust creditor entries', /from trust_creditor_entries t\s+where t\.payment_id in \(select id from r\) or t\.allocation_id in \(select id from ra\)/],
  ['engine interest', /from account_interest_accruals i\s+where i\.source = 'engine'/],
]) ok(`...it counts ${what}`, re.test(leaks))
ok('...and only the service role may ask it',
  /revoke execute on function public\.swordfish_remitted_leaks\(\) from public, anon, authenticated/.test(schema)
    && /grant execute on function public\.swordfish_remitted_leaks\(\) to service_role/.test(schema))

/* ---------- 4. the import still writes the line the gate reads ---------- */

const imp = strip(read('src/lib/swordfishImport.ts'))
ok('the import marks a receipt on or before the cut-off as remitted',
  /paid_over_in_swordfish: when <= settledThrough/.test(imp))
ok('...and approves only those', /approved_at: when <= settledThrough \?/.test(imp))

/* ---------- 5. and the live proofs exist to be run ---------- */

ok('the cut-off probe is in the repository', existsSync(new URL('../../scripts/qa/live/swordfish-cutoff-probe.sql', import.meta.url)))
ok('...and the leak check', existsSync(new URL('../../scripts/qa/live/check-swordfish-leaks.mjs', import.meta.url)))

console.log(`\ncheck-swordfish-remitted: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
