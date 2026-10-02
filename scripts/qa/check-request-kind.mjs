/**
 * A REQUEST IS NOT A DISPUTE, AND THEY HAVE DIFFERENT PHYSICS.
 *
 * THE FIRM: "sometimes we get like disputes, not a dispute, it's like the clerk that might request
 * some information... requesting additional information doesn't justify something as serious as a
 * dispute... the whole dispute situation for me currently just feels very disorganised."
 *
 * WHAT WENT WRONG WAS NOT LABELLING, IT WAS PHYSICS. A dispute is a STATE OF THE ACCOUNT: in
 * writing it holds every collection sequence, runs a ten-business-day clock, ends in a finding
 * that decides whether a statutory sequence resumes, and is charged to the debtor. A request is a
 * PIECE OF WORK: it holds nothing, ends when the thing arrives, and several are open at once.
 * With only the first door available, a clerk needing a statement filed a dispute -- which stopped
 * the collection sequences on an account nobody was objecting to.
 *
 * SO THE ASSERTIONS HERE ARE ABOUT WHAT A REQUEST MUST **NOT** DO. Its being offered is the easy
 * half; its not behaving like a dispute is the half that would go wrong silently.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-request-kind.mjs
 */
import { readFileSync } from 'node:fs'
import {
  ESCALATION_KINDS, ESCALATION_KIND_ORDER, REQUEST_KINDS, QUERY_CATEGORIES,
  escalationChargeable, escalationNote, explanationMissing,
} from '../../src/lib/disputeCategories.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const sql = read('supabase/schema.sql')
const lib = code('src/lib/accountQueries.ts')
const modal = code('src/pages/accounts/EscalateModal.tsx')
const panel = code('src/pages/accounts/QueryPanel.tsx')

/* ---------------- it exists and it is offered ---------------- */

ok('a request is a kind of its own', !!ESCALATION_KINDS.request)
ok('...offered in the escalate box', ESCALATION_KIND_ORDER.includes('request'))
/* SECOND, NOT LAST: it is the one that gets picked most, and the one whose absence pushed small
   things into a dispute. */
check('...second, under the dispute', ESCALATION_KIND_ORDER.indexOf('request'), 1)
/* AND THE IMPORT'S KIND IS STILL NOT ON THE MENU -- it is raised by the import, which knows which
   cell was wrong; an agent cannot decide a client's handover sheet was mistyped. */
ok('...and the import is still not offered', !ESCALATION_KIND_ORDER.includes('import'))

/* ---------------- and it never behaves like a dispute ---------------- */

/*
 * NEVER CHARGEABLE, WHICH IS THE ONE THAT COSTS MONEY IF IT DRIFTS. Item 3 recovers time the
 * DEBTOR caused somebody to spend. A clerk chasing a client for a statement the client should have
 * attached is the client's failing, and billing a debtor for their creditor's admin would not
 * survive being asked about.
 */
check('a request charges the debtor nothing', escalationChargeable('request'), false)
/* AND THE DISPUTE STILL DOES, or this check would pass by making everything free. */
check('...while a dispute still does', escalationChargeable('dispute'), true)
check('...and it is still the only one that does',
  Object.entries(ESCALATION_KINDS).filter(([, m]) => m.chargeable).map(([k]) => k), ['dispute'])
/* NOTHING TO CLASSIFY. QUERY_CATEGORIES is a list of ways a debtor objects, and "I need the March
   statement" is none of them. The database refuses a category here too. */
check('...and there is nothing to classify', ESCALATION_KINDS.request.needsCategory, false)
/* ITS OWN WORDS ON THE TIMELINE, or a request reads as a debtor objecting in the one place
   somebody reads the account's history. */
ok('it is recorded as what it is',
  escalationNote('request', 'the March statement').startsWith('Information requested:'))
ok('...and not as a dispute', !/Dispute raised/.test(escalationNote('request', 'x')))

/* ---------------- who it can go to ---------------- */

/*
 * ANYBODY IN THE FIRM, at the firm's choosing. The dispute's short list exists because a FINDING
 * needs somebody with standing over the person who raised it; nothing about "send me the March
 * statement" needs standing, and the person who can answer it is often neither a team leader nor a
 * liaison. Narrowing it would send somebody hunting for a name and then logging a dispute to reach
 * them -- which is the fault this kind exists to remove.
 */
check('a request may go to anybody', ESCALATION_KINDS.request.goesTo, 'anyone')
check('...while a dispute goes to the liaison', ESCALATION_KINDS.dispute.goesTo, 'liaison')
ok('the box offers everybody else on a request',
  /kind === 'request' && everybodyElse\.length > 0/.test(modal))
/* NOBODY TWICE: a liaison manager who is also this client's liaison is one person, and a select
   carrying their name twice reads as two people with the same name. */
ok('...without offering anybody twice',
  /users\.filter\(\(u\) => !alreadyOffered\.has\(u\.id\)\)/.test(modal))
/* AND THE SHORT LIST IS STILL SHORT ON A DISPUTE. */
ok('...and a dispute is still held to the three', /kind === 'request'\s*\?\s*'Anybody in the firm/.test(modal))

/* ---------------- what is being asked for, which is not who it is asked of ---------------- */

/*
 * THE FIRM: "instead of asking who are we asking, ask what are we asking, and then give it to."
 *
 * AND ASKING **WHO** WAS THE MISTAKE, not merely the wrong order. They asked of the version this
 * replaces: "from the debtor -- how would we request something from the debtor other than a
 * written dispute, which already has that workflow in place?" WHO IS BEING ASKED IS ALREADY ON THE
 * TICKET -- it is whoever it was given to. Storing it as well meant two fields that could
 * disagree ("from the client", given to the collections agent) with nothing able to say which was
 * true.
 */
ok('the box asks what is wanted', /What are we asking for\?/.test(modal))
ok('...and no longer asks who of', !/Who are we asking/.test(modal))
ok('...and nothing carries a source any more', !/requestFrom|request_from/.test(lib))
/* SHAPED LIKE THE DISPUTE'S CATEGORY, because it does the same job: a closed list so a board of
   requests sorts by something other than free text. */
ok('the list is the same shape as the dispute’s categories',
  REQUEST_KINDS.every((r) => typeof r.value === 'string' && typeof r.examples === 'string'))
ok('...and every entry says what it covers', REQUEST_KINDS.every((r) => r.examples.length > 10))
/* THE STATEMENT LEADS, because it is the document a handover most often arrives without -- and the
   box opens on the first entry, so the order is a default rather than a list. */
check('the statement is what the box opens on', REQUEST_KINDS[0].value, 'Statement of account')
/*
 * PROOF OF COMMUNICATION, ASKED FOR BY NAME -- and the assertion is that it is IN THE PROOFS,
 * not merely in the list. The commonest reason a liaison asks for it is a debtor saying nobody
 * ever contacted them, and a section 129 turns on delivery rather than quantum, so what was sent
 * and when is the whole answer to that objection. It lives on the CLIENT's system far more often
 * than on ours, which is what makes it a request rather than something to go and look up.
 *
 * THE CONTIGUITY IS THE POINT. A reader scanning a nine-item select looks for "Proof of ..." as
 * one group; a fourth proof appended at the bottom, above Other, is present and still not found.
 */
const proofs = REQUEST_KINDS.map((r, i) => [r.value, i]).filter(([v]) => v.startsWith('Proof of'))
ok('the firm can ask for what was already said to the debtor',
  REQUEST_KINDS.some((r) => r.value === 'Proof of communication'))
check('...and it is one of the proofs', proofs.map(([v]) => v), [
  'Proof of delivery', 'Proof of payment', 'Proof of communication',
])
ok('...which are offered together rather than scattered',
  proofs.every(([, i], n) => n === 0 || i === proofs[n - 1][1] + 1))

/* AND "OTHER" IS LAST AND PRESENT, or a request that is none of the named kinds has nowhere to go
   and gets logged as the nearest wrong one. */
check('...and Other is the last resort', REQUEST_KINDS[REQUEST_KINDS.length - 1].value, 'Other')
/*
 * WHICH MEANS "OTHER" HAS TO CARRY ITS OWN EXPLANATION, exactly as the dispute's does -- the same
 * function, so the two cannot drift into different ideas of how much is enough.
 */
ok('Other needs saying what it was', explanationMissing('Other', 'stuff'))
ok('...and a named kind does not', !explanationMissing(REQUEST_KINDS[0].value, ''))
ok('...by the same rule the dispute uses',
  QUERY_CATEGORIES.some((c) => c.value === 'Other'))
/* DECIDED IN THE WRITE, not trusted to the caller -- the same lock `category` has, so a future
   screen that forgets cannot put one on a dispute. */
ok('the write puts it only on a request',
  /request_for: \(input\.kind \?\? 'dispute'\) === 'request' \? \(input\.requestFor\?\.trim\(\) \|\| null\) : null/.test(lib))
/* AND THE MAPPER CARRIES IT BACK. CLAUDE.md's own warning: a column in the table, the type and the
   select but missing from the hand-written mapper reads as undefined for ever and nothing fails. */
ok('...and the mapper reads it back', /requestFor: \(r\.request_for \?\? null\)/.test(lib))

/* ---------------- and no kind wears another kind's words ---------------- */

/*
 * THE FIRM, READING A REQUEST BOX BACK: "it says like recommend for litigation. Why is that?"
 *
 * THE BUTTON AND THE FEE LINE WERE AN IF-ELSE CHAIN WITH A FALLBACK --
 * `kind === 'dispute' ? … : kind === 'help' ? … : <litigation>` -- so a kind that was neither
 * inherited the last branch. Adding `request` was all it took, and nothing failed: the box simply
 * offered to recommend litigation for a statement.
 *
 * SO THE WORDS LIVE ON THE KIND. A record cannot fall through, and a missing entry is a type error
 * before it is a screen. This is the assertion that keeps it there.
 */
ok('every kind carries its own button',
  ESCALATION_KIND_ORDER.every((k) => (ESCALATION_KINDS[k].submitLabel ?? '').length > 0))
check('...and no two press the same',
  new Set(ESCALATION_KIND_ORDER.map((k) => ESCALATION_KINDS[k].submitLabel)).size,
  ESCALATION_KIND_ORDER.length)
/* A REQUEST DOES NOT OFFER TO SUE. The specific wrong word the firm read, named so this cannot
   come back wearing a different chain. */
ok('a request does not offer to recommend litigation',
  !/litigation/i.test(ESCALATION_KINDS.request.submitLabel))
/* AND THE FREE-OF-CHARGE LINE THE SAME WAY, on every kind that charges nothing. */
ok('every free kind says why it is free',
  ESCALATION_KIND_ORDER.filter((k) => !ESCALATION_KINDS[k].chargeable)
    .every((k) => (ESCALATION_KINDS[k].freeNote ?? '').length > 20))
ok('...and a request’s reason is its own',
  !/attorneys/i.test(ESCALATION_KINDS.request.freeNote)
  && !/supervising/i.test(ESCALATION_KINDS.request.freeNote))
/* READ OFF THE KIND ON THE SCREEN, or the record above is decoration. */
ok('the box reads the button off the kind',
  /ESCALATION_KINDS\[kind\]\.submitLabel/.test(modal))
ok('...and the fee line too', /ESCALATION_KINDS\[kind\]\.freeNote/.test(modal))
/* AND THE QUESTION ABOVE THE DESCRIPTION, which was the third copy of the same chain. */
ok('...and the question it asks', /ESCALATION_KINDS\[kind\]\.prompt/.test(modal))
ok('every kind asks its own question',
  ESCALATION_KIND_ORDER.every((k) => (ESCALATION_KINDS[k].prompt ?? '').endsWith('?')))
check('...and no two ask the same',
  new Set(ESCALATION_KIND_ORDER.map((k) => ESCALATION_KINDS[k].prompt)).size,
  ESCALATION_KIND_ORDER.length)
ok('...with no chain left to fall through',
  !/kind === 'help'\s*\n?\s*\?/.test(modal) && !/'Recommend litigation'/.test(modal))

/* ---------------- the database holds all of it ---------------- */

ok('the database knows the kind', /'dispute','request','help','litigation','import'/.test(sql))
ok('...and lets nothing else say what it wants',
  /account_queries_for_only_on_request[\s\S]{0,140}?kind = 'request' or request_for is null/.test(sql))
/*
 * A REQUEST ALWAYS SAYS WHO IT IS FROM -- and the spelling matters. `request_from = any(array[…])`
 * is NULL when the column is NULL, `false OR NULL` is NULL, and a CHECK constraint PASSES on NULL:
 * the obvious version accepted a request that named nobody. Rehearsing the migration in a
 * transaction is what caught it, and this assertion is what keeps the fix.
 */
ok('...and a request always says',
  /request_for is not null and length\(btrim\(request_for\)\) > 0/.test(sql))

/* ---------------- and the screen says which is which ---------------- */

/* A PANEL OF FOUR KINDS UNDER ONE OF THEIR NAMES IS PART OF THE DISORGANISATION: it made "send the
   March statement" look like a debtor objecting to the debt. */
ok('the panel is no longer named for one of the four', !/>Disputes</.test(panel))
ok('...and says what it holds', /Disputes &amp; requests/.test(panel))
/* ON EVERYTHING BUT A DISPUTE. Labelling the default adds a word to every card to say nothing. */
ok('a card says what kind it is', /q\.kind !== 'dispute' && \(/.test(panel))
ok('...and a request says what it wants', /q\.requestFor && <span/.test(panel))

/* ---------------------------------------------------------------------------------------------
 * A TICKET YOU RAISED IS STILL YOURS TO FOLLOW.
 *
 * THE FIRM, having raised a request from an account: "the ticket was created and then it doesn't
 * display in the debt collector's situation."
 *
 * IT WAS ON THE BOARD. IT WAS ON SOMEBODY ELSE'S. A request is raised by a collector and GIVEN to
 * the liaison who has to answer it, so `owner_id` is the liaison from the moment it saves — and
 * the disputes board scopes on owner and opens on the signed-in person. The collector pressed
 * Raise a ticket, watched it save, went to look, and found an empty board.
 *
 * AN OWNER IS WHO MUST ACT; A RAISER IS WHO IS WAITING ON IT. Both are working the same ticket.
 * ------------------------------------------------------------------------------------------- */

/* `lib` and `sql` are read at the top of this file; `code` strips comments, which every assertion
   below about an ABSENCE depends on — both of these files explain at length what they no longer do. */
const board = code('src/pages/accounts/DisputesBoard.tsx')

/*
 * THE COLUMN WAS ALWAYS WRITTEN AND NEVER READ BACK, which is the whole reason this could not be
 * fixed in the board alone. CLAUDE.md's own warning, and it had happened again: a column present in
 * the table, written on every insert, and missing from the hand-written mapper reads as `undefined`
 * for ever and nothing fails.
 */
ok('a ticket records who raised it', /raised_by: input\.raisedBy/.test(lib))
ok('...and the mapper reads it back', /raisedBy: r\.raised_by \?\? null/.test(lib))
ok('...and it is on the type, not only in the row', /^\s*raisedBy: string \| null$/m.test(lib))
/* THE NAME IS NOT THE ID. `raised_by_name` was already read, which is why the absence looked like
   presence to anybody scanning the mapper -- a name cannot be compared to a signed-in user. */
ok('...which is the id, not just the name', /raisedByName: r\.raised_by_name/.test(lib))

/*
 * AND THE BOARD'S "MINE" MEANS EITHER. Held as the one predicate rather than as two comparisons
 * written out twice: the cards and the counter strip both scope, and a board whose figures
 * disagree with the cards under them is worse than one that shows too little.
 */
ok('the board scopes on owned OR raised',
  /r\.ownerId === who \|\| r\.raisedBy === who/.test(board))
ok('...through one predicate both the cards and the totals use',
  (board.match(/isMine\(r, scope\)/g) ?? []).length >= 2)
ok('...and no longer compares the owner by hand', !/r\.ownerId !== scope/.test(board))
ok('...nor in the totals', !/r\.ownerId === scope/.test(board))
/* AND THE PICKER SAYS SO. A name that now selects more than that person owns would read as a leak
   if the control went on claiming to filter by owner alone. */
ok('the picker says what it selects', /owned or raised/.test(board))

/*
 * THE SIDEBAR BADGE IS DELIBERATELY NOT CHANGED, and this is an absence worth holding. A badge
 * counts work waiting on YOU; a ticket sitting with the liaison is not that, and a badge you
 * cannot clear by doing your own work is a badge people stop reading — the argument is written
 * beside the query itself. Looking is the board's job, nagging is the badge's, and widening the
 * badge to match the board would quietly undo it.
 */
/* THE LAST DEFINITION IS THE LIVE ONE — schema.sql is append-only, and reading with indexOf lands
   on a copy a later migration replaced. CLAUDE.md names this exact trap. */
const navCounts = sql.slice(
  Math.max(sql.lastIndexOf('create or replace function public.nav_counts('),
    sql.lastIndexOf('create function public.nav_counts(')))
ok('the nav badge was found', navCounts.includes('account_queries'))
const disputesCount = navCounts.slice(navCounts.indexOf('from public.account_queries'),
  navCounts.indexOf('from public.account_queries') + 200)
ok('...and still counts only what is waiting on you', /owner_id = auth\.uid\(\)/.test(disputesCount))
ok('...not what you raised and gave away', !/raised_by/.test(disputesCount))

console.log(`\ncheck-request-kind: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
