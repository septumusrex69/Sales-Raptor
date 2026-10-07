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
import { readFileSync, readdirSync } from 'node:fs'

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

/* ---------------- and nothing reads it the broken way ---------------- */

/*
 * THE LIST THAT HAD THE BUG IS GONE. The firm redesigned Payments in -- "Payments in is only for
 * processing current payments" -- and the list of every payment, which embedded the allocation,
 * went with it. Its two readers went to places that do not embed: the queue reads
 * payments_awaiting_approval and Check reads payments_posted, both of which JOIN the allocation in
 * SQL and hand back one flat row. So what is held now is that the broken read cannot come back
 * anywhere, and that whoever embeds the allocation again meets this file's rule.
 */
const SRC = new URL('../../src/', import.meta.url)
const files = []
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir)
    if (e.isDirectory()) walk(p)
    else if (/\.tsx?$/.test(e.name)) files.push(p)
  }
}
walk(SRC)
ok('the source tree was read', files.length > 100)
const indexed = files.filter((f) => /payment_allocations\??\.\[0\]/.test(readFileSync(f, 'utf8')))
check('no allocation is read by indexing the embed, anywhere', indexed.map((f) => f.pathname.split('/src/')[1]), [])
/* AN EMBED IN A SELECT STRING: ' payment_allocations(' -- the shape this file is about. */
const embeds = files.filter((f) => /['+ ]payment_allocations\(/.test(readFileSync(f, 'utf8')))
for (const f of embeds) {
  ok(`${f.pathname.split('/src/')[1]} embeds the allocation and reads it through a helper that takes either shape`,
    /Array\.isArray\([^)]*\) \? [^:]+\[0\] :/.test(readFileSync(f, 'utf8')))
}
check('Payments in no longer embeds the allocation at all', /payment_allocations\(/.test(payments), false)

/* ---------------- the warning it silenced still draws ---------------- */

/*
 * "ALREADY PAID OVER" WAS THE SENTENCE THAT NEVER DREW. The Reverse box moved to Check, where the
 * payover run arrives as a joined column -- not an embed -- so it is read straight off the row.
 */
const check_ = read('src/pages/finance/CheckPayments.tsx')
ok('the Reverse box is on Check', /function ReverseModal\(/.test(check_))
ok('...and its "already paid over" warning reads the run off the posted row',
  /const invoiced = Boolean\(row\.runInvoice\)/.test(check_))
ok('...which payments_posted joins in SQL', /left join public\.payover_runs r on r\.id = a\.payover_run_id/.test(sql))

/* ---------------- and a payment with no split yet is still findable ---------------- */

/*
 * THE FIRM'S OWN QUESTION, once the dashes were explained: "should it go in there already?" A
 * payment invisible until somebody approves it is one the person who captured it captures again.
 * It is on Payments in, in the queue, named as pending -- not mixed into a list of posted ones.
 */
ok('Payments in draws the queue', /<AwaitingApproval /.test(payments))
ok('...headed as pending', /Pending processing/.test(read('src/pages/finance/AwaitingApproval.tsx')))

console.log(`\ncheck-embedded-shape: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
