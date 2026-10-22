/**
 * THE CLERKS' COLLECTION COMMISSION AND THE PAY STATEMENT (22 Oct 2026).
 *
 * THE FIRM (Stephan): "if a client is on 30 or 25%, they get 3%. If anything less than that, it is
 * proportionately lowered ... a client on 20%, they get 2%. Or client on 15%, they get 1.5% ... there
 * might be an exception ... on a specific client ... or on a specific account."
 * And of payments made straight to the client: "we can't pay the clerk commission if a client is owing
 * us money ... if the client doesn't owe us money at all ... then we can start paying out the clerks."
 *
 * WHAT THIS HOLDS:
 *   1. The rate rule, to the firm's own examples, and the override order (account, client, rule).
 *   2. Commission is a share of the MONEY COLLECTED, to the cent, line by line.
 *   3. A reversal is a NEGATIVE line in the period it is reversed; the period the money came in is
 *      left as it was paid.
 *   4. A payment belongs to whoever held the account on the payment day (the SQL lookup, and the
 *      summary grouping by that holder).
 *   5. PTC commission is never payable while the client owes the firm anything, is released in full in
 *      the period the client's balance reaches nought, and pending is never in the payable total.
 *      Unapproved PTCs and an unreadable ledger hold, never release.
 *   6. The database: every new table has RLS and asks people.pay; no update or removal policy on the
 *      history or the overrides; both functions ask people.pay and are not anon's; no role holds the
 *      tick; the ledger reader fails closed; and the floor and the commission read "collected" alike.
 *   7. The mappers carry every column; pay is never on the company dashboard.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-clerk-commission.mjs
 */
import { readFileSync } from 'node:fs'
import {
  balanceAt, buildStatement, cents, commissionOn, defaultPayBasis, owingSince, periodForKey, periodKeyOf,
  rateForClient, releasePeriodOf, resolveRate, shiftPeriod, summarise,
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
check('a client exception beats the rule (up)', resolveRate({ clientRate: 0.2, clientOverride: 0.035, accountOverride: null }), { rate: 0.035, source: 'client' })
check('a client exception beats the rule (down)', resolveRate({ clientRate: 0.3, clientOverride: 0.01, accountOverride: null }), { rate: 0.01, source: 'client' })
check('an account exception beats the client exception', resolveRate({ clientRate: 0.3, clientOverride: 0.01, accountOverride: 0.05 }), { rate: 0.05, source: 'account' })
check('an exception of nought is a decision, not "none"', resolveRate({ clientRate: 0.3, clientOverride: 0, accountOverride: null }), { rate: 0, source: 'client' })
check('no rate and no exception says so', resolveRate({ clientRate: null, clientOverride: null, accountOverride: null }), { rate: null, source: 'none' })

/* ---------------- 2. a share of the money collected ---------------- */

check('R10 000 on a 30% client earns R300', commissionOn(10000, rateForClient(0.30)), 300)
check('R1 234.57 at 2.4% is R29.63, to the cent', commissionOn(1234.57, 0.024), 29.63)
check('half a cent goes away from nought', [cents(0.005), cents(-0.005)], [0.01, -0.01])
check('no rate earns nothing', commissionOn(500, null), 0)

/* ---------------- the period ---------------- */

check('the period is the 11th to the 10th, named for the month it ends', periodForKey('2026-10'), { key: '2026-10', start: '2026-09-11', end: '2026-10-10' })
check('...January reaches back into December', periodForKey('2026-01').start, '2025-12-11')
check('the 10th is still this period', periodKeyOf('2026-10-10'), '2026-10')
check('the 11th is the next', periodKeyOf('2026-10-11'), '2026-11')
check('...across a year end', periodKeyOf('2026-12-15'), '2027-01')
check('periods step', [shiftPeriod('2026-12', 1), shiftPeriod('2026-01', -1)], ['2027-01', '2025-12'])

/* ---------------- the statements ---------------- */

const pay = (o) => ({
  paymentId: o.id, accountId: 'acc', caseNumber: 'BF1', debtor: 'D', companyId: o.company ?? 'c1', client: o.client ?? 'Client One',
  receivedOn: o.on, approvedOn: o.approved === undefined ? o.on : o.approved, reversedOn: o.reversed ?? null,
  amount: o.amount, paidToClient: !!o.ptc, holderId: 'holder' in o ? o.holder : 'u1', holderSource: o.source ?? 'change',
  clientRate: o.rate ?? 0.3, clientRateSource: 'receipt',
  accountOverride: o.accountOverride ?? null, accountOverrideReason: null, clientOverride: o.clientOverride ?? null, clientOverrideReason: null,
})
const stmt = (key, payments, ledgers = new Map(), basis = 'collections', basic = 4000) =>
  buildStatement({ periodKey: key, basis, basic, payments, ledgers })

/* 3. A reversal. R10 000 received 20 Sep (October period), reversed 15 Oct (November period). */
{
  const p = pay({ id: 'p1', on: '2026-09-20', amount: 10000, reversed: '2026-10-15' })
  const oct = stmt('2026-10', [p])
  check('October pays the R300 on the receipt', oct.payments.map((l) => [l.kind, l.commission]), [['receipt', 300]])
  check('...and its payable is basic + commission', oct.payable, 4300)
  const nov = stmt('2026-11', [p])
  check('November takes it back as a negative line', nov.payments.map((l) => [l.kind, l.amount, l.commission]), [['reversal', -10000, -300]])
  check('...so November pays basic less R300', nov.payable, 3700)
  const same = stmt('2026-10', [pay({ id: 'p2', on: '2026-09-20', amount: 1000, reversed: '2026-09-25' })])
  check('received and reversed in one period: both lines, nothing paid', [same.payments.length, same.paymentsTotal], [2, 0])
}

/* Overrides reach the statement, and the source and reason are on the line. */
{
  const s = stmt('2026-10', [
    pay({ id: 'a', on: '2026-09-12', amount: 1000, rate: 0.2 }),
    pay({ id: 'b', on: '2026-09-13', amount: 1000, rate: 0.2, clientOverride: 0.025 }),
    pay({ id: 'c', on: '2026-09-14', amount: 1000, rate: 0.2, clientOverride: 0.025, accountOverride: 0.04 }),
  ])
  check('rule, client, account on three lines', s.payments.map((l) => [l.source, l.commission]), [['rule', 20], ['client', 25], ['account', 40]])
}

/* 4. Payment-day attribution in the summary: grouped by who held it that day, never by who holds it now. */
{
  const r = summarise({
    periodKey: '2026-10',
    people: [{ userId: 'u1', basis: 'collections', basic: 4000 }, { userId: 'u2', basis: 'collections', basic: 4000 }],
    payments: [pay({ id: 'x', on: '2026-09-20', amount: 10000, holder: 'u2' }), pay({ id: 'y', on: '2026-09-21', amount: 500, holder: null })],
    ledgers: new Map(),
  })
  check('the payment is the holder\'s on the day', r.rows.map((x) => [x.userId, x.commission]), [['u1', 0], ['u2', 300]])
  check('money nobody held earns nobody commission, and is reported', r.unheld, 500)
}

/* 5. PTCs. A R5 000 PTC on 20 Sep: the client owes the firm R1 500 (its share) until it pays on 3 Nov. */
{
  const ptc = pay({ id: 't1', on: '2026-09-20', amount: 5000, ptc: true })
  const ledger = [
    { companyId: 'c1', on: '2026-09-20', amount: -1500 },
    { companyId: 'c1', on: '2026-11-03', amount: 1500 },
  ]
  const L = new Map([['c1', ledger]])
  check('the balance as at a day', [balanceAt(ledger, '2026-10-10'), balanceAt(ledger, '2026-11-10')], [-1500, 0])
  check('owing since the day it started', owingSince(ledger, '2026-10-10'), '2026-09-20')
  check('...and not owing once clear', owingSince(ledger, '2026-11-10'), null)

  const oct = stmt('2026-10', [ptc], L)
  check('October: a PTC on a client who owes is pending', [oct.pending.length, oct.pendingTotal], [1, 150])
  check('...never in Payments', oct.payments.length, 0)
  check('...never released', oct.releasedTotal, 0)
  check('...and NOT in the payable total', oct.payable, 4000)
  check('...with what the client owes and since when', [oct.pending[0]?.owed, oct.pending[0]?.owedSince], [1500, '2026-09-20'])

  const nov = stmt('2026-11', [ptc], L)
  check('November: the client is clear at the close, so it is released in full', [nov.releasedTotal, nov.pending.length], [150, 0])
  check('...and it is payable', nov.payable, 4150)
  check('the release period is November', releasePeriodOf(ptc, ledger, '2027-06'), '2026-11')
  const dec = stmt('2026-12', [ptc], L)
  check('...and it is not paid again in December', [dec.releasedTotal, dec.pendingTotal], [0, 0])

  /* Clear for one afternoon is not clear: back below nought by the close. */
  const flicker = [{ companyId: 'c1', on: '2026-09-20', amount: -1500 }, { companyId: 'c1', on: '2026-10-01', amount: 1500 },
    { companyId: 'c1', on: '2026-10-05', amount: -200 }]
  check('a client clear mid-period but owing at its close is not released', releasePeriodOf(ptc, flicker, '2026-10'), null)

  /* A client already clear (trust money held for them covers it) releases in the PTC's own period. */
  const covered = [{ companyId: 'c1', on: '2026-09-01', amount: 3000 }, { companyId: 'c1', on: '2026-09-20', amount: -1500 }]
  check('a client the firm owes on balance releases at once', stmt('2026-10', [ptc], new Map([['c1', covered]])).releasedTotal, 150)

  const unapproved = pay({ id: 't2', on: '2026-09-20', amount: 5000, ptc: true, approved: null })
  const u = stmt('2026-10', [unapproved], new Map([['c1', []]]))
  check('an unapproved PTC is not released, even on a clear ledger', [u.releasedTotal, u.pendingTotal, u.pending[0]?.waiting],
    [0, 150, 'Waiting for the PTC to be approved.'])

  const blind = stmt('2026-10', [ptc], null)
  check('an unreadable ledger holds everything', [blind.releasedTotal, blind.pendingTotal, blind.ledgerUnread], [0, 150, true])
  check('...and the payable never includes it', blind.payable, 4000)

  /* Reversed after it was released: it comes back in the reversal's period. */
  const late = pay({ id: 't3', on: '2026-09-20', amount: 5000, ptc: true, reversed: '2026-12-02' })
  const decR = stmt('2026-12', [late], L)
  check('a released PTC reversed later is taken back as a negative line', decR.payments.map((l) => [l.kind, l.commission]), [['ptc_reversal', -150]])
  /* Reversed while still waiting: nothing was paid, so nothing comes back; it just leaves the list. */
  const early = pay({ id: 't4', on: '2026-09-20', amount: 5000, ptc: true, reversed: '2026-10-02' })
  const e = stmt('2026-11', [early], L)
  check('a PTC reversed while waiting leaves the list and is never paid', [e.pendingTotal, e.releasedTotal, e.payments.length], [0, 0, 0])
  check('...never released at all', releasePeriodOf(early, ledger, '2027-06'), null)

  /* Every combination: pending is never part of payable. */
  for (const s of [oct, nov, dec, u, blind]) {
    ok(`payable is basic + payments + released, never pending (${s.period.key})`,
      s.payable === cents(s.basic + s.paymentsTotal + s.releasedTotal))
  }
}

/* Non-collections staff: basic only. */
{
  const s = stmt('2026-10', [pay({ id: 'z', on: '2026-09-20', amount: 10000 })], new Map(), 'sales', 9000)
  check('a sales person has no commission scheme yet: basic only', [s.scheme, s.payments.length, s.payable], [false, 0, 9000])
  check('the call centre collects', defaultPayBasis('Pre-legal Agent'), 'collections')
  check('...sales sells', defaultPayBasis('Sales Representative'), 'sales')
  check('...the liaisons are communications', defaultPayBasis('Liaison'), 'communications')
  check('...and an administrator is other', defaultPayBasis('Administrator'), 'other')
}

/* ---------------- 6. the database ---------------- */

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

for (const t of ['employee_profiles', 'employee_profile_history', 'clerk_commission_overrides']) {
  ok(`${t} exists`, tableDef(t).length > 0)
  ok(`${t} has row-level security`, sql.includes(`alter table public.${t} enable row level security;`))
  const ps = policies(t)
  ok(`${t} has policies`, ps.length > 0)
  for (const p of ps) ok(`${t} ${p[1]} asks people.pay`, /public\.has_capability\('people\.pay'\)/.test(p[2]))
  check(`${t} has no removal policy`, ps.filter((p) => p[1] === 'delete' || p[1] === 'all').length, 0)
  ok(`${t} is not anon's`, sql.includes(`revoke all on table public.${t} from anon;`))
}
check('the history and the overrides cannot be edited (no update policy)',
  ['employee_profile_history', 'clerk_commission_overrides'].map((t) => policies(t).some((p) => p[1] === 'update')), [false, false])
check('the history is written by the trigger only (no insert policy)', policies('employee_profile_history').some((p) => p[1] === 'insert'), false)
ok('the profile keeps no ID number or bank details', !/id_number|bank/.test(tableDef('employee_profiles')))
ok('the override names exactly one of client or account', /\(company_id is null\) <> \(account_id is null\)/.test(tableDef('clerk_commission_overrides')))
ok('...and a reason', /reason text not null check \(length\(btrim\(reason\)\) >= 3\)/.test(tableDef('clerk_commission_overrides')))
const stamp = liveFn('clerk_commission_override_stamp')
ok('who and when are the database\'s to write', /new\.set_by := auth\.uid\(\)/.test(stamp) && /new\.set_at := public\.raptor_now\(\)/.test(stamp))
const hist = liveFn('employee_profile_stamp')
ok('every profile field is written to history', /array\['job_title', 'started_on', 'pay_basis', 'basic_salary', 'notes'\]/.test(hist))

const lines = liveFn('clerk_commission_lines')
const ledgers = liveFn('clerk_commission_ledgers')
for (const [name, body] of [['clerk_commission_lines', lines], ['clerk_commission_ledgers', ledgers]]) {
  ok(`${name} is there`, body.length > 0)
  ok(`${name} refuses without people.pay`, /if not public\.has_capability\('people\.pay'\) then\s+raise exception/.test(body))
  ok(`${name} is not anon's`, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon;`).test(sql))
}
ok('the ledger reader reads the client\'s own ledger, not a sum of its own', /public\.client_ledger\(c\)/.test(ledgers))
ok('...and fails closed without the trust or business tick',
  /if not \(public\.has_capability\('finance\.view'\) or public\.has_capability\('business\.view'\)\) then\s+raise exception/.test(ledgers))

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

/* ---------------- 7. the mappers, and where pay is NOT ---------------- */

const api = read('src/lib/peopleApi.ts')
const ret = (/returns table \(([\s\S]*?)\)\s*language/.exec(lines)?.[1] ?? '')
const cols = [...ret.matchAll(/(\w+) (uuid|text|date|numeric|boolean)/g)].map((m) => m[1])
ok('the lines function returns columns', cols.length >= 20)
for (const c of cols) ok(`toCommissionPayment reads ${c}`, api.includes(`r.${c}`))
const profileCols = [...tableDef('employee_profiles').matchAll(/^\s+(\w+) (uuid|text|date|numeric|timestamptz)/gm)].map((m) => m[1])
check('the profile select names every column', (/EMPLOYEE_PROFILE_COLUMNS =\s+'([^']+)'/.exec(api)?.[1] ?? '').split(', '), profileCols)
for (const c of profileCols) ok(`toEmployeeProfile reads ${c}`, api.includes(`r.${c}`))

const company = strip(read('src/pages/CompanyDashboard.tsx'))
ok('pay is never on the company dashboard', !/clerkCommission|peopleApi|PayStatement/.test(company))
ok('the menu item asks people.pay', /n\.to !== '\/people' \|\| canViewPay\(currentUser\)/.test(read('src/components/layout/Sidebar.tsx')))
ok('the route is behind RequirePay', /<Route path="\/people" element=\{<RequirePay><PeopleLayout \/><\/RequirePay>\}>/.test(read('src/App.tsx')))

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-clerk-commission: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
