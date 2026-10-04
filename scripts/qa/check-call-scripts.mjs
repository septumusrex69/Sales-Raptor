/**
 * WHAT A COLLECTOR MAY SAY, TO WHOM, AND WHEN THE FIRM MAY RING AT ALL.
 *
 * From the firm's own brief, BF-Collector-CALL-SCRIPTS and Raptor build prompt 6.
 *
 * EVERY ASSERTION HERE IS A COMPLAINT TO THE COUNCIL FOR DEBT COLLECTORS IF IT GOES THE OTHER WAY.
 * The firm's own list of what founds one runs to nine lines, and three of them are a disclosure to
 * somebody who was never verified. That is why this is a closed table checked in a file rather
 * than a convention in a screen: "this is the part that cannot live in a collector's head."
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-call-scripts.mjs
 */
import {
  ALWAYS_AT_HAND, CAPACITIES, DISPOSITIONS, callHoursProblem, disposition, mayBeTold,
  doNotDial, openingScript, scriptFor, stopsEverything, stopsOnContact, withinCallHours,
} from '../../src/lib/callScripts.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------------------------------------------------------------------------------------------
 * NOBODY IS TOLD ANYTHING UNTIL THEY HAVE PROVED WHO THEY ARE
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM'S THREE RULES, each of which they asked Raptor to ENFORCE rather than suggest.
 *
 * 1. A SPOUSE IS NOT AN AUTHORISED CONTACT BY MARRIAGE. Marriage in community of property changes
 *    who is liable and what the attorneys do at the legal stage. It entitles a spouse to be told
 *    nothing at all.
 */
check('a spouse is told nothing', mayBeTold('anyone_else', true), 'nothing')
check('...even with something on file', mayBeTold('anyone_else', true), 'nothing')
/*
 * 2. CONFIRMING THE ACCOUNT EXISTS IS ITSELF A DISCLOSURE. `nothing` has to mean nothing -- not
 *    the balance, not the creditor, not whether there is an account. A level between "everything"
 *    and "nothing" is how a collector ends up saying "I can't discuss it with you" to somebody who
 *    now knows there is something to discuss.
 */
const levels = new Set(CAPACITIES.map((c) => c.tell))
ok('there is no half-way disclosure', [...levels].every((l) => ['everything', 'own_liability', 'nothing'].includes(l)))
/*
 * 3. PROOF IS A FACT ABOUT THE ROW. The firm: "a row with no proof on file is not an authorised
 *    contact, however long it has been there."
 */
check('a surety with no deed on file is a stranger', mayBeTold('surety', false), 'nothing')
check('...and with the deed, hears only their own liability', mayBeTold('surety', true), 'own_liability')
check('an executor with no appointment is told nothing', mayBeTold('executor', false), 'nothing')
check('...and with Letters of Executorship, everything', mayBeTold('executor', true), 'everything')
check('an attorney without a letter is told nothing', mayBeTold('attorney', false), 'nothing')
check('a mandate holder without the mandate is told nothing', mayBeTold('power_of_attorney', false), 'nothing')
/* THE DEBTOR THEMSELVES, whose proof is the call. */
check('the debtor is told everything', mayBeTold('debtor', true), 'everything')
/* AND A CAPACITY NOBODY RECOGNISES IS NOT A LOOPHOLE. An unknown id hears nothing. */
check('a capacity Raptor does not know is told nothing', mayBeTold('bookkeeper_maybe', true), 'nothing')

/*
 * A DEBT COUNSELLOR IS BOTH AUTHORISED AND SILENCED, which is the row that catches people out:
 * Form 17.1 is real proof, and the correct answer to it is to stop collecting rather than to
 * discuss the account.
 */
check('a debt counsellor is told nothing on a call', mayBeTold('debt_counsellor', true), 'nothing')
ok('...and reaching one stops the account', stopsOnContact('debt_counsellor'))
ok('...where reaching the debtor does not', !stopsOnContact('debtor'))

/* AN EMPLOYER IS NEVER AN AUTHORISED CONTACT -- the firm's second rule. It is not on the list at
   all, which is the strongest form of "never": there is no row to grant proof against. */
ok('an employer is not a capacity that can be granted anything',
  !CAPACITIES.some((c) => /employer/i.test(c.id) || /employer/i.test(c.label)))
check('...so an employer is told nothing', mayBeTold('employer', true), 'nothing')

/* ---------------------------------------------------------------------------------------------
 * EVERY CALL ENDS WITH ONE OF SIXTEEN THINGS
 * ------------------------------------------------------------------------------------------- */

/*
 * SIXTEEN, AND THE COVERING NOTE SAYS FOURTEEN. The document lists sixteen; the brief's prose
 * says "the 14 codes are listed in the document". The document is the firm's own content and the
 * one a collector works from, so sixteen is what is built -- and the two that would have gone are
 * EXEC and MAND, which are precisely the two that stop a disclosure to somebody who has not proved
 * who they are. Written down rather than quietly resolved.
 */
check('there are sixteen outcomes', DISPOSITIONS.length, 16)
check('...each with a code of its own', new Set(DISPOSITIONS.map((d) => d.code)).size, 16)
for (const code of ['PIF', 'PTP', 'SETL', 'DISP', 'RTP', 'NAN', 'VM', 'TPC', 'WN', 'RPC',
  'DRV', 'DEC', 'INS', 'EXEC', 'MAND', 'DNC']) {
  ok(`${code} is one of them`, !!disposition(code))
}

/*
 * THE FOUR THAT STOP EVERYTHING, and they are the whole reason this is a field rather than a
 * sentence in a comment. A workflow that keeps sending on a deceased estate is the failure that
 * reaches a family.
 */
check('four outcomes stop everything automated',
  DISPOSITIONS.filter((d) => d.stops).map((d) => d.code).sort(), ['DEC', 'DRV', 'EXEC', 'INS'])
ok('death stops everything', stopsEverything('DEC'))
ok('debt review stops everything', stopsEverything('DRV'))
ok('insolvency stops everything', stopsEverything('INS'))
/*
 * AND A DISPUTE ALLEGED ON A CALL DOES NOT. The firm's own wording: "start the dispute workflow at
 * stage A, nothing is paused." A spoken dispute opens a ticket; a WRITTEN one suspends collection.
 * The two are different events, which is the rule Raptor already holds everywhere else.
 */
ok('a dispute alleged on the telephone pauses nothing', !stopsEverything('DISP'))
ok('...and neither does a refusal to pay', !stopsEverything('RTP'))
/* A CODE NOBODY RECOGNISES STOPS NOTHING, rather than throwing: the panel must never be unable to
   close a call. */
ok('an unknown code is not a stop', !stopsEverything('NONSENSE'))

/* ---------------------------------------------------------------------------------------------
 * THE TWO HARD STOPS, WHICH ARE NOT PREFERENCES
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM: "the first two rows are hard stops, not preferences. The account must not appear in a
 * dialler campaign at all while it is in one of those states."
 */
const individual = { debtorKind: 'individual' }
ok('a deceased debtor is not dialled', !!doNotDial({ ...individual, deceased: true }))
ok('...nor one under debt review', !!doNotDial({ ...individual, underDebtReview: true }))
ok('...nor one who is insolvent', !!doNotDial({ ...individual, insolvent: true }))
ok('...nor an account with a WRITTEN dispute open', !!doNotDial({ ...individual, writtenDisputeOpen: true }))
check('an ordinary account may be dialled', doNotDial(individual), null)
/* AND THE REASON IS IN THE FIRM'S WORDS, because a collector who is refused a dial and not told
   why rings the number from their own telephone. */
ok('...and says why', /estate/i.test(doNotDial({ ...individual, deceased: true }) ?? ''))

/* NO SCRIPT AT ALL ON A HARD STOP. Returning one would put words on a screen for a call that must
   not happen, which is how it happens. */
check('a stopped account has no script to read',
  scriptFor({ ...individual, deceased: true, workflowNode: 'final_notice' }), null)

/* ---------------------------------------------------------------------------------------------
 * WHICH SCRIPT POPS, IN THE FIRM'S OWN ORDER
 * ------------------------------------------------------------------------------------------- */

/* FIRST MATCH WINS, and the order is the behaviour: a broken arrangement outranks the workflow
   node, because that is the conversation to have. */
check('a broken arrangement outranks the workflow',
  scriptFor({ ...individual, arrangementInDefault: true, workflowNode: 'final_notice' }),
  'script-ptp-default-call')
check('an instalment due today comes next',
  scriptFor({ ...individual, instalmentDueToday: true, workflowNode: 'final_notice' }),
  'script-ptp-due-call')
check('then a live settlement',
  scriptFor({ ...individual, settlementLive: true, workflowNode: 'final_notice' }),
  'script-settlement-call')
check('then the workflow node', scriptFor({ ...individual, workflowNode: 'intended_summons' }),
  'script-intended-summons-call')
for (const [node, want] of [
  ['listed', 'script-listed-call'],
  ['listing_prep', 'script-listing-prep-call'],
  ['final_notice', 'script-final-notice-call'],
  ['reminder', 'script-reminder-call'],
  ['handover', 'script-handover-call'],
]) {
  check(`...${node} reads ${want}`, scriptFor({ ...individual, workflowNode: node }), want)
}
/*
 * A COMPANY GETS A LETTER OF DEMAND, NOT A SECTION 129. The NCA's notice belongs to a credit
 * agreement; a company is written to under the common law. Reading a section 129 script at a
 * company is telling them about a right they do not have.
 */
check('a person at section 129 reads the section 129 script',
  scriptFor({ ...individual, workflowNode: 'section_129' }), 'script-s129-call')
check('...and a company reads the letter of demand',
  scriptFor({ debtorKind: 'company', workflowNode: 'section_129' }), 'script-demand-call-company')
/* NOTHING ELSE MATCHES IS STILL A SCRIPT. A collector with an empty panel improvises. */
check('an account at no node still has words', scriptFor({ ...individual, workflowNode: null }),
  'script-handover-call')

/* THE OPENING SCRIPT IS NOT IN THAT TABLE: it pops first on every call, by what the debtor is. */
check('a person is opened as a person', openingScript('individual'), 'script-open-individual')
check('...and a company as a company', openingScript('company'), 'script-open-company')

/*
 * AND THE SEVEN THAT ARE NEVER DRIVEN BY STATE. The account does not know that the person who
 * answered is the debtor's daughter -- the firm: "all seven must be available at all times."
 */
check('seven scripts are always one tap away', ALWAYS_AT_HAND.length, 7)
for (const s of ['script-next-of-kin-living', 'script-third-party-paying', 'script-mandate-check',
  'script-estate-next-of-kin', 'script-estate-executor', 'script-surety', 'script-spouse']) {
  ok(`${s} is one of them`, ALWAYS_AT_HAND.includes(s))
}
/* NONE OF THEM IS REACHABLE BY STATE, which is what makes them the collector's own. */
const byState = new Set()
for (const node of ['intended_summons', 'listed', 'listing_prep', 'final_notice', 'reminder',
  'section_129', 'handover', null]) {
  byState.add(scriptFor({ ...individual, workflowNode: node }))
  byState.add(scriptFor({ debtorKind: 'company', workflowNode: node }))
}
ok('...and none of them is ever chosen by the account',
  ALWAYS_AT_HAND.every((s) => !byState.has(s)))

/* ---------------------------------------------------------------------------------------------
 * AND THE HOURS
 * ------------------------------------------------------------------------------------------- */

/* Monday to Friday, 08:00 to 17:00. 2026-10-05 is a Monday. */
ok('eight in the morning on a weekday is a calling hour', withinCallHours('2026-10-05', 8 * 60))
ok('...and four in the afternoon', withinCallHours('2026-10-05', 16 * 60))
ok('...half past seven is not', !withinCallHours('2026-10-05', 7 * 60 + 30))
/* FIVE O'CLOCK IS THE END, not the last minute of it: "08:00 to 17:00" is a window that closes. */
ok('...and five o’clock is the end of the day', !withinCallHours('2026-10-05', 17 * 60))

/* Saturday, 09:00 to 13:00. 2026-10-03 is a Saturday. */
ok('nine on a Saturday is a calling hour', withinCallHours('2026-10-03', 9 * 60))
ok('...eight is not', !withinCallHours('2026-10-03', 8 * 60))
ok('...and one o’clock closes it', !withinCallHours('2026-10-03', 13 * 60))

/* Sunday: none at all. 2026-10-04 is a Sunday. */
ok('nobody is called on a Sunday', !withinCallHours('2026-10-04', 10 * 60))

/*
 * AND A PUBLIC HOLIDAY IS A SUNDAY. The same calendar the workflow counts business days on, so a
 * day that is not a working day for a statutory notice is not a day for a telephone call either.
 */
ok('nobody is called on Christmas Day', !withinCallHours('2026-12-25', 10 * 60))
ok('...nor on Freedom Day', !withinCallHours('2026-04-27', 10 * 60))

/* THE REASON IS IN THE FIRM'S WORDS. A dialler that refuses without saying why is one somebody
   works around with their own telephone. */
check('a Sunday says so', callHoursProblem('2026-10-04', 600), 'The firm does not call on a Sunday.')
check('a holiday says so', callHoursProblem('2026-12-25', 600), 'The firm does not call on a public holiday.')
ok('a Saturday afternoon names the Saturday window',
  /09:00 and 13:00/.test(callHoursProblem('2026-10-03', 840) ?? ''))
ok('an early weekday names the weekday window',
  /08:00 and 17:00/.test(callHoursProblem('2026-10-05', 420) ?? ''))
check('and a calling hour has no complaint', callHoursProblem('2026-10-05', 600), null)
/* A DAY THAT IS NOT A DAY IS NOT A CALLING HOUR. Read defensively: this decides whether a
   telephone rings. */
ok('nonsense is not a calling hour', !withinCallHours('not a day', 600))

console.log(`\ncheck-call-scripts: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
