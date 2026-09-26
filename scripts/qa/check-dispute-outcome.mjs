/**
 * A DISPUTE UPHELD DOES ONE OF THREE THINGS, AND ONLY ONE OF THEM ENDS THE DEBT.
 *
 * THE FIRM: "for a valid dispute, two things can happen. Either the account can be withdrawn or
 * the account can stay with new terms and conditions. So, for example, the handover amount can
 * change... or the dispute can be valid but nothing changes."
 *
 * WHAT WAS WRONG BEFORE, AND IT IS THE CASE NOBODY WOULD HAVE NOTICED: a dispute upheld with
 * NOTHING CHANGED ended the sequence. The debtor asked a fair question, the firm answered it, the
 * debt stood — and the section 129 the firm had properly issued was cancelled. Nothing on the
 * screen says a demand was lost.
 *
 * AND WHY A CHANGED AMOUNT CANNOT SIMPLY RESUME. A section 129 STATES AN AMOUNT and gives the
 * debtor ten business days to remedy it. If the firm concedes the figure was wrong, the debtor
 * was given ten days to remedy a number the firm has since accepted was incorrect — and the final
 * notice inherits it, because it says "the period given in our Section 129 notice has ended" and
 * that period ran against the wrong figure. A credit bureau listing on a conceded-wrong amount is
 * the least defensible thing in the sequence. So it ends, and a fresh one is issued.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-dispute-outcome.mjs
 */
import { readFileSync } from 'node:fs'
import { QUERY_EFFECT_LABEL, QUERY_EFFECT_HINT } from '../../src/lib/disputeCategories.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const schema = read('../../supabase/schema.sql')
const panel = read('../../src/pages/accounts/QueryPanel.tsx')
const writer = read('../../src/lib/accountQueries.ts')
const store = read('../../src/lib/accountRun.ts')
const start = read('../../api/_lib/workflow/start.ts')

/* The LAST definition, because schema.sql is append-only and the name also appears in its own
   comment and grant -- reading the first one asserts against a superseded copy. */
const fnAt = schema.lastIndexOf('create or replace function public.workflow_on_dispute_answered(')
ok('the trigger is there to read', fnAt > 0)
const fn = schema.slice(fnAt, schema.indexOf('$$;', fnAt) + 3)

/* ------------------------------------------------ the three endings */

check('there are three answers and no more',
  Object.keys(QUERY_EFFECT_LABEL).join(','), 'no_change,withdrawn,amount_changed')

/*
 * NEITHER LABEL SAYS "WITHDRAWN" ON ITS OWN, and that is deliberate. `outcome` already has a
 * 'withdrawn' meaning the DEBTOR withdrew the dispute -- the opposite of the firm's "the account
 * can be withdrawn". Two withdrawns on one screen is how somebody ends a sequence that should
 * have resumed.
 */
check('the client one says whose account it is', QUERY_EFFECT_LABEL.withdrawn,
  'The client takes the account back')
ok('...and does not collide with the debtor withdrawing the dispute',
  !/^Withdrawn$/.test(QUERY_EFFECT_LABEL.withdrawn))
/* Each answer says what it DOES, because a collector closing a dispute is deciding whether a
   statutory sequence resumes, ends, or has to be issued again. */
ok('nothing-changed says the sequence carries on', /carries on where it stopped/.test(QUERY_EFFECT_HINT.no_change))
ok('...taking the account back says nothing more is sent', /Nothing more is ever sent/.test(QUERY_EFFECT_HINT.withdrawn))
ok('...and a corrected amount says a fresh one can go', /fresh section 129 can be issued/.test(QUERY_EFFECT_HINT.amount_changed))

/* ------------------------------------------------ what the database does with them */

ok('nothing changed resumes it',
  /coalesce\(new\.outcome_effect, 'no_change'\) = 'no_change'[\s\S]{0,160}?workflow_resume_account/.test(fn))
/*
 * AND SO DOES AN UPHELD DISPUTE WITH NO EFFECT RECORDED, which is the safe direction and the one
 * the 11 already-answered disputes land in. Resuming a sequence that should have ended is visible
 * on the account; ending one that should have resumed loses a demand and nobody notices.
 */
ok('...and so does one answered before the question existed', /coalesce\(new\.outcome_effect, 'no_change'\)/.test(fn))
ok('the client taking it back ends it',
  /'withdrawn' then[\s\S]{0,200}?workflow_exit_account/.test(fn))
ok('...in the firm’s words', /The client took the account back/.test(fn))
ok('a corrected amount ends it too', /The amount was corrected, so the demand has to be re-issued/.test(fn))
ok('...and marks it for re-issue', /set reissue_allowed = true/.test(fn))
/* ONLY THE RUNS THIS ENDED. Marked by account alone it would reopen a sequence that ended on
   payment in full months ago. */
ok('...only the runs this ending ended',
  /set reissue_allowed = true[\s\S]{0,200}?left_reason = 'The amount was corrected/.test(fn))

/* ------------------------------------------------ and the fresh one can actually be started */

/*
 * THE RULE THIS NARROWS: once per account and version, EVER, because "two runs of a statutory
 * sequence is two clocks on one debt". That assumes the first clock was valid. Where the firm has
 * conceded the amount was wrong, the first demand was defective and its clock was never good.
 */
ok('the start route reads the re-issue flag', /reissue_allowed/.test(start))
/*
 * EVERY RUN, NOT ANY. One good run among them means this account has had a valid demand, and
 * that is the clock the rule exists to protect.
 */
ok('...and one good run still closes the door',
  /filter\(\(r\) => !\(r as \{ reissue_allowed\?: boolean \}\)\.reissue_allowed\)/.test(start))
ok('...with the browser filtering on the same fact', /if \(!r\.reissue_allowed\) been\.add/.test(store))

/* ------------------------------------------------ and a person is asked, not guessed at */

ok('closing a dispute asks what happened to the account',
  /What happens to the account\?/.test(panel))
ok('...as three answers rather than a sentence to interpret',
  /QUERY_EFFECT_LABEL\) as QueryEffect\[\]\)\.map/.test(panel))
/* Defaulted to the safe one, for the reason above. */
ok('...defaulted to nothing changing', /useState<QueryEffect>\('no_change'\)/.test(panel))
/* Only on an upheld dispute: the question is meaningless on one that was not. */
ok('...and only asked where the dispute was upheld', /needsAction \? effect : null/.test(panel))
ok('the writer sends it to the column the trigger reads', /outcome_effect: decision\.effect \?\? null/.test(writer))
/* AND IT IS ON THE TIMELINE, because it is the part that decides what happens next and the part
   somebody will be asked about eighteen months later. */
ok('...and it is written on the account’s timeline',
  /parts\.push\(QUERY_EFFECT_LABEL\[decision\.effect\]\)/.test(writer))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-dispute-outcome: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
