/**
 * THE CLERKS' COLLECTION COMMISSION AND THE PAY STATEMENT (22 Oct 2026; the firm's answers, 23 Oct).
 *
 * THE FIRM (Stephan): "if a client is on 30 or 25%, they get 3%. If anything less than that, it is
 * proportionately lowered ... a client on 20%, they get 2%. Or client on 15%, they get 1.5% ... there
 * might be an exception ... on a specific client ... or on a specific account."
 * And of payments made straight to the client: "if the previous month's 11th payover report didn't
 * show anything outstanding for a specific client, we can pay it out ... to the clerks. The PTCs, but
 * if it shows that there's something outstanding ... then we can't pay out the commission of those PTCs."
 *
 * WHAT THIS HOLDS:
 *   1. The rate rule, to the firm's own examples, and the exception order (account, client, rule);
 *      an exception is 0% to 3%, in the browser and in the database.
 *   2. Commission is a share of the MONEY COLLECTED, to the cent, line by line.
 *   3. A reversal is a NEGATIVE line in the period it is reversed, labelled with the pay day the
 *      commission went out on; the period the money came in is left as it was paid.
 *   4. A payment belongs to whoever held the account on the payment day.
 *   5. PTC commission is released by the PAYOVER RUN: when the run the PTC rode is approved showing
 *      nothing outstanding; held while a run left the client owing, released at a later clean run (or
 *      when the shortfall was paid into the business account); waiting while no run is approved.
 *      Pending is never in the payable total. Unreadable runs hold everything.
 *   6. Carried-over entries wait and release by the same rule, from the commission start date; and
 *      payments before the commission start date earn nothing.
 *   7. Pay day the 25th; the basic pro rata for a starter (the firm's own example) and a leaver.
 *   8. The database: RLS and people.pay on every pay table; append-only where it must be; functions
 *      ask people.pay and are not anon's; the runs reader fails closed; the floor and the commission
 *      read "collected" alike; the start date lives on profiles, Administrator-only.
 *   9. The mappers carry every column; pay is never on the company dashboard.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-clerk-commission.mjs
 */
import { readFileSync } from 'node:fs'
import {
  basicFor, buildStatement, cents, commissionOn, defaultPayBasis, exceptionRateOk, matchCarried, parseCarriedSheet,
  payKeyOn, paydayOf, periodForKey, periodKeyOf, rateForClient, releaseOf, resolveRate, salaryMonth, shiftPeriod,
  summarise, workingDaysIn,
} from '../../src/lib/clerkCommission.ts'
import { NO_ROLE_CAPABILITIES, ROLE_CAPABILITIES } from '../../src/lib/capabilities.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*(--|\/\/).*$/gm, ' ')

/* ---------------- 1. the rate ---------------- */

check('a client on 30% pays the clerk 3%', rateForClient(0.30), 0.03)
check('a client on 25% pays the clerk 3%', rateForClient(0.25), 0.03)
check('a client on 20% pays the clerk 2%', rateForClient(0.20), 0.02)
check('a client on 15% pays the clerk 1.5%', rateForClient(0.15), 0.015)
check('a client on 24% pays the clerk 2.4% (proportionately lowered, not stepped)', rateForClient(0.24), 0.024)
check('a client on 40% still pays 3%', rateForClient(0.40), 0.03)
check('a client with no rate has no rule -- null, not nought', rateForClient(null), null)
check('...and a client on nothing pays nothing', rateForClient(0), 0)

check('the rule, with no exceptions', resolveRate({ clientRate: 0.2, clientOverride: null, accountOverride: null }), { rate: 0.02, source: 'rule' })
check('a client exception beats the rule (up)', resolveRate({ clientRate: 0.2, clientOverride: 0.025, accountOverride: null }), { rate: 0.025, source: 'client' })
check('a client exception beats the rule (down)', resolveRate({ clientRate: 0.3, clientOverride: 0.01, accountOverride: null }), { rate: 0.01, source: 'client' })
check('an account exception beats the client exception', resolveRate({ clientRate: 0.3, clientOverride: 0.01, accountOverride: 0.02 }), { rate: 0.02, source: 'account' })
check('an exception of nought is a decision, not "none"', resolveRate({ clientRate: 0.3, clientOverride: 0, accountOverride: null }), { rate: 0, source: 'client' })
check('no rate and no exception says so', resolveRate({ clientRate: null, clientOverride: null, accountOverride: null }), { rate: null, source: 'none' })

/* "anything below 3%" (the firm, 23 Oct): 0 to 3 inclusive. */
check('an exception may be 0%, 2.5% or 3%', [0, 0.025, 0.03].map(exceptionRateOk), [true, true, true])
check('...never above 3%, never below nought', [0.0301, 0.035, 0.1, -0.001].map(exceptionRateOk), [false, false, false, false])

/* ---------------- 2. a share of the money collected ---------------- */

check('R10 000 on a 30% client earns R300', commissionOn(10000, rateForClient(0.30)), 300)
check('R1 234.57 at 2.4% is R29.63, to the cent', commissionOn(1234.57, 0.024), 29.63)
check('half a cent goes away from nought', [cents(0.005), cents(-0.005)], [0.01, -0.01])
check('no rate earns nothing', commissionOn(500, null), 0)

/* ---------------- the period, and pay day ---------------- */

check('the period is the 11th to the 10th, named for the month it ends', periodForKey('2026-10'), { key: '2026-10', start: '2026-09-11', end: '2026-10-10' })
check('...January reaches back into December', periodForKey('2026-01').start, '2025-12-11')
check('the 10th is still this period', periodKeyOf('2026-10-10'), '2026-10')
check('the 11th is the next', periodKeyOf('2026-10-11'), '2026-11')
check('...across a year end', periodKeyOf('2026-12-15'), '2027-01')
check('periods step', [shiftPeriod('2026-12', 1), shiftPeriod('2026-01', -1)], ['2027-01', '2025-12'])

/* 7. "paid on the 25th of the month in which that period ends (period 11 Sep - 10 Oct is paid 25 Oct)". */
check('11 Sep - 10 Oct is paid on 25 Oct', paydayOf('2026-10'), '2026-10-25')
check('the salary month is 26 Sep - 25 Oct, paid the same day', salaryMonth('2026-10'), { start: '2026-09-26', end: '2026-10-25' })
check('...and January\'s reaches back into December', salaryMonth('2027-01').start, '2026-12-26')
check('the first pay day on or after a day', [payKeyOn('2026-10-11'), payKeyOn('2026-10-25'), payKeyOn('2026-10-26'), payKeyOn('2026-12-31')],
  ['2026-10', '2026-10', '2026-11', '2027-01'])

/* ---------------- 7. the basic, pro rata ---------------- */

/* The firm's example: starting Monday the 23rd, the 25th a Wednesday -> paid for the 23rd, 24th, 25th.
   25 November 2026 is a Wednesday. */
check('25 Nov 2026 is a Wednesday and 23 Nov a Monday (the fixture is the firm\'s example)',
  [new Date('2026-11-25T00:00:00Z').getUTCDay(), new Date('2026-11-23T00:00:00Z').getUTCDay()], [3, 1])
{
  const b = basicFor(4000, '2026-11', '2026-11-23', null)
  check('a starter on Monday the 23rd is paid for 3 working days', b.prorata?.days, 3)
  check('...of the salary month\'s working days (26 Oct - 25 Nov 2026: 23)', b.prorata?.of, 23)
  check('...so basic x 3 / 23, to the cent', b.amount, cents(4000 * 3 / 23))
  check('working days are counted with both ends in', workingDaysIn('2026-11-23', '2026-11-25'), 3)
  check('...and a public holiday is not one (Day of Reconciliation, Wed 16 Dec 2026)', workingDaysIn('2026-12-14', '2026-12-18'), 4)
  check('a full month is the whole basic', basicFor(4000, '2026-11', '2026-03-01', null), { amount: 4000, full: 4000, prorata: null, none: null })
  check('...and so is no start date at all', basicFor(4000, '2026-11', null, null).amount, 4000)
  const late = basicFor(4000, '2026-10', '2026-10-26', null)
  check('a start after the 25th is paid nothing this month', [late.amount, late.none], [0, 'not_started'])
  check('...and the full basic next month (they start on the 26th)', basicFor(4000, '2026-11', '2026-10-26', null).amount, 4000)
  const leaver = basicFor(4000, '2026-11', null, '2026-11-04')
  check('a leaver is paid to the end date, pro rata', [leaver.prorata?.days, leaver.amount], [8, cents(4000 * 8 / 23)])
  check('...and nothing after', [basicFor(4000, '2026-12', null, '2026-11-04').amount, basicFor(4000, '2026-12', null, '2026-11-04').none], [0, 'left'])
}

/* ---------------- the statements ---------------- */

const pay = (o) => ({
  paymentId: o.id, accountId: 'acc', caseNumber: o.caseNumber ?? 'BF1', debtor: 'D', companyId: o.company ?? 'c1', client: o.client ?? 'Client One',
  receivedOn: o.on, approvedOn: o.approved === undefined ? o.on : o.approved, reversedOn: o.reversed ?? null,
  reversalReason: o.reason ?? null,
  amount: o.amount, paidToClient: !!o.ptc, holderId: 'holder' in o ? o.holder : 'u1', holderSource: o.source ?? 'change',
  clientRate: o.rate ?? 0.3, clientRateSource: 'receipt',
  accountOverride: o.accountOverride ?? null, accountOverrideReason: null, clientOverride: o.clientOverride ?? null, clientOverrideReason: null,
  payoverRunId: o.run ?? null,
})
/* A run: the cycle ending `end`, approved on `approved` (null: still open), with its net. */
const run = (id, end, net, approved, extra = {}) => {
  const [y, m] = end.split('-').map(Number)
  const ps = m === 1 ? `${y - 1}-12-11` : `${y}-${String(m - 1).padStart(2, '0')}-11`
  return {
    id, companyId: extra.company ?? 'c1', periodStart: ps, periodEnd: end, status: approved ? (extra.status ?? 'approved') : 'ready',
    invoiceNumber: `INV-${id}`, net, carriedIn: 0, approvedOn: approved, settledOn: extra.settled ?? null,
  }
}
const stmt = (key, payments, runs = new Map(), extra = {}) =>
  buildStatement({ periodKey: key, basis: extra.basis ?? 'collections', basic: extra.basic ?? 4000, payments, runs, ...extra })

/* 3. A reversal. R10 000 received 20 Sep (October period), reversed 15 Oct (November period). */
{
  const p = pay({ id: 'p1', on: '2026-09-20', amount: 10000, reversed: '2026-10-15', caseNumber: 'BF77', reason: 'Debit order returned' })
  const oct = stmt('2026-10', [p])
  check('October pays the R300 on the receipt', oct.payments.map((l) => [l.kind, l.commission]), [['receipt', 300]])
  check('...and its payable is basic + commission', oct.payable, 4300)
  const nov = stmt('2026-11', [p])
  check('November takes it back as a negative line', nov.payments.map((l) => [l.kind, l.amount, l.commission]), [['reversal', -10000, -300]])
  check('...labelled with the pay day it was paid on (October: 25 Oct)', [nov.payments[0]?.paidIn, paydayOf(nov.payments[0]?.paidIn ?? '')], ['2026-10', '2026-10-25'])
  check('...carrying the reason on the payment record', nov.payments[0]?.payment.reversalReason, 'Debit order returned')
  check('...so November pays basic less R300', nov.payable, 3700)
  const same = stmt('2026-10', [pay({ id: 'p2', on: '2026-09-20', amount: 1000, reversed: '2026-09-25' })])
  check('received and reversed in one period: both lines, nothing paid', [same.payments.length, same.paymentsTotal], [2, 0])
  const label = read('src/components/people/PayStatementView.tsx')
  ok('the statement words it "Reversed: <date>, <case>, <amount> -- commission taken back"',
    /Reversed: \{shortDay\(l\.on\)\}, \{what\} — commission taken back\./.test(label) && /\{l\.paidIn && ` Paid \$\{paidOn\(l\.paidIn\)\}\.`\}/.test(label))
}

/* Overrides reach the statement, and the source and reason are on the line. */
{
  const s = stmt('2026-10', [
    pay({ id: 'a', on: '2026-09-12', amount: 1000, rate: 0.2 }),
    pay({ id: 'b', on: '2026-09-13', amount: 1000, rate: 0.2, clientOverride: 0.025 }),
    pay({ id: 'c', on: '2026-09-14', amount: 1000, rate: 0.2, clientOverride: 0.025, accountOverride: 0.03 }),
  ])
  check('rule, client, account on three lines', s.payments.map((l) => [l.source, l.commission]), [['rule', 20], ['client', 25], ['account', 30]])
}

/* 4. Payment-day attribution in the summary: grouped by who held it that day, never by who holds it now. */
{
  const r = summarise({
    periodKey: '2026-10',
    people: [{ userId: 'u1', basis: 'collections', basic: 4000 }, { userId: 'u2', basis: 'collections', basic: 4000 }],
    payments: [pay({ id: 'x', on: '2026-09-20', amount: 10000, holder: 'u2' }), pay({ id: 'y', on: '2026-09-21', amount: 500, holder: null })],
    runs: new Map(),
  })
  check('the payment is the holder\'s on the day', r.rows.map((x) => [x.userId, x.commission]), [['u1', 0], ['u2', 300]])
  check('money nobody held earns nobody commission, and is reported', r.unheld, 500)
}

/* 5. PTCs, released by the payover run.
   A R5 000 PTC on 20 Sep (the October period) rides run r1 (cycle to 10 Oct, approved 11 Oct). */
{
  const ptc = pay({ id: 't1', on: '2026-09-20', amount: 5000, ptc: true, run: 'r1' })
  const clean = new Map([['c1', [run('r1', '2026-10-10', 2500, '2026-10-11')]]])
  const oct = stmt('2026-10', [ptc], clean)
  check('released when the run it rode is approved showing nothing outstanding', [oct.releasedTotal, oct.pending.length], [150, 0])
  check('...on the pay day after the run (25 Oct), not a month later', releaseOf({ runId: 'r1', ownKey: '2026-10', runs: clean.get('c1'), asOf: '2027-06' }).key, '2026-10')
  check('...it is payable', oct.payable, 4150)
  check('...and the release names the run', oct.released[0]?.lines[0]?.releasedBy?.invoiceNumber, 'INV-r1')
  const nov = stmt('2026-11', [ptc], clean)
  check('...and it is not paid again in November', [nov.releasedTotal, nov.pendingTotal], [0, 0])

  /* Approved late (the 27th): it waits for the next pay day. */
  const late = new Map([['c1', [run('r1', '2026-10-10', 2500, '2026-10-27')]]])
  check('a run approved after the 25th releases on the next pay day',
    [stmt('2026-10', [ptc], late).releasedTotal, stmt('2026-11', [ptc], late).releasedTotal], [0, 150])

  /* Not approved: waiting. */
  const open = new Map([['c1', [run('r1', '2026-10-10', 2500, null)]]])
  const w = stmt('2026-10', [ptc], open)
  check('a run not yet approved: waiting, not payable', [w.releasedTotal, w.pendingTotal, w.payable], [0, 150, 4000])
  check('...and it says why', w.pending[0]?.waiting, 'Waiting for the payover run to be approved.')
  const none = stmt('2026-10', [pay({ id: 't9', on: '2026-09-20', amount: 5000, ptc: true })], clean)
  check('a PTC on no run yet is waiting', [none.pendingTotal, none.pending[0]?.waiting], [150, 'Not on a payover run yet.'])

  /* The run left the client short (R1 200 below nil): held; the next run, clean after the carry, releases. */
  const short = [run('r1', '2026-10-10', -1200, '2026-10-11')]
  const heldOct = stmt('2026-10', [ptc], new Map([['c1', short]]))
  check('held while the run left the client owing', [heldOct.releasedTotal, heldOct.pendingTotal], [0, 150])
  check('...showing what that run left outstanding and since which run', [heldOct.pending[0]?.owed, heldOct.pending[0]?.owedSince?.id, heldOct.pending[0]?.owedRun?.id], [1200, 'r1', 'r1'])
  const stillShort = [...short, run('r2', '2026-11-10', -300, '2026-11-11')]
  const heldNov = stmt('2026-11', [ptc], new Map([['c1', stillShort]]))
  check('a second short run: still held, owing since the first', [heldNov.releasedTotal, heldNov.pending[0]?.owed, heldNov.pending[0]?.owedSince?.id], [0, 300, 'r1'])
  const recovered = [...stillShort, run('r3', '2026-12-10', 900, '2026-12-11')]
  const R = new Map([['c1', recovered]])
  check('released at the first LATER run that shows nothing outstanding',
    releaseOf({ runId: 'r1', ownKey: '2026-10', runs: recovered, asOf: '2027-06' }).key, '2026-12')
  check('...in that month and no other', ['2026-10', '2026-11', '2026-12', '2027-01'].map((k) => stmt(k, [ptc], R).releasedTotal), [0, 0, 150, 0])
  check('...and it is drawn as waiting until then', ['2026-10', '2026-11', '2026-12'].map((k) => stmt(k, [ptc], R).pendingTotal), [150, 150, 0])
  check('a later run not approved yet: still waiting', stmt('2026-12', [ptc], new Map([['c1', [...stillShort, run('r3', '2026-12-10', 900, null)]]])).pendingTotal, 150)

  /* The client paid the shortfall into the business account: settled, released on the next pay day. */
  const settled = [run('r1', '2026-10-10', -1200, '2026-10-11', { settled: '2026-10-20' })]
  check('a short run the client settled into the business account releases on the next pay day',
    releaseOf({ runId: 'r1', ownKey: '2026-10', runs: settled, asOf: '2027-06' }).key, '2026-10')

  check('unreadable runs hold everything', (() => { const b = stmt('2026-10', [ptc], null); return [b.releasedTotal, b.pendingTotal, b.runsUnread, b.payable] })(),
    [0, 150, true, 4000])

  /* Reversed after it was released: it comes back in the reversal's period, labelled with its pay day. */
  const lateRev = pay({ id: 't3', on: '2026-09-20', amount: 5000, ptc: true, run: 'r1', reversed: '2026-12-02' })
  const decR = stmt('2026-12', [lateRev], clean)
  check('a released PTC reversed later is taken back as a negative line', decR.payments.map((l) => [l.kind, l.commission, l.paidIn]), [['ptc_reversal', -150, '2026-10']])
  /* Reversed while still waiting: nothing was paid, so nothing comes back; it just leaves the list. */
  const early = pay({ id: 't4', on: '2026-09-20', amount: 5000, ptc: true, run: 'r1', reversed: '2026-10-02' })
  const e = stmt('2026-11', [early], R)
  check('a PTC reversed while waiting leaves the list and is never paid', [e.pendingTotal, e.releasedTotal, e.payments.length], [0, 0, 0])
  check('...not even in the month its run is clean', stmt('2026-10', [early], clean).releasedTotal, 0)
  check('...and the month it is reversed in takes nothing back', [stmt('2026-10', [early], open).payments.length, stmt('2026-10', [early], open).payable], [0, 4000])

  for (const s of [oct, nov, w, heldOct, heldNov, decR]) {
    ok(`payable is basic + payments + released, never pending (${s.period.key})`,
      s.payable === cents(s.basic + s.paymentsTotal + s.releasedTotal))
  }
}

/* 6. The clean cut, and carried-over commission. Commission starts 11 Dec 2026. */
{
  const START = '2026-12-11'
  const before = pay({ id: 'o1', on: '2026-12-05', amount: 10000 })
  const after = pay({ id: 'o2', on: '2026-12-12', amount: 10000 })
  const jan = stmt('2027-01', [before, after], new Map(), { commissionStart: START })
  check('a payment before the commission start date earns nothing; one after does', jan.payments.map((l) => l.payment.paymentId), ['o2'])
  const revOld = pay({ id: 'o3', on: '2026-12-05', amount: 10000, reversed: '2026-12-20' })
  check('...and its reversal takes nothing back', stmt('2027-01', [revOld], new Map(), { commissionStart: START }).payments.length, 0)
  check('...an old PTC is not pending either', stmt('2027-01', [pay({ id: 'o4', on: '2026-11-20', amount: 5000, ptc: true })], new Map(), { commissionStart: START }).pendingTotal, 0)
  check('...without a start date every payment counts', stmt('2026-12', [before]).payments.length, 1)

  const entry = { id: 'k1', userId: 'u1', companyId: 'c1', client: 'Client One', amount: 812.4, note: 'Old PTCs', source: 'sheet.xlsx',
    createdOn: '2026-12-01', reversedOn: null, reversalReason: null }
  /* The first run after the start: the cycle 11 Dec - 10 Jan, approved 11 Jan. Earlier runs do not count. */
  const runs = [run('q0', '2026-12-10', 500, '2026-12-11'), run('q1', '2027-01-10', -400, '2027-01-11'), run('q2', '2027-02-10', 50, '2027-02-11')]
  const C = new Map([['c1', runs]])
  const carry = (k, rs = C, e = entry) => stmt(k, [], rs, { carried: [e], commissionStart: START })
  check('a carried-over entry waits like a PTC', [carry('2026-12').pendingTotal, carry('2026-12').releasedTotal], [812.4, 0])
  check('...a clean run BEFORE the start date does not release it', carry('2026-12').releasedTotal, 0)
  check('...the first run after the start left the client owing: still waiting', [carry('2027-01').pendingTotal, carry('2027-01').pending[0]?.owed], [812.4, 400])
  check('...released at the first later run that shows nothing outstanding', ['2027-01', '2027-02', '2027-03'].map((k) => carry(k).releasedTotal), [0, 812.4, 0])
  check('...labelled carried over', carry('2027-02').released[0]?.lines[0]?.carried?.id, 'k1')
  check('...released at once where the first run is clean', carry('2027-01', new Map([['c1', [run('q1', '2027-01-10', 10, '2027-01-11')]]])).releasedTotal, 812.4)
  check('...waiting while there is no run after the start', carry('2027-01', new Map([['c1', [runs[0]]]])).pending[0]?.waiting, 'Waiting for the client’s first payover run.')
  const reversed = { ...entry, reversedOn: '2027-01-05', reversalReason: 'Typed twice' }
  check('a carried-over entry reversed before release is never paid', ['2027-01', '2027-02'].map((k) => [carry(k, C, reversed).pendingTotal, carry(k, C, reversed).releasedTotal]), [[0, 0], [0, 0]])
  const revAfter = { ...entry, reversedOn: '2027-03-02', reversalReason: 'Wrong clerk' }
  check('...reversed after release, it comes back as a negative line', carry('2027-03', C, revAfter).payments.map((l) => [l.kind, l.commission, l.paidIn]), [['ptc_reversal', -812.4, '2027-02']])

  /* The sheet, matched like the brought-forward balances: exact, else a person picks. */
  const rows = parseCarriedSheet([
    { Clerk: 'Thandi', Client: 'Client One', Amount: 'R 1 200.50', Note: 'old' },
    { Clerk: 'thandi@raptor.test', Client: 'C1', Amount: '300' },
    { Clerk: 'Thandy', Client: 'Client One', Amount: '50' },
    { Clerk: 'Thandi', Client: 'Client One', Amount: 'n/a' },
  ])
  check('the sheet is read by its headings', rows.map((r) => [r.row, r.amount]), [[2, 1200.5], [3, 300], [4, 50], [5, null]])
  const people = [{ id: 'u1', name: 'Thandi', email: 'thandi@raptor.test' }]
  const clients = [{ id: 'c1', name: 'Client One', code: 'C1' }]
  const m = matchCarried(rows, people, clients)
  check('by name, by email and by code; a near name is not a match; not an amount is said', m.map((r) => r.state), ['ready', 'ready', 'pick', 'not_an_amount'])
  check('...a person picks the clerk', matchCarried(rows, people, clients, { '4:clerk': 'u1' })[2].state, 'ready')
  let threw = false
  try { parseCarriedSheet([{ Name: 'x', Amount: '1' }]) } catch { threw = true }
  ok('a sheet without a Client heading is refused in words', threw)
}

/* Non-collections staff: basic only. */
{
  const s = stmt('2026-10', [pay({ id: 'z', on: '2026-09-20', amount: 10000 })], new Map(), { basis: 'sales', basic: 9000 })
  check('a sales person has no commission scheme yet: basic only', [s.scheme, s.payments.length, s.payable], [false, 0, 9000])
  check('the call centre collects', defaultPayBasis('Pre-legal Agent'), 'collections')
  check('...sales sells', defaultPayBasis('Sales Representative'), 'sales')
  check('...the liaisons are communications', defaultPayBasis('Liaison'), 'communications')
  check('...and an administrator is other', defaultPayBasis('Administrator'), 'other')
  check('a statement carries its pay day', s.payday, '2026-10-25')
  check('...and a pro-rata basic in the payable', stmt('2026-11', [], new Map(), { basic: 4000, startedOn: '2026-11-23' }).payable, cents(4000 * 3 / 23))
}

/* ---------------- 8. the database ---------------- */

const sql = read('supabase/schema.sql')
const liveFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  return at < 0 ? '' : sql.slice(at, sql.indexOf('$$;', at))
}
const tableDef = (name) => {
  const at = sql.lastIndexOf(`create table if not exists public.${name} (`)
  return at < 0 ? '' : sql.slice(at, sql.indexOf('\n);', at))
}
const policies = (table) => [...sql.matchAll(new RegExp(`create policy "[^"]+" on public\\.${table}\\s+for (\\w+)([^;]*);`, 'g'))]

for (const t of ['employee_profiles', 'employee_profile_history', 'clerk_commission_overrides', 'people_settings',
  'people_setting_changes', 'clerk_commission_carried']) {
  ok(`${t} exists`, tableDef(t).length > 0)
  ok(`${t} has row-level security`, sql.includes(`alter table public.${t} enable row level security;`))
  const ps = policies(t)
  ok(`${t} has policies`, ps.length > 0)
  for (const p of ps) ok(`${t} ${p[1]} asks people.pay`, /public\.has_capability\('people\.pay'\)/.test(p[2]))
  check(`${t} has no removal policy`, ps.filter((p) => p[1] === 'delete' || p[1] === 'all').length, 0)
  ok(`${t} is not anon's`, sql.includes(`revoke all on table public.${t} from anon;`))
}
check('the histories, the exceptions and the carried-over entries cannot be edited (no update policy)',
  ['employee_profile_history', 'clerk_commission_overrides', 'people_setting_changes', 'clerk_commission_carried'].map((t) => policies(t).some((p) => p[1] === 'update')),
  [false, false, false, false])
check('the histories are written by triggers only (no insert policy)',
  ['employee_profile_history', 'people_setting_changes'].map((t) => policies(t).some((p) => p[1] === 'insert')), [false, false])
ok('the profile keeps no ID number or bank details', !/id_number|bank/.test(tableDef('employee_profiles')))
ok('the override names exactly one of client or account', /\(company_id is null\) <> \(account_id is null\)/.test(tableDef('clerk_commission_overrides')))
ok('...and a reason', /reason text not null check \(length\(btrim\(reason\)\) >= 3\)/.test(tableDef('clerk_commission_overrides')))
ok('an exception is capped at 3% in the database',
  /add constraint clerk_commission_overrides_rate_upto_3 check \(rate is null or \(rate >= 0 and rate <= 0\.03\)\)/.test(sql))
const rules = read('src/pages/people/CommissionRules.tsx')
ok('...and on the screen, through the same 3%', /exceptionRateOk\(\(rateValue as number\) \/ 100\)/.test(rules) && !/> 10\)/.test(rules))
ok('...with the sentence saying what an exception is', /a different clerk commission for one client or one account, instead of the standard rule; never\s+above/.test(rules))
const stamp = liveFn('clerk_commission_override_stamp')
ok('who and when are the database\'s to write', /new\.set_by := auth\.uid\(\)/.test(stamp) && /new\.set_at := public\.raptor_now\(\)/.test(stamp))
const hist = liveFn('employee_profile_stamp')
ok('every pay field is written to history', /array\['job_title', 'ended_on', 'pay_basis', 'basic_salary', 'notes'\]/.test(hist))

/* The start date: on profiles, any Administrator's, history kept, nobody else may move it. */
ok('the start date is a column on profiles', /alter table public\.profiles add column if not exists start_date date;/.test(sql))
ok('...and no longer on the pay record', /'alter table public\.employee_profiles dr' \|\| 'op column if exists started_on'/.test(sql))
ok('...only an Administrator may change it', /new\.start_date := old\.start_date;/.test(liveFn('protect_profile_privileged_fields')))
ok('...and every change is written to the pay history', /'start_date'/.test(liveFn('profile_start_date_history'))
  && /after insert or update of start_date on public\.profiles/.test(sql))
const auth = read('src/store/AuthContext.tsx')
ok('the hand-written profile mapper carries it', /startDate: row\.start_date \?\? undefined/.test(auth) && /start_date: string \| null/.test(auth))

/* Carried over: append-only, reversal copies the original, one reversal. */
const carriedDef = tableDef('clerk_commission_carried')
ok('a carried-over entry is positive, a reversal negative with a reason', /\(reverses_id is null and amount > 0\)\s+or \(reverses_id is not null and amount < 0 and length\(btrim\(coalesce\(reason, ''\)\)\) >= 3\)/.test(carriedDef))
ok('...one reversal an entry', /create unique index if not exists clerk_commission_carried_one_reversal\s+on public\.clerk_commission_carried \(reverses_id\) where reverses_id is not null;/.test(sql))
const cstamp = liveFn('clerk_commission_carried_stamp')
ok('...the reversal copies clerk, client and the exact negative', /new\.amount := -v_orig\.amount;/.test(cstamp) && /new\.user_id := v_orig\.user_id;/.test(cstamp))
ok('clear_staging empties the carried-over entries', /public\.clerk_commission_carried'/.test(liveFn('clear_staging')))

const lines = liveFn('clerk_commission_lines')
const runsFn = liveFn('clerk_commission_runs')
for (const [name, body] of [['clerk_commission_lines', lines], ['clerk_commission_runs', runsFn]]) {
  ok(`${name} is there`, body.length > 0)
  ok(`${name} refuses without people.pay`, /if not public\.has_capability\('people\.pay'\) then\s+raise exception/.test(body))
  ok(`${name} is not anon's`, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon;`).test(sql))
}
ok('the runs reader reads the runs as they stand, never re-summing them',
  /r\.net_payover, r\.carried_in/.test(runsFn) && !/sum\(/.test(strip(runsFn)))
ok('...leaves out void runs', /r\.status <> 'void'/.test(runsFn))
ok('...and fails closed without the trust or business tick',
  /if not \(public\.has_capability\('finance\.view'\) or public\.has_capability\('business\.view'\)\) then\s+raise exception/.test(runsFn))
ok('the ledger reader is gone', /'dr' \|\| 'op function if exists public\.clerk_commission_ledgers\(uuid\[\]\)'/.test(sql))
ok('a payment carries the run it rode', /select a\.payover_run_id\s+from public\.payment_allocations a\s+where a\.payment_id = p\.id and a\.payover_run_id is not null/.test(lines))

/* 4. Payment-day attribution, in SQL: the desk on the day, exactly as collector_performance reads it. */
const DESK = /from public\.account_desk_history dh\s+where dh\.account_id = p\.account_id\s+and dh\.effective_from <= p\.received_at\s+order by dh\.effective_from desc\s+limit 1/
ok('a payment is credited to the desk on the payment day', DESK.test(lines))
ok('...and filtered by that holder, not by today\'s', /\(p_user is null or h\.user_id = p_user\)/.test(lines) && !/assigned_to/.test(strip(lines)))
ok('the floor reads the desk the same way', DESK.test(liveFn('collector_performance')))
ok('overrides are read as in force on the payment day',
  (lines.match(/o\.effective_from <= \(p\.received_at at time zone 'Africa\/Johannesburg'\)::date/g) ?? []).length === 2)
ok('the client\'s rate is the one stamped on the receipt first', /coalesce\(al\.commission_rate, public\.account_commission_rate\(p\.account_id\)\)/.test(lines))

/* WHAT COUNTS AS COLLECTED: one predicate, three readers, so the floor and pay cannot disagree. */
const COLLECTED = "p.source <> 'moved' and p.rejected_at is null and not p.is_demo"
check('collector_performance reads collected that way, twice', (liveFn('collector_performance').split(COLLECTED).length - 1), 2)
check('collector_daily reads it that way', (liveFn('collector_daily').split(COLLECTED).length - 1), 1)
check('the commission reads it that way', (lines.split(COLLECTED).length - 1), 1)

/* The tick. */
const allCaps = liveFn('all_capabilities')
ok('people.pay is a capability the database knows', /'people\.pay'/.test(allCaps))
ok('...added beside the template, not in it', !/'people\.pay'/.test(liveFn('role_capabilities')))
ok('...and in no role in the browser either',
  NO_ROLE_CAPABILITIES.includes('people.pay') && Object.values(ROLE_CAPABILITIES).every((c) => !c.includes('people.pay')))

/* ---------------- 9. the mappers, and where pay is NOT ---------------- */

const api = read('src/lib/peopleApi.ts')
const ret = (/returns table \(([\s\S]*?)\)\s*language/.exec(lines)?.[1] ?? '')
const cols = [...ret.matchAll(/(\w+) (uuid|text|date|numeric|boolean)/g)].map((m) => m[1])
ok('the lines function returns columns', cols.length >= 22)
for (const c of cols) ok(`toCommissionPayment reads ${c}`, api.includes(`r.${c}`))
const runCols = [...(/returns table \(([\s\S]*?)\)\s*language/.exec(runsFn)?.[1] ?? '').matchAll(/(\w+) (uuid|text|date|numeric|boolean)/g)].map((m) => m[1])
ok('the runs function returns columns', runCols.length === 10)
for (const c of runCols) ok(`toPayoverRun reads ${c}`, api.includes(`r.${c}`))
/* Profile columns, read off the table AND the later alters, in the select and the mapper. */
const profileCols = [...tableDef('employee_profiles').matchAll(/^\s+(\w+) (uuid|text|date|numeric|timestamptz)/gm)].map((m) => m[1])
  .filter((c) => c !== 'started_on')
  .concat([...sql.matchAll(/alter table public\.employee_profiles add column if not exists (\w+)/g)].map((m) => m[1]))
check('the profile select names every column', (/EMPLOYEE_PROFILE_COLUMNS =\s+'([^']+)'/.exec(api)?.[1] ?? '').split(', '), profileCols)
for (const c of profileCols) ok(`toEmployeeProfile reads ${c}`, api.includes(`r.${c}`))
ok('nothing reads the removed started_on any more', !/started_on/.test(strip(api)))
const carriedCols = [...carriedDef.matchAll(/^\s+(\w+) (uuid|text|numeric|timestamptz)/gm)].map((m) => m[1])
check('the carried-over select names every column', (/CARRIED_COLUMNS =\s+'([^']+)'/.exec(api)?.[1] ?? '').split(', '), carriedCols)
for (const c of carriedCols) ok(`toCarriedRow reads ${c}`, api.includes(`r.${c}`))
/* Written out literally in the select (check-select-columns reads literals), so held to the list here. */
ok('...and the query selects exactly that list', api.includes(`.select('${carriedCols.join(', ')}, companies(name)')`))

const company = strip(read('src/pages/CompanyDashboard.tsx'))
ok('pay is never on the company dashboard', !/clerkCommission|peopleApi|PayStatement/.test(company))
ok('the menu item asks people.pay', /n\.to !== '\/people' \|\| canViewPay\(currentUser\)/.test(read('src/components/layout/Sidebar.tsx')))
ok('the route is behind RequirePay', /<Route path="\/people" element=\{<RequirePay><PeopleLayout \/><\/RequirePay>\}>/.test(read('src/App.tsx')))

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-clerk-commission: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
