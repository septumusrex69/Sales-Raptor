/**
 * YOU RAISE A TICKET. YOU ESCALATE IT WHEN YOU HAND IT TO SOMEBODY ELSE.
 *
 * THE FIRM, LOOKING AT THE TWO BUTTONS ON AN EMAIL: "this thing, these two buttons take you to the
 * same page... I don't know if we say escalate, but then if it's a dispute, yeah, you can say
 * possibly escalate... but now you escalated yourself, for example, if you create this as a
 * dispute and you're handling it yourself. I mean, what are we doing for the wording?"
 *
 * TWO FAULTS, AND THE SECOND HAD BEEN IN THE BOX SINCE IT WAS BUILT.
 *
 *   THE TWO BUTTONS LANDED ON ONE SCREEN. "This is a dispute" and "This is a request" both opened
 *   a box headed "What is this email?" whose first question was a radio pair reading dispute /
 *   request -- so it re-asked, with equal weight, the question the press had just answered. The
 *   press appeared to have done nothing.
 *
 *   AND THE DOOR WAS NAMED AFTER ONE OF THE ANSWERS INSIDE IT. Further down, the same box asks
 *   "What happens to it now? -- Escalate it / Keep it, I will deal with it myself." So escalating
 *   was always one outcome of raising, and the screen called the whole act by that outcome's name.
 *   A dispute recorded and kept is raised and not escalated, which is exactly the case they named.
 *
 * SO THE RULE, WHICH THIS FILE HOLDS: RAISE is the act, always. ESCALATE is what happens when it
 * goes to somebody else, and it stays on the question that decides that and nowhere above it.
 *
 * AND "TICKET" IS THE FIRM'S OWN WORD, not one invented here -- "we could create the ticket like it
 * already exists for the dispute", "the ticket can be, the information request can be deleted".
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-raise-not-escalate.mjs
 */
import { readFileSync } from 'node:fs'
import { ESCALATION_KINDS, ESCALATION_KIND_ORDER } from '../../src/lib/disputeCategories.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* Comments off before any source assertion: this change is mostly WORDS, and the files explain at
   length why each one was chosen. A grep cannot tell the explanation from the label. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const modal = code('src/pages/accounts/EscalateModal.tsx')
const account = code('src/pages/accounts/AccountDetail.tsx')

/* ---------------- the door ---------------- */

ok('the account offers raising a ticket', /label="Raise a ticket"/.test(account))
/*
 * AND NOT "ESCALATE", which is the word the firm questioned. Asserted as an absence because the
 * old label is the thing that comes back: it is shorter, it was there for months, and it reads
 * fine until you are the person keeping the dispute yourself.
 */
ok('...rather than escalating it', !/label="Escalate"/.test(account))

/* ---------------- the box says what it is raising ---------------- */

/*
 * OFF AN EMAIL THE TITLE ECHOES THE BUTTON. This is what makes the two buttons land somewhere
 * visibly different, which is the complaint that started this.
 */
ok('the title off an email is the kind that was pressed',
  /ESCALATION_KINDS\[kind\]\.submitLabel/.test(modal))
ok('...and from the account it is raising a ticket', /'Raise a ticket'/.test(modal))
ok('...and on a link it says what linking does', /'Add this email to the dispute'/.test(modal))
/* THE OLD TITLES ARE GONE, both of them. */
ok('the box is no longer headed "Escalate this account"', !/'Escalate this account'/.test(modal))
ok('...nor "What is this email?", which asked what the press had answered',
  !/'What is this email\?'/.test(modal))

/* EVERY KIND HAS A SUBMIT LABEL TO BE TITLED BY, or the heading falls back to nothing. A record
   cannot fall through -- the same argument as the card chips. */
for (const k of ESCALATION_KIND_ORDER) {
  ok(`${k} says what pressing it raises`, (ESCALATION_KINDS[k].submitLabel ?? '').length > 3)
}
/* AND THE TWO THAT AN EMAIL CAN PRODUCE READ AS TITLES. "Raise dispute" heading a box about a
   dispute is the press said back; a label that read "Send" or "OK" would not be. */
ok('a dispute raised off an email is headed as one',
  /dispute/i.test(ESCALATION_KINDS.dispute.submitLabel))
ok('...and a request as one', /request/i.test(ESCALATION_KINDS.request.submitLabel))

/* ---------------- the question it asks ---------------- */

ok('it asks what the thing is', /What is it\?/.test(modal))
/*
 * NOT "WHY ARE YOU ESCALATING IT?" -- which presumed the answer to a question the box asks further
 * down, and presumed the one that is wrong for a dispute you keep.
 */
ok('...rather than why you are escalating it', !/Why are you escalating it\?/.test(modal))

/* ---------------- and escalating survives where it is true ---------------- */

/*
 * THIS IS THE HALF THAT MAKES IT A RULE RATHER THAN A FIND-AND-REPLACE. "Escalate it" is the right
 * words for handing a dispute to somebody else, and the box asks exactly that. Deleting the word
 * everywhere would lose the distinction the firm was reaching for.
 */
ok('handing it to somebody is still called escalating', /'Escalate it'/.test(modal))
ok('...against keeping it yourself', /Keep it — I will deal with it myself/.test(modal))
ok('...and that is the question that decides whose desk it is on',
  /What happens to it now\?/.test(modal))

/* ---------------- off an email, the press is not re-asked ---------------- */

ok('the kind is stated rather than offered', /fromEmail && !linkedTo && \(/.test(modal))
ok('...with the ladder hidden', /\$\{linkedTo \|\| fromEmail \? 'hidden' : ''\}/.test(modal))
/*
 * AND CHANGING IT IS ONE LINK, NOT A SECOND RADIO. Two radios give the wrong answer equal weight
 * with the right one; a link says "this is what you chose, and here is the way out".
 */
ok('...and one way out of it', /const other = kind === 'dispute' \? 'request' : 'dispute'/.test(modal))
ok('...which names what it becomes',
  /Not a dispute — they are asking us for something/.test(modal)
  && /Not a request — the debtor is disputing the account/.test(modal))
/* THE BARRED CASE STILL SPEAKS. A second dispute cannot be opened while one is, and a statement
   with no such line would read as a box that refuses only on Save. */
ok('...and says so where a dispute is already open',
  /kind === 'dispute' && alreadyDisputed/.test(modal))

/* ---------------- from the account, all four are a real question ---------------- */

/*
 * NOTHING HAS BEEN PRESSED THERE, so the ladder is the question and stays one. This is the
 * assertion that stops the fix above being applied where it does not belong.
 */
ok('the ladder is still there for the account', /ESCALATION_KIND_ORDER\.map\(\(k\) => \{/.test(modal))
check('...offering every kind a person may raise', ESCALATION_KIND_ORDER.length, 4)
/* AND NOT `import`, which is raised by the handover import and never by a person. */
ok('...and not the one the import raises', !ESCALATION_KIND_ORDER.includes('import'))

console.log(`\ncheck-raise-not-escalate: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
