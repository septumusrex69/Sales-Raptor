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

console.log(`\ncheck-call-outcome: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
