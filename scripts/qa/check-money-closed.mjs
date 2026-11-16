#!/usr/bin/env node
/**
 * A CLOSED ACCOUNT HAS NOTHING LEFT TO TAKE (R-35 · Raptor H19).
 *
 * Rinda (Finance), 16 Nov, on BNP0013: closed paid up and refunded, then R50 more came in. "The full R50
 * should be available to refund, however on the what is left to take there shows R14.95 which in this case
 * will be incorrect." allocate_payment and preview_allocation already hold everything received after a close
 * as the debtor's credit (prompt 11); account_money_position still counted a correspondence fee raised after
 * the close as "left".
 *
 * Held here, from the LAST definitions in schema.sql (it is append-only):
 *   - the view makes the very same closed test preview_allocation makes (ended on/before the day, or an
 *     imported write-off), with today in place of the payment's day;
 *   - on a closed account every Left, the commission potential and BF left to take are nil, and each
 *     bucket's Left moves to its Cannot take -- so the row still adds up;
 *   - account_closed is appended LAST (create or replace view refuses anything else) and read by the app;
 *   - the panel says why, in words, when the account is closed.
 *
 * Run: node scripts/qa/check-money-closed.mjs
 */
import fs from 'node:fs'

const sql = fs.readFileSync('supabase/schema.sql', 'utf8')
const panel = fs.readFileSync('src/pages/accounts/MoneyPanel.tsx', 'utf8')
const lib = fs.readFileSync('src/lib/payover.ts', 'utf8')
let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const squash = (s) => s.replace(/\s+/g, ' ').trim()

const at = sql.lastIndexOf('create or replace view public.account_money_position as')
const view = at < 0 ? '' : sql.slice(at, sql.indexOf(';', sql.indexOf('left join allocated al', at)) + 1)
ok('the view is in schema.sql', view.length > 1000)

const pAt = sql.lastIndexOf('create or replace function public.preview_allocation(')
const prev = squash(sql.slice(pAt, sql.indexOf('$$;', pAt)))
const engineTest = /\(\(d\.ended_as is not null and v_day >= d\.ended_on\) or \(d\.ended_as is null and \(coalesce\(d\.write_off_reason, ''\) <> '' or d\.status ~\* '\^\(written\.off\|closed\)'\)\)\)/
ok('preview_allocation still makes the closed test this view copies', engineTest.test(prev))

const v = squash(view)
ok('the view makes the same closed test, with today for the payment\'s day',
  /\(\(d\.ended_as is not null and public\.raptor_today\(\) >= d\.ended_on\) or \(d\.ended_as is null and \(coalesce\(d\.write_off_reason, ''\) <> '' or d\.status ~\* '\^\(written\.off\|closed\)'\)\)\) as closed/.test(v))
ok('...joined onto every account', /left join shut sh on sh\.account_id = d\.id;$/.test(v))

for (const [left, cant] of [['interest_left', 'interest_cant_take'], ['costs_left', 'costs_cant_take'], ['receipt_fees_left', 'receipt_fees_cant_take']]) {
  /* Tempered: the captured greatest(...) may not run into another case, or it would span two columns. */
  const one = '(greatest\\((?:(?!case when)[^])*?\\))'
  const l = new RegExp(`case when sh\\.closed then 0 else ${one} end as ${left},`).exec(v)
  ok(`${left} is nil on a closed account`, Boolean(l))
  const c = new RegExp(`\\+ case when sh\\.closed then ${one} else 0 end as ${cant},`).exec(v)
  ok(`...and ${cant} takes exactly what was left, so the row adds up`, Boolean(l && c && l[1] === c[1]))
}
ok('commission potential is nil on a closed account', /case when sh\.closed then 0 else round\([^]*?\) end as commission_potential,/.test(v))
ok('BF left to take is nil on a closed account', /case when sh\.closed then 0 else greatest\([^]*?end as bf_left_to_take,/.test(v))
ok('account_closed is the LAST column (a replaced view may only add at the end)',
  /coalesce\(sh\.closed, false\) as account_closed from public\.debtor_accounts d/.test(v))

ok('the app reads account_closed', /accountClosed: Boolean\(r\.account_closed\)/.test(lib))
ok('the panel says why when the account is closed', /pos\.accountClosed && \(/.test(panel) && /This account is closed/.test(panel))

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-money-closed: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
