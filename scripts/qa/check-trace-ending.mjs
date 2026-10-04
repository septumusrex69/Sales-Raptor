/**
 * HOW A TRACE ENDS, WHEN THE DEBTOR CANNOT BE FOUND.
 *
 * THREE RULES THE FIRM ASKED FOR, and all three were missing from a screen that otherwise did the
 * trace work well:
 *
 *   TWO ROUNDS TO A PERSON. "If an individual has worked through a trace twice, it could go to the
 *   next person." Counted on SPENT rounds only -- a hard trace that found the debtor is not a
 *   reason to take a file away -- and per person, which is the firm's own unit.
 *
 *   PARK IT AND RE-TRACE. People resurface: a payroll, a credit application, a new address. So a
 *   traced-out account is set aside with a date to come back, and it comes back as a TRACE.
 *
 *   OR ASK THE CLIENT TO WRITE IT OFF AS UNCONTACTABLE. Until this existed a file nobody could
 *   find had no ending at all -- it sat on a desk consuming a diary slot every few weeks for a
 *   review nobody could act on.
 *
 * NEITHER ENDING HAPPENS ON ITS OWN, and that is asserted here: an account parked by a rule is an
 * account that left somebody's desk without anybody deciding, and only the client may write off
 * their own money.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trace-ending.mjs
 */
import { readFileSync } from 'node:fs'
import {
  ROUNDS_BEFORE_REALLOCATION, reallocationDue, reallocationLine, roundsSpentBy, traceRound,
} from '../../src/lib/traceRound.ts'
import {
  DORMANT_MONTHS, DORMANT_PREFIX, WRITE_OFF_REASONS, dormantFreezeReason, isDormant,
  uncontactableAsk, wakeDate,
} from '../../src/lib/dormancy.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* A finding somebody tried and got nothing from, and one that reached the debtor. */
const dead = (id) => ({
  id, kind: 'mobile', value: `08${id}`, outcome: 'wrong_number', outcomeAt: '2026-09-01',
})
const live = (id) => ({
  id, kind: 'mobile', value: `08${id}`, outcome: 'verified', outcomeAt: '2026-09-01',
})
const spent = (by) => ({ pulledBy: by, items: [dead('1'), dead('2')] })
const found = (by) => ({ pulledBy: by, items: [live('1'), dead('2')] })

/* THE PREMISE: these fixtures really are spent and found. Asserted before the rule that counts
   them, or the counting below proves nothing. */
check('the fixture that reached nobody is spent', traceRound(spent('a').items).state, 'spent')
check('...and the one that found a number is not',
  traceRound(found('a').items).state, 'worked_through')

/* ------------------------------------------------ two rounds to a person */

check('the firm’s limit', ROUNDS_BEFORE_REALLOCATION, 2)
check('one spent round is one', roundsSpentBy([spent('a')], 'a'), 1)
check('two are two', roundsSpentBy([spent('a'), spent('a')], 'a'), 2)
/* A ROUND THAT FOUND THE DEBTOR DOES NOT COUNT. It did its job, however hard it was. */
check('a round that reached the debtor is not counted',
  roundsSpentBy([spent('a'), found('a')], 'a'), 1)
/* COUNTED PER PERSON. Three collectors with one spent round each have not spent anybody's two --
   the account has been looked at from three directions, which is what reallocation is for. */
check('somebody else’s rounds are not yours',
  roundsSpentBy([spent('a'), spent('b'), spent('c')], 'a'), 1)
/* A TRACE WITH NO pulledBy COUNTS FOR NOBODY. Everything imported before that column existed has
   none, and attributing those to whoever is on the account today would reallocate a file on the
   strength of somebody else's work. */
check('an unattributed round counts for nobody', roundsSpentBy([spent(null)], 'a'), 0)
check('...and asking about nobody counts nothing', roundsSpentBy([spent('a')], null), 0)

check('one round is not due', reallocationDue([spent('a')], 'a'), false)
check('two are', reallocationDue([spent('a'), spent('a')], 'a'), true)
check('nothing to say on one', reallocationLine([spent('a')], 'a'), null)
ok('...and the sentence names the rule on two',
  /two to a person/.test(reallocationLine([spent('a'), spent('a')], 'a') ?? ''))
/* IT SAYS WHAT REALLOCATION IS FOR, so it does not read as a mark against the collector. */
ok('...and says why', /fresh eyes/.test(reallocationLine([spent('a'), spent('a')], 'a') ?? ''))

/* ------------------------------------------------ parking it */

/* RECORDED AS A FIRM FREEZE, with the wake date in the reason -- no new column and no nightly
   job. See dormancy.ts for why. */
const reason = dormantFreezeReason('14 Apr 2027', 2)
ok('a park is recognisable afterwards', isDormant(reason))
ok('...and says how many rounds were spent', /2 traces were/.test(reason))
ok('...and when it comes back', /14 Apr 2027/.test(reason))
check('an ordinary freeze is not a park', isDormant('The client asked us to hold it.'), false)
check('no reason at all is not a park', isDormant(null), false)
ok('one round reads as one', /One trace was/.test(dormantFreezeReason('1 Jan 2027', 1)))

check('the default park is six months', DORMANT_MONTHS, 6)
check('six months on', wakeDate('2026-10-04'), '2027-04-04')
/*
 * THE LAST DAY OF A SHORTER MONTH, NOT THE FIRST OF THE NEXT. 31 August plus six months is 28
 * February: adding to the day directly rolls it over into March, which is the trap the instalment
 * schedule already carries a note about.
 */
check('a 31st lands on the last day of a shorter month', wakeDate('2026-08-31'), '2027-02-28')
check('...and a leap year gets its 29th', wakeDate('2027-08-31'), '2028-02-29')
check('a date it cannot read is left alone', wakeDate('not a date'), 'not a date')
check('the period is a parameter, not a constant in the arithmetic',
  wakeDate('2026-10-04', 3), '2027-01-04')

/* ------------------------------------------------ asking the client */

ok('uncontactable is a write-off reason', WRITE_OFF_REASONS.includes('Uncontactable'))
/*
 * AND IT IS NOT "CANNOT PAY". A pensioner who answers the telephone is a different account from
 * one whose every number is dead, and the firm's own rule is that refusing and cannot-pay never
 * go on one list -- this is a third thing again.
 */
ok('...and cannot pay is a different reason', WRITE_OFF_REASONS.includes('Cannot pay'))
check('...and they are not the same entry',
  WRITE_OFF_REASONS.filter((r) => /uncontactable|cannot pay/i.test(r)).length, 2)

const ask = uncontactableAsk({ rounds: 2, searches: 3, parkedUntil: '14 Apr 2027' })
/* IT QUOTES THE ACCOUNT OF THE WORK. A client asked to write off a balance is entitled to it;
   "we cannot find this debtor, please write it off" is the firm asking to be let off a file. */
ok('the ask says how many searches were run', /3 bureau searches/.test(ask))
ok('...and how many rounds were worked', /2 traces/.test(ask))
ok('...and what it is asking for', /write the balance off as uncontactable/.test(ask))
/* AND IT OFFERS THE ALTERNATIVE, because parking costs the client nothing. */
ok('...and names the park as the alternative', /14 Apr 2027/.test(ask))
ok('...or offers one where nothing is parked yet',
  /trace it again in six months/.test(uncontactableAsk({ rounds: 1, searches: 1 })))
ok('one of each reads as one', /one bureau search has/i.test(uncontactableAsk({ rounds: 1, searches: 1 })))

/* ------------------------------------------------ what the screens do */

const modal = read('src/pages/accounts/TraceWorkspaceModal.tsx')
const park = read('src/pages/accounts/ParkTraceModal.tsx')
const account = read('src/pages/accounts/AccountDetail.tsx')

/* BOTH ENDINGS ARE OFFERED FROM THE SPENT ROUND, which is where somebody is standing when they
   find out -- the same reasoning as the fresh-search button beside them. */
ok('a spent round offers the park', /round\.state === 'spent' && onPark/.test(code(modal)))
ok('...and the write-off request', /round\.state === 'spent' && onAskWriteOff/.test(code(modal)))
/* AND NOT ON A ROUND THAT IS STILL BEING WORKED, or the screen invites somebody to give up on an
   account with numbers still untried. */
ok('...and neither before the round is spent',
  !/onPark \|\|/.test(code(modal)) && !/\{onPark &&/.test(code(modal)))
ok('the reallocation sentence is drawn where the round ends', /\{reallocation &&/.test(code(modal)))

/*
 * A PARK IS A FIRM FREEZE PLUS A DATED TRACE IN THE DIARY. Both, and the diary half is what makes
 * it a park rather than a disappearance.
 */
/*
 * MATCHED ON THE WHOLE LINE, FROM ITS INDENTATION.
 *
 * `/diarise\(/` passes on `if (false) await diarise({...})`, and so does `/await diarise\(/` --
 * a guard switched off and a check that never noticed, which is the vacuous-assertion trap
 * CLAUDE.md records. Both were break-tested and both let it through. A line that begins with
 * `await` after its indentation cannot be carrying a condition.
 */
const unconditional = (src, call) =>
  new RegExp(`^\\s*await ${call}\\(\\{`, 'm').test(code(src))
ok('parking freezes the account', unconditional(park, 'freezeAccount'))
ok("...as the firm's own freeze, not the client's", /by: 'firm'/.test(code(park)))
ok('...and books the day it comes back', unconditional(park, 'diarise'))
ok('...as a trace rather than a review', /kind: 'trace'/.test(code(park)))
/* THE CLIENT DECIDES. Nothing here writes a write-off, and the box says so. */
ok('the request only asks', /askClient\(\{ accountId, ask: ask\.trim\(\), actor \}\)/.test(code(park)))
ok('...and says the client decides', /it is their money/.test(park))
/* ASSERTED ON THE COLUMN, not on the words: `mode: 'write_off'` is which half of the box is open
   and must not be mistaken for a write. What may never happen here is a write to the account's
   own write-off columns or its status. */
check('nothing writes a write-off onto the account',
  /write_off_reason|setSubStatus|status:/.test(code(park)), false)

/* THE FIGURES QUOTED TO THE CLIENT COME OFF THE LEDGER, never off a count of reports: a report
   uploaded twice is one search, and the client is quoted what they paid for. */
ok('the searches quoted are the ones charged',
  /annexureItem === '4c' && f\.billed/.test(code(account)))
ok('...and the rounds are the spent ones',
  /traceRound\(t\.items\)\.state === 'spent'/.test(code(account)))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-trace-ending: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
