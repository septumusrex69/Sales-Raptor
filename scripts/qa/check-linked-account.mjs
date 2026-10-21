/**
 * One debtor, two accounts from the same client — recognised, described, and offered a desk.
 *
 * THE FIRM, on a row refused for "Reference BF-308 appears twice in this file": "it's the same
 * reference number, but two accounts. It could be like a linked account -- just call it linked
 * account, not other account. The first thing that should happen is it should ask you: this looks
 * like a linked account, do you want to accept it or reject it? But there should be an accept
 * option ... usually these accounts should be worked by the same people, so we need to give that
 * option as well."
 *
 * WHAT IS WORTH CHECKING HERE is the description and the suggestion, because both are read by a
 * person making a decision that opens a ledger. The refusal-to-warning half is asserted in
 * check-handover-import.mjs, where the planner is.
 *
 * Run: node --experimental-strip-types scripts/qa/check-linked-account.mjs
 */
import { readFileSync } from 'node:fs'
import { linkedMessage, linkedSummary, suggestedDesk } from '../../src/lib/linkedAccount.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass += 1
  else failures.push(`${name}\n    expected ${e}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const HELD = {
  reference: 'BF0042', clientReference: 'BF-308', name: 'Ndlovu', idNumber: null, capital: 760,
  status: 'Active: Activated', subStatus: 'Promise To Pay',
  heldBy: 'jen-id', heldByName: 'Jennifer Adams',
}

/* ---------- what the other account reads as ---------- */

/*
 * THE POSITION, NOT THE STATUS COLUMN. CLAUDE.md's first rule, and the one most easily broken
 * here: `status = 'Active: Activated'` describes how the row got into the table and says nothing
 * about the debtor. Somebody deciding whether to take a second debt needs "Arranged".
 */
const summary = linkedSummary(HELD)
ok(`the account reads as a sentence (${summary})`, summary.includes('BF0042'))
ok('...with the surname', summary.includes('Ndlovu'))
ok('...where it stands, as a position', summary.includes('Arranged'))
ok('...and never the status column', !summary.includes('Active: Activated'))
ok('...and whose desk it is on', summary.includes('Jennifer Adams'))

/* An account nobody holds says so, rather than leaving a gap that reads as an oversight. */
ok('an unheld account says nobody holds it',
  /nobody/.test(linkedSummary({ ...HELD, heldBy: null, heldByName: null })))

/*
 * A SETTLED OR WRITTEN-OFF ACCOUNT STILL DESCRIBES ITSELF, and this is the case the suggestion
 * exists for somebody to overrule: the firm named it -- "or it's been withdrawn, or it's been
 * settled or whatever. Then we can see who worked on that account."
 */
ok('a closed account says it is closed',
  /Closed/.test(linkedSummary({ ...HELD, status: 'Written-off' })))

/* ---------- what the row says ---------- */

const onBook = { how: 'client-reference', line: null, account: HELD }
const message = linkedMessage(onBook, 'BF-308')
ok(`the message names the reference (${message})`, message.includes('BF-308'))
ok('...calls it a linked account, the firm’s word', /linked account/.test(message))
ok('...says where the other one is', message.includes('BF0042'))
/*
 * AND ENDS WITH BOTH ANSWERS. The screen cannot know whether a debtor genuinely owes twice and
 * neither can we -- only the person with both in front of them can. A message that recommended
 * one would be a guess wearing the firm's authority.
 */
ok('...and offers both answers', /Accept it if/.test(message) && /reject it if/.test(message))

/* The other way it is recognised, which is a different sentence about the same thing. */
const sameDebtor = linkedMessage({ how: 'same-debtor', line: 7, account: null }, 'BF-309')
ok('the same debtor twice names the row', /Row 7 is the other one/.test(sameDebtor))
ok('...and calls it a linked account too', /linked account/.test(sameDebtor))
/* It does NOT claim the reference was reused, because it was not -- that is the other test. */
ok('...without claiming the reference was reused', !/used reference/.test(sameDebtor))

/* ---------- the desk ---------- */

check('a held account suggests its desk', suggestedDesk(onBook), { id: 'jen-id', name: 'Jennifer Adams' })
check('an unheld account suggests nobody',
  suggestedDesk({ ...onBook, account: { ...HELD, heldBy: null, heldByName: null } }), null)
/*
 * A MATCH TO ANOTHER ROW IN THE SAME FILE SUGGESTS NOBODY, and this is the one worth being sure
 * of: that account does not exist yet, so there is no desk to follow onto. Suggesting one would
 * mean reading a desk off a row that has never been imported.
 */
check('a row in the same file has no desk to follow',
  suggestedDesk({ how: 'same-debtor', line: 7, account: null }), null)
check('nothing linked suggests nothing', suggestedDesk(null), null)

/* ---------- and it is offered on the screen, not merely computed ---------- */

const card = readFileSync(new URL('../../src/components/settings/HandoverImportCard.tsx', import.meta.url), 'utf8')
ok('the decision card asks for the desk', /suggestedDesk\(row\.planned\?\.linkedTo/.test(card))
/*
 * OFF UNTIL IT IS PRESSED. The account it points at may be settled, withdrawn, or on the desk of
 * somebody who has left -- and an account appearing on a collector's list that nobody chose to
 * put there is worse than one waiting in the pile, because a list is a place people trust.
 */
ok('...and it is off until somebody presses it', /const \[toDesk, setToDesk\] = useState\(false\)/.test(card))
ok('...and it travels with the decision rather than on its own',
  /onAccept\(note\.trim\(\) \|\| null, toDesk \? desk\?\.id \?\? null : null\)/.test(card))

const draft = readFileSync(new URL('../../src/lib/handoverDraft.ts', import.meta.url), 'utf8')
/*
 * SET ON THE INSERT, not allocated afterwards. An account that exists in the pile for a moment
 * and then moves reads, on a watched list, as somebody taking work off a collector.
 */
ok('the account opens on that desk',
  /\.\.\.\(row\.allocateTo \? \{ assigned_to: row\.allocateTo \} : \{\}\)/.test(draft))
/* Reopening a row un-decides where it was going as well as whether. */
ok('...and reopening a row clears the desk with the decision',
  /clearDraftRowDecision[\s\S]{0,260}allocateTo: null/.test(draft))

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
