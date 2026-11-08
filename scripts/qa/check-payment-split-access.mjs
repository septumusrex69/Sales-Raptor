/**
 * ONLY FINANCE SEES THE PAYMENT SPLIT (Raptor H19 / S20; Stephan, 8 Nov).
 *
 * account_payments and payment_allocations were readable by every signed-in person, so the split on every payment
 * -- commission, the firm's share, what the client was paid -- was one REST call away from any collector's browser.
 * Since `s20_payment_split_finance_only` both tables are finance.view at the table, and a non-finance screen reads
 * `account_payment_lines` (the day, amount, route and state; no split, no who-captured-it) or a definer function.
 *
 * Held here:
 *  1. The LAST select policy on each table is finance.view (schema.sql is append-only).
 *  2. The view exists, filters on a signed-in caller or the service role, and carries none of the private columns.
 *  3. The invoker reads that summed payments for non-finance screens became definer, or a collector's figures read
 *     nought; and none of them returns a split column.
 *  4. No file in src/ reads either table directly, except the finance-only paths listed below -- the trap is a new
 *     screen copying an old `.from('account_payments')` and showing a collector an empty statement.
 *  5. The screens a collector, a liaison and the debtor's statement use read the view / the definer function.
 *
 * Run: node scripts/qa/check-payment-split-access.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const root = new URL('../../', import.meta.url).pathname
const read = (p) => readFileSync(join(root, p), 'utf8')
const schema = read('supabase/schema.sql')

/* ---- 1. the policies ---- */
function lastPolicy(name) {
  const re = new RegExp(`(create|alter) policy ${name}\\b[^;]*;`, 'g')
  let m; let last = ''
  while ((m = re.exec(schema))) last = m[0]
  return last
}
for (const p of ['account_payments_select', 'payment_allocations_select']) {
  const pol = lastPolicy(p)
  ok(`${p} is defined`, pol.length > 0)
  ok(`...and its last definition asks for finance.view`, /has_capability\('finance\.view'\)/.test(pol))
  ok(`...and not merely for a signed-in caller`, !/auth\.uid\(\) is not null/i.test(pol))
}

/* ---- 2. the view ---- */
const viewAt = schema.lastIndexOf('create or replace view public.account_payment_lines')
ok('account_payment_lines is defined', viewAt > 0)
const view = viewAt > 0 ? schema.slice(viewAt, schema.indexOf(';', viewAt)) : ''
ok('...with owner\'s rights, so the finance-only policy does not empty it', /security_invoker = false/.test(view))
ok('...filtered to a signed-in caller', /auth\.uid\(\) is not null/.test(view))
ok('...or the server (nightly stored balance, notices)', /'service_role'/.test(view))
for (const col of ['amount', 'received_at', 'approved_at', 'reversed_at', 'rejected_at', 'paid_to_client', 'created_at', 'allocated_on']) {
  ok(`...and gives the screens ${col}`, new RegExp(`p\\.${col}\\b`).test(view))
}
for (const col of ['depositor_name', 'created_by', 'approved_by', 'rejected_by', 'rejection_reason', 'suspense_reason',
  'swordfish_payment_id', 'moved_from_allocation_id', 'hold_as_credit']) {
  ok(`...but never ${col}`, !new RegExp(`\\b${col}\\b`).test(view))
}
ok('anon may not read the view', /revoke all on public\.account_payment_lines from public, anon/.test(schema))

/* ---- 3. definer reads ---- */
for (const fn of ['account_settlement', 'accounts_ready_to_close', 'client_account_outcomes', 'client_book_summary',
  'client_book_totals', 'client_money_by_day', 'collector_daily', 'collector_performance', 'protect_finance_cutover']) {
  ok(`${fn} runs with definer rights (a collector's figures do not read nought)`,
    new RegExp(`alter function public\\.${fn}\\([^)]*\\) security definer`).test(schema))
}
const rof = (() => {
  const at = schema.lastIndexOf('create or replace function public.receipts_on_file(')
  return at < 0 ? '' : schema.slice(at, schema.indexOf('\n$$;', at))
})()
ok('receipts_on_file is defined (the liaison\'s withdraw box)', rof.length > 0)
ok('...and asks for a signed-in caller', /auth\.uid\(\) is not null/.test(rof))
for (const col of ['commission', 'due_to_bf', 'to_interest', 'to_capital', 'to_fees', 'half_a']) {
  ok(`...and returns no ${col}`, !new RegExp(`\\b${col}\\b`).test(rof.slice(0, rof.indexOf('language'))))
}

/* ---- 4. nobody outside finance reads the tables ---- */
/* The finance-only paths, each with the number of direct reads it may make. paymentReverse's one is
   fetchReverseTarget, behind the Reverse button (payment.reverse, a finance tick). */
const ALLOWED = new Map([
  ['src/lib/paymentReverse.ts', 2],
  ['src/pages/finance/FinanceSettings.tsx', 1],
  /* fetchPostedPayments' Captured column (S20): Payments in -> History, a trust screen. */
  ['src/lib/payover.ts', 1],
])
function walk(dir, out = []) {
  for (const f of readdirSync(join(root, dir))) {
    const p = `${dir}/${f}`
    if (statSync(join(root, p)).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
const seen = new Map()
for (const f of walk('src')) {
  const n = (read(f).match(/from\(\s*['"](account_payments|payment_allocations)['"]\s*\)/g) ?? []).length
  if (n) seen.set(f, n)
}
for (const [f, n] of seen) {
  ok(`${f} reads account_payments / payment_allocations only where finance is the reader`, ALLOWED.has(f) && n <= ALLOWED.get(f))
}
ok('the allow-list is not stale (each still reads the table)', [...ALLOWED.keys()].every((f) => seen.has(f)))

/* ---- 5. the screens that must keep working ---- */
const via = (file, re, what) => ok(`${file}: ${what}`, re.test(read(file)))
via('src/lib/accountBook.ts', /fetchAllRows\(\(\) => supabase\.from\('account_payment_lines'\)/, 'the account page\'s ledger reads the view')
via('src/lib/storedBalance.ts', /from\('account_payment_lines'\)\.select\(LEDGER_SELECT\.payments\)/, 'the list, export, nightly balance and notices read the view')
via('src/lib/paymentReverse.ts', /fetchAccountPayments[\s\S]{0,400}from\('account_payment_lines'\)/, 'the Transactions list reads the view')
via('src/components/finance/PaymentDates.tsx', /from\('account_payment_lines'\)/, 'a payment\'s three dates read the view')
via('src/lib/handoverDiscard.ts', /count\('account_payment_lines'\)/, 'undoing a handover counts payments through the view')
via('src/lib/accountEndingApi.ts', /rpc\('receipts_on_file'/, 'the withdraw box reads receipts_on_file')
via('api/_lib/debtorPortal.ts', /admin\.from\('account_payments'\)/, 'the debtor portal reads as the server (service role), untouched')

console.log(`\ncheck-payment-split-access: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
