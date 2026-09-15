/**
 * Narrowing the book.
 *
 * A WRONG FILTER DOES NOT THROW. It returns a shorter list, and a shorter list looks like good
 * news — "only four accounts have gone quiet" reads as a well-run book whether it is true or a
 * clause that silently excluded the nulls. That is the whole reason this file exists: every
 * check here is about a way the list could be quietly, plausibly wrong.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-account-filters.mjs
 */
import { readFileSync } from 'node:fs'
import {
  FILTER_PARAMS, PRESCRIBING_CHOICES, QUIET_CHOICES, STATUS_GROUPS,
  clearedFilters, filterChips, hasAccountFilters, queryFromParams, shiftDays,
} from '../../src/lib/accountFilters.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

/* A fixed today, so "nothing in 30 days" means one thing every time this runs. */
const TODAY = new Date('2026-09-15T00:00:00Z')
const q = (s) => queryFromParams(new URLSearchParams(s), TODAY)

/* ---------- dates ---------- */

check('30 days back', shiftDays(TODAY, -30), '2026-08-16')
check('90 days on', shiftDays(TODAY, 90), '2026-12-14')
// Across a month boundary and a leap year, because ISO string arithmetic is where this breaks.
check('crossing a year', shiftDays(new Date('2026-01-05T00:00:00Z'), -10), '2025-12-26')
check('a leap day exists', shiftDays(new Date('2028-02-28T00:00:00Z'), 1), '2028-02-29')
/*
 * Pinned to UTC on purpose. Johannesburg is UTC+2 the whole year, so a request made at half past
 * midnight local is still the previous day in UTC — which is one day, once a night, and vastly
 * cheaper than local date arithmetic that has to be right about a DST rule the country does not
 * have. This check exists so the choice is deliberate rather than rediscovered.
 */
check('late-night local time does not shift the day',
  shiftDays(new Date('2026-09-15T22:30:00Z'), 0), '2026-09-15')

/* ---------- an empty URL asks for the whole book ---------- */

check('nothing set is no filter', Object.keys(q('')).length, 0)
ok('...and reads as unfiltered', !hasAccountFilters(q('')))
ok('...and shows no chips', filterChips(new URLSearchParams('')).length === 0)

/* ---------- each filter reaches the query ---------- */

check('client', q('client=abc').companyId, 'abc')
check('search is trimmed', q('q=%20smit%20').search, 'smit')
ok('a blank search is not a filter', q('q=%20%20').search === undefined)
check('status group', q('status=active').statusGroup, 'active')
check('sub-status', q('sub=Promise+To+Pay').subStatus, 'Promise To Pay')
check('bucket', q('bucket=Failed+PTPs').bucket, 'Failed PTPs')
check('a desk', q('who=u1').assignedTo, 'u1')
check('nobody’s desk', q('who=nobody').assignedTo, 'nobody')
check('handed over from', q('from=2026-01-01').handedOverFrom, '2026-01-01')
check('handed over to', q('to=2026-06-30').handedOverTo, '2026-06-30')
check('adrift', q('adrift=1').adrift, true)
check('never worked', q('never=1').neverWorked, true)
check('in duplum', q('duplum=1').inDuplum, true)
check('waiting on the client', q('waiting=1').waitingOnClient, true)
check('commission drift', q('drift=1').commissionDriftOnly, true)
check('minimum outstanding', q('min=10000').minOutstanding, 10000)

/*
 * RELATIVE IN THE URL, ABSOLUTE IN THE QUERY. A link that says quiet=30 means "in the last
 * thirty days" on the day it is opened. Freezing the date into the URL would make a link sent on
 * Monday quietly answer Monday's question for the rest of the year.
 */
check('quiet becomes a date', q('quiet=30').quietSince, '2026-08-16')
check('prescription becomes a date', q('presc=90').prescribingBefore, '2026-12-14')

/* ---------- nonsense narrows nothing ---------- */

/*
 * The safe failure for a bad filter is to ignore it. A filter that silently hides accounts
 * because somebody mistyped a query string is how a book goes unworked, and nobody would ever
 * see the mistake — the list would just be short.
 */
ok('an unknown status group is dropped', q('status=banana').statusGroup === undefined)
ok('a non-numeric quiet is dropped', q('quiet=soon').quietSince === undefined)
ok('a non-numeric minimum is dropped', q('min=lots').minOutstanding === undefined)
ok('zero days quiet is not "since today"', q('quiet=0').quietSince === undefined)
ok('a negative window is dropped', q('quiet=-30').quietSince === undefined)
ok('R0 or more is not a filter', q('min=0').minOutstanding === undefined)
ok('an empty value is not a filter', q('sub=').subStatus === undefined)

/* ---------- the chips say what has been hidden ---------- */

/*
 * The chips are the ONLY thing standing between a person and a wrong conclusion once the panel
 * is shut. Each has to read as the question that was asked, not as the control that was set.
 */
const chipLabels = (s) => filterChips(new URLSearchParams(s)).map((c) => c.label)
check('live book', chipLabels('status=active')[0], 'Live book')
check('a sub-status speaks for itself', chipLabels('sub=Delinquent+Payer')[0], 'Delinquent Payer')
check('the unallocated pile', chipLabels('who=nobody')[0], 'On nobody’s desk')
check('a named desk', filterChips(new URLSearchParams('who=u1'), { userName: () => 'Thandi Nkosi' })[0].label, 'Thandi Nkosi')
ok('an unknown desk still reads as something',
  chipLabels('who=u1')[0] === 'One agent’s desk')
check('quiet reads as a sentence', chipLabels('quiet=30')[0], 'Nothing in 30 days')
check('prescription reads as a sentence', chipLabels('presc=180')[0], 'Prescribes within 6 months')
check('an odd window still reads', chipLabels('quiet=45')[0], 'Nothing in 45 days')
/*
 * en-ZA groups thousands with a NON-BREAKING space (U+00A0), not a plain one. Normalised here
 * rather than expected literally, because the two are indistinguishable in a failure message and
 * a check nobody can read the failure of is worse than no check.
 */
check('money is formatted', chipLabels('min=25000')[0].replace(/\u00a0/g, ' '), 'R25 000 or more outstanding')
check('a date range reads as a range', chipLabels('from=2026-01-01&to=2026-06-30')[0], 'Handed over 2026-01-01 to 2026-06-30')
check('an open-ended range reads as one', chipLabels('from=2026-01-01')[0], 'Handed over from 2026-01-01')

/*
 * THE CLIENT IS NOT A CHIP. It has its own control in the bar, it is how the whole screen is
 * scoped, and "Clear filters" throwing it away would drop somebody out of the book they were
 * reading and into the firm's entire ledger.
 */
ok('the client never becomes a chip', chipLabels('client=abc').length === 0)
ok('...and survives clearing', clearedFilters(new URLSearchParams('client=abc&sub=Tracing')).get('client') === 'abc')
ok('...and the search survives clearing', clearedFilters(new URLSearchParams('q=smit&sub=Tracing')).get('q') === 'smit')
ok('...while the filters do not', clearedFilters(new URLSearchParams('client=abc&sub=Tracing')).get('sub') === null)

/*
 * A CHIP FOR EVERY FILTER. Without this, adding a fourteenth filter and forgetting its chip
 * produces a list that is narrowed with nothing on screen saying so — the exact failure the
 * chips exist to prevent.
 */
const everyFilterSet = 'status=active&sub=Tracing&bucket=Diary&who=nobody&from=2026-01-01&to=2026-06-30'
  + '&adrift=1&never=1&quiet=30&presc=90&duplum=1&waiting=1&min=1000&drift=1'
const allChips = filterChips(new URLSearchParams(everyFilterSet))
ok('every filter produces a chip', allChips.length === FILTER_PARAMS.length - 1) // from+to share one chip
ok('every chip can be removed', allChips.every((c) => FILTER_PARAMS.includes(c.param)))
ok('every filter reaches the query', hasAccountFilters(q(everyFilterSet)))
/*
 * And clearing really clears. Not "mostly clears": a key left behind here is a filter nobody can
 * see and nobody can turn off, because its chip is gone with the rest.
 */
const cleared = clearedFilters(new URLSearchParams(everyFilterSet))
ok('clearing leaves nothing behind', FILTER_PARAMS.every((p) => !cleared.has(p)))
ok('...and an empty book is unfiltered', !hasAccountFilters(queryFromParams(cleared, TODAY)))

/* ---------- the choices offered are choices the URL understands ---------- */

ok('every quiet choice round-trips',
  QUIET_CHOICES.every((c) => q(`quiet=${c.days}`).quietSince === shiftDays(TODAY, -c.days)))
ok('every prescription choice round-trips',
  PRESCRIBING_CHOICES.every((c) => q(`presc=${c.days}`).prescribingBefore === shiftDays(TODAY, c.days)))
ok('every status group round-trips',
  STATUS_GROUPS.every((g) => q(`status=${g.value}`).statusGroup === g.value))
ok('every status group has a chip',
  STATUS_GROUPS.every((g) => chipLabels(`status=${g.value}`).length === 1))

/* ---------- what the database is actually asked ---------- */

const book = readFileSync(new URL('../../src/lib/accountBook.ts', import.meta.url), 'utf8')

/*
 * "GONE QUIET" MUST INCLUDE THE NEVER-WORKED. last_action_at is null on an account nobody has
 * ever touched, and `lt` alone drops nulls — so the filter built to find neglect would exclude
 * the most neglected accounts in the book and report a clean result.
 */
ok('quiet counts a null last action', /last_action_at\.lt\.\$\{q\.quietSince\},last_action_at\.is\.null/.test(book))

/*
 * "PRESCRIBING SOON" IS NOT "ALREADY PRESCRIBED". One is a deadline to work to; the other has
 * happened and is a conversation with the client about a write-off. Merging them buries the
 * accounts that can still be saved under the ones that cannot.
 */
ok('prescribing excludes the already prescribed',
  /prescription_date', q\.prescribingBefore\)\.eq\('prescribed', false\)/.test(book))

/*
 * ADRIFT IS ABOUT THE LIVE BOOK. Written-off accounts have no diary date and never will; without
 * the status clause they would be 372 of the answer and the real hole — active accounts nobody is
 * booked to ring — would be invisible inside it.
 */
ok('adrift is active accounts only', /q\.adrift[\s\S]{0,120}ilike\('status', 'Active%'\)/.test(book))

/*
 * STATUS GROUPS MATCH BY PREFIX, not against a list of the five values the book holds today. The
 * import writes whatever Swordfish sends, so 'Active: Reinstated' can arrive tomorrow — and an
 * `in` list written this afternoon would silently drop it out of the live book.
 */
ok('the live book is a prefix match', /statusGroup === 'active'[\s\S]{0,80}ilike\('status', 'Active%'\)/.test(book))
ok('closed covers written off and closed',
  /statusGroup === 'closed'[\s\S]{0,140}Written-off%[\s\S]{0,40}Closed%/.test(book))

/*
 * FILTERED IN THE DATABASE, not over the fifty rows on screen. A client-side filter gives an
 * answer that is right about the page and wrong about the book — and the pager would still say
 * "1–50 of 735" over it.
 */
for (const clause of [
  "eq('sub_status', q.subStatus)", "eq('bucket', q.bucket)", "is('assigned_to', null)",
  "gte('handover_date', q.handedOverFrom)", "lte('handover_date', q.handedOverTo)",
  "is('last_action_at', null)", "eq('in_duplum', true)",
  "not('client_action_ask', 'is', null)", "gte('capital_outstanding', q.minOutstanding)",
]) ok(`${clause} is sent to the database`, book.includes(clause))

/*
 * The one exception, and it is marked as one: PostgREST cannot compare two columns to each
 * other, so commission drift is the only filter done in the browser. Everything else being in
 * SQL is what makes that acceptable — it runs over a page, and the page is already the answer.
 */
ok('commission drift is the only client-side filter',
  /PostgREST cannot compare two columns/.test(book))

/* ---------- the mapper carries the columns the filters rely on ---------- */

/*
 * The mapper is hand-written, so a column present in the database, in the type and in the select
 * but missing here reads as undefined for ever and nothing fails. diary_capacity sat in exactly
 * that state for months.
 */
for (const field of ['assignedTo: r.assigned_to', 'clientActionAsk: r.client_action_ask', 'subStatus: r.sub_status']) {
  ok(`the mapper carries ${field.split(':')[0]}`, book.includes(field))
}

/* ---------- the list shows what it filtered by ---------- */

const list = readFileSync(new URL('../../src/pages/accounts/AccountsList.tsx', import.meta.url), 'utf8')

/*
 * The summary tiles count the CLIENT'S WHOLE BOOK, not the filtered list. A tile that followed
 * the filters would read "Accounts 3" above a list of three, and there would be no number left
 * anywhere on the screen saying how big the book really is.
 */
ok('the summary ignores the filters', /fetchBookSummary\(query\.companyId\)/.test(list))
ok('...and says so when the list is narrowed', /Accounts \(whole book\)/.test(list))

/*
 * An empty filtered list must not read as an empty book. "No accounts here yet" over a filtered
 * nothing sends somebody to the import screen to fix a problem they do not have.
 */
ok('an empty result distinguishes the two cases', /No accounts match these filters/.test(list))
ok('...and offers the way out', /Clear the filters/.test(list))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Thirteen filters, every one applied in the database, every one readable as a chip once the panel
is shut, and every one removable. A mistyped query string narrows nothing.`)
