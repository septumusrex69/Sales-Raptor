/**
 * THE SET-OFF GAP, CLOSED (the firm, 22 Oct: "you can proceed with one").
 *
 * A charge set off against a payover -- a withdrawal fee, a balance brought forward -- used to be
 * credited to the firm WHOLE the moment the run was approved, even when the run was below nil and
 * the client had no trust money to pay it with. R1 000 owed and nothing collected left the firm
 * R1 000 drawable that was not in the bank; the client then paying it into the BUSINESS account
 * left the trust ledger R1 000 above the bank. Proved on staging, rolled back, before and after.
 *
 * Held here:
 *   1. trust_creditors_on_run writes the CLIENT side whole (the "Client owes us" carry) and the
 *      FIRM side only as far as trust money covered it -- cumulatively per client, the PTC share's
 *      own rule, so nothing is credited twice and nothing is lost;
 *   2. a brought-forward CREDIT is still credited in full, at once (client +credit, firm -credit);
 *   3. trust_position counts the uncovered set-off as the firm's, waiting (derived, not drawable),
 *      and trust_cash_by_cycle reads a run's set-off from the client's entry, so both still
 *      reconcile to the bank;
 *   4. the arithmetic, replayed in a pure mirror of the trigger against the staging probes of
 *      22 Oct, to the cent.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-set-off-covered.mjs
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
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const sql = read('supabase/schema.sql')
/* THE LAST DEFINITION (schema.sql is append-only), anchored on the full phrase -- a bare name
   lands on a grant or a comment. */
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return strip(m?.[2] ?? '')
}

/* ---------------- 1. the trigger ---------------- */

const trig = lastFn('trust_creditors_on_run')
ok('the trigger is found', trig.length > 0)
/* PRESENCE BEFORE ORDER: indexOf is -1 for a deleted line, and -1 < anything. */
const approvalAt = trig.indexOf('if public.payover_run_is_open(old.status) and not public.payover_run_is_open(new.status)')
const clientAt = trig.indexOf("values ('client', new.company_id, -new.charges_set_off,")
const ptcAt = trig.indexOf('v_ptc_short := least(v_short, greatest(v_ptc_debt, 0));')
const soAt = trig.indexOf('v_so_short := least(v_short - v_ptc_short, v_so_owed);')
const paidAt = trig.indexOf('if old.paid_at is null and new.paid_at is not null')
ok('the client side of a set-off is still written whole, on approval', clientAt > approvalAt && approvalAt >= 0)
ok('...under its old wording, which every ledger reader matches', /'Charges set off against payover ' \|\| new\.invoice_number/.test(trig))
ok('the set-off is read after the PTC share, whose part of the shortfall it needs', ptcAt >= 0 && soAt > ptcAt)
ok('...and before the payout, inside the approval', soAt >= 0 && paidAt > soAt)

/* THE OLD PAIR IS GONE: the firm was credited new.charges_set_off whatever the run collected. */
check('the firm is no longer credited the whole charge regardless',
  /\('firm', new\.company_id, new\.charges_set_off,/.test(trig), false)

ok('the set-off owed is every approved run\'s client entry, debts and credits apart',
  /coalesce\(sum\(-e\.amount\) filter \(where e\.amount < 0\), 0\),\s+coalesce\(sum\(-e\.amount\) filter \(where e\.amount > 0\), 0\)\s+into v_so_owed, v_so_credit/.test(trig)
  && /e\.party = 'client'\s+and e\.reason like 'Charges set off against payover %';/.test(trig))
ok('...less what the firm was already credited for it',
  /select coalesce\(sum\(e\.amount\), 0\) into v_so_credited[\s\S]*?e\.party = 'firm'\s+and e\.reason like 'Charges recovered from payover %';/.test(trig))
ok('the shortfall is PTC debt first, then set-off, never more than is owed',
  /v_so_short := least\(v_short - v_ptc_short, v_so_owed\);/.test(trig))
ok('business payments the PTC share did not take are read against the set-off, and never credited in trust',
  /v_biz_so := least\(greatest\(v_paid_biz - v_biz_ptc, 0\), v_so_resolved\);/.test(trig))
ok('one firm entry for the difference: resolved, less business, plus credits, less already credited',
  /v_so_now := round\(v_so_resolved - v_biz_so \+ v_so_credit - v_so_credited, 2\);/.test(trig)
  && /if v_so_now <> 0 then/.test(trig))
ok('...named so firm_entry_kind still calls it a charge recovered',
  /values \('firm', new\.company_id, v_so_now,\s+'Charges recovered from payover ' \|\| new\.invoice_number/.test(trig))
ok('...and named exactly as before when it is the run\'s own charge, in full',
  /case when v_so_now = round\(coalesce\(new\.charges_set_off, 0\), 2\) then ''/.test(trig))
ok('the classifier still reads that prefix as charge_recovered',
  /p_reason like 'Charges recovered from payover %' then 'charge_recovered'/.test(lastFn('firm_entry_kind')))
ok('the trigger keeps its security mode (it writes the ledger nobody else may)',
  /create or replace function public\.trust_creditors_on_run\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+set search_path to 'public'/
    .test(sql.slice(sql.lastIndexOf('create or replace function public.trust_creditors_on_run('))))

/* ---------------- 2. the readers that must still reconcile ---------------- */

const pos = lastFn('trust_position')
ok('against the bank: the set-off not yet covered is the firm\'s, waiting',
  /when party = 'client' and reason like 'Charges set off against payover %' then -amount/.test(pos)
  && /when party = 'firm' and reason like 'Charges recovered from payover %' then -amount/.test(pos))
ok('...summed with the PTC share BEFORE the floor (a business payment may have paid either)',
  /select coalesce\(sum\(greatest\(owed, 0\)\), 0\) as bal from \(\s+select company_id,\s+sum\(case/.test(pos))

const cash = lastFn('trust_cash_by_cycle')
ok('the cash view no longer reads the firm\'s set-off credit, which may land on a later run',
  /coalesce\(reason, ''\) not like 'Charges recovered from payover %'/.test(cash))
ok('...but the client\'s set-off entry, negated, in that run\'s own cycle',
  /\+ coalesce\(-sum\(amount\) filter \(where party = 'client'\s+and coalesce\(reason, ''\) like 'Charges set off against payover %'\), 0\) as firm_other/.test(cash))

const split = lastFn('firm_trust_split')
check('what may be drawn reads real firm entries only, never the derived waiting figure',
  /Charges set off|ptc_pending/.test(split), false)

/* ---------------- 3. the arithmetic, a pure mirror of the trigger ---------------- */

/*
 * One client's ledger as entries {party, amount, reason}. approve() is the trigger's approval
 * branch, line for line; the PTC debt is passed in (it needs allocations the mirror does not keep).
 */
const r2 = (n) => Math.round(n * 100) / 100
const sum = (es, f) => r2(es.filter(f).reduce((t, e) => t + e.amount, 0))
const approve = (L, run, ptcDebt = 0) => {
  if (run.cso) L.push({ party: 'client', amount: -run.cso, reason: `Charges set off against payover ${run.inv}` })
  const short = Math.max(-run.net, 0)
  const paidBiz = sum(L, (e) => e.party === 'client' && e.reason.startsWith('Paid to the business account'))
  const ptcCredited = sum(L, (e) => e.party === 'firm' && e.reason.startsWith('PTC share recovered'))
  const ptcShort = Math.min(short, Math.max(ptcDebt, 0))
  const ptcResolved = Math.max(ptcDebt - short, 0)
  const bizPtc = Math.min(Math.max(paidBiz, 0), ptcResolved)
  const now = r2(ptcResolved - bizPtc - ptcCredited)
  if (now !== 0) L.push({ party: 'firm', amount: now, reason: `PTC share recovered from payover ${run.inv}` })
  const setOff = L.filter((e) => e.party === 'client' && e.reason.startsWith('Charges set off against payover '))
  const soOwed = r2(setOff.filter((e) => e.amount < 0).reduce((t, e) => t - e.amount, 0))
  const soCredit = r2(setOff.filter((e) => e.amount > 0).reduce((t, e) => t - e.amount, 0))
  const soCredited = sum(L, (e) => e.party === 'firm' && e.reason.startsWith('Charges recovered from payover '))
  const soShort = Math.min(short - ptcShort, soOwed)
  const soResolved = soOwed - soShort
  const bizSo = Math.min(Math.max(paidBiz - bizPtc, 0), soResolved)
  const soNow = r2(soResolved - bizSo + soCredit - soCredited)
  if (soNow !== 0) L.push({ party: 'firm', amount: soNow, reason: `Charges recovered from payover ${run.inv}` })
}
const firm = (L) => sum(L, (e) => e.party === 'firm')
const client = (L) => sum(L, (e) => e.party === 'client')
/* trust_position's derived waiting figure, set-off half (no PTC in these scenarios). */
const waiting = (L) => Math.max(0, r2(L.reduce((t, e) => t + (
  (e.party === 'client' && e.reason.startsWith('Charges set off against payover ')) ? -e.amount
    : (e.party === 'firm' && e.reason.startsWith('Charges recovered from payover ')) ? -e.amount
      : (e.party === 'client' && e.reason.startsWith('Paid to the business account')) ? -e.amount : 0), 0)))
/* The ledger "against the bank": every entry, plus the firm's derived waiting share. */
const againstBank = (L) => r2(sum(L, () => true) + waiting(L))

{
  /* (a)-(f), the staging probe of 22 Oct. Bank figures are what the trust account would hold. */
  const L = []
  approve(L, { inv: 'PO-1', cso: 1000, net: -1000 })
  check('(a) R1 000 owed, nothing collected: the firm is credited nothing', firm(L), 0)
  check('(a) ...the R1 000 carried as owing', client(L), -1000)
  check('(a) ...and the trust still reconciles to the bank (R0)', againstBank(L), 0)

  L.push({ party: 'client', amount: 600, reason: 'Collected for the client' })
  approve(L, { inv: 'PO-2', cso: 0, net: -400 })
  check('(b) the next run collects R600: the firm is credited R600', firm(L), 600)
  check('(b) ...R400 still owing', client(L), -400)
  check('(b) ...against the bank (R600)', againstBank(L), 600)

  L.push({ party: 'client', amount: 400, reason: 'Paid to the business account against PO-2 (BIZ)' })
  check('(c) the client pays R400 into the BUSINESS account: no trust credit for it', firm(L), 600)
  check('(c) ...the trust ledger equals the bank (R600), not R1 000', sum(L, () => true), 600)

  L.push({ party: 'client', amount: 2000, reason: 'Collected for the client' })
  approve(L, { inv: 'PO-3', cso: 500, net: 1500 })
  check('(d) a fully covered run credits its whole charge, as it always did', firm(L), 1100)
  check('(d) ...under the old wording', L.at(-1)?.reason, 'Charges recovered from payover PO-3')
  check('(d) ...and the PTC share is not "taken back" for the R400 paid to business (the old rule wrote -R400)',
    L.some((e) => e.reason.startsWith('PTC share recovered')), false)
  L.push({ party: 'client', amount: -1500, reason: 'Payover PO-3 paid to the client' })
  check('(d) ...against the bank (R1 100)', againstBank(L), 1100)

  const before = L.length
  approve(L, { inv: 'PO-4', cso: -5000, net: 5000 })
  check('(e) a brought-forward CREDIT moves to the client exactly as before',
    L.slice(before).map((e) => [e.party, e.amount]), [['client', 5000], ['firm', -5000]])

  approve(L, { inv: 'PO-5', cso: 172.5, net: -172.5 })
  check('(f) a withdrawal fee on a run with nothing collected: nothing credited', firm(L), -3900)
}
{
  /* (g) covered over two later runs: R600, then the rest -- R1 000 in all, never more. */
  const L = []
  approve(L, { inv: 'PO-1', cso: 1000, net: -1000 })
  L.push({ party: 'client', amount: 600, reason: 'Collected for the client' })
  approve(L, { inv: 'PO-2', cso: 0, net: -400 })
  L.push({ party: 'client', amount: 2000, reason: 'Collected for the client' })
  approve(L, { inv: 'PO-3', cso: 0, net: 1600 })
  check('(g) R600 then R400 credited as collections cover it', L.filter((e) => e.party === 'firm').map((e) => e.amount), [600, 400])
  approve(L, { inv: 'PO-4', cso: 0, net: 0 })
  check('(g) ...and nothing more on a later run', firm(L), 1000)
}
{
  /* (h) PTC debt and a set-off on one shortfall: the shortfall is PTC first, so the set-off is
     the first to be covered -- and the two together never exceed what trust money covered. */
  const L = []
  approve(L, { inv: 'PO-1', cso: 1000, net: -1300 }, 300)
  check('(h) R300 PTC + R1 000 set-off, nothing collected: nothing credited', firm(L), 0)
  L.push({ party: 'client', amount: 800, reason: 'Collected for the client' })
  approve(L, { inv: 'PO-2', cso: 0, net: -500 }, 300)
  check('(h) R800 collected, R500 still short: R800 credited, all of it set-off', [firm(L), sum(L, (e) => e.reason.startsWith('PTC'))], [800, 0])
}
{
  /* (i) going forward only: a run credited WHOLE under the old rule while below nil is caught up
     at the client's next approval -- by a new entry, nothing rewritten. */
  const L = [{ party: 'client', amount: -1000, reason: 'Charges set off against payover PO-1' },
    { party: 'firm', amount: 1000, reason: 'Charges recovered from payover PO-1' }]
  L.push({ party: 'client', amount: 600, reason: 'Collected for the client' })
  approve(L, { inv: 'PO-2', cso: 0, net: -400 })
  check('(i) an old full credit is brought back to what trust money covered', [L.at(-1)?.amount, firm(L)], [-400, 600])
  check('(i) ...the old entry itself untouched', L[1].amount, 1000)
}

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-set-off-covered: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
