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
  ESCALATION_KINDS, ESCALATION_KIND_ORDER, REQUEST_SOURCES,
  escalationChargeable, escalationNote,
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

/* ---------------- who is being asked, which is not who is doing it ---------------- */

check('there are three sources', REQUEST_SOURCES.map((r) => r.value), ['client', 'debtor', 'file'])
ok('the box asks which', /Who are we asking\?/.test(modal))
ok('...and passes it only on a request',
  /requestFrom: kind === 'request' \? requestFrom : undefined/.test(modal))
/* DECIDED IN THE WRITE, not trusted to the caller -- the same lock `category` has, so a future
   screen that forgets cannot put a source on a dispute. */
ok('the write puts a source only on a request',
  /request_from: \(input\.kind \?\? 'dispute'\) === 'request' \? \(input\.requestFrom \?\? null\) : null/.test(lib))
/* AND THE MAPPER CARRIES IT BACK. CLAUDE.md's own warning: a column in the table, the type and the
   select but missing from the hand-written mapper reads as undefined for ever and nothing fails. */
ok('...and the mapper reads it back', /requestFrom: \(r\.request_from \?\? null\)/.test(lib))

/* ---------------- the database holds all of it ---------------- */

ok('the database knows the kind', /'dispute','request','help','litigation','import'/.test(sql))
ok('...and lets nothing else carry a source',
  /account_queries_from_only_on_request[\s\S]{0,140}?kind = 'request' or request_from is null/.test(sql))
/*
 * A REQUEST ALWAYS SAYS WHO IT IS FROM -- and the spelling matters. `request_from = any(array[…])`
 * is NULL when the column is NULL, `false OR NULL` is NULL, and a CHECK constraint PASSES on NULL:
 * the obvious version accepted a request that named nobody. Rehearsing the migration in a
 * transaction is what caught it, and this assertion is what keeps the fix.
 */
ok('...and a request always names one',
  /request_from is not null and request_from = any \(array\['client','debtor','file'\]\)/.test(sql))

/* ---------------- and the screen says which is which ---------------- */

/* A PANEL OF FOUR KINDS UNDER ONE OF THEIR NAMES IS PART OF THE DISORGANISATION: it made "send the
   March statement" look like a debtor objecting to the debt. */
ok('the panel is no longer named for one of the four', !/>Disputes</.test(panel))
ok('...and says what it holds', /Disputes &amp; requests/.test(panel))
/* ON EVERYTHING BUT A DISPUTE. Labelling the default adds a word to every card to say nothing. */
ok('a card says what kind it is', /q\.kind !== 'dispute' && \(/.test(panel))
ok('...and a request says who is being asked', /from the client/.test(panel))

console.log(`\ncheck-request-kind: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
