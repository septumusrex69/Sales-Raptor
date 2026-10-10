/**
 * THE STAGING CLOCK (prompt 10): several months of Raptor tested in one afternoon, and production
 * provably unchanged.
 *
 * Held here:
 *   1. raptor_now() / raptor_today() ARE now() and Johannesburg's day unless the deployment row says
 *      staging AND a clock row exists -- and the clock row cannot be written unless it says staging;
 *   2. every business function reads the clock: the only functions left on the real clock are a
 *      named list of audit stamps and real-world expiries, so a new now() anywhere else fails here;
 *   3. the jump goes forward only, a day at a time, closes the cycle on the 11th, and is logged;
 *      Clear staging is the only way back, behind three locks;
 *   4. a statement cannot be dated after today, in the database and before the upload;
 *   5. the server asks the database what day it is, and a jump records due steps as skipped
 *      rather than sending them;
 *   6. the browser reads the clock once per page load, before any page draws, and decides dates
 *      from it -- `new Date()` survives only in a named list of files that stamp the real world;
 *   7. the pure arithmetic: jump days, the three buttons' targets, the banner's sentence.
 *
 * The live half -- the clock moving on staging, a cycle closing on the jump, production's answer
 * being now() -- is scripts/qa/live/staging-clock-probe.sql.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-staging-clock.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyClock, bannerLine, clockNow, clockToday, daysAfter, firmClockState, jumpDays, jumpTargets,
  resetClock,
} from '../../src/lib/clock.ts'
import { firstLineAfter } from '../../src/lib/bankStatement.ts'
import { exceptionsOf, splitForBatch } from '../../src/lib/paymentsQueue.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const no = (name, actual) => check(name, actual, false)
const root = new URL('../../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const stripTs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const sql = read('supabase/schema.sql')
const lower = sql.toLowerCase()
/* THE LAST DEFINITION, anchored on the full phrase (HANDOFF.md: a bare name lands on a grant). */
const lastFn = (name) => {
  const at = lower.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return { head: '', body: '' }
  const m = /\bas\s+\$(\w*)\$([\s\S]*?)\$\1\$/i.exec(sql.slice(at))
  return { head: sql.slice(at, at + (m ? m.index : 0)), body: strip(m?.[2] ?? '') }
}

/* ---------- 1. production is now(), and cannot be anything else ---------- */

const today = lastFn('raptor_today').body
const nowFn = lastFn('raptor_now').body
ok('raptor_today reads the clock row only where the deployment says staging',
  /select c\.business_date from public\.staging_clock c\s+where exists \(select 1 from public\.deployment d where d\.kind = 'staging'\)/.test(today))
ok('...and is otherwise Johannesburg\'s day', /\(now\(\) at time zone 'Africa\/Johannesburg'\)::date\)/.test(today))
ok('raptor_now is the staging day at the real time of day, only on staging with a clock set',
  /when exists \(select 1 from public\.deployment d where d\.kind = 'staging'\)\s+and exists \(select 1 from public\.staging_clock\)/.test(nowFn)
  && /\(now\(\) at time zone 'Africa\/Johannesburg'\)::time/.test(nowFn))
ok('...and otherwise now(), exactly', /else now\(\)\s+end/.test(nowFn))
const guardTrig = lastFn('staging_clock_only_on_staging').body
ok('the clock row cannot be written unless the deployment says staging',
  /if not exists \(select 1 from public\.deployment where kind = 'staging'\) then\s+raise exception/.test(guardTrig)
  && /create or replace trigger staging_clock_only_on_staging\s+before insert or update on public\.staging_clock/.test(sql))
ok('the clock table has one row at most', /create table if not exists public\.staging_clock \(\s+id boolean primary key default true check \(id\)/.test(sql))
no('...and nobody writes it through a policy', /create policy \w+ on public\.staging_clock\s+for (insert|update|delete|all)/.test(sql))

/* ---------- 2. every business function reads the clock ---------- */

const names = new Set([...sql.matchAll(/create or replace function public\.(\w+)\(/gi)].map((m) => m[1].toLowerCase()))
const stillReal = []
for (const n of names) {
  const { head, body } = lastFn(n)
  if (/(?<![\w.])now\(\)|\bcurrent_date\b|current_timestamp/i.test(body) || /default now\(\)/i.test(head)) stillReal.push(n)
}
/*
 * THE ONLY FUNCTIONS LEFT ON THE REAL CLOCK, and why: updated_at stamps (the protect_* pair,
 * touch_message_template, set_trust_opening_balance's updated_at), published_at (configuration),
 * a signing link's expiry (the real world's), and the clock's own machinery. A new function that
 * reads now() for a business date fails here -- write raptor_now() / raptor_today() instead.
 */
check('only the named audit and real-world functions read the real clock', stillReal.sort(), [
  'clear_staging', 'protect_approved_handover_draft', 'protect_approved_handover_draft_row',
  'raptor_clock', 'raptor_now', 'raptor_today', 'set_trust_opening_balance', 'signing_document',
  'signing_open', 'signing_sign', 'step_staging_clock', 'touch_message_template', 'workflow_publish',
])
ok('...and set_trust_opening_balance only for its updated_at',
  !/(?<![\w.])now\(\)/.test(lastFn('set_trust_opening_balance').body.replace(/updated_at = now\(\)/, '')))
ok('approval stamps the business day and moment', /set approved_at = public\.raptor_now\(\)[\s\S]*allocated_on = public\.raptor_today\(\)/.test(lastFn('approve_payment').body))
ok('the open cycle is the clock\'s', /public\.payover_cycle_start\(public\.raptor_now\(\)\)/.test(lastFn('payover_cycle_now').body))
ok('a run cannot be approved before the clock\'s cycle has ended', /if v_end >= public\.raptor_today\(\)/.test(lastFn('approve_payover_run').body))
ok('a withdrawal is dated on the clock', /ended_on = public\.raptor_today\(\)/.test(lastFn('withdraw_account').body))
ok('a client charge defaults to the clock\'s day', /coalesce\(p_raised_on, public\.raptor_today\(\)\)/.test(lastFn('raise_client_charge').body))
ok('Mark paid defaults to the clock', /p_paid_at timestamptz default public\.raptor_now\(\)/.test(lastFn('mark_payover_run_paid').head))
/* created_at is a real stamp the clock cannot move; the cycle is allocated_on (be1e03b). */
ok('the cycle tiles cut on allocated_on, not created_at',
  /p\.allocated_on >= b\.s and p\.allocated_on <= public\.payover_cycle_end\(b\.s\)/.test(lastFn('payover_cycle_tiles').body)
  && !/created_at/.test(lastFn('payover_cycle_tiles').body))
ok('...and so does Build for another cycle', !/created_at/.test(lastFn('payover_buildable').body))
for (const [table, column, fn] of [
  ['account_payments', 'received_at', 'raptor_now'], ['client_charges', 'raised_on', 'raptor_today'],
  ['trust_creditor_entries', 'entry_at', 'raptor_now'], ['account_fees', 'incurred_at', 'raptor_now'],
  ['business_expenses', 'incurred_on', 'raptor_today'], ['payment_allocations', 'computed_at', 'raptor_now'],
]) {
  ok(`${table}.${column} defaults to the clock`,
    sql.includes(`alter table public.${table} alter column ${column} set default public.${fn}();`))
}

/* ---------- 3. the jump, and the only way back ---------- */

const guard = lastFn('staging_clock_guard').body
ok('only an Administrator, only on staging', /kind = 'staging'/.test(guard) && /current_user_role\(\) is distinct from 'Administrator'/.test(guard))
const begin = lastFn('begin_staging_clock_jump').body
ok('a jump goes forward only', /if p_to <= v_from then\s+raise exception 'The staging clock only goes forward/.test(begin))
ok('...and is logged in finance_setting_changes',
  /insert into public\.finance_setting_changes \(setting, old_value, new_value, reason, changed_by\)\s+values \('staging_clock'/.test(begin))
const step = lastFn('step_staging_clock').body
ok('the clock moves exactly one day at a time', /if p_day is distinct from v_today \+ 1 then\s+raise exception/.test(step))
ok('...guarded', /perform public\.staging_clock_guard\(\)/.test(step))
ok('on the 11th the cycle that just ended closes, as pg_cron would', /if extract\(day from p_day\) = 11 then\s+v_closed := public\.close_payover_cycle\(public\.payover_cycle_start\(p_day::timestamp at time zone 'Africa\/Johannesburg' - interval '1 day'\)\)/.test(step))
ok('...and the runs are refreshed, as opening the queue would', /v_refreshed := public\.refresh_payover_runs\(\)/.test(step))
const clear = lastFn('clear_staging').body
ok('Clear staging needs the words typed', /if p_confirm is distinct from 'CLEAR STAGING' then\s+raise exception/.test(clear))
ok('...is guarded', /perform public\.staging_clock_guard\(\)/.test(clear))
ok('...empties the money in one statement', /'trunc' \|\| 'ate table public\.client_business_receipts, public\.payover_run_sends, public\.payover_run_lines, public\.payover_runs, '/.test(clear))
ok('...clears the trust opening balance it described', /set trust_opening_balance = null, trust_opening_date = null/.test(clear))
ok('...and starts the clock on the day picked', /set business_date = p_start/.test(clear))
no('...and never touches people, templates or mailboxes',
  /from public\.(profiles|message_templates|user_emails|workflow_versions|workflow_nodes|firm_settings)\b'?\s*;?$/m.test(clear.replace(/update public\.firm_settings/, '')))

/* ---------- 4. a statement cannot run ahead of the clock ---------- */

ok('the database refuses a statement with a line after today',
  /filter \(where \(l->>'date'\)::date > public\.raptor_today\(\)\)[\s\S]{0,200}raise exception 'That statement has a line dated %, after today/.test(lastFn('import_bank_lines').body))
check('the first late line is found', firstLineAfter([{ date: '2026-07-09' }, { date: '2026-07-14' }, { date: '2026-07-12' }], '2026-07-11'), { date: '2026-07-12' })
check('...a line ON today is not late', firstLineAfter([{ date: '2026-07-11' }], '2026-07-11'), null)
ok('the browser asks before uploading', /const late = firstLineAfter\(input\.lines, clockToday\(\)\)/.test(stripTs(read('src/lib/payover.ts'))))

/* ---------- 4b. money on a closed account is flagged (the simulation's third cycle) ---------- */

const row = {
  paymentId: 'p1', client: 'Sim Alpha', receivedOn: '2026-08-27', amount: 300, paidToClient: false,
  toInterest: 0, toCosts: 0, toReceiptFees: 0, toFees: 0, receiptFee: 0, receiptFeeVat: 0, toCapital: 300,
  capitalBefore: 1000, capitalAfter: 700, excess: 0, commission: 60, commissionVat: 9, commissionRate: 0.2,
  toClient: 231, dueToBf: 0, hasRate: true, interestCant: 0, rfCant: 0, feesCant: 0, cameBackFrom: null,
}
const flagged = exceptionsOf(row, [], null, { as: 'written_off', on: '2026-08-20' }).find((e) => e.key === 'closed_account')
check('a payment on a closed account is badged', flagged?.label ?? null, 'Account closed')
ok('...saying how and when it closed', /written off on 2026-08-20/.test(flagged?.detail ?? ''))
ok('...as something to check', flagged?.warn === true)
no('an open account is not badged', exceptionsOf(row, []).some((e) => e.key === 'closed_account'))
check('it is held out of Approve all', JSON.stringify(splitForBatch([
  { row, problems: [], exceptions: [flagged] }, { row: { ...row, paymentId: 'p2' }, problems: [], exceptions: [] },
])), JSON.stringify({ clean: ['p2'], held: ['p1'] }))

/* ---------- 5. the server ---------- */

const clockRoute = stripTs(read('api/_lib/workflow/clock.ts'))
ok('the server asks the database what day it is', /admin\.rpc\('raptor_clock'\)/.test(clockRoute))
for (const f of ['run', 'start', 'release', 'advance']) {
  const t = stripTs(read(`api/_lib/workflow/${f}.ts`))
  ok(`${f}.ts takes the firm's day from the database`, /await firmClock\(admin\)/.test(t) && !/todayInJohannesburg\(\)/.test(t))
}
ok('the jump refuses anything but the staging database, before the caller is looked up',
  clockRoute.indexOf('isStagingDatabase(process.env.VITE_SUPABASE_URL)') >= 0
  && clockRoute.indexOf('isStagingDatabase(process.env.VITE_SUPABASE_URL)') < clockRoute.indexOf('requireCaller('))
ok('...calls the database as the person who pressed it', /global: \{ headers: \{ Authorization: req\.headers\.authorization/.test(clockRoute))
ok('...walks the days in order, the clock first, then that morning\'s sweep',
  /for \(const day of jumpDays\(today, to\)\)/.test(clockRoute)
  && clockRoute.indexOf("as.rpc('step_staging_clock'") < clockRoute.indexOf('await sweep(admin, { accountIds: [], today: day, now, skipSends: true'))
const stepTs = stripTs(read('api/_lib/workflow/step.ts'))
const skipAt = stepTs.indexOf('if (options.skipSends)')
ok('a jump records a due step as skipped', skipAt > 0 && /state: 'skipped'/.test(stepTs.slice(skipAt, skipAt + 400)))
ok('...before anything is sent or charged', skipAt > 0 && skipAt < stepTs.indexOf('await sendSms(') && skipAt < stepTs.indexOf('chargeItemWith('))
ok('a skipped email does not hold its SMS', /priorRes\.data\?\.state === 'sent' \|\| priorRes\.data\?\.state === 'skipped'/.test(stepTs))
ok('the step state allows skipped', /check \(state in \('pending', 'held', 'sent', 'cancelled', 'failed', 'skipped'\)\)/.test(sql))

/* ---------- 6. the browser ---------- */

const layout = stripTs(read('src/components/layout/AppLayout.tsx'))
ok('the layout reads the clock once, on mount', /void loadClock\(\)\.then/.test(layout) && /\}, \[\]\)/.test(layout))
ok('...and draws no page until it has', /\{clockRead \? <Outlet \/> : null\}/.test(layout))
ok('...with the banner above every page', /<StagingClockBar clock=\{clock\} \/>/.test(layout))
const bar = stripTs(read('src/components/layout/StagingClockBar.tsx'))
ok('the controls are an Administrator\'s', /const isAdmin = currentUser\?\.role === 'Administrator'/.test(bar) && /\{isAdmin && !busy && \(/.test(bar))
ok('...and a landed jump reloads the page, so the new day is read', /window\.location\.reload\(\)/.test(bar))

/*
 * NEVER new Date() FOR A DATE DECISION. These files keep the machine's clock on purpose: timers
 * (idle sign-out, a call's timeout), ids and file stamps, and the real world's stamps (a mailbox, an
 * email read, a reminder's alarm, updated_at). Anything else that needs "now" uses lib/clock.
 */
const ALLOWED = new Set([
  'src/lib/clock.ts', 'src/components/auth/IdleTimeout.tsx', 'src/components/settings/SignatureEditor.tsx',
  'src/components/NewVersionWatcher.tsx', 'src/data/mockData.ts', 'src/lib/firmSettings.ts',
  'src/lib/accountEmails.ts', 'src/lib/workflowStore.ts', 'src/lib/remittanceEmail.ts', 'src/lib/userMail.ts',
  'src/lib/mailReadState.ts', 'src/lib/templateLibrary.ts', 'src/lib/letterheads.ts', 'src/lib/reminders.ts',
  'src/lib/reminderTime.ts', 'src/lib/calendarEvents.ts', 'src/pages/mail/MailPage.tsx',
  'src/pages/settings/SettingsPage.tsx', 'src/store/AppStore.tsx', 'src/lib/swordfishImport.ts',
  'src/lib/accountQueries.ts', 'src/pages/accounts/CallButton.tsx', 'src/pages/accounts/AccountDetail.tsx',
])
const walk = (dir) => readdirSync(new URL(dir, root)).flatMap((n) => {
  const p = join(dir, n)
  return statSync(new URL(p, root)).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []
})
const offenders = walk('src').filter((f) => !ALLOWED.has(f)
  && /new Date\(\)|Date\.now\(\)/.test(stripTs(read(f))))
check('no other file reads the machine\'s clock', offenders, [])
/* The allowed files' remaining reads are the real-world ones, counted so a new one is looked at. */
const realReads = [...ALLOWED].filter((f) => f !== 'src/lib/clock.ts')
  .reduce((n, f) => n + (stripTs(read(f)).match(/new Date\(\)|Date\.now\(\)/g) ?? []).length, 0)
check('...and the allowed files keep exactly their real-world reads', realReads, 48)

/* ---------- 7. the arithmetic ---------- */

check('a jump walks every day after today up to and including the target',
  jumpDays('2026-06-28', '2026-07-02'), ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02'])
check('...and nothing when the target is not ahead', jumpDays('2026-07-02', '2026-07-02'), [])
check('from the 10th, the 11th is tomorrow and the 10th a month on',
  jumpTargets('2026-06-10'), { plusOne: '2026-06-11', toEleventh: '2026-06-11', toTenth: '2026-07-10' })
check('from the 11th, the next 11th is next month', jumpTargets('2026-07-11').toEleventh, '2026-08-11')
check('...across a year end', jumpTargets('2026-12-20'), { plusOne: '2026-12-21', toEleventh: '2027-01-11', toTenth: '2027-01-10' })
check('daysAfter crosses a month', daysAfter('2026-06-30', 1), '2026-07-01')

resetClock()
check('no clock read: no banner', bannerLine(firmClockState()), null)
check('production: no banner', bannerLine({ businessNow: '2026-10-10T14:00:00Z', businessToday: '2026-10-10', realNow: '2026-10-10T14:00:00Z', realToday: '2026-10-10', staging: false, moved: false }), null)
const staged = { businessNow: '2026-07-11T08:00:00Z', businessToday: '2026-07-11', realNow: '2026-10-10T08:00:00Z', realToday: '2026-10-10', staging: true, moved: true }
check('staging: the firm\'s sentence', bannerLine(staged), 'Staging date 11 Jul 2026 (real date 10 Oct 2026)')
applyClock(staged, new Date('2026-10-10T08:00:00Z').getTime())
const drift = Math.abs(clockNow().getTime() - (new Date('2026-07-11T08:00:00Z').getTime() + (Date.now() - new Date('2026-10-10T08:00:00Z').getTime())))
ok('the app\'s now is the business moment, with the real time of day still running', drift < 5000)
/* A morning in Johannesburg that is still the previous day in UTC is the firm's day, not UTC's. */
applyClock({ ...staged, businessNow: '2026-07-10T23:30:00Z' }, Date.now())
check('clockToday is Johannesburg\'s day', clockToday(), '2026-07-11')
resetClock()

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-staging-clock: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
