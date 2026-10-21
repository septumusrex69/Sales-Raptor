/**
 * HELD FOR SWORDFISH PAYOVERS (S10; HANDOFF 3a item 2, the design agreed under S8).
 *
 * The money in trust at the cut-over that Swordfish still pays out on 11 Dec and 11 Jan is ONE bucket:
 * set once out of the opening balance, its own line on the Trust overview, its debits taken off it from
 * To sort. WHAT THIS HOLDS:
 *
 *   1. THE ARITHMETIC: what is left is counted as owned -- by accountedFromCash (the overview and Not
 *      accounted for) and by trust_position's owed_out -- so the bucket is never read as money nobody
 *      owns, nor a Swordfish payout as a shortfall. The overview's lines still add up to the figure.
 *   2. THE REFUSALS, in the database (last definitions, comments stripped): set by an Administrator with
 *      the trust tick, with a reason, only after the opening, never above it and never below what has
 *      been paid out; a line off it is a debit, after the opening, on the trust account, not already
 *      allocated, and no more than is left -- and the screen asks the same first (mayTakeOff).
 *   3. NO LEDGER ENTRY: the money leaves the bucket, not anybody's ledger; allocation_kind is 'other'.
 *   4. ONCE SAID, STAYS SAID: swordfish_kind is written by allocate_swordfish_line alone.
 *   5. CLEAR STAGING EMPTIES IT with the opening; the finance revoke loop carries its functions.
 *   6. THE SCREENS CALL IT: overview, Not accounted for, Trust settings, To sort, Payments out to allocate.
 *
 * Proved on staging in a rolled-back transaction (S10): opening R100 000, holding R5 000 -> creditors
 * +5 000; a R3 000 Swordfish payover dated after the opening -> left R2 000, the difference back by
 * R3 000, no ledger entry, the statement reads "Swordfish payover - run 11 Dec"; refused: no opening,
 * over the opening, a short reason, twice, on the opening day, a credit, R2 500 against R2 000 left,
 * another bank account, a bad kind, setting below what was paid out; a direct write to swordfish_kind
 * was reverted; anon got no row; Clear staging left no holding.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-swordfish-holding.mjs
 */
import { readFileSync } from 'node:fs'
import {
  SWORDFISH_KIND_LABEL, holdingSentence, mayTakeOff, swordfishLeft, toSwordfishHolding,
} from '../../src/lib/swordfishHolding.ts'
import { accountedFromCash } from '../../src/lib/trustUnaccounted.ts'
import { currentHoldings } from '../../src/lib/trustOverview.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/* ---------------- 1. the arithmetic ---------------- */

const h = toSwordfishHolding({
  amount: '5000.00', reason: 'bank opening less Raptor receipts', as_at: '2026-12-10', set_at: '2026-12-11T08:00:00Z',
  set_by_name: 'Barry Joubert', paid_out: '3000.00', payovers: '3000.00', drawings: '0', lines: 1, left_over: '2000.00',
})
check('the row is read', [h.amount, h.asAt, h.paidOut, h.left, h.lines, h.setBy], [5000, '2026-12-10', 3000, 2000, 1, 'Barry Joubert'])
check('nothing held is nought left', [swordfishLeft(null), swordfishLeft(undefined), swordfishLeft(h)], [0, 0, 2000])
check('the labels are the firm’s', [SWORDFISH_KIND_LABEL.payover, SWORDFISH_KIND_LABEL.drawing], ['Swordfish payover', 'Swordfish-era drawing'])
check('the overview sentence', holdingSentence(h, (iso) => `day ${iso}`), 'R 5 000.00 set on day 2026-12-10, R 3 000.00 paid out, R 2 000.00 left')

const debit = (txnDate, amount) => ({ direction: 'debit', txnDate, amount })
ok('a debit after the opening within what is left may come off', mayTakeOff(debit('2026-12-11', -1500), h))
ok('...exactly what is left, too', mayTakeOff(debit('2027-01-11', -2000), h))
ok('...but not a cent more', !mayTakeOff(debit('2027-01-11', -2000.01), h))
ok('...nor a line dated ON the opening (inside the opening balance already)', !mayTakeOff(debit('2026-12-10', -10), h))
ok('...nor one before it', !mayTakeOff(debit('2026-12-01', -10), h))
ok('...nor money in', !mayTakeOff({ direction: 'credit', txnDate: '2026-12-11', amount: 10 }, h))
ok('...nor anything when nothing is held', !mayTakeOff(debit('2026-12-11', -10), null))
ok('...nor a zero line', !mayTakeOff(debit('2026-12-11', 0), h))

const cash = [
  { periodStart: '2026-11-11', periodEnd: '2026-12-10', paysOn: '2027-01-11', isOpen: false, forClients: 1000, forFirm: 250, firmSetOff: 0, firmOther: -20, forDebtors: 30, unplaced: 0, total: 1260 },
  { periodStart: '2026-12-11', periodEnd: '2027-01-10', paysOn: '2027-02-11', isOpen: true, forClients: 400, forFirm: 100, firmSetOff: 0, firmOther: 0, forDebtors: 0, unplaced: 0, total: 500 },
]
check('accounted for, without a holding, is unchanged', accountedFromCash(cash), 1760)
check('accounted for adds what is left of the holding', accountedFromCash(cash, swordfishLeft(h)), 3760)
check('...and nothing when nothing is held', accountedFromCash(cash, swordfishLeft(null)), 1760)

const lines = currentHoldings({ cash, firm: null, kept: 10, label: (c) => c.periodStart, payDay: (d) => d, swordfish: h })
check('the overview draws the bucket first, as what is left', [lines[0]?.key, lines[0]?.who, lines[0]?.amount], ['swordfish', 'Held for Swordfish payovers', 2000])
check('...and its lines add up to accounted for', Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100, accountedFromCash(cash, swordfishLeft(h)))
check('no line where nothing is held', currentHoldings({ cash, firm: null, kept: 0, label: () => '', payDay: (d) => d, swordfish: null }).some((l) => l.key === 'swordfish'), false)
check('no line once nothing is left', currentHoldings({ cash, firm: null, kept: 0, label: () => '', payDay: (d) => d, swordfish: { ...h, left: 0 } }).some((l) => l.key === 'swordfish'), false)

/* ---------------- 2-5. the database, last definitions ---------------- */

const sql = read('supabase/schema.sql')
const lower = sql.toLowerCase()
function liveFn(name) {
  const at = Math.max(lower.lastIndexOf(`create or replace function public.${name}(`), lower.lastIndexOf(`create function public.${name}(`))
  if (at < 0) return ''
  const m = /\bas\s+\$(\w*)\$([\s\S]*?)\$\1\$/i.exec(sql.slice(at))
  return stripSql(m?.[2] ?? '')
}

const tbl = /create table if not exists public\.swordfish_holding \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? ''
ok('the holding is a one-row table', /id boolean primary key default true check \(id\)/.test(tbl))
ok('...amount, reason, set by, set at', /amount numeric/.test(tbl) && /reason text not null/.test(tbl) && /set_by uuid/.test(tbl) && /set_at timestamptz/.test(tbl))
ok('...with row-level security on', /alter table public\.swordfish_holding enable row level security/.test(sql))
ok('...read by the trust tick', /create policy swordfish_holding_read on public\.swordfish_holding\s+for select to authenticated using \(public\.has_capability\('finance\.view'\)\)/.test(sql))
ok('...and NO policy that writes it (set_swordfish_holding is the only writer)',
  !/create policy \w+ on public\.swordfish_holding\s+for (insert|update|all)/.test(stripSql(sql)))
ok('a statement line can say which Swordfish debit it was',
  /add column if not exists swordfish_kind text\s+check \(swordfish_kind is null or swordfish_kind in \('payover', 'drawing'\)\)/.test(sql))

const set = liveFn('set_swordfish_holding')
ok('set: defined', set.length > 0)
ok('set: Administrator with the trust tick, a null role cannot slip through',
  /not public\.has_capability\('finance\.view'\) or public\.current_user_role\(\) is distinct from 'Administrator'/.test(set))
ok('set: a reason of a sentence is required', /v_reason is null or length\(v_reason\) < 10/.test(set))
ok('set: refused before the opening is captured', /if v_open is null then\s+raise exception/.test(set))
ok('set: never more than the opening', /if round\(p_amount, 2\) > coalesce\(v_open_amount, 0\) then\s+raise exception/.test(set))
ok('set: never below what has already been paid out', /if round\(p_amount, 2\) < coalesce\(v_paid, 0\) then\s+raise exception/.test(set))
ok('set: logged with the reason, dated by the opening',
  /insert into public\.finance_setting_changes[\s\S]*'swordfish_holding'[\s\S]*' at the end of ' \|\| v_open[\s\S]*v_reason/.test(set))

const fig = liveFn('swordfish_holding_figures')
ok('figures: only lines AFTER the opening come off it', /l\.txn_date > f\.trust_opening_date/.test(fig))
ok('figures: on the trust account', /l\.bank_account = f\.trust_account_number/.test(fig))
ok('figures: only lines said to be Swordfish, closed as other', /l\.swordfish_kind is not null and l\.allocation_kind = 'other'/.test(fig))
ok('figures: left is the amount less what was paid out', /round\(h\.amount - g\.paid, 2\)/.test(fig))
ok('position: no row without the trust tick', /where public\.has_capability\('finance\.view'\)/.test(liveFn('swordfish_holding_position')))

const alloc = liveFn('allocate_swordfish_line')
ok('allocate: defined', alloc.length > 0)
ok('allocate: the trust tick', /if not public\.has_capability\('finance\.view'\) then\s+raise exception/.test(alloc))
ok('allocate: payover or drawing only', /p_kind not in \('payover', 'drawing'\)/.test(alloc))
ok('allocate: the holding is locked first (two people, one bucket)', /from public\.swordfish_holding s where s\.id for update/.test(alloc)
  && alloc.indexOf('swordfish_holding s where s.id for update') < alloc.indexOf('from public.bank_statement_lines where id = p_line'))
ok('allocate: refuses money in', /if v_l\.direction is distinct from 'debit' then\s+raise exception/.test(alloc))
ok('allocate: refuses a line already allocated', /if v_l\.allocation_kind is not null or v_l\.status in \('allocated', 'reconciled'\) then\s+raise exception/.test(alloc))
ok('allocate: refuses another bank account', /if v_l\.bank_account is distinct from v_account then\s+raise exception/.test(alloc))
ok('allocate: refuses a line on or before the opening', /if v_open is null or v_l\.txn_date <= v_open then\s+raise exception/.test(alloc))
ok('allocate: refuses more than is left', /if round\(v_amt, 2\) > round\(coalesce\(v_left, 0\), 2\) then\s+raise exception/.test(alloc))
ok('allocate: closes the line as other, saying which', /allocation_kind = 'other', swordfish_kind = p_kind/.test(alloc))
ok('allocate: writes NO ledger entry -- the money leaves the bucket, not anybody’s ledger',
  alloc.length > 0 && !/trust_creditor_entries/.test(alloc) && !/trust_entry_id\s*=/.test(alloc))

const tp = liveFn('trust_position')
ok('trust_position reads what is left', /swordfish as \(\s+select coalesce\(\(select x\.left_over from public\.swordfish_holding_figures\(\) x\), 0\) as bal/.test(tp))
check('...and adds it to owed_out in creditors, net owed and the difference', (tp.match(/h\.owed_out \+ u\.bal \+ s\.bal/g) ?? []).length, 3)
ok('...with no owed_out left without it', !/h\.owed_out \+ u\.bal(?! \+ s\.bal)/.test(tp))
ok('...joined in', /from cash c, held h, unplaced u, swordfish s/.test(tp))

const protect = liveFn('protect_bank_statement_line')
ok('swordfish_kind is written by allocate_swordfish_line alone',
  /if new\.swordfish_kind is distinct from old\.swordfish_kind\s+and coalesce\(current_setting\('raptor\.swordfish_line', true\), ''\) <> 'on' then\s+new\.swordfish_kind := old\.swordfish_kind;/.test(protect))
ok('...which opens the gate only around its own update',
  /set_config\('raptor\.swordfish_line', 'on', true\);\s+update public\.bank_statement_lines[\s\S]*?set_config\('raptor\.swordfish_line', '', true\)/.test(alloc))

const clear = liveFn('clear_staging')
const tr = /'trunc'\s*\|\|\s*'ate table ([\s\S]*?)';/.exec(clear)
const truncated = tr ? tr[1].replace(/'\s*\|\|\s*'/g, '').split(',').map((t) => t.trim().replace(/^public\./, '')) : []
ok('Clear staging empties the holding with the opening', truncated.length > 20 && truncated.includes('swordfish_holding'))
ok('...and still resets the opening', /trust_opening_balance = null, trust_opening_date = null/.test(clear))

const revokeAt = sql.lastIndexOf('revoke execute on function public.%s from public, anon')
const loop = revokeAt > 0 ? sql.slice(sql.lastIndexOf('foreach fn in array array[', revokeAt), revokeAt) : ''
for (const fn of ['swordfish_holding_figures()', 'swordfish_holding_position()', 'set_swordfish_holding(numeric, text)', 'allocate_swordfish_line(uuid, text, text)']) {
  ok(`${fn} is in the last finance revoke loop`, loop.includes(`'${fn}'`))
}
ok('the figures are not callable from the browser at all',
  /revoke all on function public\.swordfish_holding_figures\(\) from public, anon, authenticated;/.test(sql))

/* ---------------- 6. the screens call it ---------------- */

const overview = stripTs(read('src/pages/trust/TrustOverview.tsx'))
const unacc = stripTs(read('src/pages/trust/TrustUnaccounted.tsx'))
ok('the overview reads the holding', /fetchSwordfishHolding\(\)/.test(overview))
ok('...counts what is left as accounted for', /accountedFromCash\(cash, swordfishLeft\(swordfish\)\)/.test(overview))
ok('...and draws its line', /currentHoldings\(\{[\s\S]*?swordfish,/.test(overview))
ok('Not accounted for adds it the same way', /fetchSwordfishHolding\(\)/.test(unacc) && /accountedFromCash\(cash, swordfishLeft\(swordfish\)\)/.test(unacc))
ok('Trust settings sets it', /setSwordfishHolding\(amount, reason\)/.test(stripTs(read('src/pages/finance/FinanceSettings.tsx'))))
const toSort = stripTs(read('src/components/finance/BankLinesToAllocate.tsx'))
ok('To sort offers the two only where the holding can take the line', /const offerSwordfish = mayTakeOff\(line, swordfish\)/.test(toSort)
  && /offerSwordfish && <option value="sf_payover">/.test(toSort) && /offerSwordfish && <option value="sf_drawing">/.test(toSort))
ok('...and takes it off through allocate_swordfish_line', /allocateSwordfishLine\(line\.id, sfKind/.test(toSort))
const payIn = stripTs(read('src/pages/finance/UnallocatedReceipts.tsx'))
ok('Payments out to allocate offers the two the same way', /mayTakeOff\(\{ direction: 'debit', txnDate: p\.txnDate, amount: p\.amount \}, swordfish\)/.test(payIn)
  && /allocateSwordfishLine\(lineId, kind, null\)/.test(payIn))
const api = stripTs(read('src/lib/bankAllocationApi.ts')) + stripTs(read('src/lib/trust.ts'))
ok('the calls name the functions', /rpc\('allocate_swordfish_line'/.test(api) && /rpc\('set_swordfish_holding'/.test(api) && /rpc\('swordfish_holding_position'/.test(api))

if (failures.length) {
  console.error(`check-swordfish-holding: ${failures.length} failed, ${pass} passed\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-swordfish-holding: ${pass} passed, 0 failed`)
