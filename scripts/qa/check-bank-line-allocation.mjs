/**
 * PROMPT 12: EVERY LINE ON THE TRUST STATEMENT IS ALLOCATED, IN AND OUT.
 *
 * THE FIRM: "So that the trust fund completely reconciles and gets a zero balance. Every single
 * payment going in or going out should be allocated and have a reason for being there."
 *
 * WHAT THIS HOLDS:
 *   1. the suggestions -- obvious where they should be, and silent where two answers are possible
 *   2. allocate_bank_line writes a ledger entry for every kind, tied to its line, and refuses what
 *      is not allowed (a credit as a bank charge, "other" without a reason, a line twice)
 *   3. a debit arrives UNALLOCATED, not 'excluded'; an allocation once made is frozen
 *   4. a bank charge is the firm's cost, never its earnings; a transfer in is not income either
 *   5. the screens: Exceptions lists the lines; the import no longer says money out is "not imported"
 *
 * Proved on staging in a rolled-back transaction against the firm's test statement: its two
 * "##BANK CHARGE" lines (R57.50 each, R115) became two firm entries of -R57.50 tied to their lines,
 * the firm's balance in trust went to -R115 (the business account owing the trust), earned stayed
 * nil, a second allocation and a direct rewrite were both refused, and a liaison saw nothing.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-bank-line-allocation.mjs
 */
import { readFileSync } from 'node:fs'
import {
  candidatesFor, kindsFor, needsReason, needsTarget, suggestAllocation, unexplainedDebitAction,
} from '../../src/lib/bankLineAllocation.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/^\s*\/\/.*$/gm, '')

/* ---------------- 1. the suggestions ---------------- */

const line = (amount, description, direction = amount < 0 ? 'debit' : 'credit') => ({
  id: 'l', txnDate: '2026-09-30', amount, description, direction, reference: null,
  bankAccount: '9999999999', bankAccountLabel: 'Trust Account - TEST',
})
const run = (id, amount) => ({ kind: 'payover', id, amount, label: `INV-${id}` })

check("the test statement's own wording is a bank charge", suggestAllocation(line(-57.5, '##BANK CHARGE'), [])?.kind, 'bank_charge')
for (const d of ['#SERVICE FEE', '#MONTHLY ACC FEE', 'CASH DEP FEE', 'ADMIN FEE']) {
  check(`...and so is "${d}"`, suggestAllocation(line(-10, d), [])?.kind, 'bank_charge')
}
check('a payover run of exactly the amount is suggested, with the run',
  suggestAllocation(line(-4000, 'FNB OB PMT KIS'), [run('r1', 4000)]), { kind: 'payover', targetId: 'r1', why: 'The only payover to a client of exactly this amount: INV-r1.' })
/* TWO RUNS OF ONE AMOUNT IS A QUESTION FOR A PERSON: guessing settles the wrong client's run. */
check('...but not when two runs share the amount', suggestAllocation(line(-4000, 'FNB OB PMT'), [run('r1', 4000), run('r2', 4000)]), null)
check('...nor a run a cent away', suggestAllocation(line(-4000, 'FNB OB PMT'), [run('r1', 4000.01)]), null)
check('a refund of exactly the amount is suggested',
  suggestAllocation(line(-250, 'REFUND'), [{ kind: 'refund', id: 'o1', amount: 250, label: 'Refund to T Ngubane' }])?.targetId, 'o1')
check('naming the business account is a transfer to it',
  suggestAllocation(line(-1000, 'TRANSFER 62700193882'), [], '62700193882')?.kind, 'business_transfer')
check('interest IN is bank interest', suggestAllocation(line(12.34, 'CR INT 4.25%'), [])?.kind, 'bank_interest')
check('the business account paying IN is a transfer from it',
  suggestAllocation(line(115, 'FROM 62700193882'), [], '62700193882')?.kind, 'business_transfer_in')
/* A DEBTOR'S PAYMENT IS PLACED, NOT ALLOCATED: nothing is suggested for it here. */
check("a debtor's payment is not suggested as anything", suggestAllocation(line(300, 'CAPITEC T NGUBANE'), []), null)
check('a credit is never a bank charge, whatever it says', suggestAllocation(line(57.5, '##BANK CHARGE REVERSAL'), [])?.kind ?? null, null)

check('money out may be five things', kindsFor('debit'), ['payover', 'refund', 'business_transfer', 'bank_charge', 'other'])
check('money in, three -- a debtor is placed, not allocated', kindsFor('credit'), ['bank_interest', 'business_transfer_in', 'other'])
ok('a payover and a refund need choosing', needsTarget('payover') && needsTarget('refund') && !needsTarget('bank_charge'))
ok('"other" needs a reason, and only "other"', needsReason('other') && !needsReason('bank_charge'))
check('candidates are matched to the cent', candidatesFor(line(-4000, 'x'), 'payover', [run('a', 4000), run('b', 3999.99)]).map((c) => c.id), ['a'])

/* ---------------- 2. the database ---------------- */

const sql = read('supabase/schema.sql')
const liveFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return strip(m?.[2] ?? '')
}
const alloc = liveFn('allocate_bank_line')
ok('allocate_bank_line asks the trust tick', /has_capability\('finance\.view'\)/.test(alloc))
ok('...refuses a line already allocated', /v_l\.allocation_kind is not null or v_l\.status in \('allocated', 'reconciled'\)/.test(alloc))
ok('...refuses "other" without a reason', /p_kind = 'other' and v_why is null/.test(alloc))
ok('...lets money out be only the five', /p_kind not in \('payover', 'refund', 'business_transfer', 'bank_charge', 'other'\)/.test(alloc))
ok('...and money in only the three', /p_kind not in \('bank_interest', 'business_transfer_in', 'other'\)/.test(alloc))
ok('a payover goes through the existing exact match', /perform public\.reconcile_bank_debit\(p_line, p_target\)/.test(alloc))
ok('a refund settles the refund, whose trigger writes the debtor\'s entry', /update public\.trust_payments_out\s+set paid_at/.test(alloc))
/* EVERY OTHER KIND WRITES ITS OWN ENTRY, TIED TO THE LINE -- that is what makes the bank and the ledger agree. */
for (const [kind, party, reason] of [
  ['bank_charge', 'firm', "'Bank charges - '"],
  ['bank_interest', 'firm', "'Bank interest received - '"],
  ['business_transfer_in', 'firm', "'Paid in from the business account - '"],
  ['business_transfer', 'firm', "'Drawn to the business account - '"],
]) {
  const at = alloc.indexOf(`p_kind = '${kind}' then`)
  const seg = at > 0 ? alloc.slice(at, at + 900) : ''
  ok(`${kind} writes a ${party} entry tied to the line`, seg.includes(`values ('${party}'`) && seg.includes(reason) && /p_line, auth\.uid\(\)/.test(seg))
}
ok('a bank charge is money OUT of the firm\'s balance', /'bank_charge' then\s+insert into public\.trust_creditor_entries \(party, amount, reason, bank_line_id, created_by\)\s+values \('firm', -v_amt/.test(alloc))
ok('"other" is held against nobody until somebody knows', /values \('unidentified'/.test(alloc))
ok('every allocation is recorded on the line', /set allocation_kind = p_kind, allocation_reason = v_why, trust_entry_id = v_entry/.test(alloc))

/* ---------------- 3. arriving, and staying, allocated ---------------- */

const imp = liveFn('import_bank_lines')
ok('a debit arrives unallocated; only a note is excluded', /case when v_dir = 'note' then 'excluded' else 'unallocated' end/.test(imp))
check('...and no longer "excluded" on arrival', /case when v_dir = 'credit' then 'unallocated' else 'excluded' end/.test(imp), false)
const protect = liveFn('protect_bank_statement_line')
ok('an allocation once made is frozen', /if old\.allocation_kind is not null then\s+new\.allocation_kind := old\.allocation_kind;/.test(protect))
ok('...and the bank\'s own facts still are', /new\.amount := old\.amount;/.test(protect))
ok('the list asks the trust tick and shows what is unaccounted for',
  /has_capability\('finance\.view'\)[\s\S]*l\.allocation_kind is null[\s\S]*l\.status not in \('allocated', 'reconciled'\)/.test(liveFn('bank_lines_to_allocate')))
ok('the payover match list stops offering a line said to be something else', /and l\.allocation_kind is null/.test(liveFn('unreconciled_payouts')))

/* ---------------- 4. a cost is not earnings ---------------- */

const kind = liveFn('firm_entry_kind')
ok('the classifier knows a bank charge', /like 'Bank charges - %' then 'bank_charge'/.test(kind))
ok('...and the business paying the trust back', /like 'Paid in from the business account - %' then 'transfer_in'/.test(kind))
ok('business_month leaves both out of earned',
  /not in \('drawing', 'charge_recovered', 'bank_charge', 'transfer_in'\)/.test(liveFn('business_month')))
ok('...and so does Income', /where kind not in \('drawing', 'charge_recovered', 'bank_charge', 'transfer_in'\)/.test(liveFn('business_income')))
/* The firm, 8 Oct: bank interest on the trust account is the firm's interest income -- its own line
   on Income, no longer folded into "other". Held in full in check-business-income. */
ok('bank interest credited to the firm lands in Income on its own line, not nowhere',
  /when kind = 'bank_interest' then amount else 0 end\) as bank_interest/.test(liveFn('business_income')))

for (const sig of ['allocate_bank_line(uuid, text, text, uuid)', 'bank_lines_to_allocate()', 'bank_allocation_candidates()']) {
  ok(`${sig} is revoked from public and anon`, sql.includes(`revoke all on function public.${sig} from public, anon;`))
}

/* ---------------- 5. the screens ---------------- */

ok('Trust -> Exceptions lists the lines', /<BankLinesToAllocate \/>/.test(read('src/pages/finance/FinanceExceptions.tsx')))
const importCard = read('src/pages/finance/BankImportCard.tsx')
check('the import no longer says money out is not imported', /payments out — not imported/.test(importCard), false)
ok('...and says each is to be allocated', /each to be allocated/.test(importCard))
const card = strip(read('src/components/finance/BankLinesToAllocate.tsx'))
ok('nothing is allocated until a person presses Allocate', /onClick=\{go\}/.test(card) && !/useEffect\([^)]*allocateBankLine/.test(card))

/* THE OVERVIEW'S ACTION ON A DEBIT NOTHING ACCOUNTS FOR (the firm, 8 Oct, at "##BANK CHARGE"). */
check('a bank charge is booked as one', unexplainedDebitAction('##BANK CHARGE', null).label, 'Book as a bank charge')
check('...even where a run happens to be the same amount', unexplainedDebitAction('##BANK CHARGE', 'PO-X').label, 'Book as a bank charge')
check('a payout with a likely run names it', unexplainedDebitAction('FNB APP PAYMENT', 'PO-RRC-2610').label, 'Match to PO-RRC-2610')
check('...and every action goes where lines are allocated', unexplainedDebitAction('x', null).to, '/trust/exceptions')

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-bank-line-allocation: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
