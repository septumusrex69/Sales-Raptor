/**
 * ASKED ONCE, ON THE WAY OUT, AND ONLY WHERE IT IS WORTH ASKING.
 *
 * THE FIRM, having complained that the call box asked after every single call: "I'm confirming that
 * with you when you rediarise. Or if you go out of the account. To confirm the status of the
 * account. And also if you want to rediarise."
 *
 * THE WHOLE RISK IS ASKING TOO OFTEN. CLAUDE.md: "a warning that fires when nothing is wrong is
 * worse than no warning, because people stop reading it." This file is mostly the four ways the
 * prompt has to stay silent.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-leaving-account.mjs
 */
import { readFileSync } from 'node:fs'
import { WORKING_ACTIONS, shouldAskOnLeaving, worked } from '../../src/lib/leavingAccount.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const code = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

const worked_ = { worked: true, hasOpenEntry: false, mine: true, closed: false }

/* THE CASE IT EXISTS FOR: somebody worked their own open account and left no date. */
ok('a worked account with no date asks', shouldAskOnLeaving(worked_))

/* ---------------------------------------------------------------------------------------------
 * AND THE FOUR WAYS IT STAYS QUIET
 * ------------------------------------------------------------------------------------------- */

/*
 * NOTHING WAS DONE. Opening an account to read a figure is most of what anybody does on a busy
 * day; asking them to confirm a status they never touched is how a status gets confirmed without
 * being looked at, which is worse than leaving it alone.
 */
ok('...but reading one does not', !shouldAskOnLeaving({ ...worked_, worked: false }))
/* ALREADY DIARISED. Both halves of the question are answered; re-asking teaches people to dismiss
   it, which is the complaint this is meant to cure rather than relocate. */
ok('...nor one already diarised', !shouldAskOnLeaving({ ...worked_, hasOpenEntry: true }))
/* NOT THEIRS. A team leader passing through does not decide where somebody else's account stands. */
ok('...nor somebody else s account', !shouldAskOnLeaving({ ...worked_, mine: false }))
/* CLOSED. Settled, written off, handed back -- there is no next day to pick. */
ok('...nor a closed one', !shouldAskOnLeaving({ ...worked_, closed: true }))

/* EACH REASON STANDS ALONE, so a future change that fixes one does not quietly re-open the others. */
ok('...and any one of them is enough',
  !shouldAskOnLeaving({ worked: false, hasOpenEntry: true, mine: false, closed: true }))

/* ---------------------------------------------------------------------------------------------
 * WHAT COUNTS AS HAVING WORKED IT
 * ------------------------------------------------------------------------------------------- */

ok('a call counts', worked(['call']))
ok('...and a promise', worked(['promise']))
ok('...and a trace', worked(['trace']))
/* LOOKING IS NOT WORKING, which is the line the whole prompt rests on. */
ok('...but reading the statement does not', !worked(['statement', 'simulation', 'tab']))
ok('...and nothing at all certainly does not', !worked([]))
/* EVERY ACTION ON THE LIST IS SOMETHING THAT CHANGES WHERE THE ACCOUNT STANDS. A list that grew a
   passive entry would make the prompt fire on reading, which is the failure mode. */
for (const a of WORKING_ACTIONS) ok(`${a} is a doing`, worked([a]))
check('the list is the nine things that move an account', WORKING_ACTIONS.length, 9)

/* ---------------------------------------------------------------------------------------------
 * AND THE PAGE ASKS THE RULE RATHER THAN RE-DERIVING IT
 * ------------------------------------------------------------------------------------------- */

const page = code('src/pages/accounts/AccountDetail.tsx')
ok('the account page asks the rule', /shouldAskOnLeaving\(\{/.test(page))
/*
 * TOUCHED IS SET WHERE THE ACCOUNT RELOADS, which is the one place that already knows something
 * happened -- every action calls it when it is done. Nine call sites each remembering to say so is
 * how one of them comes not to.
 */
ok('...and anything that reloads the account has worked it', /setTouched\(true\)/.test(page))
/*
 * AN UNKNOWN COUNTS AS ALREADY DIARISED. hasEntry is null until the lookup answers, and the cost
 * of being wrong is asymmetric: a false no nags somebody who has just diarised it -- the behaviour
 * the firm complained about -- while a false yes stays quiet and the account is still on the "No
 * diary date" list a team leader works.
 */
ok('...and an unanswered lookup stays quiet', /hasOpenEntry: hasEntry !== false/.test(page))
/* AND IT IS THE SIGNED-IN PERSON'S ACCOUNT, not whoever can see it. */
ok('...and only on your own account', /mine: account\.assignedTo === currentUser\?\.id/.test(page))

/* THE BOX CHANGES NO STATUS BY ITSELF. The rule the firm confirmed when asked directly and
   callOutcome records: a status is a consequence of something recorded, never a keystroke. */
const modal = code('src/pages/accounts/LeavingModal.tsx')
ok('the box offers no list of rungs', !/CLIENT_POSITIONS\)\.map|POSITION_ORDER/.test(modal))
ok('...it sends you to where a record gets written', /onRecord/.test(modal))
/* AND IT SAYS WHERE THE ACCOUNT STANDS, so leaving it there is a decision rather than a default. */
ok('...and says where it stands now', /CLIENT_POSITIONS\[standing\]/.test(modal))
/* DISMISSABLE. A prompt that cannot be escaped is one people click through. */
ok('...and can be left alone', /Leave it for now/.test(modal))
/* NOT "Cancel": nothing is being undone, and "Cancel" beside a saved call reads as though it
   takes the call back. */
ok('...without the word Cancel', !/>\s*Cancel\s*</.test(modal))

console.log(`\ncheck-leaving-account: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
