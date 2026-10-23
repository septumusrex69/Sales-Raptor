/**
 * LEAVE AND THE SIMPLEPAY EXPORT (23 Oct 2026).
 *
 * THE FIRM (Stephan): track leave days per employee, the types of leave and how much each has left.
 * "Me and Camille and any administrator can see the leave. Team leaders can also see the leave of
 * their teams. Leaves can be done in half days or full days." And of payroll: "do the export one
 * first, API later".
 *
 * WHAT THIS HOLDS:
 *   1. The BCEA's figures, each named once (s20, s22, s27).
 *   2. Leave is counted in WORKING days -- weekends and SA public holidays out -- and in half days.
 *   3. The part of a stretch inside a period (the salary month), and cancelled / opening rows are not leave.
 *   4. Accrual: annual 1.25 a completed month, carried forward, from the start date or an opening
 *      balance; sick 1 per 26 worked in the first six months, then 30 a 36-month cycle; family 3 a
 *      year after four months; a leaver stops accruing.
 *   5. Who sees it and who records it, in the browser and in the database, the same lists.
 *   6. The table: RLS, no removal, an update is a cancellation, overlaps refused, cleared on staging.
 *   7. The mapper carries every column; the export's headings live in one constant.
 *   8. Leave is information on the pay statement, never in its sums.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-leave.mjs
 */
import { readFileSync } from 'node:fs'
import {
  ANNUAL_DAYS_PER_YEAR, ANNUAL_PER_MONTH, ANNUAL_WORKED_RATIO, FAMILY_AFTER_MONTHS, FAMILY_DAYS_PER_YEAR, LEAVE_KINDS,
  SICK_CYCLE_MONTHS, SICK_DAYS_PER_CYCLE, SICK_EARLY_MONTHS, SICK_EARLY_RATIO,
  addMonths, annualByDaysWorked, completedMonths, daysWithin, fmtDays, leaveBalances, leaveDays, leaveInPeriod, leaveWords, overlapping,
} from '../../src/lib/leave.ts'
import { SIMPLEPAY_HEADINGS, simplePayCsv, simplePayFilename, simplePayRows } from '../../src/lib/simplePay.ts'
import { LEAVE_TEAM_LEADERS, canRecordLeave, canSeeSomeLeave, canViewLeave, leaveVisibleTo } from '../../src/lib/permissions.ts'
import { NO_ROLE_CAPABILITIES, ROLE_CAPABILITIES } from '../../src/lib/capabilities.ts'
import { ROLE_DEPARTMENTS } from '../../src/lib/departments.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*(--|\/\/).*$/gm, ' ')

let seq = 0
const rec = (o) => ({
  id: `r${++seq}`, userId: 'u1', kind: 'annual', entry: 'taken', startHalf: false, endHalf: false, note: null,
  createdBy: null, createdAt: '2026-01-01T08:00:00Z', cancelledAt: null, cancelledBy: null, cancelReason: null,
  endsOn: o.startsOn, ...o,
})
const bal = (list, kind) => list.find((b) => b.kind === kind)

/* ---------------- 1. the Act's figures ---------------- */

check('annual: 15 working days a year (s20, 21 consecutive days on a five-day week)', ANNUAL_DAYS_PER_YEAR, 15)
check('...accrued 1.25 a month', ANNUAL_PER_MONTH, 1.25)
check('...the alternative is one day per 17 worked (s20(2)(b))', [ANNUAL_WORKED_RATIO, annualByDaysWorked(170), annualByDaysWorked(169)], [17, 10, 9])
check('sick: 30 days a 36-month cycle (s22(2))', [SICK_DAYS_PER_CYCLE, SICK_CYCLE_MONTHS], [30, 36])
check('...1 per 26 worked in the first six months (s22(3))', [SICK_EARLY_RATIO, SICK_EARLY_MONTHS], [26, 6])
check('family responsibility: 3 a year, after four months (s27)', [FAMILY_DAYS_PER_YEAR, FAMILY_AFTER_MONTHS], [3, 4])
check('the kinds are the Act\'s and unpaid', LEAVE_KINDS, ['annual', 'sick', 'family', 'maternity', 'parental', 'adoption', 'commissioning', 'unpaid'])

/* ---------------- 2. working days, half days ---------------- */

const d = (s, e, sh = false, eh = false) => leaveDays({ startsOn: s, endsOn: e ?? s, startHalf: sh, endHalf: eh })
check('a Monday-to-Friday week is 5 days', d('2026-11-02', '2026-11-06').days, 5)
check('Mon 27 Apr - Fri 1 May 2026 is 3: Freedom Day and Workers\' Day are not leave', d('2026-04-27', '2026-05-01').days, 3)
/* Christmas is a Friday and New Year's Day a Friday; the Day of Goodwill falls on Saturday 26 Dec and
   is not moved (only a Sunday holiday moves to the Monday). */
check('Thu 24 Dec 2026 - Mon 4 Jan 2027 is 6: Christmas and New Year out, across the year end', d('2026-12-24', '2027-01-04').days, 6)
check('a fortnight over a weekend is 10', d('2026-11-02', '2026-11-13').days, 10)
check('one day is 1', d('2026-11-03').days, 1)
check('a half day is 0.5', d('2026-11-03', '2026-11-03', true).days, 0.5)
check('from midday Monday to midday Wednesday is 2', d('2026-11-02', '2026-11-04', true, true).days, 2)
check('from midday Monday to Friday is 4.5', d('2026-11-02', '2026-11-06', true).days, 4.5)
ok('a Saturday alone is not leave', d('2026-11-07').days === null && /no working days/.test(d('2026-11-07').problem))
ok('a half day on a public holiday is refused', d('2026-12-16', '2026-12-16', true).days === null)
ok('the last day before the first is refused', d('2026-11-06', '2026-11-02').days === null)
ok('one day cannot be half twice', d('2026-11-03', '2026-11-03', false, true).days === null)
ok('every figure is a half-day step', [d('2026-11-02', '2026-11-06', true, true).days, d('2026-11-03', '2026-11-03', true).days]
  .every((n) => Number.isInteger(n * 2)))

/* ---------------- 3. inside a period ---------------- */

const straddle = rec({ startsOn: '2026-11-23', endsOn: '2026-11-27', startHalf: true, days: 4.5 })
check('a stretch wholly inside counts as recorded', daysWithin(straddle, '2026-10-26', '2026-11-30'), 4.5)
check('...straddling the 25th: Mon(half)-Wed in this salary month', daysWithin(straddle, '2026-10-26', '2026-11-25'), 2.5)
check('...and Thu-Fri in the next', daysWithin(straddle, '2026-11-26', '2026-12-25'), 2)
const inMonth = leaveInPeriod([
  straddle,
  rec({ kind: 'sick', startsOn: '2026-11-10', days: 1 }),
  rec({ kind: 'sick', startsOn: '2026-11-11', days: 1, cancelledAt: '2026-11-12T08:00:00Z', cancelReason: 'Wrong day' }),
  rec({ entry: 'opening', startsOn: '2026-11-01', days: 9 }),
], '2026-10-26', '2026-11-25')
check('leave in a salary month, by kind; cancelled and opening rows are not leave', [inMonth.annual, inMonth.sick, inMonth.family], [2.5, 1, 0])
check('...in words, for the statement', leaveWords(inMonth), 'Annual leave 2.5 days, Sick leave 1 day')
check('days are shown as they are: halves, and quarters on an accrued balance', [fmtDays(2.5), fmtDays(3), fmtDays(12.75)], ['2.5', '3', '12.75'])

check('overlap: a new stretch over a recorded one is found', overlapping([straddle], { userId: 'u1', startsOn: '2026-11-27', endsOn: '2026-11-30' })?.id, straddle.id)
check('...not somebody else\'s', overlapping([straddle], { userId: 'u2', startsOn: '2026-11-27', endsOn: '2026-11-30' }), null)
check('...nor a cancelled one', overlapping([{ ...straddle, cancelledAt: 'x' }], { userId: 'u1', startsOn: '2026-11-27', endsOn: '2026-11-27' }), null)

/* ---------------- 4. accrual and balances ---------------- */

check('months: the 31st into February is its last day', addMonths('2026-01-31', 1), '2026-02-28')
check('a month is completed at the end of the day before the same date', [completedMonths('2026-01-15', '2026-02-13'), completedMonths('2026-01-15', '2026-02-14')], [0, 1])

const B = (o) => leaveBalances({ startDate: '2026-01-15', records: [], asAt: '2027-01-14', ...o })
check('annual: a year\'s service accrues 15', bal(B({}), 'annual').entitled, 15)
check('...a month\'s, 1.25', bal(B({ asAt: '2026-02-14' }), 'annual').entitled, 1.25)
check('...less leave taken and booked', (() => {
  const b = bal(B({ asAt: '2026-08-20', records: [rec({ startsOn: '2026-06-01', endsOn: '2026-06-03', startHalf: true, days: 2.5 }), rec({ startsOn: '2026-09-07', days: 1 })] }), 'annual')
  return [b.entitled, b.taken, b.booked, b.left]
})(), [8.75, 2.5, 1, 5.25])
check('...carried forward: two years is 30 with nothing taken', bal(B({ asAt: '2028-01-14' }), 'annual').left, 30)
check('...from an opening balance, years before it are not counted',
  (() => {
    const b = bal(leaveBalances({ startDate: '2014-03-01', asAt: '2026-05-31', records: [
      rec({ entry: 'opening', startsOn: '2026-03-01', days: 10.75 }),
      rec({ startsOn: '2025-12-01', days: 3 }),
      rec({ startsOn: '2026-04-01', days: 2 }),
    ] }), 'annual')
    return [b.entitled, b.taken, b.left]
  })(), [14.5, 2, 12.5])
check('...a leaver stops accruing at the end date', bal(B({ endedOn: '2026-07-14', asAt: '2027-01-14' }), 'annual').entitled, 7.5)
ok('...no start date: nothing accrues, and it says so', bal(leaveBalances({ startDate: null, records: [], asAt: '2026-11-01' }), 'annual').entitled === null
  && /Start date not set/.test(bal(leaveBalances({ startDate: null, records: [], asAt: '2026-11-01' }), 'annual').words))

/* Sick: 5 Jan to 31 Mar 2026 is 20 + 20 + 22 = 62 working days (Human Rights Day is a Saturday). */
check('sick, first six months: one day per 26 worked (62 worked -> 2)', bal(leaveBalances({ startDate: '2026-01-05', records: [], asAt: '2026-03-31' }), 'sick').entitled, 2)
check('...after six months, 30 in the cycle', bal(leaveBalances({ startDate: '2026-01-05', records: [], asAt: '2026-07-06' }), 'sick').entitled, 30)
check('...days taken in the first six months come off the first cycle (s22(4))',
  bal(leaveBalances({ startDate: '2026-01-05', asAt: '2026-08-01', records: [rec({ kind: 'sick', startsOn: '2026-03-02', days: 2 })] }), 'sick').left, 28)
check('...a new cycle starts at 36 months and the old one\'s days are gone',
  (() => {
    const b = bal(leaveBalances({ startDate: '2023-01-05', asAt: '2026-02-01', records: [rec({ kind: 'sick', startsOn: '2025-06-02', days: 5 })] }), 'sick')
    return [b.cycle.from, b.cycle.to, b.left]
  })(), ['2026-01-05', '2029-01-04', 30])
check('family: nothing until four months are behind them ("longer than four months")', bal(leaveBalances({ startDate: '2026-07-01', records: [], asAt: '2026-10-31' }), 'family').entitled, 0)
check('...then 3', bal(leaveBalances({ startDate: '2026-07-01', records: [], asAt: '2026-11-01' }), 'family').entitled, 3)
check('...and it resets each year of service',
  bal(leaveBalances({ startDate: '2024-07-01', asAt: '2026-07-02', records: [rec({ kind: 'family', startsOn: '2026-06-01', days: 2 })] }), 'family').left, 3)
check('maternity and its relatives have no pot, only the statute in words',
  ['maternity', 'parental', 'adoption', 'commissioning', 'unpaid'].map((k) => bal(B({}), k).left), [null, null, null, null, null])

/* ---------------- 5. who sees, who records ---------------- */

const U = (id, role, teamId, grants = []) => ({ id, role, teamId, grants, revokes: [] })
const all = [U('a', 'Pre-legal Agent', 't1'), U('b', 'Pre-legal Agent', 't2'), U('l', 'Pre-legal Team Leader', 't1'),
  U('s', 'Sales Representative', 't3'), U('sm', 'Sales Manager', 't3'), U('x', 'Liaison', null)]
const ids = (me) => leaveVisibleTo(me, all).map((u) => u.id).sort()
check('an Administrator sees everybody', ids(U('ad', 'Administrator', null)).length, all.length)
check('a people.pay holder of any role sees everybody ("me and Camille")', ids(U('c', 'Read Only', null, ['people.pay'])).length, all.length)
check('a team leader sees their own team only', ids(all[2]), ['a', 'l'])
check('...a sales manager theirs', ids(all[4]), ['s', 'sm'])
check('...a leader with no team, nobody', ids(U('l2', 'Pre-legal Team Leader', undefined)), [])
check('the call centre manager sees the call centre', ids(U('ccm', 'Call Centre Manager', undefined)), ['a', 'b', 'l'])
check('a collector sees nobody', ids(all[0]), [])
check('a revoked Administrator sees nobody', ids({ ...U('ad', 'Administrator', null), revokes: ['people.leave'] }), [])
ok('only an Administrator with the tick records', canRecordLeave(U('ad', 'Administrator', null))
  && !canRecordLeave(U('r', 'Read Only', null, ['people.leave'])) && !canRecordLeave(all[2])
  && !canRecordLeave({ ...U('ad', 'Administrator', null), revokes: ['people.leave'] }))
ok('...a grant of people.leave lets somebody else see it', canViewLeave(U('r', 'Read Only', null, ['people.leave'])))
ok('the menu shows for a leader with a team, not one without', canSeeSomeLeave(all[2]) && !canSeeSomeLeave(U('l2', 'Pre-legal Team Leader', undefined)))
ok('people.leave is in the Administrator\'s template and no other role\'s',
  ROLE_CAPABILITIES.Administrator.includes('people.leave') && !NO_ROLE_CAPABILITIES.includes('people.leave')
  && Object.entries(ROLE_CAPABILITIES).every(([r, c]) => r === 'Administrator' || !c.includes('people.leave')))

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

const def = tableDef('leave_records')
ok('leave_records exists', def.length > 0)
ok('...with row-level security', sql.includes('alter table public.leave_records enable row level security;'))
ok('...not anon\'s', sql.includes('revoke all on table public.leave_records from anon;'))
const ps = policies('leave_records')
check('...three policies: read, record, cancel', ps.map((p) => p[1]).sort(), ['insert', 'select', 'update'])
ok('...read by leave_visible', ps.some((p) => p[1] === 'select' && /public\.leave_visible\(user_id\)/.test(p[2])))
ok('...written by may_record_leave only', ps.filter((p) => p[1] !== 'select').every((p) => /public\.may_record_leave\(\)/.test(p[2])))
check('...and never removed', ps.filter((p) => p[1] === 'delete' || p[1] === 'all').length, 0)
ok('taken leave is in half-day steps; an opening balance may be a quarter day',
  /add constraint leave_records_half_days\s+check \(entry = 'opening' or days \* 2 = trunc\(days \* 2\)\);/.test(sql)
  && /alter table public\.leave_records alter column days type numeric\(6, 2\);/.test(sql))
ok('...never more days than the calendar covers, one day never half twice',
  /days <= \(ends_on - starts_on \+ 1\) and not \(starts_on = ends_on and end_half\)/.test(def))
ok('...an opening balance is annual, on one day', /entry = 'opening' and kind = 'annual' and starts_on = ends_on/.test(def))
const kindsInSql = (/kind text not null check \(kind in \(([^)]*)\)\)/.exec(def)?.[1] ?? '').split(',').map((x) => x.trim().replace(/'/g, ''))
check('the database\'s kinds are the browser\'s', kindsInSql, LEAVE_KINDS)

const vis = liveFn('leave_visible')
ok('leave_visible asks people.leave and people.pay', /has_capability\('people\.leave'\)/.test(vis) && /has_capability\('people\.pay'\)/.test(vis))
const leadersSql = (/me\.role in \(([^)]*)\)/.exec(vis)?.[1] ?? '').split(',').map((x) => x.trim().replace(/'/g, '')).sort()
check('...its team leaders are the browser\'s', leadersSql, [...LEAVE_TEAM_LEADERS].sort())
ok('...a leader with no team leads nobody', /me\.team_id is not null and them\.team_id = me\.team_id/.test(vis))
const ccm = (/me\.role = 'Call Centre Manager'\s+and them\.role in \(([^)]*)\)/.exec(vis)?.[1] ?? '').split(',').map((x) => x.trim().replace(/'/g, '')).sort()
check('...the call centre manager reaches exactly the call centre roles', ccm,
  Object.entries(ROLE_DEPARTMENTS).filter(([, dep]) => dep === 'Call centre').map(([r]) => r).sort())
ok('may_record_leave asks the tick AND the Administrator', /has_capability\('people\.leave'\) and public\.current_user_role\(\) = 'Administrator'/.test(liveFn('may_record_leave')))
for (const fn of ['leave_visible', 'may_record_leave', 'leave_record_stamp']) {
  ok(`${fn} is security invoker with a search path`, /security invoker\s+set search_path to 'public'/.test(liveFn(fn)))
}
for (const fn of ['leave_visible(uuid)', 'may_record_leave()']) ok(`${fn} is not anon's`, sql.includes(`revoke all on function public.${fn} from public, anon;`))
const stamp = strip(liveFn('leave_record_stamp'))
ok('who and when are the database\'s to write', /new\.created_by := auth\.uid\(\)/.test(stamp) && /new\.cancelled_by := auth\.uid\(\)/.test(stamp))
ok('an overlap is refused', /r\.starts_on <= new\.ends_on and new\.starts_on <= r\.ends_on/.test(stamp))
ok('an update is a cancellation: any other change is refused', /is distinct from[\s\S]*Leave is not edited/.test(stamp))
ok('...with a reason, once', /Say why the leave is cancelled/.test(stamp) && /already cancelled/.test(stamp))
ok('clear_staging empties the leave records', /public\.leave_records'/.test(liveFn('clear_staging')))
ok('people.leave is in the database\'s Administrator template', /when 'Administrator' then array\[[^\]]*'people\.leave'/.test(liveFn('role_capabilities')))
ok('the employee number is written to the pay history', /'employee_number'\]/.test(liveFn('employee_profile_stamp')))

/* ---------------- 7. the mapper, the export ---------------- */

const api = read('src/lib/peopleApi.ts')
const cols = [...def.matchAll(/^\s+(\w+) (uuid|text|date|numeric|boolean|timestamptz)/gm)].map((m) => m[1])
check('LEAVE_COLUMNS names every column of the table', (/LEAVE_COLUMNS =\s+'([^']+)'/.exec(api)?.[1] ?? '').split(', '), cols)
for (const c of cols) ok(`toLeaveRecord reads ${c}`, api.includes(`r.${c}`))
ok('...and the query selects exactly that list', api.includes(`.select('${cols.join(', ')}')`))

const people = [
  { name: 'Thandi', email: 't@raptor.test', employeeNumber: 'E007', basic: 3652.17, commission: 450,
    leave: { annual: 2.5, sick: 1, family: 0, maternity: 0, parental: 0, adoption: 0, commissioning: 0, unpaid: 0 } },
  { name: 'Smit, Jan "JJ"', email: 'j@raptor.test', employeeNumber: null, basic: 12000, commission: 0,
    leave: { annual: 0, sick: 0, family: 0, maternity: 0, parental: 0, adoption: 0, commissioning: 0, unpaid: 3 } },
]
const csv = simplePayCsv(people)
const lines = csv.split('\r\n')
check('the export\'s heading row is SIMPLEPAY_HEADINGS, in order', lines[0], Object.values(SIMPLEPAY_HEADINGS).join(','))
check('...a leave column for every kind', Object.keys(SIMPLEPAY_HEADINGS).filter((k) => k.startsWith('leave_')).length, LEAVE_KINDS.length)
check('...amounts plain (no R, no separator), leave to the half day', lines[1], 'E007,Thandi,t@raptor.test,3652.17,450.00,2.5,1,0,0,0,0,0,0')
check('...a name with a comma and quotes is quoted', lines[2].split(',"')[0] + ',"' + lines[2].split(',"')[1].split('",')[0] + '"', ',"Smit, Jan ""JJ"""')
check('...unpaid leave in its own column', simplePayRows(people)[1].leave_unpaid, '3')
check('...one line a person, and a closing line break', lines.length, 4)
check('the file is named for the pay day', simplePayFilename('2026-11'), 'simplepay-2026-11.csv')
const spSrc = read('src/lib/simplePay.ts')
ok('the headings live in one constant and say the template is still to come', /SIMPLEPAY_HEADINGS = \{/.test(spSrc) && /has not yet supplied/.test(spSrc))
const month = read('src/pages/people/PeopleMonth.tsx')
ok('the Month summary exports the summary\'s own figures', /basic: r\.basic, commission: r\.commission/.test(month) && /simplePayCsv\(result\.rows\.map/.test(month))
ok('...with leave in the salary month', /const m = salaryMonth\(periodKey\)[\s\S]*leaveInPeriod\(leave\.filter/.test(month))
ok('...and the button is on it', /Export for SimplePay/.test(month))

/* ---------------- 8. information, not pay ---------------- */

const view = strip(read('src/components/people/PayStatementView.tsx'))
ok('the statement draws the leave line', /data-testid="statement-leave"/.test(view) && /does not change the figures above/.test(view))
const payMaths = strip(read('src/lib/clerkCommission.ts'))
ok('the pay arithmetic does not read leave', !/leave\.ts|leaveIn|LeaveRecord/.test(payMaths))
const leavePage = strip(read('src/pages/people/PeopleLeave.tsx'))
ok('the Leave page shows no pay', !/fetchEmployeeProfiles|basicSalary|clerk_commission|fetchCommissionPayments/.test(leavePage))
ok('...and draws the recording form only for canRecordLeave', /mayRecord && records && \(/.test(leavePage) && /const mayRecord = canRecordLeave\(currentUser\)/.test(leavePage))

if (failures.length) {
  console.log(failures.map((f) => `  FAIL ${f}`).join('\n'))
}
console.log(`check-leave: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
