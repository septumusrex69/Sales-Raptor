/**
 * A TRACE IS AN ATTEMPT, AND AN ATTEMPT CAN BE SPENT.
 *
 * THE FIRM: "if we've worked through an entire trace, it should mention that the entire trace has
 * been worked through. There should be an option to upload a new trace or to rework the trace --
 * you've worked once through the entire trace, now trying again."
 *
 * WHAT WAS THERE WAS A COUNT THAT WENT QUIET. The account showed "12 findings nobody has tried
 * yet", and when the last one was answered the line DISAPPEARED -- so finished and never-started
 * read identically, as silence, and the fact a team leader most needs was the one the panel
 * stopped showing.
 *
 * WORKED THROUGH AND SPENT ARE NOT THE SAME CLAIM, which is most of what this file holds. A round
 * that was worked through and produced a live number did its job; one worked through that produced
 * nothing is the firm's money gone and a debtor still missing -- and that is what a second search,
 * a re-work, or somebody else's desk is for.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trace-round.mjs
 */
import { readFileSync } from 'node:fs'
import { canRework, roundLine, traceRound } from '../../src/lib/traceRound.ts'
import { traceSummary } from '../../src/lib/traceStore.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')

const modal = code('src/pages/accounts/TraceWorkspaceModal.tsx')
const panel = code('src/pages/accounts/AccountDetail.tsx')
const lib = code('src/lib/traceRound.ts')

const I = (kind, outcome, id = `${kind}-${outcome}`) => ({
  id, traceId: 't', accountId: 'a', kind, value: id, label: null,
  peopleLinked: null, seenOn: null, amount: null, status: null,
  outcome, outcomeAt: null, outcomeNote: null, promotedContactId: null,
})

/* ---------------------------------------------------------------------------------------------
 * THREE STATES, AND THE THIRD IS THE ONE THAT MATTERS
 * ------------------------------------------------------------------------------------------- */

check('a round somebody is still going down is working',
  traceRound([I('mobile', 'verified'), I('mobile', null, 'm2')]).state, 'working')
check('...and says how far', roundLine(traceRound([I('mobile', 'verified'), I('mobile', null, 'm2')])),
  '1 of 2 tried.')

/*
 * WORKED THROUGH AND SPENT MUST NOT BE COLLAPSED. Both have every finding answered; only one of
 * them produced a debtor. A screen that called them both "worked through" would hide the only
 * fact worth acting on.
 */
check('every finding tried, and the debtor reached, is worked through',
  traceRound([I('mobile', 'verified'), I('email', 'no_answer')]).state, 'worked_through')
check('...and every finding tried with nothing reaching them is spent',
  traceRound([I('mobile', 'unreachable'), I('email', 'no_answer')]).state, 'spent')
ok('...and the spent one says so plainly',
  /none of it reached the debtor/.test(roundLine(traceRound([I('mobile', 'unreachable')]))))

/*
 * REACHING SOMEBODY ELSE IS NEITHER SUCCESS NOR NOTHING. A spouse who takes a message is a live
 * line and a person who knows them -- worth saying on a round that otherwise reads as wasted, and
 * not worth calling a result.
 */
const spouse = traceRound([I('mobile', 'reached_other'), I('email', 'unreachable')])
check('reaching somebody who is not the debtor does not finish the job', spouse.state, 'spent')
ok('...but it is reported', spouse.reachedSomeone)
ok('...and said out loud', /Somebody answered, but not the debtor/.test(roundLine(spouse)))

/*
 * A LINKED PERSON CANNOT REACH THE DEBTOR, which is the firm's own rule -- OUTCOMES_FOR does not
 * offer `verified` on that list at all. Tested here as well rather than trusted, because this is
 * what decides whether a round is spent and somebody's desk changes.
 */
check('a verified linked person does not make the round a success',
  traceRound([I('link', 'verified'), I('mobile', 'unreachable')]).state, 'spent')

/*
 * NOTHING TO WORK IS NOT A FINISHED ROUND. A bureau profile that came back with no numbers has not
 * been worked through -- there was nothing to work -- and calling it spent would start the clock
 * towards somebody else's desk on a search nobody could act on.
 */
check('a report with nothing to ring is not spent',
  traceRound([I('address', null), I('property', null)]).state, 'working')
ok('...and says so rather than counting nought of nought',
  /Nothing on this report to ring/.test(roundLine(traceRound([I('address', null)]))))

/* ---------------------------------------------------------------------------------------------
 * WHAT COUNTS AS WORK IS ONE LIST
 * ------------------------------------------------------------------------------------------- */

/*
 * `untried` AND A ROUND'S `workable` ARE TWO READINGS OF ONE LIST and have to stay one list, or
 * the panel and the round disagree about whether a trace is finished. Held by running both.
 */
const mixed = [I('mobile', null), I('email', null), I('link', null), I('address', null), I('employer', null)]
check('numbers, emails and linked people are the work', traceRound(mixed).workable, 3)
check('...which is exactly what the summary counts untried', traceSummary(mixed).untried, 3)
/* ADDRESSES AND EMPLOYERS ARE OUT BY DESIGN: an address is confirmed by a letter coming back, and
   a trace that could not read as finished until something had been posted never would. */
check('an address is not somebody failing to answer', traceRound([I('address', null)]).workable, 0)

/* ---------------------------------------------------------------------------------------------
 * RE-WORKING IS A DIFFERENT JOB FROM SEARCHING AGAIN
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM'S OWN DISTINCTION, and the reason a re-work is a real option rather than a euphemism
 * for doing it again: "you couldn't make contact, but it was ringing or the phone was off." A line
 * that rings is alive; a dead one is not.
 */
ok('a number that rang can be tried again', canRework([I('mobile', 'no_answer')]))
ok('...a disconnected one cannot', !canRework([I('mobile', 'unreachable')]))
ok('...nor a wrong number', !canRework([I('mobile', 'not_theirs')]))
ok('...and neither can a round nobody has started', !canRework([I('mobile', null)]))
ok('a spent round says what is left to try',
  /1 number rang and could be tried again/.test(roundLine(traceRound([
    I('mobile', 'no_answer'), I('email', 'unreachable'),
  ]))))

/* ---------------------------------------------------------------------------------------------
 * DERIVED, NEVER STORED
 * ------------------------------------------------------------------------------------------- */

/*
 * A stored flag needs a job to maintain it, and a night the job does not run is a night the account
 * lies about whether anybody has tried -- the same reasoning isMissed and the diary's carry-over
 * already carry. Held as the absence of any write.
 */
ok('the round is a reading, not a column', !/supabase|insert|update\(/.test(lib))

/* ---------------------------------------------------------------------------------------------
 * AND BOTH SCREENS SAY IT
 * ------------------------------------------------------------------------------------------- */

ok('the account panel says where the attempt stands', /roundLine\(round\)/.test(panel))
/*
 * AND NO LONGER GOES SILENT WHEN IT IS FINISHED -- the fault this whole task is for. Held as the
 * absence of the old condition, which only ever drew while something was untried.
 */
ok('...and does not vanish once everything is tried', !/\{found\.untried > 0 && \(/.test(panel))
ok('the trace itself says it too', /roundLine\(round\)/.test(modal))
/* THE TWO BUTTONS, AND ONLY ON A SPENT ROUND. Offering a fresh search on a trace somebody is
   halfway through would buy a second report before the first had been read. */
ok('a spent round offers a fresh search', /round\.state === 'spent' && onUploadNew/.test(modal))
ok('...and names the fee it carries', /item 4\(c\)/.test(modal))
/* RE-WORK ONLY WHERE SOMETHING RANG: a button that re-opens a list of dead numbers teaches people
   the feature is pointless. */
ok('...and offers a re-work only where something rang',
  /round\.state === 'spent' && reworkable/.test(modal))

console.log(`\ncheck-trace-round: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
