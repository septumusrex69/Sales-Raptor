/**
 * THE COMPANY DASHBOARD — the screen the whole firm lands on.
 *
 * TWO THINGS ARE GUARDED HERE AND THEY ARE DIFFERENT IN KIND.
 *
 * The first is arithmetic: what the sales side contributes to that screen. A handover deal's
 * `value` is deliberately zero — a signed book earns nothing at signature — so summing `value`
 * across a mixed pipeline reports every mandate the firm has ever signed as worth nothing, and
 * the screen would say "R 0 won" in a month the firm signed a nine-figure book. That is a wrong
 * number nobody would question, which is the worst kind.
 *
 * The second is a PROMISE THE FIRM WAS MADE. They agreed to one dashboard for everybody on one
 * condition: "we're not going to be disclosing commission and income from the Annexure B fees.
 * We'll do that on another place, which is not even for an administrator." Every figure on this
 * screen is either the client's money to recover or a count of work. A commission column added
 * here later by somebody who did not hear that sentence would show every collector's earnings to
 * the whole firm, and there is no way to un-show it. So it is asserted as an absence.
 *
 * Run: node scripts/qa/check-company-dashboard.mjs
 */
import { readFileSync } from 'node:fs'
import { awaitingFirstHandover, bookSlices, departmentHeadline, intakeBars, intakeComparison, intakeMonthBars, intakeSplit, salesSnapshot, spansMonths } from '../../src/lib/companySnapshot.ts'
import { getSalesMonthForKey } from '../../src/lib/salesMonth.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

/* ---------- the sales side, counted ---------- */

/* The firm's month, the 11th to the 10th: 11 Sep – 10 Oct 2026. */
const period = getSalesMonthForKey('2026-10')
ok('there is a sales month to count against', !!period)

const LEADS = [
  { id: 'l1', status: 'No Contact Yet', createdAt: '2026-09-15T09:00:00Z' },
  { id: 'l2', status: 'Hot Lead', createdAt: '2026-08-02T09:00:00Z' },
  { id: 'l3', status: 'Converted', createdAt: '2026-09-20T09:00:00Z' },
  { id: 'l4', status: 'Rejected', createdAt: '2026-09-21T09:00:00Z' },
]
const DEALS = [
  /* A mandate: a signed book, worth nothing at signature and everything to the floor. */
  { id: 'd1', stage: 'Won', kind: 'Handover', value: 0, handoverAmount: 4_000_000, wonAt: '2026-09-18T09:00:00Z' },
  /* A service deal won in the same month, which IS revenue and is counted as such. */
  { id: 'd2', stage: 'Won', kind: 'Service', value: 250_000, wonAt: '2026-09-19T09:00:00Z' },
  /* Won, but in the month before — outside the period being read. */
  { id: 'd3', stage: 'Won', kind: 'Service', value: 900_000, wonAt: '2026-08-19T09:00:00Z' },
  /* Still in play. */
  { id: 'd4', stage: 'Mandate Sent', kind: 'Handover', value: 0, handoverAmount: 1_000_000, createdAt: '2026-09-01T09:00:00Z' },
  { id: 'd5', stage: 'Quotation Sent', kind: 'Service', value: 120_000, createdAt: '2026-09-02T09:00:00Z' },
  { id: 'd6', stage: 'Rejected', kind: 'Service', value: 500_000, rejectedAt: '2026-09-03T09:00:00Z' },
]
const s = salesSnapshot(LEADS, DEALS, period)

/* A lead is open until it either becomes a client or is rejected — the other two are the ways out. */
check('open leads are the ones still being worked', s.openLeads, 2)
check('...and what came in this period is counted apart', s.leadsAdded, 3)

/*
 * THE FIGURE THE WHOLE FUNCTION EXISTS FOR. A mandate is counted as a mandate and a book, never
 * as revenue; a service deal is counted as revenue. Mixing them is the failure, in either
 * direction.
 */
check('a signed mandate is one mandate', s.mandatesSigned, 1)
check('...and brings its book with it', s.mandateBook, 4_000_000)
check('deal value won is the service deals only', s.dealsWonValue, 250_000)
ok('...so a mandate never reads as revenue', s.dealsWonValue !== 4_250_000 && s.dealsWonValue !== 4_000_000)
/* And the month is a fence: last month's win belongs to last month's figure. */
ok('a deal won in another month is not in this one', s.dealsWonValue < 900_000)

check('deals open are the service deals still in play', s.dealsOpen, 1)
check('...at what they are worth', s.dealsOpenValue, 120_000)
ok('a rejected deal is not open', s.dealsOpen === 1)

/* A deal with no kind at all — the old rows, before the distinction existed — is read off its
   service, which is what dealKind is for. */
{
  const legacy = salesSnapshot([], [
    { id: 'x', stage: 'Won', service: 'Debt Collection', value: 0, handoverAmount: 7_000, wonAt: '2026-09-18T09:00:00Z' },
  ], period)
  check('a deal with no kind is read off its service', legacy.mandatesSigned, 1)
  check('...and still earns nothing at signature', legacy.dealsWonValue, 0)
}

/* Nothing at all is nought, not a crash and not a null — the firm's first month on a new client
   will look exactly like this. */
{
  const empty = salesSnapshot([], [], period)
  check('an empty pipeline is nought', empty.openLeads + empty.mandatesSigned + empty.dealsOpen, 0)
}

/* ---------- the promise the firm was made ---------- */

const page = read('../../src/pages/CompanyDashboard.tsx')
const lib = read('../../src/lib/companySnapshot.ts')
const data = read('../../src/lib/companySnapshotData.ts')
/*
 * COMMENTS STRIPPED FIRST. Both files explain in prose why commission is not on this screen, and
 * a regex over the raw text is satisfied by the explanation rather than by the behaviour — the
 * trap this codebase has a name for, and has been caught by more than once.
 */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
/*
 * The footer sentence is the one place those words are allowed to appear, because it is the
 * screen saying out loud that they are not on it. Cut out by its own text rather than by a
 * line number, and asserted separately below — so removing the sentence does not quietly widen
 * what the scan permits.
 */
const FOOTER = /Everyone in the firm lands here[\s\S]*?narrower audience\./
const code = strip(page).replace(FOOTER, '') + strip(lib) + strip(data)
for (const word of ['commission', 'Commission', 'annexure', 'Annexure', 'remittance', 'Remittance']) {
  ok(`the firm's own income is not on it: no "${word}"`, !code.includes(word))
}
/* Said in words on the screen as well, so the next person reads it before adding one. */
ok('...and the screen says why, where somebody will see it',
  /Commission and Annexure B income are deliberately not on/.test(page))
/* The money that IS on it is named for whose it is. */
ok('the client’s money is labelled as the client’s',
  /the client's money to\s*\n?\s*recover/.test(page))

/* ---------- the hero, and only here ---------- */

ok('the company dashboard wears the photograph', /<CollectionsHero/.test(page))
ok('...handed the figures the floor reads', /figures=\{month\.figures\}/.test(page))
ok('...with the controls inside its own strip', /filters=\{<MonthControls/.test(page))
ok('...and the month bar inside the panel, not as a card underneath',
  /progress=\{<MonthProgress[\s\S]{0,120}tone="dark"/.test(page))
ok('there is a way out of it into your own department',
  /myDashboardPath\(currentUser\?\.role\)/.test(page))

/* ---------- the book's figures are counted in the database ---------- */

const sql = read('../../supabase/schema.sql')
/* THE LAST DEFINITION. schema.sql is append-only, so the day this function is replaced `indexOf`
   silently starts asserting against the superseded copy — see CLAUDE.md, and check-allocation-start,
   where it had already happened. There is one definition today; this is what keeps that irrelevant. */
const fn = sql.slice(sql.lastIndexOf('create or replace function public.company_snapshot'))
ok('there is a company_snapshot function to read', fn.length > 500)
/*
 * NOT A ROW OF THE BOOK CROSSES THE WIRE. CLAUDE.md: a list that loads the book to count it stops
 * working the month it matters, and this screen is opened by everybody in the firm every morning.
 */
ok('...counted in the database, not in the browser', /count\(\*\)::integer/.test(fn))
ok('...and the browser only ever calls it', /supabase\.rpc\('company_snapshot'/.test(data))
ok('...never selecting the book itself', !/from\('debtor_accounts'\)/.test(data))
/* And the arithmetic beside it stays importable by this very file: a check cannot load the
   Supabase client, which is why the fetch is next door rather than in companySnapshot.ts. */
ok('the sales arithmetic pulls in no client', !/from '\.\/supabase/.test(lib))
/*
 * SECURITY INVOKER. A summary that counted rows its reader may not open would be a quiet
 * disclosure — the same reasoning book_summary and account_view_counts are written under.
 */
ok('it runs as the caller', /security invoker/.test(fn.slice(0, 1200)))
ok('...with a fixed search path', /set search_path to 'public'/.test(fn.slice(0, 1200)))

/*
 * TWO KINDS OF QUIET, COUNTED APART.
 *
 * last_action_at was only ever written by the Swordfish import until Raptor began stamping it, so
 * most of the imported book carries no action at all. Folded into "gone quiet" that is 14 000
 * accounts reading as abandoned on the screen the whole firm opens — a warning that fires when
 * nothing is wrong, which CLAUDE.md says is worse than no warning because people stop reading it.
 */
const quiet = fn.slice(fn.indexOf('quiet_accounts integer'))
ok('an account that has never been actioned is counted separately',
  /never_actioned integer/.test(fn))
ok('...and is NOT folded into the quiet count',
  /last_action_at is not null[\s\S]{0,120}last_action_at < \(public\.raptor_today\(\) - p_quiet_days\)/.test(quiet))
ok('...and the screen explains the second number rather than hiding it',
  /have no action recorded in\s*\n?\s*Raptor yet/.test(page))

/* ---------- it is loading, not nought ---------- */

/*
 * A tile reading "0 accounts" while the count is in flight is not a slower answer, it is a wrong
 * one — and on a screen the whole firm opens, a wrong nought is read and repeated before it
 * corrects itself.
 */
ok('figures that have not arrived are not drawn as nought',
  /if \(loading\) \{/.test(page) && /animate-spin/.test(page))
ok('...and a failure says so rather than showing zeroes',
  /These figures could not be counted/.test(page))

/*
 * "MONTH", NOT "SALES MONTH". The firm, of the period picker over the photograph: "Don't call this
 * the current sales month because it's not a sales month ... just current month." Read with
 * comments stripped, so the note explaining the rule cannot satisfy or fail it.
 */
for (const f of ['../../src/components/ui/SalesMonthPicker.tsx', '../../src/components/ui/PeriodFilter.tsx']) {
  ok(`${f.split('/').pop()} says "month", not "sales month"`, !/sales months?/i.test(strip(read(f))))
}
ok('the picker offers the current month by that name', /current: 'Current month'/.test(read('../../src/components/ui/SalesMonthPicker.tsx')))
ok('...and a span of months is not called sales months either',
  !/Sales Months/.test(strip(read('../../src/lib/salesMonth.ts'))))

/* ------------------------------------------------------------------ */

/* ---------- the firm's layout, 18 Oct: a bar a day, and a ring that adds up ---------- */

{
  /* This file's check() is Object.is (see HANDOFF §6), so arrays are compared as JSON. */
  const same = (name, actual, expected) => check(name, JSON.stringify(actual), JSON.stringify(expected))
  const bars = intakeBars('2026-10-11', '2026-11-10', [
    { day: '2026-10-12', accounts: 4 }, { day: '2026-10-17', accounts: 3 }, { day: '2026-12-01', accounts: 99 },
  ], '2026-10-18')
  check('a bar for every day of the period, not only the days with work', bars.length, 31)
  same('...in order, first and last', [bars[0].day, bars[30].day], ['2026-10-11', '2026-11-10'])
  same('...the database\'s counts on their days', bars.filter((b) => b.accounts > 0).map((b) => [b.day, b.accounts]),
    [['2026-10-12', 4], ['2026-10-17', 3]])
  ok('...a day outside the period is ignored, not tacked on', !bars.some((b) => b.accounts === 99))
  same('a Saturday and a Sunday are weekends', bars.filter((b) => b.weekend).slice(0, 2).map((b) => b.day), ['2026-10-11', '2026-10-17'])
  check('days after the as-at day are still to come', bars.filter((b) => b.future).length, 23)
  ok('...the as-at day itself is not', bars.find((b) => b.day === '2026-10-18')?.future === false)
  check('across a year end', intakeBars('2026-12-11', '2027-01-10', [], '2027-01-10').length, 31)

  const ring = bookSlices({ bookAccounts: 30, activeAccounts: 24, unallocatedActive: 3 })
  same('the ring partitions the book', ring.map((x) => x.value), [21, 3, 6])
  check('...so its slices add up to the centre', ring.reduce((t, x) => t + x.value, 0), 30)
  same('...and never go below nought on odd figures', bookSlices({ bookAccounts: 2, activeAccounts: 3, unallocatedActive: 5 }).map((x) => x.value), [0, 3, 0])
  ok('clients and gone quiet are not slices (they are not parts of the book)', !ring.some((x) => /client|quiet/i.test(x.label)))

  const intakeFn = sql.slice(sql.lastIndexOf('create or replace function public.company_intake_by_day('))
  ok('the days are counted in the database', /count\(\*\)::integer/.test(intakeFn.slice(0, 1500)) && /group by a\.handover_date/.test(intakeFn.slice(0, 1500)))
  ok('...on the same rule as the snapshot\'s intake', /a\.handover_date between p_from and p_to/.test(intakeFn.slice(0, 1500)))
  ok('...as the caller', /security invoker/.test(intakeFn.slice(0, 400)))
  ok('...and the browser only calls it', /supabase\.rpc\('company_intake_by_day'/.test(data))
  ok('the screen draws the bars and the ring', /<IntakeChart/.test(page) && /bookSlices\(book\)/.test(page))
  /* Last month, day for day, and the words. */
  const withPrior = intakeBars('2026-10-11', '2026-11-10', [{ day: '2026-10-12', accounts: 4 }, { day: '2026-10-17', accounts: 5 }], '2026-10-18',
    { fromIso: '2026-09-11', toIso: '2026-10-10', rows: [{ day: '2026-09-14', accounts: 2 }, { day: '2026-09-30', accounts: 5 }] })
  same('last month is laid by position: its 4th day beside this 4th day', withPrior.slice(0, 5).map((b) => b.priorAccounts), [0, 0, 0, 2, 0])
  same('...and a slot past the end of the shorter month has no prior figure, not a nought', withPrior.at(-1)?.priorAccounts, null)
  same('compared by the same day, not against the whole of last month', intakeComparison(withPrior)?.words, 'up from 2 last month by the same day')
  same('...the whole month once it is over', intakeComparison(intakeBars('2026-09-11', '2026-10-10', [{ day: '2026-09-12', accounts: 1 }], '2026-10-18',
    { fromIso: '2026-08-11', toIso: '2026-09-10', rows: [{ day: '2026-08-20', accounts: 3 }] }))?.words, 'down from 3 last month')
  same('nothing to compare is no sentence', intakeComparison(intakeBars('2026-10-11', '2026-11-10', [], '2026-10-18')), null)
  same('capital rides along for the rand view', intakeBars('2026-10-11', '2026-10-12', [{ day: '2026-10-12', accounts: 1, capital: 5000 }], '2026-10-18')[1].capital, 5000)

  /* Each department's headline: none of them the firm's income. */
  const m = (v) => `R ${v}`
  const heads = ['Call centre', 'Sales', 'Communications', 'Administration'].map((d) =>
    departmentHeadline(d, { collected: 1200, mandates: 1, intakeClients: 2, intakeAccounts: 9 }, m))
  same('every department has a headline', heads.map((h) => h && `${h.value} ${h.label}`),
    ['R 1200 collected this month', '1 mandate signed', '2 clients sent work', '9 accounts loaded'])
  same('a figure still being counted reads as waiting, not nought',
    departmentHeadline('Call centre', { collected: null, mandates: 0, intakeClients: null, intakeAccounts: null }, m)?.value, '…')
  ok('no headline is commission or fees', !heads.some((h) => /commission|fee|annexure/i.test(h?.label ?? '')))
  ok('the screen links the ring to the account list\'s own views', /viewParams\('unallocated'/.test(page) && /viewParams\('gone_quiet'/.test(page))
  ok('...and a bar to the handovers it covers: its day, or its whole month', /onDay=\{\(b\) => navigate\(handedOver\(b\.day, b\.toDay\)\)\}/.test(page))

  /* New and existing clients (the firm, 18 Oct): the three figures add up, from the same bars. */
  const sb = intakeBars('2026-10-11', '2026-10-20', [
    { day: '2026-10-12', accounts: 4, capital: 80000, newAccounts: 1, newCapital: 30000 },
    { day: '2026-10-17', accounts: 3, capital: 57500, newAccounts: 3, newCapital: 57500 },
  ], '2026-10-18')
  same('total, existing and new', intakeSplit(sb), {
    total: { accounts: 7, capital: 137500 }, fresh: { accounts: 4, capital: 87500 }, existing: { accounts: 3, capital: 50000 } })
  same('sales\' headline is the new clients\' work, communications\' the existing',
    ['Sales', 'Communications'].map((d) => departmentHeadline(d, { collected: 0, mandates: 9, intakeClients: 9, intakeAccounts: 9, fromNew: 4, fromExisting: 3 }, m)?.label),
    ['accounts from new clients', 'accounts from existing clients'])
  /* OVER A SPAN OF MONTHS, ONE BAR A MONTH (the firm, 18 Oct: "compare the months to each other instead
     of the days"). Sales months, 11th to 10th; the one in progress drawn as far as it has got. */
  ok('one sales month is days', !spansMonths('2026-08-11', '2026-09-10'))
  ok('...six of them are months', spansMonths('2026-04-11', '2026-10-10'))
  const mb = intakeMonthBars('2026-04-11', '2026-10-10', [
    { day: '2026-04-11', accounts: 2, capital: 100, newAccounts: 1, newCapital: 40 },
    { day: '2026-05-10', accounts: 3, capital: 300, newAccounts: 0, newCapital: 0 },
    { day: '2026-05-11', accounts: 5, capital: 500, newAccounts: 5, newCapital: 500 },
    { day: '2026-09-01', accounts: 7, capital: 700, newAccounts: 2, newCapital: 200 },
  ], '2026-09-05')
  same('six bars, by the month each ends in', mb.map((x) => x.label), ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'])
  same('...the 10th belongs to the month ending that day, the 11th to the next', mb.slice(0, 2).map((x) => [x.accounts, x.newAccounts]), [[5, 1], [5, 5]])
  same('...each bar opens the month it covers', [mb[0].day, mb[0].toDay, mb[0].span], ['2026-04-11', '2026-05-10', 'month'])
  same('...the month in progress is drawn, the one not yet begun is a future slot', [mb[4].future, mb[4].accounts, mb[5].future], [false, 7, true])
  same('...and no faint bar behind: the months are the comparison', mb.every((x) => x.priorAccounts === null), true)
  same('across a year end the label says the year', intakeMonthBars('2025-11-11', '2026-02-10', [], '2026-03-01').map((x) => x.label), ['Dec 25', 'Jan 26', 'Feb 26'])
  const ib = sql.slice(sql.lastIndexOf('create or replace function public.company_intake_by_day('))
  ok('new is counted from the client\'s FIRST handover, not the mandate', /min\(handover_date\) as first_day/.test(ib.slice(0, 1500)) && !/mandate/.test(ib.slice(0, 1500)))
  ok('...for three months', /first_day \+ interval '3 months'/.test(ib.slice(0, 1500)))
  ok('...on the top-level client, so a sub-account shares its parent\'s clock', /coalesce\(c\.parent_company_id, c\.id\) as client/.test(ib.slice(0, 1500)))

  /* Signed, nothing handed over yet. */
  same('the longest waiting first, days on the firm\'s calendar', awaitingFirstHandover([
    { company_id: 'a', name: 'Recent', mandate_signed_at: '2026-10-10T08:00:00Z', account_owner_id: null },
    { company_id: 'b', name: 'Cold', mandate_signed_at: '2026-08-01T22:30:00Z', account_owner_id: 'u' },
  ], '2026-10-18').map((c) => [c.name, c.days]), [['Cold', 78], ['Recent', 8]])
  const aw = sql.slice(sql.lastIndexOf('create or replace function public.clients_awaiting_first_handover('))
  ok('awaiting means a mandate and not one account, its sub-accounts included',
    /mandate_signed_at is not null/.test(aw.slice(0, 900)) && /not exists/.test(aw.slice(0, 900)) && /s\.parent_company_id = c\.id/.test(aw.slice(0, 900)))
  ok('...asked as the caller', /security invoker/.test(aw.slice(0, 400)))
  ok('the communications dashboard shows it', /fetchAwaitingFirstHandover\(\)/.test(read('../../src/pages/CommunicationsDashboard.tsx')))
}


for (const f of failures) console.error(`  ✗ ${f}`)

console.log(`check-company-dashboard: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
