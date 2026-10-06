/**
 * THE TRUST, SPLIT BY THE PAYOVER EACH PART OF IT IS WAITING FOR.
 *
 * THE FIRM, LOOKING AT AN OVERVIEW THAT GAVE ONE FIGURE PER PARTY: "it should reflect everything
 * that is currently in the trust. How much money is currently in the trust? And what is for this
 * month's payover? And what is for next month's payover? ... if we're on the 6th of October, the
 * money for last month that was running from the 10th of August to the 11th of September has not
 * been paid out on the 11th of October. So that money's in there. Plus, money from the 11th of
 * September to the 6th of October is in there as well."
 *
 * WHAT THIS GUARDS:
 *
 * 1. EVERY ENTRY LANDS IN EXACTLY ONE CYCLE, AND THE RUN DECIDES IT FIRST. The negative entry that
 *    pays a cycle out must land in the SAME bucket as the positives it cancels, or a settled cycle
 *    hangs about for ever as a credit in whichever month the EFT happened to clear and the one
 *    still owing is buried under it. The order of that coalesce is the correctness of the whole
 *    function, so it is read out of the source rather than trusted.
 *
 * 2. THE BUCKETS SUM TO THE POSITION. The bands and the control block on one screen are the same
 *    money read twice, and two arithmetics for one trust balance is the drift the payover engine
 *    was centralised to avoid. Clients to owed_to_clients, debtors to owed_to_debtors, and the
 *    firm's TWO columns together to owed_to_firm.
 *
 * 3. THE FIRM'S COLUMN IS SPLIT, AND NOT COSMETICALLY. `firm_earned` is what a cycle's receipts
 *    earned; `firm_moved` is a drawing to the business account or a correction, made against the
 *    whole pot rather than a month. One column for both and the month somebody drew reads as a
 *    month the firm earned nothing.
 *
 * 4. THE PAY-OVER DATE IS A SETTING, BECAUSE RAPTOR GUESSED IT. The firm's sentence puts the
 *    11 Aug - 10 Sep money out on the 11th of OCTOBER, a month after it closed rather than the day
 *    after. That is a date the firm promises a client their money, so it reads firm_settings.
 *
 * 5. NO `Date` PARSES A POSTGRES DATE. `new Date('2026-10-11')` is UTC midnight, which in
 *    Johannesburg is two in the morning and in Honolulu is the 10th -- and a cycle boundary is
 *    exactly where that costs a day.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trust-cycles.mjs
 */
import { readFileSync } from 'node:fs'
import {
  cycleLabel, cycleProgress, cycleState, cycleTodo, cycleTotals, daysBetween, shortDate,
} from '../../src/lib/trustCycles.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const no = (name, actual) => check(name, actual, false)

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/schema.sql')

/* schema.sql is APPEND-ONLY, so the LAST definition is the live one -- and the opening paren is
   part of the pattern, or the name also matches its own grant, revoke and comment. */
function liveBody(name) {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return null
  const opens = sql.indexOf('as $$', at)
  const ends = sql.indexOf('$$;', opens)
  return opens < 0 || ends < 0 ? null : sql.slice(opens, ends)
}

/* ------------------- 1. one cycle per entry, the run first ------------------- */

const byCycle = liveBody('trust_by_cycle')
ok('trust_by_cycle is in schema.sql', !!byCycle)

/*
 * THE COALESCE, READ IN ORDER. Asserted as one pattern rather than four presence checks: four
 * would pass on a function that had them in the wrong order, and the order is the whole point --
 * the run before the receipt, the receipt before its allocation's receipt, and the entry date
 * last.
 */
ok('the run decides the cycle before anything else does',
  /coalesce\(\s*r\.period_start,\s*public\.payover_cycle_start\(p\.created_at\),\s*public\.payover_cycle_start\(ap\.created_at\),\s*public\.payover_cycle_start\(e\.entry_at\)\)/
    .test(byCycle ?? ''))

/* AND THE THREE JOINS THAT MAKE THOSE REACHABLE. A coalesce naming a column no join brings in is
   a null that silently falls through to the entry date. */
for (const [what, re] of [
  ['the payover run', /left join public\.payover_runs r on r\.id = e\.payover_run_id/],
  ['the receipt', /left join public\.account_payments p on p\.id = e\.payment_id/],
  ['the allocation', /left join public\.payment_allocations a on a\.id = e\.allocation_id/],
  ["the allocation's receipt", /left join public\.account_payments ap on ap\.id = a\.payment_id/],
]) ok(`${what} is joined`, re.test(byCycle ?? ''))

/* IT READS THE WHOLE LEDGER. A `where` on the entries themselves would drop money out of a bucket
   without dropping it out of trust_position, and the two would stop tying. */
ok('every creditor entry is bucketed',
  /from public\.trust_creditor_entries e\b/.test(byCycle ?? ''))

/* A SETTLED CYCLE DISAPPEARS. Rows of zeroes would bury the cycles that still owe something. */
ok('a cycle that nets to nothing is not listed',
  /and \(round\(a\.held, 2\) <> 0/.test(byCycle ?? ''))

/* AND IT IS GATED LIKE EVERY OTHER TRUST FUNCTION -- the capability, not the role name. */
ok('it asks the finance capability', /has_capability\('finance\.view'\)/.test(byCycle ?? ''))
no('...and does not test a role name instead', /current_user_role\(\) = 'Administrator'/.test(byCycle ?? ''))
/*
 * A CREATE IS A GRANT, AND REVOKING FROM anon IS NOT ENOUGH. Postgres grants EXECUTE on every new
 * function to PUBLIC and anon inherits that, so `from anon` alone leaves it callable with no
 * session at all -- which is what this function shipped with until the ACL on staging was read
 * back and found carrying `=X/postgres` where every neighbouring trust function did not.
 */
for (const fn of ['trust_by_cycle\\(\\)', 'payover_pays_on\\(date\\)']) {
  ok(`${fn.replace(/\\\\/g, '')} is revoked from public as well as anon`,
    new RegExp(`revoke execute on function public\\.${fn} from public, anon`).test(sql))
}

/* --------------------- 2. the firm's column is split in two --------------------- */

ok('what a cycle earned the firm comes from its receipts',
  /sum\(amount\) filter \(where party = 'firm' and from_receipt\)/.test(byCycle ?? ''))
ok('...and a drawing is the other column',
  /sum\(amount\) filter \(where party = 'firm' and not from_receipt\)/.test(byCycle ?? ''))
/*
 * AND "FROM A RECEIPT" MEANS EITHER WAY OF POINTING AT ONE. A parked credit taken to the firm
 * carries an allocation_id and no payment_id; read on payment_id alone it would be classed as a
 * drawing and vanish out of the month it was actually earned in.
 */
ok('an entry pointing at a receipt either way counts as earned',
  /\(e\.payment_id is not null or e\.allocation_id is not null\) as from_receipt/.test(byCycle ?? ''))

/* ---------------- 3. the paid-over date is a setting, not a constant ---------------- */

const paysOn = liveBody('payover_pays_on')
ok('payover_pays_on is in schema.sql', !!paysOn)
ok('it reads the lag off firm_settings',
  /select payover_lag_months from public\.firm_settings/.test(paysOn ?? ''))
/* NOT HARD-CODED BACK. The whole reason it is a column is that the firm has not named the period. */
no('...and does not hard-code a month', /interval '1 month'/.test(paysOn ?? ''))
ok('the cycle end plus the lag plus a day',
  /\+ interval '1 day'\)::date/.test(paysOn ?? ''))
ok('the column exists on the table',
  /add column if not exists payover_lag_months integer not null default 1/.test(sql))
ok('and trust_by_cycle quotes the date rather than computing its own',
  /public\.payover_pays_on\(public\.payover_cycle_end\(a\.cyc\)\)/.test(byCycle ?? ''))

/* ------------------------- 4. the dates, with no Date ------------------------- */

const lib = read('src/lib/trustCycles.ts')
/*
 * `new Date('2026-10-11')` IS UTC MIDNIGHT. Two in the morning in Johannesburg, and the 10th in
 * Honolulu -- and these strings are nothing but cycle boundaries, which is precisely where a day
 * either way is a payover in the wrong month. Date.UTC is the one use that is correct, so the
 * assertion is on the constructor.
 */
no('no Postgres date is parsed with new Date',
  /new Date\(/.test(lib.replace(/\/\*[\s\S]*?\*\//g, '')))

check('a day is a day', daysBetween('2026-10-06', '2026-10-11'), 5)
check('...backwards too', daysBetween('2026-10-11', '2026-10-06'), -5)
/* ACROSS A MONTH END AND A YEAR END, which is where hand-rolled date arithmetic goes wrong. */
check('across a month end', daysBetween('2026-09-10', '2026-10-11'), 31)
check('across a year end', daysBetween('2026-12-28', '2027-01-04'), 7)
/* AND ACROSS THE 29th OF FEBRUARY. */
check('through a leap day', daysBetween('2028-02-28', '2028-03-01'), 2)

check('a date reads as the firm writes it', shortDate('2026-09-10'), '10 Sep 2026')
/* en-ZA renders September as "Sept", which is why this is hand-rolled. */
no('...and never as Sept', /Sept/.test(shortDate('2026-09-01')))

check('a cycle names itself', cycleLabel('2026-08-11', '2026-09-10'), '11 Aug – 10 Sep 2026')
/* THE YEAR ONCE WHERE BOTH ENDS SHARE IT, BOTH TIMES WHERE THEY DO NOT. */
check('...and carries both years over a year end',
  cycleLabel('2026-12-11', '2027-01-10'), '11 Dec 2026 – 10 Jan 2027')

/* ----------------------- 5. where a cycle stands today ----------------------- */

const cyc = (over) => ({
  periodStart: '2026-08-11', periodEnd: '2026-09-10', paysOn: '2026-10-11', isOpen: false,
  toClients: 8420.1, firmEarned: 2311.55, firmMoved: 0, toDebtors: 0, unplaced: 0,
  held: 10731.65, runs: 1, runsPaid: 0, runsToDo: 1, ...over,
})

/* THE FIRM'S OWN EXAMPLE, ON THE FIRM'S OWN DAY: the 6th of October, with the August cycle closed
   and waiting for the 11th. */
check('the closed cycle is waiting for its day',
  cycleState(cyc(), '2026-10-06'),
  { word: 'Closed', detail: 'Pays over 11 Oct 2026, in 5 days', tone: 'due' })
check('...and on the day itself it says so',
  cycleState(cyc(), '2026-10-11').detail, 'Pays over today, 11 Oct 2026')
/*
 * PAST ITS DAY AND STILL HOLDING MONEY IS A FACT, NOT AN ALARM. The date it is late against comes
 * out of a setting the firm has not confirmed, and a red banner driven by Raptor's own guess is
 * the warning CLAUDE.md says is worse than none.
 */
check('past its day it states the fact',
  cycleState(cyc(), '2026-10-14'),
  { word: 'Still in trust', detail: 'Was due 11 Oct 2026, 3 days ago', tone: 'late' })
no('...and does not shout about it', cycleState(cyc(), '2026-10-14').tone === 'late'
  && cycleState(cyc(), '2026-10-14').word.includes('Overdue'))

const open = cyc({ periodStart: '2026-09-11', periodEnd: '2026-10-10', paysOn: '2026-11-11', isOpen: true })
check('the open cycle is still collecting',
  cycleState(open, '2026-10-06'),
  { word: 'Collecting now', detail: '4 days to run · pays over 11 Nov 2026', tone: 'open' })
/* SINGULAR AT ONE. "1 days to run" on a screen the firm reads every morning. */
check('...and counts one day singly', cycleState(open, '2026-10-09').detail,
  '1 day to run · pays over 11 Nov 2026')
check('...and says so on the last day', cycleState(open, '2026-10-10').detail,
  'Closes today · pays over 11 Nov 2026')

/* THE BAR IS HOW FAR THROUGH THE COLLECTING PERIOD TODAY IS, inclusive of both ends. */
check('the bar starts at one day in', Math.round(cycleProgress(open, '2026-09-11') * 100), 3)
check('...and is full on the closing day', cycleProgress(open, '2026-10-10'), 1)
check('...and never runs past it', cycleProgress(open, '2026-10-30'), 1)

/* ------------------------- 6. what is left to do on it ------------------------- */

/*
 * A CLOSED CYCLE WITH CLIENT MONEY AND NO RUN BUILT is a different problem from one whose runs are
 * waiting to be approved, and "needs attention" over both would flatten them into a shrug.
 */
check('a closed cycle with nothing built says so',
  cycleTodo(cyc({ runs: 0, runsToDo: 0 })), 'No payover run has been built for it yet')
check('...and one with runs waiting counts them',
  cycleTodo(cyc({ runs: 3, runsToDo: 2 })), '2 runs still to be approved and paid')
check('...singly at one', cycleTodo(cyc({ runs: 1, runsToDo: 1 })),
  '1 run still to be approved and paid')
check('...and nothing where every run is paid',
  cycleTodo(cyc({ runs: 2, runsToDo: 0, runsPaid: 2 })), null)
/* AN OPEN CYCLE IS NEVER BEHIND ON ANYTHING: its runs are not built until it closes. */
check('an open cycle is asked nothing', cycleTodo(open), null)
/* AND NEITHER IS A CLOSED ONE HOLDING ONLY THE FIRM'S OWN MONEY -- there is no payover to build. */
check('a cycle with no client money is asked nothing',
  cycleTodo(cyc({ toClients: 0, runs: 0 })), null)

/* ------------------------- 7. the totals tie the screen ------------------------- */

const totals = cycleTotals([cyc(), open])
check('the client column sums', totals.toClients, 16840.2)
check('the firm column sums', totals.firmEarned, 4623.1)
/* ROUNDED TO THE CENT, or floating point puts a hundredth of a cent on a trust reconciliation. */
check('and it is rounded to the cent',
  cycleTotals([cyc({ toClients: 0.1 }), cyc({ toClients: 0.2 })]).toClients, 0.3)
check('an empty book totals nil', cycleTotals([]).toClients, 0)

/* ------------------------- 8. the screen draws both ------------------------- */

const page = read('src/pages/trust/TrustOverview.tsx')
ok('the overview reads the cycles', /fetchTrustCycles\(\)/.test(page))
ok('...and still reads the position', /fetchTrustPosition\(\)/.test(page))
/*
 * THE CONTROL BLOCK ENDS ON THE DIFFERENCE. It used to be a list headed "whose money is in there"
 * with the bank balance on a separate panel and no line connecting the two; a trust control is the
 * one place the firm reads DOWN to a difference.
 */
const from = page.indexOf('\n            Trust control\n')
const control = from < 0 ? '' : page.slice(from, page.indexOf('Owed back to the trust', from))
ok('the control block was found', control.length > 500 && control.length < 4000)
/* PRESENCE BEFORE ORDER, ALWAYS. `indexOf` returns -1, so an order-only assertion passes
   vacuously the day the line it orders is deleted -- the trap this suite has been caught by. */
let at = -1
for (const line of ['Owed out of trust', 'In the bank', 'Difference']) {
  const found = control.search(new RegExp(`(^\\s*|>)${line}(\\n|<)`, 'm'))
  ok(`the control block carries "${line}"`, found >= 0)
  ok(`...and it comes after the line above it`, found > at)
  at = found
}
/*
 * TODAY IS READ ON THE FIRM'S CLOCK. "How many days until the 11th" against a browser in another
 * zone is wrong for a third of every day, and toISOString would hand back UTC.
 */
ok("today is taken on the firm's clock",
  /toLocaleDateString\('en-CA', \{ timeZone: 'Africa\/Johannesburg' \}\)/.test(page))
no('...and never from toISOString', /toISOString\(\)/.test(page))

/* THE SETTING IS REACHABLE FROM THE SCREEN THAT QUOTES IT. Raptor guessed the date; the firm has
   to be able to find where to change it without being told. */
ok('the page points at the setting it guessed', /\/trust\/settings/.test(page))
const settings = read('src/pages/finance/FinanceSettings.tsx')
ok('and the setting is actually on that screen', /payover_lag_months/.test(settings))

console.log(`check-trust-cycles: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
