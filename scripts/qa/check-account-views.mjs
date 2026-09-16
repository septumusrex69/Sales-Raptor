/**
 * The questions somebody opens the account list to ask.
 *
 * THE DEFAULT VIEW WAS THE PROBLEM, not the page size. Six figures of accounts sorted
 * alphabetically by account number is nobody's question: you open the book, land on "Abc1111",
 * and cannot tell whether you are looking at the whole thing or at a filter somebody left set an
 * hour ago. That is the complaint these views and the scope line exist to answer — and the
 * failure mode they guard against is the quiet one, a short list that looks like a small book.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-account-views.mjs
 */
import { readFileSync } from 'node:fs'
import {
  ACCOUNT_VIEWS, QUIET_VIEW_DAYS, activeView, viewParams, viewsFor,
} from '../../src/lib/accountViews.ts'
import { filterChips, hasAccountFilters, queryFromParams } from '../../src/lib/accountFilters.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const ME = 'user-1'
const TODAY = new Date('2026-09-15T00:00:00Z')
const q = (s, ctx) => queryFromParams(new URLSearchParams(s), TODAY, ctx)
const paramsOf = (id) => viewParams(id, ME).toString()

/* ---------- the views hold together ---------- */

ok('no two views share an id', new Set(ACCOUNT_VIEWS.map((v) => v.id)).size === ACCOUNT_VIEWS.length)
ok('no two views read the same', new Set(ACCOUNT_VIEWS.map((v) => v.label)).size === ACCOUNT_VIEWS.length)
ok('every view explains itself', ACCOUNT_VIEWS.every((v) => v.hint.length > 20))
/*
 * A badge is what turns a link into a queue: "No diary date" gets clicked once, "No diary date
 * 355" gets worked. A view whose count key is not in the RPC's result silently shows no number.
 */
const rpcKeys = ['whole_book', 'my_desk', 'unallocated', 'adrift', 'broken_promises', 'promises_due', 'gone_quiet']
ok('every view has a count the database returns', ACCOUNT_VIEWS.every((v) => rpcKeys.includes(v.countKey)))

/* ---------- each view asks for what it says ---------- */

check('the whole book narrows nothing', paramsOf('whole_book'), '')
check('my desk is my id', paramsOf('my_desk'), `who=${ME}`)
check('unallocated is nobody', paramsOf('unallocated'), 'who=nobody')
check('no diary date', paramsOf('adrift'), 'adrift=1')
check('promises due', paramsOf('promises_due'), 'sub=Promise+To+Pay')
check('gone quiet', paramsOf('gone_quiet'), `quiet=${QUIET_VIEW_DAYS}`)

/*
 * BROKEN PROMISES READS THE BUCKET, NOT THE SUB-STATUS, and the difference is the whole point of
 * the view. Swordfish files 40 accounts under 'Failed PTPs' while only 3 carry sub-status
 * 'Payment Default' — and 13 of the 40 still say 'Promise To Pay', a live promise the old system
 * had already flagged as broken. Reading the sub-status would find three of the forty and the
 * other thirty-seven would go unworked with nothing on screen to say so.
 */
check('broken promises reads the bucket', paramsOf('broken_promises'), 'bucket=Failed+PTPs')
check('...and reaches the query as one', q('bucket=Failed+PTPs').bucket, 'Failed PTPs')

/*
 * "My desk" resolves to a real id rather than a magic token. A link meaning a different desk
 * depending on who opens it cannot be sent to anybody, which is most of what a link is for.
 */
ok('my desk carries no "me" token', !paramsOf('my_desk').includes('me'))
check('a person with no account gets no desk filter', viewParams('my_desk', null).toString(), '')

/* ---------- every view is a real query ---------- */

for (const v of ACCOUNT_VIEWS) {
  const query = q(paramsOf(v.id))
  if (v.id === 'whole_book') ok('the whole book is unfiltered', !hasAccountFilters(query))
  else ok(`${v.label} narrows the book`, hasAccountFilters(query))
}

/* ---------- which view is lit ---------- */

check('an empty URL is the whole book', activeView(new URLSearchParams(''), ME), 'whole_book')
check('my desk is recognised', activeView(new URLSearchParams(`who=${ME}`), ME), 'my_desk')
check('somebody else’s desk is not a view', activeView(new URLSearchParams('who=other'), ME), null)

/*
 * EXACT MATCH, NOT "CONTAINS". The moment somebody narrows a view by hand it has stopped being
 * that view, and a tab that stays lit while the list beneath it says something else is worse
 * than no tab — it is the screen asserting something untrue about itself.
 */
check('a narrowed view is no longer that view',
  activeView(new URLSearchParams('adrift=1&duplum=1'), ME), null)
check('a view plus a search is not the view',
  activeView(new URLSearchParams('adrift=1&q=smit'), ME), null)

/*
 * The client is the exception, because scoping the book to one client is orthogonal to which
 * question is being asked of it. "My desk, at Growthpoint" is still My desk.
 */
check('a client does not unset the view',
  activeView(new URLSearchParams('adrift=1&client=abc'), ME), 'adrift')
check('a client alone is still the whole book',
  activeView(new URLSearchParams('client=abc'), ME), 'whole_book')
// An emptied control writes '' rather than deleting the key; that must not read as a filter.
check('a cleared control does not unset the view',
  activeView(new URLSearchParams('adrift=1&sub='), ME), 'adrift')

/* ---------- an agent is not shown somebody else's pile ---------- */

ok('a leader sees the unallocated pile', viewsFor(true).some((v) => v.id === 'unallocated'))
ok('an agent does not', !viewsFor(false).some((v) => v.id === 'unallocated'))
ok('...but still gets every other view', viewsFor(false).length === ACCOUNT_VIEWS.length - 1)

/* ---------- a team is a set of desks ---------- */

const teamCtx = { teamMembers: () => ['a', 'b', 'c'] }
check('a team becomes its members', q('team=t1', teamCtx).assignedToAny?.join(','), 'a,b,c')
ok('...and narrows the book', hasAccountFilters(q('team=t1', teamCtx)))
/*
 * AN UNKNOWN OR EMPTY TEAM MATCHES NOTHING. Treating "no members" as "no filter" would answer a
 * question about one team with the entire book — the most dangerous shape a filter can fail in,
 * because the answer looks authoritative and is the opposite of what was asked.
 */
check('a team with no members matches nothing', q('team=t1', { teamMembers: () => [] }).assignedToAny?.length, 0)
check('an unresolvable team matches nothing', q('team=t1').assignedToAny?.length, 0)
ok('...and still reads as narrowed', hasAccountFilters(q('team=t1')))
check('a team chip names the team',
  filterChips(new URLSearchParams('team=t1'), { teamName: () => 'Pre-legal' })[0].label, 'Pre-legal')

/* ---------- what the firm asked to be taken away ---------- */

const panel = readFileSync(new URL('../../src/pages/accounts/AccountFilters.tsx', import.meta.url), 'utf8')

/*
 * NO BUCKET CONTROL. "Bucket" is Swordfish's word for its own work queue and nobody at the firm
 * uses it, so as a filter label it was a question people could not answer. Its one piece of real
 * information survives as the Broken promises view.
 */
ok('the bucket control is gone', !/Any bucket/.test(panel))
ok('...but the bucket still reads back as a chip',
  filterChips(new URLSearchParams('bucket=Failed+PTPs'))[0].label === 'Broken promises')
ok('...and can still be cleared', !new URLSearchParams(
  [...new URLSearchParams('bucket=Failed+PTPs')].filter(([k]) => k !== 'bucket')).has('bucket'))

/* Mandate drift is not a filter any more, at the firm's instruction. */
ok('the mandate-rate control is gone', !/Off their mandate rate" note/.test(panel))
ok('...but the tile that counts it still links through',
  /drift', driftOnly \? null : '1'/.test(
    readFileSync(new URL('../../src/pages/accounts/AccountsList.tsx', import.meta.url), 'utf8')))

/* The team control is there, and only where teams exist. */
ok('the team control exists', /Any team/.test(panel))
ok('...and is not offered when there are none', /teams\.length > 0 &&/.test(panel))

/* ---------- the screen says what it is showing ---------- */

const list = readFileSync(new URL('../../src/pages/accounts/AccountsList.tsx', import.meta.url), 'utf8')

/*
 * THE SENTENCE THAT ANSWERS "IS THIS EVERYTHING?" before anybody has to ask it. Without it a
 * filter left set an hour ago looks exactly like a small book, and the only clue is a number on
 * a button somebody has to notice.
 */
ok('the scope line states both figures', /Showing \{shown\.toLocaleString\('en-ZA'\)\} of \{total\.toLocaleString\('en-ZA'\)\}/.test(list))
ok('...and names the client', /companyName \?\? 'all clients'/.test(list))
ok('...and says when it is narrowed', /narrowed/.test(list))
ok('...and offers the way back', /Show the whole book/.test(list))

/*
 * Pages are appended, not replaced, and merged by id. The book is ordered by account number and
 * rows move between pages while somebody reads — an account allocated, a handover landing — so a
 * blind concat shows the same account twice, which reads as a duplicate in the book rather than
 * as a paging artefact.
 */
ok('more pages are appended', /setAccounts\(\(prev\) => \{/.test(list))
ok('...without duplicating a row', /seen = new Set\(prev\.map\(\(a\) => a\.id\)\)/.test(list))
/*
 * The first-page effect must not depend on `page`, or loading more refetches from the top and
 * throws away everything already on screen — a Load more button that loses your place.
 */
/*
 * `pageSize` belongs in there and `page` does not, and the difference is the whole point:
 * changing how many rows to show is a NEW first page, while loading the next one must append.
 */
ok('loading more does not reset the list', /\}, \[query, pageSize\]\)\n\n  async function loadMore/.test(list))
ok('...but changing the page size does', /\[query, pageSize\]/.test(list))
ok('...and the effect never depends on the page number', !/\}, \[query[^\]]*\bpage\b[^S]/.test(list))
ok('the selection survives loading more',
  /setTicked\(new Set\(\)\); setAllMatching\(false\) \}, \[key\]\)/.test(list))

/* ---------- how many rows, chosen at the top ---------- */

/*
 * A SHUFFLE IS THREE THOUSAND ACCOUNTS AT ONCE. The firm's own word for moving everything that
 * has gone two month ends since handover without paying, and a hundred rows at a time makes that
 * twenty-nine presses of a button at the foot of the table — which is exactly where the only
 * control used to be, so asking for more meant scrolling past everything already on screen.
 */
ok('the page size is a choice', /const PAGE_SIZES = \[100, 500, 1000, 2000\] as const/.test(list))
ok('...that the list actually uses', /pageSize \}\)/.test(list))
ok('...offered beside the count it changes', /ml-auto flex items-center gap-1/.test(list))
/*
 * And only where it would do something. A "2 000" button on a client with 310 accounts does
 * nothing when pressed, and a control that does nothing is one people stop trusting the rest of.
 */
ok('a size the book cannot fill is not offered', /PAGE_SIZES\.filter\(\(n, i\) => i === 0 \|\| n <= total \* 2\)/.test(list))
ok('...but the smallest always is', /i === 0 \|\|/.test(list))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Seven views, each a real URL with a count on it. The screen states what it is showing and offers
the way back to the whole book. A team is a set of desks, and an empty team matches nothing.`)
