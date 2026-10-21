/**
 * A PAYOVER IS MATCHED FROM THE STATEMENT BY ITS REFERENCE FIRST (the firm, 10 Oct: "from the bank
 * statement ... allocate a specific payment made to a client ... linking it from the reference
 * number to the payover").
 *
 * Held here:
 *   1. the run number is found in the debit's reference OR description, any case, with the
 *      "-2" suffix a second run in a month gets;
 *   2. it is matched ONLY at the run's exact amount, only on an approved/sent/paid run, and only
 *      once -- anything else is reported and left for a person;
 *   3. the import runs it straight after the lines land, and Exceptions can run it again.
 *
 * Proved live on staging (rolled back): a debit "IB PAYMENT ... BF PO-SMA-2607" at the run's amount
 * settled the run; "bf po-smb-2607" R1 short was reported, not matched.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-payover-reference-match.mjs
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
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/^\s*\/\/.*$/gm, '')

const sql = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return strip(m?.[2] ?? '')
}

/* ---------- 1. the number, wherever the bank put it ---------- */

const finder = lastFn('payover_number_in')
const pattern = /from '([^']+)'\)/.exec(finder)?.[1] ?? ''
ok('the run number is read case-blind', /upper\(coalesce\(p_text, ''\)\)/.test(finder))
/* The same pattern, run here in JavaScript ((?:) is the same in both). */
const find = (s) => (s.toUpperCase().match(new RegExp(pattern)) ?? [null])[0]
check('...out of a bank description', find('IB PAYMENT TO SIM ALPHA BF PO-SMA-2607'), 'PO-SMA-2607')
check('...in lower case', find('bf po-smb-2607 thanks'), 'PO-SMB-2607')
check('...with a second run\'s suffix', find('BF PO-KFH-2610-2'), 'PO-KFH-2610-2')
check('...and nothing from an ordinary line', find('BANK FEE 0010'), null)

/* ---------- 2. only the exact amount, only once ---------- */

const match = lastFn('match_payovers_by_reference')
ok('it reads the reference and the description',
  /public\.payover_number_in\(coalesce\(l\.reference, ''\) \|\| ' ' \|\| coalesce\(l\.description, ''\)\)/.test(match))
ok('only unallocated debits', /direction = 'debit' and allocation_kind is null and payover_run_id is null/.test(match))
const amountAt = match.indexOf("round(abs(l.amount), 2) <> round(v_run.net_payover, 2)")
const allocAt = match.indexOf("perform public.allocate_bank_line(l.id, 'payover', null, v_run.id)")
ok('the amount must be the run\'s to the cent', amountAt > 0)
ok('...checked before anything is written', amountAt > 0 && allocAt > amountAt)
ok('a run not approved, or already on the statement, is not matched',
  /if v_run\.status not in \('approved', 'sent', 'paid'\)\s+or exists \(select 1 from public\.bank_statement_lines x where x\.payover_run_id = v_run\.id\) then/.test(match))
ok('...and every refusal is reported, not swallowed', (match.match(/differs := differs \+ 1;/g) ?? []).length === 3)
ok('it goes through allocate_bank_line, so the line and the run are settled the ordinary way', allocAt > 0)
ok('trust-tick only', /if not public\.has_capability\('finance\.view'\) then/.test(match))

/* ---------- 3. where it runs ---------- */

const card = strip(read('src/pages/finance/BankImportCard.tsx'))
const importAt = card.indexOf('await importBankLines(')
const matchAt = card.indexOf('await matchPayoversByReference()')
ok('the import matches payovers straight after the lines land', importAt > 0 && matchAt > importAt)
ok('...and says what it matched and what it did not', /data-testid="payovers-matched"/.test(card) && /Not matched: \{n\}/.test(card))
const ex = strip(read('src/components/finance/BankLinesToAllocate.tsx'))
ok('Exceptions can match by reference again', /onClick=\{\(\) => void matchByReference\(\)\}/.test(ex))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-payover-reference-match: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
