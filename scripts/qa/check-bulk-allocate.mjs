/**
 * Moving accounts between desks, in bulk.
 *
 * THE DANGEROUS ACTION IN THE WHOLE APP. Everything else edits one account that somebody is
 * looking at; this changes hundreds that they are not. It cannot be undone except by another
 * bulk action in the other direction, and the accounts it moves wrongly are invisible by
 * definition — they are the ones that were never on screen.
 *
 * So every check here is about scope: that the list and the write agree about which accounts,
 * that a selection cannot outlive the question it was made under, and that the number a person
 * confirms against is one the database has just counted rather than one the screen remembers.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-bulk-allocate.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, actual) => {
  if (actual === true) { pass += 1; return }
  failures.push(`${name}\n    expected true\n    got      ${JSON.stringify(actual)}`)
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const alloc = read('../../src/lib/accountAllocation.ts')
const book = read('../../src/lib/accountBook.ts')
const list = read('../../src/pages/accounts/AccountsList.tsx')
const modal = read('../../src/pages/accounts/AllocateModal.tsx')

/* ---------- one definition of "which accounts" ---------- */

/*
 * The list asks "which accounts" and the bulk action asks "which accounts am I about to change".
 * Written twice, those drift — and the failure is not a wrong list, it is allocating two hundred
 * accounts nobody saw. One builder, used by both, is the only thing that makes that impossible.
 */
ok('the clause builder exists', /export function applyAccountFilters/.test(book))
ok('the list goes through it', /const query = applyAccountFilters\(/.test(book))
ok('the bulk selection goes through it', /applyAccountFilters\(\s*\n?\s*supabase\.from\('debtor_accounts'\)\.select\('id'/.test(alloc))
ok('the count goes through it too',
  (alloc.match(/applyAccountFilters\(/g) ?? []).length >= 2)

/*
 * NO SECOND SET OF CLAUSES. A .eq or .ilike against debtor_accounts anywhere in the allocation
 * module would be a filter the list does not know about.
 */
ok('allocation writes no filters of its own',
  !/from\('debtor_accounts'\)[\s\S]{0,200}\.(ilike|gte|lte)\(/.test(alloc))

/* ---------- the write is by id, never by re-running the filter ---------- */

/*
 * Between the count and the write an account can be paid, frozen or reassigned by somebody else.
 * An update that re-matched the filter would quietly move accounts nobody counted — the exact
 * failure the confirmation exists to prevent, arriving after the confirmation.
 */
ok('ids are resolved before the write', /async function resolveIds/.test(alloc))
ok('the update is keyed by id', /\.update\(\{ assigned_to: input\.toUserId \}\)\s*\n?\s*\.in\('id', ids\)/.test(alloc))
ok('nothing updates by filter', !/applyAccountFilters\([\s\S]{0,80}\.update\(/.test(alloc))

/* ---------- a ceiling, and it is about attention rather than about SQL ---------- */

ok('there is a ceiling', /export const BULK_CEILING = \d+/.test(alloc))
/*
 * PRESENCE BEFORE ORDER. indexOf returns -1 for something that is not there, and -1 is less than
 * every real position — so an order-only assertion passes vacuously the moment the guard it is
 * ordering is deleted, which is the one change it exists to catch.
 */
ok('the ceiling is actually enforced', alloc.includes('throw new BulkTooLarge'))
ok('it is enforced before the write',
  alloc.indexOf('throw new BulkTooLarge') < alloc.indexOf(".update({ assigned_to"))
/*
 * The fetch asks for one more than the ceiling. Asking for exactly the ceiling would make a
 * selection of precisely that size indistinguishable from one far larger that had been truncated,
 * and the action would proceed on a silently cut-down list.
 */
ok('the fetch can tell "at the ceiling" from "over it"', /limit\(BULK_CEILING \+ 1\)/.test(alloc))
ok('the message says what to do instead', /a client at a time/.test(alloc))

/* ---------- every move leaves a trail ---------- */

/*
 * "Who was supposed to be working this in March" is asked every time a client complains, and a
 * book where accounts change hands invisibly has no answer.
 */
ok('each account gets a note', /async function noteEach/.test(alloc))
ok('the note names the destination', /Moved to \$\{input\.toUserName\}/.test(alloc))
ok('...and the unallocated pile by name', /returned to the unallocated pile/.test(alloc))
ok('...and who did it', /input\.actor\.name \? ` by \$\{input\.actor\.name\}`/.test(alloc))

/*
 * source: 'manual', not 'system'. The timeline's default filter hides system notes, and an
 * allocation somebody has to answer for later is not machine chatter.
 */
ok('notes are visible by default', /source: 'manual'/.test(alloc))
ok('...and system is not used', !/source: 'system'/.test(alloc))

/*
 * A FAILED NOTE DOES NOT FAIL THE MOVE. The allocation is already written by then; throwing
 * would tell the caller nothing happened when it did, which is worse than a short trail.
 */
ok('a failed note is counted, not thrown', /notesFailed/.test(alloc))
ok('...and the count reaches the person', /could not be noted on the timeline/.test(modal))

/* ---------- the selection cannot outlive its question ---------- */

/*
 * Tick eleven rows, narrow the filters, allocate: without this the action runs on accounts no
 * longer on screen. It is the worst kind of bulk mistake because it looks exactly like the right
 * one — the bar says eleven and eleven accounts move.
 */
ok('changing the filters clears the selection',
  /useEffect\(\(\) => \{ setTicked\(new Set\(\)\); setAllMatching\(false\) \}, \[key\]\)/.test(list))
/*
 * Keyed on the QUESTION, not on the page. Pages are appended now, so clearing on `page` as well
 * would drop the ticks the moment somebody loaded more rows to tick — which reads as the app
 * losing the selection at random.
 */
ok('...but survives loading another page', !/setAllMatching\(false\) \}, \[key, page\]\)/.test(list))

/*
 * Unticking one row while "all matching" is on must not silently cancel six hundred. It drops to
 * this page minus that row, which is a visible, countable thing.
 */
ok('unticking under "all matching" falls back to the page',
  /const base = allMatching \? new Set\(pageIds\) : ticked/.test(list))
ok('the header box agrees with the rows under "all matching"',
  /const allOnPageTicked = allMatching \|\|/.test(list))

/* ---------- the number is the confirmation ---------- */

/*
 * Re-counted in the modal rather than carried in from the list: "all 214 matching" is a filter,
 * and a filter matches what it matches at the moment it runs. Confirming against a figure the
 * screen remembered a minute ago is confirming against nothing.
 */
ok('the modal counts for itself', /selectionCount\(selection\)/.test(modal))
ok('...and names the number before allocating', /count\.toLocaleString\('en-ZA'\)/.test(modal))
ok('...and will not run on a count it does not have', /count === null \|\| count === 0/.test(modal))

/*
 * "Select all matching" is offered only once the page is fully ticked and there is more beyond
 * it. Offered unconditionally it reads as the default action, which is the opposite of what a
 * five-hundred-account move should feel like.
 */
ok('select-all-matching is offered, not assumed',
  /allOnPageTicked && !allMatching && total > accounts\.length/.test(list))
ok('...and says what it means', /not just this page/.test(list))

/* ---------- allocation and referral are not two switches ---------- */

const write = readFileSync(new URL('../../src/lib/handOutWrite.ts', import.meta.url), 'utf8')
const handOutModal = readFileSync(new URL('../../src/pages/accounts/HandOutModal.tsx', import.meta.url), 'utf8')

/*
 * THE FIRM'S RULE: an allocation cannot happen without a referral, though a referral can happen
 * on its own. Putting an account on somebody's desk and booking nobody to ring it is precisely
 * how 355 accounts arrived belonging to a person and diarised by nobody — so that combination is
 * not offered at all, rather than being a checkbox somebody can clear by accident. It WAS a
 * checkbox until the firm corrected it.
 */
ok('there are two modes, not two flags', /export type HandOutMode = 'refer' \| 'allocate_and_refer'/.test(write))
ok('the old independent flags are gone', !/alsoAllocate|alsoBook/.test(write))
ok('...in the modal too', !/alsoAllocate|alsoBook/.test(handOutModal))
/*
 * No branch may skip the booking. An early return on "not booking" is exactly the shape that
 * would let an allocation stand alone again, so its absence is the thing to assert.
 */
ok('both modes book', !/if \(!input\.(alsoBook|mode)\) return/.test(write))
ok('only allocation is conditional', /if \(input\.mode === 'allocate_and_refer'\)/.test(write))
ok('the modal offers exactly the two', /Allocate and refer/.test(handOutModal) && /Refer only/.test(handOutModal))
ok('...and never offers allocate-without-booking', !/Allocate only|allocate_only/.test(handOutModal))

/* ---------- and several ways to choose who ---------- */

/*
 * Everyone, a grade, a team, or ticked by hand — but as quick SELECTIONS over one list, not four
 * modes. Modes would leave "I chose Elite, then unticked one" with nowhere to live.
 */
ok('everyone can be chosen at once', /setChosen\(new Set\(context\.collectors\.map/.test(handOutModal))
/*
 * `&& !c.ungraded` matters. An ungraded person is treated as Junior internally so they can be
 * given generic work — but clicking the "Junior" quick-pick should select the people a team
 * leader actually graded Junior, not sweep in everybody nobody has got round to grading.
 */
ok('...by grade', /c\.grade === g && !c\.ungraded/.test(handOutModal))
ok('...by team', /teamOf\(users, c\.userId\) === t\.id/.test(handOutModal))
ok('...and cleared', /onClick=\{\(\) => setChosen\(new Set\(\)\)\}/.test(handOutModal))
/*
 * A grade nobody holds, or a team with no collectors, is a button that appears to do nothing.
 * Offered only where it would narrow something.
 */
ok('an empty grade is not offered',
  /COLLECTOR_GRADES\.filter\(\(g\) => context\.collectors\.some\(\(c\) => c\.grade === g && !c\.ungraded\)\)/.test(handOutModal))

/*
 * THIRTY-FIVE COLLECTORS DO NOT FIT IN CARDS. Eight did; a real floor does not, and choosing four
 * of them meant scrolling past thirty-one. A capped, searchable list with the choice summarised
 * above it is what makes the modal usable at that size -- and the cap matters on its own, because
 * a modal taller than the screen hides its own buttons.
 */
ok('the list is searchable', /Search \$\{context\.collectors\.length\} collectors by name/.test(handOutModal))
ok('...and capped rather than growing with the team', /max-h-56 overflow-y-auto/.test(handOutModal))
ok('...with the choice visible while scrolling', /of \$\{context\.collectors\.length\} chosen/.test(handOutModal))
ok('...and a way back to just the chosen', /Show only chosen/.test(handOutModal))
/*
 * Ordered by who is taking most. Alphabetical buries the four people the plan actually used
 * somewhere in the middle of thirty-five.
 */
ok('the busiest are listed first',
  /\(taking\.get\(b\.userId\) \?\? 0\) - \(taking\.get\(a\.userId\) \?\? 0\)/.test(handOutModal))
ok('a team with no collectors is not offered',
  /teams\s*\n?\s*\.filter\(\(t\) => context\.collectors\.some/.test(handOutModal))
/* Choosing nobody is now reachable, so it must read as a state rather than an empty panel. */
ok('choosing nobody says so', /Nobody chosen, so there is nothing to plan/.test(handOutModal))

/* ---------- unallocated is a destination, not an absence ---------- */

/*
 * An agent leaves and their book has to go somewhere before it is shared out. Collapsing "choose
 * a person" and "take it off every desk" into one empty option would make the second unreachable
 * and the first destructive by accident.
 */
/*
 * AllocateModal is the earlier, simpler screen and is no longer what the bulk bar opens —
 * HandOutModal replaced it. Kept and still checked because it remains the plain "move these to
 * one desk" path, and an unused file that silently rots is worse than one nobody opens.
 */
ok('the empty option does nothing', /disabled=\{busy \|\| !toUserId/.test(modal))
ok('unallocated is its own choice', /value="nobody"/.test(modal))
ok('...and is translated to null on the way out', /toUserId === 'nobody' \? null : toUserId/.test(alloc + modal))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The list and the bulk action share one definition of "which accounts". The write is by id, the
count is taken by the database at the moment of confirming, and every account that moves says on
its own timeline who moved it and why.`)
