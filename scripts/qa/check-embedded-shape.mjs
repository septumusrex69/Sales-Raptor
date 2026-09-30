/**
 * AN EMBEDDED RESOURCE WITH A UNIQUE KEY COMES BACK AS AN OBJECT, NOT A LIST.
 *
 * THE FIRM, LOOKING AT THE FINANCE PAYMENTS TABLE: every money column on every row was a dash --
 * receipt fee, interest, costs, capital, commission, to client -- on payments that had been
 * approved and split hours before. They read it as a question about approval: "should it go in
 * there already, or should it wait to be approved?"
 *
 * IT WAS NEITHER. `payment_allocations.payment_id` is UNIQUE -- one split per payment, which is
 * the firm's rule -- and PostgREST reads that index and decides the relationship is to-ONE. So the
 * embed arrives as a single OBJECT. Read with `?.[0]` it is undefined, every time, on every row.
 *
 * AND IT SILENCED A WARNING THAT MATTERS MORE THAN THE COLUMNS. The Reverse box asks the same
 * embed whether the payment is already inside an issued payover run, and says so -- "the invoice
 * that carried it is not touched, the correction becomes a negative line in the client's next
 * run". That sentence never drew, on any payment, ever.
 *
 * THE RULE THIS FILE HOLDS: where a foreign key is unique, read the embed through a helper that
 * takes either shape. The shape follows an INDEX, and an index is exactly the kind of thing that
 * gets dropped and rebuilt -- so code that assumes one of the two is one migration from breaking
 * in silence, which is how this did.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-embedded-shape.mjs
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
const payments = read('src/pages/finance/FinancePayments.tsx')

/* ---------------- the index that decides the shape ---------------- */

/*
 * ONE SPLIT PER PAYMENT IS THE RULE AND THE CAUSE. Asserted here so that the day somebody makes it
 * non-unique, this file says why the reader was written the way it is.
 */
ok('one split per payment, enforced by a unique key',
  /payment_id uuid not null unique references public\.account_payments \(id\)/.test(sql))

/* ---------------- and the reader takes either shape ---------------- */

ok('the embed is read through a helper', /const oneOf = \(a: Allocation \| Allocation\[\] \| null \| undefined\)/.test(payments))
ok('...which takes either shape', /Array\.isArray\(a\) \? a\[0\] : a \?\? undefined/.test(payments))
ok('...and the type says both are possible',
  /payment_allocations: Allocation \| Allocation\[\] \| null/.test(payments))

/*
 * AND NOTHING INDEXES IT DIRECTLY ANY MORE. This is the assertion that the bug is gone rather than
 * that the helper merely exists -- the table read it one way and the Reverse box the other, and
 * both were wrong in the same way.
 */
check('no allocation is read by indexing the embed',
  (payments.match(/payment_allocations\?\.\[0\]/g) ?? []).length, 0)
ok('the table reads it through the helper', /const a = oneOf\(r\.payment_allocations\)/.test(payments))
ok('...and so does the "already paid over" warning',
  /const invoiced = Boolean\(oneOf\(row\.payment_allocations\)\?\.payover_run_id\)/.test(payments))

/* ---------------- and a payment with no split yet says which ---------------- */

/*
 * THE FIRM'S OWN QUESTION, once the dashes are explained: "should it go in there already? Or
 * should it wait to be approved before it goes there?"
 *
 * IT BELONGS HERE. This list is the book, and a payment invisible until somebody approves it is a
 * payment the person who captured it cannot find -- so they capture it again. What it must not do
 * is look like one that has moved money: after the fix an approved payment shows figures, so an
 * empty row can only mean "not approved", and that has to be said rather than inferred.
 */
ok('a payment still waiting is marked', /Waiting for approval/.test(payments))
ok('...decided by the approval, not by the split',
  /const waiting = !r\.approved_at && !r\.reversed_at/.test(payments))
ok('...which means the list has to read that column', /account_id, approved_at,'/.test(payments))
/*
 * AND IT IS NOT OFFERED A REVERSE. Nothing has happened to reverse: no fee raised, no capital
 * moved, no remittance. It is taken out of the queue above instead.
 */
ok('...and is not offered a reversal', /\{!reversed && !waiting && \(/.test(payments))

console.log(`\ncheck-embedded-shape: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
