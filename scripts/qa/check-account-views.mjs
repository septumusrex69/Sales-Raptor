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
  ACCOUNT_VIEWS, QUIET_VIEW_DAYS, activeView, landingParams, landingView, viewParams, viewsFor,
} from '../../src/lib/accountViews.ts'
import { parseBook } from '../../src/lib/accountBooks.ts'
import { ROLE_DEPARTMENTS, departmentOf } from '../../src/lib/departments.ts'
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
const rpcKeys = ['whole_book', 'active', 'on_hold', 'closed',
  'my_desk', 'unallocated', 'adrift', 'broken_promises', 'promises_due', 'gone_quiet']
ok('every view has a count the database returns', ACCOUNT_VIEWS.every((v) => rpcKeys.includes(v.countKey)))

/* ---------- each view asks for what it says ---------- */

/*
 * EVERY SHORTCUT CARRIES `book=active`, AND WHOLE BOOK IS THE ONE THAT DOES NOT.
 *
 * THE FIRM: "A frozen or closed account must never appear in a collector's queue or a dialler
 * campaign." These used to narrow the whole table, so "Gone quiet 19" counted accounts that were
 * paid up, written off or frozen -- work nobody may do, drawn as work waiting.
 *
 * IN THE URL RATHER THAN FORCED IN THE QUERY, because the URL is the state: a shortcut somebody
 * pastes to a colleague has to land on the same list, and a book applied invisibly would not
 * travel with it.
 */
check('the whole book narrows nothing, not even to a book', paramsOf('whole_book'), '')
check('my desk is my id, on the active book', paramsOf('my_desk'), `book=active&who=${ME}`)
check('unallocated is nobody', paramsOf('unallocated'), 'book=active&who=nobody')
check('no diary date', paramsOf('adrift'), 'book=active&adrift=1')
check('promises due', paramsOf('promises_due'), 'book=active&sub=Promise+To+Pay')
check('gone quiet', paramsOf('gone_quiet'), `book=active&quiet=${QUIET_VIEW_DAYS}`)
/* NO SHORTCUT REACHES ANOTHER BOOK, asserted over the list rather than one at a time -- a ninth
   view added without the book is this rule broken again. */
for (const v of ACCOUNT_VIEWS) {
  if (v.id === 'whole_book') continue
  check(`${v.id} stays on the active book`,
    new URLSearchParams(paramsOf(v.id)).get('book'), 'active')
}

/*
 * BROKEN PROMISES READS THE BUCKET, NOT THE SUB-STATUS, and the difference is the whole point of
 * the view. Swordfish files 40 accounts under 'Failed PTPs' while only 3 carry sub-status
 * 'Payment Default' — and 13 of the 40 still say 'Promise To Pay', a live promise the old system
 * had already flagged as broken. Reading the sub-status would find three of the forty and the
 * other thirty-seven would go unworked with nothing on screen to say so.
 */
check('broken promises reads the bucket', paramsOf('broken_promises'), 'book=active&bucket=Failed+PTPs')
check('...and reaches the query as one', q('bucket=Failed+PTPs').bucket, 'Failed PTPs')

/*
 * "My desk" resolves to a real id rather than a magic token. A link meaning a different desk
 * depending on who opens it cannot be sent to anybody, which is most of what a link is for.
 */
ok('my desk carries no "me" token', !paramsOf('my_desk').includes('me'))
check('a person with no account gets no desk filter, only the book',
  viewParams('my_desk', null).toString(), 'book=active')

/* ---------- every view is a real query ---------- */

for (const v of ACCOUNT_VIEWS) {
  const query = q(paramsOf(v.id))
  if (v.id === 'whole_book') ok('the whole book is unfiltered', !hasAccountFilters(query))
  else ok(`${v.label} narrows the book`, hasAccountFilters(query))
}

/* ---------- which view is lit ---------- */

/*
 * AN EMPTY URL IS THE ACTIVE BOOK AND NO SHORTCUT, which is what the screen now opens on. It used
 * to light "Whole book"; the firm's instruction was that the whole book is not where the screen
 * opens, and lighting it over a list of active accounts would be the tab asserting something
 * untrue about the list under it.
 */
check('an empty URL lights no shortcut', activeView(new URLSearchParams(''), ME), null)
/* AND IT IS STILL THE ACTIVE BOOK, which is the half that matters. */
check('...because an absent book means Active', parseBook(null), 'active')
check('whole book is still reachable, and lights',
  activeView(new URLSearchParams('book=whole'), ME), 'whole_book')
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
  activeView(new URLSearchParams('book=whole&client=abc'), ME), 'whole_book')
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
/*
 * ASSERTED ON THE DEPENDENCY LIST ITSELF, not on what happens to sit under it. This matched
 * `}, [query, pageSize])` followed immediately by `async function loadMore` -- which held only
 * while nothing was ever added between them, and the balances effect now is. What matters is
 * unchanged: `pageSize` belongs in that list and `page` does not.
 */
ok('loading more does not reset the list', /\}, \[query, pageSize\]\)/.test(list))
ok('...because the first page does not watch the page number',
  !/\}, \[query, pageSize, page\]\)/.test(list) && !/\}, \[page, query, pageSize\]\)/.test(list))
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

/* ---------------------------------------------------------------------------------------------
 * THE BOOK OPENS ON YOUR OWN DESK.
 *
 * THE FIRM: "by default they should only see their own book unless they change the scope function.
 * They should be able to see any account in the book, but when they click on Accounts, what they
 * view is their accounts that they are working."
 *
 * BOTH HALVES ARE HELD HERE, and the second is the one an optimisation would quietly remove. This
 * is a LANDING, not a permission: nothing is hidden, Whole book keeps its place and its count, and
 * a pasted link still wins. The assertions below are mostly about the ways it must NOT fire.
 * ------------------------------------------------------------------------------------------- */

/* WHO LANDS ON THEIR DESK: the department that carries accounts and a diary, read off the one map
   rather than a fourth hand-written list of roles. */
for (const role of ['Pre-legal Agent', 'Pre-legal Team Leader', 'Call Centre Manager']) {
  check(`a ${role} opens on their own desk`, landingView(departmentOf(role)), 'my_desk')
}
/* AND WHO DOES NOT. An administrator carries no book at all, so an empty My desk would be the
   whole of what Raptor showed them. */
for (const role of ['Administrator', 'Sales Representative', 'Liaison', 'Read Only']) {
  check(`a ${role} opens on the whole book`, landingView(departmentOf(role)), 'whole_book')
}
/* HELD OVER EVERY ROLE IN THE UNION, so a role added to UserRole and forgotten lands somewhere
   decided rather than wherever the map happened to leave it. */
for (const role of Object.keys(ROLE_DEPARTMENTS)) {
  ok(`${role} lands on a view that exists`,
    ACCOUNT_VIEWS.some((v) => v.id === landingView(departmentOf(role))))
}

/* ---------- and it only fires on a question nobody asked ---------- */

const land = (search, role = 'Pre-legal Agent') =>
  landingParams(new URLSearchParams(search), departmentOf(role), ME)

check('a bare /accounts lands on my desk', land('')?.toString(), `book=active&who=${ME}`)
/*
 * THE URL IS THE STATE ON THIS SCREEN, so anything it already says must win -- a link somebody was
 * sent, a bookmark, a filter built by hand. A redirect that overrode those would make every shared
 * link open on the reader's own desk instead of the account they were sent to.
 */
for (const asked of ['who=nobody', 'adrift=1', 'bucket=Failed+PTPs', 'q=Dube', 'quiet=30',
  `who=${ME}`, 'sub=Promise+To+Pay']) {
  check(`"${asked}" is left exactly as it is`, land(asked), null)
}
/*
 * AND THE WHOLE BOOK BUTTON SETS NOTHING AT ALL, which is why the page fires this once per visit
 * rather than on every change. Asserted here as the reason, and on the page itself below.
 */
check('the whole book is the absence of a question', viewParams('whole_book', ME).toString(), '')

/* A CLIENT IS NOT A QUESTION ABOUT THE BOOK. Arriving from a client record is still "show me the
   book" -- about one client -- so it lands on that client's share of my desk and carries the
   parameter through rather than dropping it. */
check('a client on its own still lands on my desk', land('client=c1')?.get('who'), ME)
check('...and the client is carried through', land('client=c1')?.get('client'), 'c1')
/* BUT A CLIENT BESIDE A REAL QUESTION IS LEFT ALONE, because the question is the thing being
   asked. */
check('a client beside a filter is left alone', land('client=c1&adrift=1'), null)
/* AN EMPTY PARAMETER IS NOT A QUESTION EITHER: the filter panel writes '' to clear, and a cleared
   filter must land like a bare URL rather than pinning somebody to the whole book. */
check('a cleared filter is still a bare page', land('adrift=&q=')?.toString(), `book=active&who=${ME}`)
/* PAGE IS NOT A QUESTION. It is how far down the same list somebody has read. */
check('a page number is not a question', land('page=2')?.get('who'), ME)

/*
 * AND NOTHING HAPPENS WITHOUT SOMEBODY TO BE. `my_desk` with no id is the whole book wearing a
 * different name -- viewParams sets nothing -- so firing before the session resolves would spend
 * the one redirect on a view that means something else entirely.
 */
check('no user, no redirect',
  landingParams(new URLSearchParams(''), 'Call centre', null), null)
/* AND THE LANDING IT PRODUCES IS A REAL VIEW, not a URL that merely looks like one. */
check('what it lands on is recognised as My desk',
  activeView(land('') ?? new URLSearchParams(), ME), 'my_desk')

/* ---------- the page fires it once, and says so when the desk is empty ---------- */

ok('the page lands the book on arrival', /landingParams\(params, departmentOf\(currentUser\.role\)/.test(list))
/*
 * ONCE PER VISIT, AND THIS IS THE ASSERTION THAT KEEPS THE WHOLE BOOK BUTTON WORKING. That button
 * sets no parameters, so a redirect running on every parameter change would bounce straight off it
 * and the tab could never be clicked at all -- a scope control that cannot widen the scope.
 */
ok('...once per visit, so the whole book can still be chosen',
  /const landed = useRef\(false\)/.test(list) && /if \(landed\.current/.test(list))
/*
 * READ OUT OF THE LANDING EFFECT ITSELF, which is the false positive this assertion walked into
 * first. The view-tab button a hundred lines below also writes `setParams(next, { replace: true })`
 * -- so a file-wide search found that, passed, and reported nothing when the landing was changed to
 * push a history entry. A landing that pushes means the back button walks into the redirect and
 * bounces straight forward again, which is a page somebody cannot leave.
 */
const landingEffect = list.slice(list.indexOf('const landed = useRef(false)'),
  list.indexOf('const setParam = useCallback') > list.indexOf('const landed = useRef(false)')
    ? list.indexOf('const setParam = useCallback')
    : list.indexOf('const landed = useRef(false)') + 900)
ok('the landing effect was found', /landingParams/.test(landingEffect))
ok('...and leaves no history entry behind it',
  /setParams\(next, \{ replace: true \}\)/.test(landingEffect))
/* AND ONLY ONCE THERE IS A USER, or the one redirect is spent on a view that cannot name a desk. */
ok('...and not before the session has a user', /if \(landed\.current \|\| !currentUser\) return/.test(list))
/*
 * NOTHING IS HIDDEN. The whole book keeps its tab and its count: this is where the firm's second
 * sentence lives -- "they should be able to see any account in the book" -- and it is the half an
 * optimisation would remove while the first half went on working perfectly.
 */
ok('the whole book is still offered to everybody',
  ACCOUNT_VIEWS.some((v) => v.id === 'whole_book' && !v.leadersOnly))
ok('...to a collector as well as a leader', viewsFor(false).some((v) => v.id === 'whole_book'))
/*
 * AND AN EMPTY DESK SAYS WHAT IS TRUE. The book now opens here, so a collector with nothing
 * allocated meets the empty state rather than a list -- and "No accounts match these filters" over
 * a page they did not filter reads as a fault in the software.
 */
ok('an empty desk says nothing is allocated', /Nothing is allocated to you\./.test(list))
/*
 * PRESENCE FIRST, THEN ORDER. `indexOf` returns -1, so an order-only assertion passes vacuously
 * the moment the branch it orders is deleted -- which is exactly the trap this codebase has
 * written down. A character-count window was tried first and is no better: it passes or fails on
 * how long the comment above the branch happens to be.
 */
const deskBranch = list.indexOf("current === 'my_desk' ?")
const filterBranch = list.indexOf(') : narrowed ?')
ok('the empty desk branch is there at all', deskBranch > 0)
ok('...and so is the filter one it did not replace', filterBranch > 0)
ok('...rather than blaming filters nobody set', deskBranch > 0 && deskBranch < filterBranch)
ok('...and offers the whole book from there', /Show the whole book/.test(list))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Seven views, each a real URL with a count on it. The screen states what it is showing and offers
the way back to the whole book. A team is a set of desks, and an empty team matches nothing.`)
