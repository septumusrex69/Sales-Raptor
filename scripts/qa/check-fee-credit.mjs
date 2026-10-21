/**
 * CREDIT NOTES ON FEES, NEVER A DELETED FEE (S10, prompt 13 item 8).
 *
 * A credit note is a negative account_fees row naming the fee it credits. Held here: the statement
 * draws it as a credit and still adds up to its foot; the balance drops by it; the two per-fee
 * readers net it into its fee; credit_fee's rules (Administrator, reason, never more than is still
 * owing, never a receipt fee); and the screen. Probed on staging (S10): R100 fee, R30 credited --
 * account_fees_net, account_money_position and fee_split all read R70; R80 more refused at R70; a
 * blank reason refused; the row split -26.09 / -3.91 in the fee's own proportion.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-fee-credit.mjs
 */
import { readFileSync } from 'node:fs'
import { buildStatement, computeBalance } from '../../src/lib/accountBalance.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/* ---------- the arithmetic ---------- */
const ledgers = {
  payments: [], interest: [],
  fees: [
    { date: '2026-02-01', description: 'Email', exclVat: 86.96, vat: 13.04, billed: true, annexureItem: '1a' },
    { date: '2026-02-03', description: 'Credit note: Email', exclVat: -26.09, vat: -3.91, billed: true, annexureItem: '1a' },
  ],
}
const before = computeBalance({ capitalHandedOver: 1000, handoverDate: '2026-01-01', ledgers: { ...ledgers, fees: [ledgers.fees[0]] } })
const after = computeBalance({ capitalHandedOver: 1000, handoverDate: '2026-01-01', ledgers })
check('the balance drops by the credit', Math.round((before.balance - after.balance) * 100) / 100, 30)
const s = buildStatement({ capitalHandedOver: 1000, handoverDate: '2026-01-01', ledgers })
const credit = s.lines.find((l) => l.kind === 'fee-credit')
check('the credit note is its own line on the statement', credit?.description ?? null, 'Credit note: Email')
check('...as a credit, not a negative charge', [credit?.debit, credit?.credit], [0, 30])
check('the fee it credits is still there, as charged', s.lines.find((l) => l.description === 'Email')?.debit ?? null, 100)
check('...and the lines still add up to the foot',
  Math.round(s.lines.reduce((t, l) => t + l.debit - l.credit, 0) * 100) / 100, Math.round(s.breakdown.balance * 100) / 100)

/* ---------- the database ---------- */
const sql = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas\s+\$(\w*)\$([\s\S]*?)\$\1\$/i.exec(sql.slice(at))
  return (m?.[2] ?? '').replace(/--[^\n]*/g, '')
}
const fn = lastFn('credit_fee')
ok('Administrator only, by role', /if public\.current_user_role\(\) is distinct from 'Administrator' then/.test(fn))
ok('a reason is required', /if v_reason is null then\s+raise exception 'Say why the fee is being credited\.'/.test(fn))
ok('never more than is still owing on the fee', /if round\(p_amount, 2\) > round\(v_unpaid, 2\) then/.test(fn)
  && /v_unpaid := v_net - least\(greatest\(v_taken - v_settled_before, 0\), v_net\)/.test(fn))
ok('...after earlier credits', /select n\.amount_excl_vat \+ n\.vat_amount into v_net from public\.account_fees_net n where n\.id = p_fee/.test(fn))
ok('a receipt fee is refused', /v_fee\.payment_id is not null and v_fee\.annexure_item = '9'/.test(fn))
ok('a credit note is not itself credited', /if v_fee\.credits_fee_id is not null then/.test(fn))
ok('the row is inserted, never the fee updated', /insert into public\.account_fees \(/.test(fn) && !/update public\.account_fees/.test(fn))
ok('...negative, naming its fee, with who and why', /'Credit note: ' \|\| v_fee\.description, -v_excl/.test(fn) && /p_fee, v_reason, \(select name from public\.profiles where id = auth\.uid\(\)\)/.test(fn))
ok('...under its own action code, so no charge count reads it', /'credit_note', 'credit_note', true/.test(fn))
ok('a trigger keeps a hand-written credit to Administrators',
  /create or replace trigger account_fees_credit_notes_are_administrators\s+before insert on public\.account_fees/.test(sql))
const netAt = sql.lastIndexOf('create or replace view public.account_fees_net')
const net = netAt < 0 ? '' : sql.slice(netAt, sql.indexOf(';', netAt))
ok('the net view folds credits into their fee and leaves them out', /where x\.credits_fee_id = f\.id/.test(net) && /where f\.credits_fee_id is null/.test(net))
ok('fee_split walks the net fees', /from public\.account_fees_net f/.test(lastFn('fee_split')))
const posAt = sql.lastIndexOf('create or replace view public.account_money_position as')
ok('account_money_position walks the net fees', /from public\.account_fees_net f/.test(sql.slice(posAt, sql.indexOf('left join allocated al', posAt))))

/* ---------- the screen ---------- */
const panel = read('src/components/accounts/FeeCreditPanel.tsx')
ok('the panel raises them through credit_fee', /supabase\.rpc\('credit_fee', \{ p_fee: feeId, p_amount: Number\(amount\), p_reason: reason\.trim\(\) \}\)/.test(panel))
ok('...asks for a reason', /if \(!reason\.trim\(\)\) \{ setError/.test(panel))
ok('...offers fees only, not receipt fees, not credit notes',
  /!f\.creditsFeeId && !f\.cancelledAt && f\.billed && !\(f\.annexureItem === '9' && f\.paymentId\)/.test(panel))
const page = read('src/pages/accounts/AccountDetail.tsx')
ok('on Transactions, for an Administrator', /\{currentUser\?\.role === 'Administrator' && \(\s+<FeeCreditPanel fees=\{ledgers\?\.fees \?\? \[\]\} onDone=\{reload\} \/>/.test(page))
ok('a credited trace is not counted as a trace', /f\.annexureItem === '4c' && f\.billed && !f\.creditsFeeId/.test(page))

if (failures.length) {
  console.error(`check-fee-credit: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-fee-credit: ${pass} passed, 0 failed`)
