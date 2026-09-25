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
import { salesSnapshot } from '../../src/lib/companySnapshot.ts'
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
const fn = sql.slice(sql.indexOf('create or replace function public.company_snapshot'))
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
  /last_action_at is not null[\s\S]{0,120}last_action_at < \(current_date - p_quiet_days\)/.test(quiet))
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

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-company-dashboard: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
