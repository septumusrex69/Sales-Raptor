/**
 * WHAT THE FIRM MAY DRAW IS NEVER BELOW NIL, AND WHAT WAITS IS NEVER MORE THAN IS HELD (prompt 12 B4).
 *
 * 11 Sep on staging: held R24 016.26, waiting R24 104.36, drawable -R88.10 -- bank charges since the
 * last drawing (R57.50 + R69.00 - R38.40 interest) taken from a share that was all still waiting.
 * The function is SQL; this models its last line exactly and holds the identity on the firm's numbers,
 * then holds schema.sql to that line.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-firm-drawable.mjs
 */
import { readFileSync } from 'node:fs'
import { drawingStep } from '../../src/lib/paymentsOut.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const r2 = (v) => Math.round(v * 100) / 100
/* The function's last line, as written. */
const split = (free, pend) => {
  const held = free + pend
  return { held: r2(held), drawable: r2(Math.max(free + Math.min(pend, 0), 0)), waiting: r2(Math.min(Math.max(pend, 0), Math.max(held, 0))) }
}
const day11 = split(-88.10, 24104.36)
check('the firm\'s 11 Sep: nothing may be drawn, not minus R88.10', day11.drawable, 0)
check('...and what waits is what is held', day11.waiting, 24016.26)
check('...so held is drawable + waiting', r2(day11.drawable + day11.waiting), day11.held)
const after = split(12543.05 - 88.10, 11473.21)
check('once the clients are paid, the charges come off what may be drawn', after.drawable, 12454.95)
check('a firm balance below nil draws nothing and waits on nothing', split(-500, 200), { held: -300, drawable: 0, waiting: 0 })
for (const [f, p] of [[100, 50], [-10, 50], [0, -20], [30, -40], [-5, 0]]) {
  const s = split(f, p)
  check(`never negative, never more than held (${f}, ${p})`, s.drawable >= 0 && s.waiting >= 0 && s.waiting <= Math.max(s.held, 0), true)
}
const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const fn = sql.slice(sql.lastIndexOf('create or replace function public.firm_trust_split('))
check('schema.sql caps what may be drawn at nil', /round\(greatest\(free \+ least\(pend, 0\), 0\), 2\)/.test(fn), true)
check('...and what waits at what is held', /round\(least\(greatest\(pend, 0\), greatest\(held, 0\)\), 2\)/.test(fn), true)

/* PROMPT 12 C: the drawable figure and the overview judge a run by ONE test. firm_trust_split asked
   firm_run_settled while the cycle readers asked "paid?", so Marula's settled runs below nil were the
   firm's to draw and the clients' to be paid over at once, and "Payover overdue" fired on them. */
const body = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  return at < 0 ? '' : sql.slice(at, sql.indexOf('\n$$;', at))
}
check('firm_trust_split asks firm_run_settled', /firm_run_settled\(/.test(body('firm_trust_split')), true)
check('...the trust in cash counts a settled run\'s client money as kept back, by the same test',
  /coalesce\(public\.firm_run_settled\(r\.id\), false\) as run_paid/.test(body('trust_cash_by_cycle')), true)
check('...and no longer by "paid" alone', /r\.paid_at is not null as run_paid/.test(body('trust_cash_by_cycle')), false)
check('runs still to do leave out a settled run below nil', /and not public\.firm_run_settled\(r\.id\)\), 0\)/.test(body('trust_by_cycle')), true)

/* PROMPT 12 B2: the payout day's last line. Done only once the statement has the drawing. */
const bfOut = (o) => ({ kind: 'business_transfer', id: 'd1', payee: 'Bredell Ferreira', amount: 12543.05, reference: null,
  paidAt: '2026-09-11T09:00:00Z', paidReference: 'BF FEES-2609', confirmed: false, statementDate: null, accountId: null, caseNumber: null, ...o })
const day = '2026-09-11'
check('drawable and nothing recorded: draw it, on BF FEES of the payout month',
  drawingStep({ payDay: day, drawable: 12543.05, waiting: 0, paidOut: [] }), { state: 'draw', amount: 12543.05, reference: 'BF FEES-2609' })
check('...recorded but not on the statement is not done',
  drawingStep({ payDay: day, drawable: 0, waiting: 0, paidOut: [bfOut()] }).state, 'recorded')
check('...matched on the statement is done, with the day',
  drawingStep({ payDay: day, drawable: 0, waiting: 0, paidOut: [bfOut({ confirmed: true, statementDate: '2026-09-12' })] }),
  { state: 'done', amount: 12543.05, reference: 'BF FEES-2609', statementDate: '2026-09-12' })
check('...last month\'s drawing does not tick off this month',
  drawingStep({ payDay: day, drawable: 500, waiting: 0, paidOut: [bfOut({ paidReference: 'BF FEES-2608', confirmed: true })] }).state, 'draw')
check('...nor does a refund on the same words', drawingStep({ payDay: day, drawable: 0, waiting: 0, paidOut: [bfOut({ kind: 'refund' })] }).state, 'none')
check('...half the drawings on the statement is not done',
  drawingStep({ payDay: day, drawable: 0, waiting: 0, paidOut: [bfOut({ confirmed: true }), bfOut({ id: 'd2', amount: 100 })] }).state, 'recorded')
check('...and with nothing drawable yet, it waits for its clients', drawingStep({ payDay: day, drawable: 0, waiting: 11061.83, paidOut: [] }).state, 'waits')
const queue = readFileSync(new URL('../../src/pages/finance/FinanceWorkQueue.tsx', import.meta.url), 'utf8')
check('the Approve tab draws the line', /data-testid="firm-drawing-step"/.test(queue) && /drawingStep\(\{ payDay: approveDay/.test(queue), true)

/* THE FIRM IS ONE PARTY ON "AGAINST THE BANK" (13 Oct): grouped per account, its drawings read as
   R39 877.68 owed back to the trust beside a firm line already net of them. */
check('trust_position groups the firm as one party, like trust_balances',
  /when 'debtor' then coalesce\(account_id::text, party\)\s*else party end as who/.test(body('trust_position')), true)
check('...and no longer splits it by account', /else coalesce\(account_id::text, party\) end as who/.test(body('trust_position')), false)

/* THE UNRECOVERED PTC SHARE IS THE FIRM'S, WAITING (the firm chose it, 13 Oct): the R1 287.50 that
   sat in the bank with nobody's name on it between a PTC and the approval of its run. */
const tp = body('trust_position')
check('Against the bank derives the firm\'s unrecovered PTC share', /ptc_pending as/.test(tp)
  && /reason like '%Paid straight to the client%' then -amount/.test(tp)
  && /reason like 'PTC share recovered%' then -amount/.test(tp)
  && /reason like 'Paid to the business account against PO-%' then -amount/.test(tp), true)
check('...never below nil per client', /sum\(greatest\(owed, 0\)\)/.test(tp), true)
check('...and counts it as the firm\'s', /select 'firm', 'firm', bal from ptc_pending/.test(tp), true)
check('...derived, not written: firm_trust_split (what may be drawn) never reads it', /ptc_pending|Paid straight to the client/.test(body('firm_trust_split')), false)
const tcc = body('trust_cash_by_cycle')
check('the overview takes a PTC\'s fees off the client on a run not yet settled', /\+ coalesce\(sum\(amount\) filter \(where ptc_fee and not run_paid\), 0\) as clients_open/.test(tcc), true)
check('...and puts the same amount on the firm, so the cycle total does not move',
  /coalesce\(-sum\(amount\) filter \(where ptc_fee and not run_paid\), 0\) as ptc_waiting/.test(tcc)
  && /round\(a\.firm_earned \+ a\.kept_back \+ a\.ptc_waiting, 2\)/.test(tcc)
  && /a\.clients_open \+ a\.kept_back \+ a\.ptc_waiting \+/.test(tcc), true)

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-firm-drawable: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
