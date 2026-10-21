/**
 * THE PANEL IN FRONT OF A COLLECTOR WHILE THE DEBTOR IS ON THE LINE.
 *
 * SIX BEHAVIOURS, AND THE FIRM WROTE EVERY ONE OF THEM. The second is the one they said matters
 * most: "the opening script pops first, always... the workflow script underneath it is locked
 * until the collector ticks verified. This is the single most important behaviour in this prompt:
 * it is what stops a collector disclosing an account to the wrong person."
 *
 * WHY A SOURCE-READ CHECK AND NOT ONLY A UNIT ONE. The rules themselves are pure and are held in
 * check-call-scripts; what this holds is that the PANEL obeys them -- that the lock is a lock
 * rather than a heading further down the page, that nothing identifying is drawn above it, and
 * that the close really is barred without a disposition. A panel that shipped with the lock
 * removed would pass every unit check in the repository.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-call-panel.mjs
 */
import { readFileSync } from 'node:fs'
import {
  ALL_SCRIPTS, ALWAYS_AT_HAND, BRANCHES_AT_HAND, CLOSING_SCRIPTS, DISPOSITIONS, NEEDS_MORE,
  OBJECTIONS, OUTCOME_FOR_DISPOSITION, RECORDS_NOTHING, dispositionNote, needsMore, nodeFromLabel,
  nodeReached, outcomeFor,
} from '../../src/lib/callScripts.ts'
import { CALL_OUTCOMES } from '../../src/lib/callOutcome.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const panel = read('src/components/collections/CallScriptPanel.tsx')
const account = read('src/pages/accounts/AccountDetail.tsx')
const contacts = read('src/pages/accounts/AuthorisedContactsPanel.tsx')
const estate = read('src/pages/accounts/EstatePanel.tsx')
/* Comments stripped where an assertion would otherwise be satisfied by prose explaining the rule
   -- the trap check-silent-triggers records and check-account-templates repeats. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* ------------------------------------------------ 1. the opening script, always */

ok('the panel opens on the opening script', /openingScript\(debtorKind\)/.test(code(panel)))
/* AND THE ACCOUNT'S OWN SCRIPT IS WHAT FOLLOWS THE TICK, never what it opens with. */
ok('...and the workflow script only after the tick',
  /verified \? forState : opening/.test(code(panel)))

/* ------------------------------------------------ 2. the lock */

/*
 * THE LOCK IS THE WHOLE POINT. Asserted three ways, because there are three ways to lose it: the
 * tick could be missing, the script could be drawn anyway, or the identifying header could be
 * drawn above the lock.
 */
ok('there is a verification tick', /setVerified\(/.test(code(panel)))
ok('...and it records WHO was verified, not merely that somebody was',
  /capacity: 'debtor'/.test(code(panel)) && /who: c\.name/.test(code(panel)))
/*
 * NOTHING IDENTIFYING ABOVE THE LOCK. The firm: "the panel must not display the debtor's name,
 * the creditor or the balance until the verification tick is set, because a collector reads what
 * is on the screen." So the header before the tick is the reference and nothing else.
 */
ok('the header before the tick is the reference only',
  /nothing else until the person is verified/.test(panel))
ok('...and the name appears only on the verified branch',
  /verified\s*\n?\s*\? <>Verified:/.test(code(panel)))
/* THE TICK READS THE ACCOUNT'S OWN LIST, and only rows whose proof is on file: the firm's "a row
   with no proof on file is not an authorised contact, however long it has been there". */
ok('the tick offers only live authorised contacts',
  /authorised\.filter\(\(c\) => isLive\(c, today\)\)/.test(code(panel)))

/* ------------------------------------------------ 3. every branch one tap away */

ok('what they just said is one tap away', /BRANCHES_AT_HAND/.test(code(panel)))
ok('...and who is on the line', /ALWAYS_AT_HAND/.test(code(panel)))
ok('...and how the call ends', /CLOSING_SCRIPTS/.test(code(panel)))
/* THE FIRM NAMED SEVEN OF EACH. Asserted on the lists rather than on the panel, because the panel
   draws whatever is in them -- and a list that quietly lost a row is a branch nobody can reach. */
check('the firm’s seven branches', BRANCHES_AT_HAND.length, 7)
check('...and the seven section E scripts', ALWAYS_AT_HAND.length, 7)
check('every branch is a script that exists',
  [...BRANCHES_AT_HAND, ...ALWAYS_AT_HAND, ...CLOSING_SCRIPTS].filter((k) => !ALL_SCRIPTS.includes(k)),
  [])
/* DECEASED IS AMONG THEM. It is the branch a collector reaches in the worst moment of a call and
   the one the firm wrote a whole route for. */
ok('the deceased branch is one tap away', BRANCHES_AT_HAND.includes('script-deceased'))
ok('...and so is the estate script', ALWAYS_AT_HAND.includes('script-estate-next-of-kin'))

/* ------------------------------------------------ 4. merge-filled before it opens */

ok('a missing field is drawn as a named gap', /kind === 'text'/.test(code(panel))
  && /fieldLabel\(s\.field\)/.test(code(panel)))
/* THE FIELD'S NAME IN THE FIRM'S WORDS, off the same catalogue the composer's warning reads. */
ok('...named off the merge vocabulary', /MERGE_FIELDS\.collections\.find/.test(code(panel)))
ok('...and the gaps are counted before the words are read', /unanswered\(script, values\)/.test(code(panel)))

/* ------------------------------------------------ 5. no closing without a disposition */

ok('a live call cannot be closed without a code', /const canClose = !live \|\| disposition !== null/.test(code(panel)))
ok('...and the close respects it', /if \(!canClose\) return/.test(code(panel)))
/*
 * AND READING A SCRIPT WITH NOBODY ON THE LINE DEMANDS NOTHING. The firm's rule is about a CALL;
 * demanding a record of one that never happened is how the imported book came to have 58 accounts
 * claiming a promise to pay with 43 promises behind them.
 */
ok('reading a script off the account demands no disposition', /live=\{false\}/.test(code(account)))

/* ------------------------------------------------ the sixteen codes */

check('the firm’s sixteen codes', DISPOSITIONS.length, 16)
/* EVERY CODE RESOLVES, so a collector cannot pick one that falls through to nothing. */
check('every code has an entry in the outcome map',
  DISPOSITIONS.filter((d) => !(d.code in OUTCOME_FOR_DISPOSITION)).map((d) => d.code), [])
/* AND EVERY OUTCOME IT RESOLVES TO IS A REAL RUNG. A typo here is an account that moves nowhere. */
check('every outcome it resolves to is one of the eight rungs',
  Object.values(OUTCOME_FOR_DISPOSITION).filter((o) => o !== null && !(o in CALL_OUTCOMES)), [])
/*
 * THE FOUR CODES THAT MOVE NOTHING EACH SAY SO. A collector who picks PIF and is told nothing
 * walks away believing the file is closed -- and money is recorded off money, never off a call.
 */
check('the codes that record no position are the four that cannot',
  Object.entries(OUTCOME_FOR_DISPOSITION).filter(([, o]) => o === null).map(([c]) => c).sort(),
  ['DNC', 'MAND', 'PIF', 'SETL'])
check('...and each of them says what does carry it',
  ['PIF', 'SETL', 'MAND', 'DNC'].filter((c) => !RECORDS_NOTHING[c]), [])
ok('paid in full says the money is the record', /recorded off the money/.test(RECORDS_NOTHING.PIF))
/* THE FOUR THAT STOP EVERYTHING. The firm: "stop everything, route to the manager." */
check('the four hard stops', DISPOSITIONS.filter((d) => d.stops).map((d) => d.code).sort(),
  ['DEC', 'DRV', 'EXEC', 'INS'])

/* ------------------------------------------------ what a code writes */

/* THE CODE AND ITS CONSEQUENCE, both, in the firm's own words. A note reading "PTP" can only be
   read by somebody who already knows the shorthand; the reader is an attorney eighteen months on. */
ok('the note names the code', /^Call ended PTP/.test(dispositionNote('PTP')))
ok('...and what Raptor does with it', /pause collections/.test(dispositionNote('PTP')))
check('an unknown code still records the call', dispositionNote('ZZZ'), 'Call ended ZZZ.')
/*
 * AND THE THREE KINDS OF CODE THAT NEED A PERSON ARE NOT WRITTEN OFF A BUTTON. A promise needs an
 * amount and a date, a dispute needs a classification, a stop needs the practitioner's details --
 * recordOutcome refuses without them and is right to. The imported book is the evidence.
 */
ok('a promise needs the arrangement captured', needsMore('PTP') !== null)
ok('...a dispute needs its classification', needsMore('DISP') !== null)
ok('...and a hard stop needs the detail', ['DRV', 'DEC', 'INS', 'EXEC'].every((c) => needsMore(c)))
/* AND THE CODES THAT CAN BE WRITTEN IN FULL OFF THE BUTTON ASK FOR NOTHING, or the panel nags on
   every call and people stop reading it. */
check('the straightforward codes need nothing more',
  ['RTP', 'NAN', 'VM', 'TPC', 'WN', 'RPC'].filter((c) => needsMore(c) !== null), [])
check('every code that needs more is a code that exists',
  Object.keys(NEEDS_MORE).filter((c) => !DISPOSITIONS.some((d) => d.code === c)), [])

/* THE ACCOUNT PAGE WRITES IT, through the one function that writes an outcome anywhere. */
ok('the page records the call on the timeline', /dispositionNote\(code\)/.test(code(account)))
ok('...and moves the account through recordOutcome', /recordOutcome\(\{ accountId: account\.id, outcome, actor \}\)/.test(code(account)))
ok('...and only where the button is enough', /if \(outcome && !more\)/.test(code(account)))
/* THE NOTE IS RAPTOR'S WORDS, hidden when the timeline shows only what people wrote -- the
   collector's own account of the call goes in the note box. */
ok('the call note is marked as the system’s', /source: 'system'/.test(code(account)))

/* ------------------------------------------------ the objections */

check('the firm’s sixteen answers', OBJECTIONS.length, 16)
ok('they are shown beside whichever script is open', /OBJECTIONS\.map/.test(code(panel)))
/* THEY CARRY MERGE FIELDS TOO, filled from the same values the script was filled from -- an
   objection answer that reads {{collector_email}} aloud is the same failure one line over. */
ok('...merged from the same values', /<Merged text=\{o\.answer\}/.test(code(panel)))
ok('the "I already paid" answer is there',
  OBJECTIONS.some((o) => /already paid/i.test(o.said)))

/* ------------------------------------------------ which script, by state */

/* THE NODE IS READ OFF A CLOSED MAP of the firm's own labels, never by matching words: "Notice of
   intention to list" and "Listed" are the call before the default is reported and the call after
   it, and they are opposite conversations. */
check('the demand node', nodeFromLabel('Section 129 / letter of demand'), 'section_129')
check('...its SMS is the same stage', nodeFromLabel('Section 129 / letter of demand SMS'), 'section_129')
check('the notice of intention is the listing-prep call', nodeFromLabel('Notice of intention to list'), 'listing_prep')
check('...and Listed is the call after it', nodeFromLabel('Listed'), 'listed')
check('the final notice', nodeFromLabel('Final notice'), 'final_notice')
check('the reminder', nodeFromLabel('Reminder'), 'reminder')
check('the intended summons', nodeFromLabel('Intended summons'), 'intended_summons')
check('the handover', nodeFromLabel('Handover email'), 'handover')
check('a label nobody mapped is not guessed at', nodeFromLabel('Ask the client'), null)
check('nothing at all is nothing', nodeFromLabel(null), null)

/*
 * AND THE STAGE IS THE LAST NOTICE THAT ACTUALLY WENT, not the next one due: a call script is
 * about the letter the debtor is holding.
 */
check('the stage is the last notice sent', nodeReached([
  { label: 'Section 129 / letter of demand', sentAt: '2026-09-01T06:00:00Z' },
  { label: 'Final notice', sentAt: '2026-09-14T06:00:00Z' },
  { label: 'Listed', sentAt: null },
]), 'final_notice')
check('an unsent step is not a stage', nodeReached([{ label: 'Listed', sentAt: null }]), null)
check('nothing sent at all is nothing', nodeReached([]), null)
/* OUT OF ORDER STILL RESOLVES TO THE LATEST, because a re-issued sequence sends things in the
   order somebody pressed them. */
check('the latest by date wins, whatever order the rows are in', nodeReached([
  { label: 'Final notice', sentAt: '2026-09-14T06:00:00Z' },
  { label: 'Reminder', sentAt: '2026-09-20T06:00:00Z' },
]), 'reminder')

/* THE PAGE FEEDS IT FROM THE RUNS, which is where the sent steps live. */
ok('the page reads the stage off the workflow runs', /nodeReached\(runs\.flatMap/.test(code(account)))
/* AND THE FOUR HARD STOPS COME OFF THE PRACTITIONER STRUCTURE the book already carries, rather
   than off a sub-status somebody typed. */
ok('deceased is read off the account', /deceased: account\.dateOfDeath !== null/.test(code(account)))
ok('debt review is the debt counsellor', /underDebtReview: account\.practitionerKind === 'debt_counsellor'/.test(code(account)))
/* A VERBAL DISPUTE SUSPENDS NOTHING -- the firm's rule, already load-bearing in the triggers. */
ok('only a written dispute stops the call', /q\.inWriting && q\.receivedOn !== null/.test(code(account)))

/* ------------------------------------------------ who may be told */

ok('the account carries an authorised contacts panel', /AuthorisedContactsPanel/.test(code(account)))
/* PERMISSION, NOT CONTACT DETAILS -- said on the panel, because the thing it is confused with is
   account_contacts, which is numbers to dial. */
ok('...and says what it is', /Permission, not contact details/.test(contacts))
ok('a row with no proof authorises nothing', /Authorises nothing/.test(contacts))
ok('...and names what is still needed', /Still needed:/.test(contacts))
/* THE SPOUSE RULE, SAID WHERE SOMEBODY IS CHOOSING. The firm's first enforced rule and the one
   collectors most often get wrong. */
ok('a spouse is not authorised by marriage', /not authorised by marriage/.test(contacts))
ok('...and nothing may be said to them at all', /Nothing may be said\s*\n?\s*to them at all/.test(contacts))

/* ------------------------------------------------ the estate route */

ok('the estate panel exists on a deceased account', /EstatePanel/.test(code(account)))
ok('...and only there', /account\.dateOfDeath !== null \|\| account\.practitionerKind === 'executor'/.test(code(account)))
/*
 * THE DEADLINE IS A HARD TASK AND NOT A NOTE. The firm: "this is the one date on an estate file
 * that actually costs the client money if it is missed, so it needs a hard task, not a note."
 */
ok('the claim deadline is booked in the diary', /diarise\(\{/.test(code(estate)))
ok('...on the date it is actually due', /dueOn: deadline/.test(code(estate)))
/* A CALLBACK AND NOT A REVIEW. A review is the diary's last rung -- the kind with no event behind
   it -- and this has the most consequential event on the file behind it. */
ok('...as a callback rather than a routine review', /kind: 'callback'/.test(code(estate)))
ok('...owned by whoever has the file', /ownerId: account\.assignedTo/.test(code(estate)))
/* AND THE CREDIT LIFE QUESTION IS ASKED EVERY TIME. "The single fastest resolution available on a
   deceased account, and it is routinely missed." */
ok('the credit life prompt is on the panel', /ESTATE_PROMPTS/.test(code(estate)))
/* NOTHING IS DISCLOSED UNTIL AN EXECUTOR IS ON FILE, said on the panel in the firm's own terms:
   not the balance, not the creditor, not that the account exists. */
ok('no executor means nothing may be said', /nobody may be told/.test(estate))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-call-panel: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
