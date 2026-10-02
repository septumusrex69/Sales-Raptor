/**
 * ONE NOTE, NOT TWO: THE CALL BOX RECORDS WHAT CAME OF THE CALL.
 *
 * THE FIRM, having run their first afternoon of calls: "I think we can as well add to this thing
 * immediately -- add a question. As you raise a ticket, or you can raise a PTP immediately from the
 * screen. Either way, it records. And it's then accepted as spoken to the debtor, so it charges the
 * consultation and the other thing, the phone call."
 *
 * AND THE FAULT UNDERNEATH IT: "the big thing and the big problem was the note. So now you make a
 * note of the telephone call, and then you make another note of, for example, the dispute. Right?
 * So you're double making notes. So notes should be made only at one place."
 *
 * They were typing the same sentence twice. A call that ended in a dispute was written up in "What
 * was said?", then written again in the Escalate box, and the two were different by the time they
 * were both saved -- so the account's timeline and the client's dispute report disagreed about what
 * the debtor had actually said.
 *
 * THREE THINGS THIS FILE HOLDS, AND THE FIRST IS A FEE:
 *
 *  1. ONLY THE FIVE OUTCOMES THAT MEAN SOMEBODY WAS REACHED are offered on the call box, because
 *     choosing one is now the press that charges the R60 consultation. "Arranged" and "nobody
 *     picked up" on one press is a promise with a voicemail behind it. R60 charged for a voicemail
 *     is the exact bug this box was built to end -- see CallButton's own note.
 *  2. THE WORDS ARE ASKED FOR ONCE. The picker draws no second box where the caller already holds
 *     the sentence, and the call's note is what reaches the promise and the dispute.
 *  3. THE CONSULTATION IS WRITTEN FIRST AND CANNOT BE LOST. A promise that will not save must not
 *     take the record of the call, or its fee's evidence, with it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-call-outcome.mjs
 */
import { readFileSync } from 'node:fs'
import {
  CALL_OUTCOMES, CALL_OUTCOME_ORDER, EMPTY_OUTCOME, needsWords, outcomeReady,
} from '../../src/lib/callOutcome.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* Comments stripped. Several assertions below are about what is ABSENT, and both of these files
   explain at length what they no longer do -- the trap this codebase has walked into three times. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

const box = code('src/pages/accounts/CallButton.tsx')
const picker = code('src/components/diary/OutcomePicker.tsx')
const page = code('src/pages/accounts/AccountDetail.tsx')

/* ---------------------------------------------------------------------------------------------
 * 1. THE FIVE THAT MEAN SOMEBODY WAS REACHED
 * ------------------------------------------------------------------------------------------- */

/*
 * DERIVED FROM `reached`, NOT LISTED. A ninth outcome then lands on the right side of this line by
 * saying what it is, rather than by somebody remembering a file in pages/accounts.
 */
ok('the call box offers only what it offers by asking `reached`',
  /CALL_OUTCOME_ORDER\.filter\(\(k\) => CALL_OUTCOMES\[k\]\.reached\)/.test(box))
ok('...and passes exactly that list to the picker', /offer=\{SPOKE_TO_THEM\}/.test(box))

/* AND THE LIST IT PRODUCES IS THE FIVE, asserted on the data rather than the regex above, so a
   `reached` flipped on one outcome fails here and not in a screenshot three weeks later. */
const spoke = CALL_OUTCOME_ORDER.filter((k) => CALL_OUTCOMES[k].reached)
check('which is the five an answered call can land on', spoke,
  ['promised', 'negotiating', 'cannot_pay', 'refused', 'disputed'])
/*
 * AND NO ANSWER IS NOT AMONG THEM, which is the one that matters: it is the OTHER button on the
 * same box, and two controls for one fact is how they come to disagree.
 */
ok('no answer is not offered beside the button that means it', !spoke.includes('no_answer'))
/* NOR A TRACE NOR A PRACTITIONER. Both mean the debtor was not reached, so neither can sit on a
   press that raises R60 for a conversation. They stay on the diary's box, which charges nothing. */
ok('...nor a trace', !spoke.includes('wrong_number'))
ok('...nor under administration', !spoke.includes('under_administration'))
/* THE DIARY STILL OFFERS ALL EIGHT. The narrowing is the call box's, and the picker's default is
   untouched -- a diary entry being finished at a desk can have landed anywhere. */
ok('the picker still offers all eight by default',
  /const offered = offer \?\? CALL_OUTCOME_ORDER/.test(picker))
ok('...and the diary passes no list', !/offer=\{/.test(code('src/components/diary/CompleteDiaryModal.tsx')))

/*
 * AND THE VOICEMAIL BUTTON GOES OFF ONCE ONE IS CHOSEN. Without this the two halves of the box
 * contradict each other on one press: a promise recorded, a consultation not charged, and an
 * account reporting Arranged with "no answer" on its timeline.
 */
ok('a chosen outcome turns the voicemail button off',
  /answered\(false\)\} disabled=\{busy \|\| !!came\.outcome\}/.test(box))
ok('...saying why, because the way back is to clear the choice',
  /that is somebody you spoke to/.test(box))

/* ---------------------------------------------------------------------------------------------
 * 2. THE WORDS ARE TYPED ONCE
 * ------------------------------------------------------------------------------------------- */

/*
 * THE ASSERTION THE FIRM'S COMPLAINT ACTUALLY ASKS FOR. `words: comment` is the whole fix: the
 * promise's note, the dispute's description and the call's own note are one sentence, written in
 * the box the collector is already looking at.
 */
ok('the outcome is recorded off the call s own note', /words: comment,/.test(box))
/* AND THE PICKER DRAWS NO SECOND BOX FOR THEM. */
ok('the call box tells the picker the words are already asked for',
  /wordsAskedAs="What was said\?"/.test(box))
ok('...and the picker draws its own field only where they are not',
  /needsWords\(chosen\) && !wordsAskedAs && \(/.test(picker))
/*
 * AND IT KEEPS NO SECOND COPY. Stored on `came` as well, the two would drift the moment somebody
 * edited the note after choosing -- and the one that reached the client would be the stale one.
 */
ok('the sentence is folded in at the point of use, not kept twice',
  /const choice: OutcomeChoice = \{ \.\.\.came, words: comment \}/.test(box))
ok('...and nothing writes words back onto the choice',
  /onChange=\{\(next\) => setCame\(\{ \.\.\.next, words: '' \}\)\}/.test(box))

/*
 * VALIDATION DID NOT MOVE. outcomeReady reads `words`, so a dispute still cannot be saved with
 * nothing behind it -- the words simply arrive from a different box. Held on the function rather
 * than the source, because this is the guarantee and the regexes above are only the plumbing.
 */
const disputed = { ...EMPTY_OUTCOME, outcome: 'disputed', category: 'Amount in dispute' }
ok('a dispute with no words is still refused', !outcomeReady(disputed))
ok('...and allowed once the call s note is folded in',
  outcomeReady({ ...disputed, words: 'Says the last two invoices were never delivered.' }))
ok('a dispute with no classification is still refused',
  !outcomeReady({ ...disputed, category: '', words: 'Says it was paid in March.' }))
/* AND "OTHER" STILL NEEDS A REAL EXPLANATION, which on this box means the call note has to carry
   it -- a three-word note is not a dispute a client can answer. */
ok('“Other” still needs more than a few words',
  !outcomeReady({ ...disputed, category: 'Other', words: 'He disputes.' }))
ok('a promise with no amount or date is still refused',
  !outcomeReady({ ...EMPTY_OUTCOME, outcome: 'promised' }))
/* AND RECORDING NOTHING STAYS POSSIBLE. A collector who did something the five do not cover must
   still be able to put the call on the account; a required field with no honest answer is how
   "Review" came to mean nothing. */
ok('and no outcome at all is still allowed', outcomeReady(EMPTY_OUTCOME))

/* THE FIVE THE BOX OFFERS, AGAINST WHAT THEY NEED. Two of them want words and both get the note. */
check('two of the five need the words', spoke.filter((k) => needsWords(k)),
  ['cannot_pay', 'disputed'])

/* WHY THE BUTTON IS OFF, ON THE BUTTON. It refused on an empty note before and said so; a promise
   with no date can refuse it now too, and "nothing happens when I press it" is how a collector
   decides the screen is broken. */
ok('the button says why it will not save', /const whyNot = !comment\.trim\(\)/.test(box))
ok('...and carries it as its own title', /title=\{whyNot \?\? undefined\}/.test(box))

/* ---------------------------------------------------------------------------------------------
 * 3. THE CONSULTATION IS WRITTEN FIRST AND IS NEVER LOST
 * ------------------------------------------------------------------------------------------- */

/*
 * ORDER, AND IT IS THE SAME REASONING THE MAIN COMMENT ALREADY CARRIES. The fee and the note behind
 * it are the thing that must not be lost -- a fee with no evidence is the one kind nobody can
 * defend when a client queries it. Written after recordConsultation, so a promise that will not
 * save costs the collector the promise and not the call.
 */
const consultAt = box.indexOf('recordConsultation({')
const outcomeAt = box.indexOf('recordOutcome({')
ok('both writes are there', consultAt > 0 && outcomeAt > 0)
ok('...and the consultation is written first', consultAt < outcomeAt)
/*
 * AND THE OUTCOME CANNOT CLAIM THE CALL FAILED. recordOutcome reports rather than throws, so the
 * failure is a line naming which half is missing over a call that is on the timeline either way.
 */
ok('a failed outcome says the call is still recorded',
  /The call is recorded\. \$\{CALL_OUTCOMES\[chosen\]\.label\} is not/.test(box))
ok('...and is not thrown, so the box still closes', !/throw new Error\(`Could not record/.test(box))

/*
 * AND THE OUTCOME RAISES NO FEE OF ITS OWN. Item 3 recovers a dispute taken up with somebody else;
 * one a collector writes down mid-call is the job. recordOutcome passes charge: false, and the box
 * says so where the choice is made -- held as an ABSENCE plus a sentence, because adding the fee
 * here would read like consistency.
 */
ok('the box says the outcome costs the debtor nothing',
  /Saying where the account stands adds nothing at all/.test(box))
ok('...and the recorder keeps item 3 off it', /charge: false,/.test(code('src/lib/recordOutcome.ts')))

/* ---------------------------------------------------------------------------------------------
 * AND IT DOES NOT ASK FOR A PROMISE THAT ALREADY STANDS
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM'S OBJECTION, MADE ABOUT THE DIARY AND JUST AS TRUE ON A CALL: "there's already a PTP in
 * place, why do you need to redo this?" A retyped promise is a SECOND promise -- two rows, two due
 * dates, and a client report that cannot say which arrangement is the arrangement.
 */
ok('the account hands the call box the promise that stands',
  /livePromise=\{due \? \{ amount: due\.amount, dueOn: due\.dueOn \} : null\}/.test(page))
ok('...and the picker is told about it', /livePromise=\{livePromise \?\? null\}/.test(box))
/* AND NOTHING IS WRITTEN WHERE IT IS BEING KEPT. */
ok('a standing promise is not written again',
  /promise: chosen === 'promised' && \(!livePromise \|\| came\.repromise\)/.test(box))
ok('...and outcomeReady asks for nothing either',
  outcomeReady({ ...EMPTY_OUTCOME, outcome: 'promised' }, true))

/* ---------------------------------------------------------------------------------------------
 * THE BOX SAYS WHERE THE ACCOUNT ALREADY IS
 *
 * THE FIRM: "the account asks you every single time after you've spoken to someone if you want to
 * update the status... maybe it should show you what the current status is... because if you're
 * still busy tracing someone, it's still on tracing already, until you find someone. It always is
 * in a state of asking you what the status is."
 *
 * THEY WERE DESCRIBING A BLANK QUESTION. Five options, none marked, no sign the app already knew
 * the answer -- so leaving an account alone was indistinguishable from forgetting to answer.
 * ------------------------------------------------------------------------------------------- */

ok('the picker takes where the account stands', /current\?: ClientPosition \| null/.test(picker))
ok('...and says it before it asks', /Now <span[\s\S]{0,120}standing\.label/.test(picker))
/* THE WHOLE POINT: choosing nothing has to read as an outcome, not an empty field. */
ok('...and says what choosing nothing does',
  /the account stays on/.test(picker) && /!chosen && standing/.test(picker))
/* AND THE RUNG IT IS ON IS MARKED IN THE GRID, so nobody picks it again out of doubt. */
ok('...and marks the rung it is already on', /const isNow = k === currentKey && !on/.test(picker))

/*
 * MARKED, NOT CHOSEN, and this is the one that actually matters.
 *
 * Pre-selecting the current rung would write the record behind it AGAIN on every call -- a second
 * promise with its own due date, a second dispute with its own clock. The whole design of
 * callOutcome is that a status is a consequence of something recorded; a status that re-records
 * itself every time somebody opens the box is that rule running backwards.
 */
ok('...without pre-choosing it', !/outcome: currentKey/.test(picker))
ok('...and it is excluded from the chosen state', /k === currentKey && !on/.test(picker))

/*
 * AND THE MARKER DOES NOT CHANGE THE BUTTON'S NAME.
 *
 * It did, and the e2e caught it: a second line inside the button made its accessible name
 * "Arranged where it is now", so anything looking for the rung by name stopped finding it -- a
 * screen reader included. The rung is the name; the fact lives in the title beside it.
 */
ok('...without renaming the button', /aria-hidden="true"[\s\S]{0,80}where it is now/.test(picker))
ok('...and the fact is in the title instead', /where the account is now`/.test(picker))

/* IT ADDS NO WAY TO SET A POSITION BY HAND. The firm settled that rule when asked directly and
   callOutcome records it: a status is a consequence of something recorded, never a keystroke. */
ok('the picker still writes nothing by itself',
  !/onChange\(\{ \.\.\.value, position:/.test(picker))

/* THE ACCOUNT PAGE PASSES THE POSITION IT ALREADY DERIVED, rather than deriving a second one --
   two readings of one position is how the hero and the call box come to disagree. */
ok('the page hands the call box its position', /standing=\{position === 'new' \? null : position\}/.test(page))
ok('...and the call box passes it to the picker', /current=\{standing \?\? null\}/.test(box))
ok('...and does not derive its own', !/deskPosition\(/.test(box) && !/clientPosition\(/.test(box))
/*
 * 'new' IS A DESK RUNG, NOT ONE OF THE THIRTEEN. It is what the account page shows for an account
 * nobody has worked yet; a client is never told it, and the call box must not offer to leave an
 * account on it.
 */
ok('...and a desk-only rung is not passed as one of the thirteen',
  /position === 'new' \? null/.test(page))

/* ---------------------------------------------------------------------------------------------
 * AND A NUMBER RUNG OFF THE TRACE IS A CALL ON THE ACCOUNT
 *
 * THE FIRM: "I should also be able to call the numbers from in the trace." The press already rang
 * -- every number there has been a PhoneLink all along -- so what was missing was the RECORD: no
 * item 2 fee, no timeline line, and no account_calls row for BuzzBox to match its events against.
 * ------------------------------------------------------------------------------------------- */

const trace = code('src/pages/accounts/TraceWorkspaceModal.tsx')
ok('a trace number reports the dial', /onDialled=\{\(c\) => onDial\(c\.to\)\}/.test(trace))
/* BOTH OF THEM: the row's own number and the one a linked person shares with the debtor, which is
   the number a collector chasing a relative most wants to press. */
check('...on the row and on the linked person alike',
  (trace.match(/onDialled=\{\(c\) => onDial\(c\.to\)\}/g) ?? []).length, 2)
/* THROUGH THE SAME FUNCTION THE ACCOUNT'S CALL BUTTON USES. Written twice they drift, and the
   failure is a book where a call is billable or not depending which screen it was placed from. */
ok('...through the one recorder', /recordDial\(\{ accountId: trace\?\.accountId/.test(trace))
ok('...imported from the account\u2019s own call library',
  /import \{ recordDial \} from '\.\.\/\.\.\/lib\/accountCalls'/.test(trace))
/* NEVER ALLOWED TO FAIL THE CALL. The conversation is happening; a fee that will not write is
   something to report, not a red box over a call that went through. */
ok('...and a failed fee does not break the call', /\.catch\(\(e\) => setError/.test(trace))

console.log(`\ncheck-call-outcome: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
