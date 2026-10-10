/**
 * THE TRUST ACCOUNT'S OPENING BALANCE, AND THE OVERVIEW THAT READS FROM THE MONEY (10 Oct).
 *
 * The bank figure on the trust overview was the SUM OF IMPORTED STATEMENT LINES, so whatever the
 * account held before the first statement Raptor has was missing from it -- on staging, the whole
 * of the R15 021.04 "bank / ledger difference". Now it is the bank's balance at the end of a
 * captured day plus every statement line AFTER that day. Held here:
 *
 *   1. trust_position counts the opening once and the lines after it once (not on/before the day);
 *   2. only set_trust_opening_balance can move it -- Administrator with the trust tick, a reason,
 *      not in the future, logged -- and a whole-row save from Firm details cannot put an old one back;
 *   3. the overview's three figures add up: in the trust = accounted for + not accounted for, and
 *      not accounted for splits into unplaced receipts + bank/ledger gap, with any remainder shown.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trust-opening.mjs
 */
import { readFileSync } from 'node:fs'
import { trustHeadline } from '../../src/lib/trustBalance.ts'

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
const code = strip(sql)
const liveFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return strip(m?.[2] ?? '')
}

/* ---------- 1. the bank figure ---------- */
const pos = liveFn('trust_position')
ok('trust_position was found', pos.length > 200)
ok('cash is the opening balance plus the statement lines',
  /coalesce\(max\(f\.trust_opening_balance\), 0\) \+ coalesce\(sum\(l\.amount\), 0\)/.test(pos))
ok('...on the trust account only', /l\.bank_account = f\.trust_account_number/.test(pos.slice(0, pos.indexOf('by_party'))))
ok('...and only lines AFTER the opening day (a line on the day is inside the opening already)',
  /f\.trust_opening_date is null or l\.txn_date > f\.trust_opening_date/.test(pos))
ok('...joined from the settings row, so no statement lines still reads the opening',
  /from public\.firm_settings f\s+left join public\.bank_statement_lines l/.test(pos))
ok('...behind the trust tick, as no row rather than nought', /where public\.has_capability\('finance\.view'\)\s*$/.test(pos.trim()))

ok('the two columns exist', /add column if not exists trust_opening_balance numeric\(14,2\)/.test(code)
  && /add column if not exists trust_opening_date date/.test(code))
ok('...and come together or not at all',
  /check \(\(trust_opening_balance is null\) = \(trust_opening_date is null\)\)/.test(code))

/* ---------- 2. who may move it ---------- */
const setter = liveFn('set_trust_opening_balance')
ok('the setter was found', setter.length > 200)
ok('Administrator with the trust tick only',
  /if not public\.has_capability\('finance\.view'\) or public\.current_user_role\(\) <> 'Administrator' then\s*raise exception/.test(setter))
ok('...never in the future, on the firm\'s clock',
  /if p_as_at > public\.raptor_today\(\) then\s*raise exception/.test(setter))
ok('...with a reason of a sentence', /length\(v_reason\) < 10 then\s*raise exception/.test(setter))
ok('...logged, old and new, with the reason',
  /insert into public\.finance_setting_changes \(setting, old_value, new_value, reason, changed_by\)/.test(setter)
  && /'trust_opening_balance'/.test(setter))
const guardOn = setter.indexOf("set_config('raptor.trust_opening', 'on', true)")
ok('...and it opens the guard only around its own update',
  guardOn >= 0 && guardOn < setter.indexOf('update public.firm_settings')
  && setter.indexOf("set_config('raptor.trust_opening', '', true)") > setter.indexOf('update public.firm_settings'))
ok('the setter is revoked from public and anon',
  sql.includes('revoke all on function public.set_trust_opening_balance(numeric, date, text) from public, anon;'))

const guard = liveFn('protect_trust_opening')
ok('any other change is put back, not raised',
  /new\.trust_opening_balance := old\.trust_opening_balance;/.test(guard)
  && /new\.trust_opening_date := old\.trust_opening_date;/.test(guard)
  && !/raise/.test(guard))
ok('...unless the setter opened the guard', /current_setting\('raptor\.trust_opening', true\)/.test(guard))
ok('...and the trigger is on firm_settings, before update',
  /create or replace trigger protect_trust_opening\s+before update on public\.firm_settings/.test(code))

/* ---------- 3. the three figures ---------- */
/* The e2e fixture: 6 910.10 in the bank, ledger 7 873.60 of which 485.00 unplaced, 963.50 short. */
check('the fixture: in, accounted, not, and what "not" is made of',
  trustHeadline({ trustCash: 6910.10, owners: 7388.60, unidentified: 485, difference: -963.50 }),
  { inTrust: 6910.1, accounted: 7388.6, notAccounted: -478.5, unplaced: 485, awaiting: 0, gap: -963.5, otherGap: -963.5, residual: 0 })
/* Staging on 10 Oct, before and after the opening balance: owners 33 018.38, 950 unplaced. */
check('staging without an opening: the gap is the money before the first statement',
  trustHeadline({ trustCash: 18947.34, owners: 33018.38, unidentified: 950, difference: -15021.04 }),
  { inTrust: 18947.34, accounted: 33018.38, notAccounted: -14071.04, unplaced: 950, awaiting: 0, gap: -15021.04, otherGap: -15021.04, residual: 0 })
check('...with R15 021.04 at 7 Oct captured: only the unplaced receipts are left',
  trustHeadline({ trustCash: 33968.38, owners: 33018.38, unidentified: 950, difference: 0 }),
  { inTrust: 33968.38, accounted: 33018.38, notAccounted: 950, unplaced: 950, awaiting: 0, gap: 0, otherGap: 0, residual: 0 })
/* THE SCREEN CAN STILL SAY "THIS DOES NOT ADD UP": owners that disagree with trust_position show
   as a residual, not folded into either named part. */
/* A receipt waiting for approval is in the bank and on no ledger line: named, out of the gap. */
check('waiting for approval comes out of the bank/ledger gap, by name',
  trustHeadline({ trustCash: 1800, owners: 1000, unidentified: 0, difference: 800, awaiting: 800 }),
  { inTrust: 1800, accounted: 1000, notAccounted: 800, unplaced: 0, awaiting: 800, gap: 800, otherGap: 0, residual: 0 })
check('owners that disagree with the position leave a residual',
  trustHeadline({ trustCash: 1000, owners: 900, unidentified: 50, difference: 0 }).residual, 50)
check('cents are rounded, not floated', trustHeadline({ trustCash: 0.3, owners: 0.1, unidentified: 0.2, difference: 0 }).residual, 0)

/* ---------- 4. the screens ---------- */
const page = strip(read('src/pages/trust/TrustOverview.tsx'))
let at = -1
for (const label of ['label="In the trust account"', 'label="Accounted for"', 'label="Not accounted for"']) {
  const found = page.indexOf(label)
  ok(`the band carries ${label}`, found >= 0)
  ok('...in that order', found > at)
  at = found
}
ok('the old two-balances band is gone', !/label="Bank balance"/.test(page) && !/label="Bank \/ ledger difference"/.test(page))
ok('unplaced receipts are NOT in accounted for', !/const accounted = [^\n]*\n?[^\n]*position\.unidentified/.test(page))
ok('the band says when no opening balance is captured', /no opening balance captured/.test(page))
ok('the overview reads where the bank figure starts', /fetchTrustOpening\(\)/.test(page))

/* The firm, 10 Oct: the reconciliation was "a weird pink thing". A white card; the state is a rule and a pill. */
const recon = page.slice(page.indexOf('Ownership reconciliation</div>') - 700, page.indexOf('Ownership reconciliation</div>'))
ok('the reconciliation is a card with a coloured rule, not a tinted panel',
  /<Card className=\{clsx\('lg:col-span-5[^']*border-t-4'/.test(recon) && !/'bg-negative-50' : 'bg-positive-50'/.test(page))

const settings = strip(read('src/pages/finance/FinanceSettings.tsx'))
ok('Trust settings captures it through the one function', /await setTrustOpening\(amount, asAt, reason\)/.test(settings))
ok('...asking for a reason of a sentence and no future day',
  /asAt <= today && reason\.trim\(\)\.length >= 10/.test(settings))
const lib = strip(read('src/lib/trust.ts'))
ok('the browser calls set_trust_opening_balance with all three',
  /rpc\('set_trust_opening_balance', \{ p_amount: amount, p_as_at: asAt, p_reason: reason \}\)/.test(lib))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-trust-opening: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
