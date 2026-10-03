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

/*
 * FOUR ANSWERS, AND WHICH IS WHICH TURNS ON ONE QUESTION: is the debtor still in default?
 * Ordered commonest first, which is also safest first -- the two that carry on, then the two
 * that end it.
 */
check('there are four answers and no more',
  Object.keys(QUERY_EFFECT_LABEL).join(','),
  'no_change,amount_changed,no_longer_in_arrears,withdrawn')

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
/*
 * A CORRECTED AMOUNT DOES NOT VOID THE DEMAND, and this reverses what was built first. Section
 * 129(1)(a) requires notice of the DEFAULT and the proposal to refer the matter on; the amount is
 * not the statutory content. The firm pushed back and were right: "the guy disputed it, the
 * dispute was right, the amount was changed, but everything else still stays in place."
 */
ok('...a corrected amount says the demand stands', /section 129 stands/.test(QUERY_EFFECT_HINT.amount_changed))
ok('...and that the next notices quote the new figure', /quotes the corrected balance/.test(QUERY_EFFECT_HINT.amount_changed))
/* AND THE NARROW CASE WHERE IT DOES FALL AWAY: no default, so nothing to demand remedy of. */
ok('...while clearing the arrears ends it', /no default to demand remedy of/.test(QUERY_EFFECT_HINT.no_longer_in_arrears))
ok('...and says a fresh one can go later', /fresh\s+.?section 129 can be issued/.test(QUERY_EFFECT_HINT.no_longer_in_arrears))

/* ------------------------------------------------ what the database does with them */

/*
 * THE SEQUENCE CARRIES ON UNLESS THE DEBT ITSELF HAS GONE. Not upheld; upheld with nothing
 * changed; upheld with the amount corrected -- in every one the debtor was in default and was
 * told so, which is what the notice had to do.
 */
/* The window is wide enough to clear the comment that now sits between the condition and the call
   -- and still narrow enough that deleting the call cannot be satisfied by a later one, because
   every resume after this point in the function is an EXIT rather than a resume. */
ok('nothing changed resumes it',
  /in \('no_change', 'amount_changed'\)[\s\S]{0,400}?workflow_resume_account/.test(fn))
/* AND IT NAMES ITS CAUSE. Answering the objection says nothing about a promise the debtor has
   made, and a resume that lifted every hold let a section 129 carry on over a live arrangement. */
ok('...lifting only the holds a dispute put there',
  /workflow_resume_account\(new\.account_id, 'dispute_closed', 'dispute'\)/.test(fn))
ok('...and so does a corrected amount', /'no_change', 'amount_changed'/.test(fn))
/*
 * AND SO DOES AN UPHELD DISPUTE WITH NO EFFECT RECORDED, which is the safe direction and the one
 * the 11 already-answered disputes land in. Resuming a sequence that should have ended is visible
 * on the account; ending one that should have resumed loses a demand and nobody notices.
 */
ok('...and so does one answered before the question existed', /coalesce\(new\.outcome_effect, 'no_change'\)/.test(fn))
ok('the client taking it back ends it',
  /'withdrawn' then[\s\S]{0,200}?workflow_exit_account/.test(fn))
ok('...in the firm’s words', /The client took the account back/.test(fn))
/* NO DEFAULT, NOTHING TO DEMAND REMEDY OF -- the one case where the notice does fall away. */
ok('clearing the arrears ends it', /The account was not in arrears, so the demand fell away/.test(fn))
ok('...and marks it for re-issue', /set reissue_allowed = true/.test(fn))
/* ONLY THE RUNS THIS ENDED. Marked by account alone it would reopen a sequence that ended on
   payment in full months ago. */
ok('...only the runs this ending ended',
  /set reissue_allowed = true[\s\S]{0,220}?left_reason = 'The account was not in arrears/.test(fn))
/* AND A CORRECTED AMOUNT NO LONGER ENDS ANYTHING, which is what this reversed. */
ok('a corrected amount ends nothing', !/The amount was corrected, so the demand has to be re-issued/.test(fn))

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
/* THE CAST MOVED OUT OF THE FILTER and onto the row list, because the route now needs each run's
   STATE as well -- it closes the live one before creating its replacement. The rule is unchanged:
   any run without the flag blocks. */
ok('...and one good run still closes the door',
  /const blocking = runs\.filter\(\(r\) => !r\.reissue_allowed\)/.test(start))
ok('...reading every run of this account and version',
  /\.select\('id, state, reissue_allowed'\)\.eq\('account_id', accountId\)\.eq\('version_id', versionId\)/.test(start))
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
