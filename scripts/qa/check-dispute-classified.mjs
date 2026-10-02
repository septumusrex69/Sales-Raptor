/**
 * A DISPUTE SAYS WHAT IT IS ABOUT.
 *
 * THE FIRM: "you can dispute should be compulsory. You should be able to say about what is a
 * dispute about."
 *
 * THE FIELD WAS OPTIONAL AND THE REASON FOR IT HAD EXPIRED. The table's own comment records the
 * original argument -- "it could be anything: already paid, goods not delivered, wrong person,
 * wrong amount. A required taxonomy would be a guess dressed as a field" -- and that was a fair
 * thing to say about the seven labels somebody here invented. It stopped being fair the day the
 * firm wrote their own ten, because a taxonomy the people using it produced is not a guess, and
 * because the tenth is Other.
 *
 * WHAT OPTIONAL COST, MEASURED: twelve of the twenty disputes on the book carry no classification.
 * That is 60% of every report that groups by one. A field two people in three skip is not an
 * optional field, it is a field that does not work.
 *
 * THERE ARE SIX DOORS INTO account_queries AND THE RULE HAS TO HOLD ON ALL OF THEM, which is what
 * this file is for -- and the last two were found by making it compulsory and then reading every
 * caller, not by the screens telling anybody:
 *
 *   - THE ESCALATE BOX, where a collector raises one deliberately.
 *   - raiseQuery, which the box and everything else in the browser goes through.
 *   - api/_lib/email/ticket, which is the path a dispute raised off an EMAIL takes -- it inserts
 *     with the service key and never touches raiseQuery, so a rule written only in the lib is a
 *     rule with a door beside it.
 *   - THE DIARY'S CALL BOX. "They dispute it" is one of the eight outcomes, and recordOutcome
 *     raises the dispute from it. This one would have BROKEN THE DIARY: raiseQuery refuses an
 *     unclassified dispute, recordOutcome collects the failure, and the sub-status is deliberately
 *     not written when anything above it failed -- so finishing a disputed account would have
 *     failed outright. So the picker asks on the call, which is the only moment anybody knows.
 *   - CANCELLING AN ARRANGEMENT "because of a dispute", which raises one as a side effect. Here the
 *     cancellation would have landed and the DISPUTE would have been lost with a line of red under
 *     it, which is worse than failing: the account carries on collecting on a disputed debt.
 *   - AND THE DATABASE, which is the only one of the six that cannot be gone round.
 *
 * THE ONE THING THIS DELIBERATELY DOES NOT ASSERT is a check constraint, because a CHECK is
 * enforced on UPDATE as well as INSERT -- including one added NOT VALID. The twelve unclassified
 * disputes already on the book would have become unopenable: assigning one, answering one or
 * closing one refused over a field the screen does not offer after the dispute is raised, with a
 * bare 23514 to explain it. So the guarantee is a TRIGGER with the update case written out, and
 * the assertions below hold it to all three of its cases.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-dispute-classified.mjs
 */
import { readFileSync } from 'node:fs'
import {
  classificationMissing, explanationMissing, CLASSIFICATION_REQUIRED,
  QUERY_CATEGORIES, CATEGORY_NEEDING_EXPLANATION, ESCALATION_KINDS,
} from '../../src/lib/disputeCategories.ts'
/* outcomeReady moved out of OutcomePicker.tsx and into the vocabulary it composes, which is what
   lets the three assertions below hold the RULE rather than its source -- scripts/qa cannot resolve
   a .tsx at all. See the note above it in callOutcome.ts. */
import { EMPTY_OUTCOME, outcomeReady } from '../../src/lib/callOutcome.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* Comments off before any source assertion: these files explain at length what they refuse, and a
   grep cannot tell the explanation from the thing. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const sql = read('supabase/schema.sql')
const box = code('src/pages/accounts/EscalateModal.tsx')
const lib = code('src/lib/accountQueries.ts')
const api = code('api/_lib/email/ticket.ts')

/* ---------------- the rule, asked once ---------------- */

/* THE FUNCTION EXISTS BEFORE ANYTHING ABOUT WHAT IT DECIDES. Four callers asserting against a
   deleted export is four assertions passing on a rule nobody applies. */
check('a dispute with no classification is missing one', classificationMissing('dispute', null), true)
check('...and so is one with only spaces', classificationMissing('dispute', '   '), true)
check('...but a classified one is not', classificationMissing('dispute', 'Amount dispute'), false)
/*
 * AND ONLY A DISPUTE IS ASKED. A request says what it wants through `request_for` -- a different
 * closed list, already required by its own constraint -- and nobody classifies an agent asking a
 * team leader for a ruling. Decided by `needsCategory` rather than by an `if` written four times.
 */
for (const kind of ['request', 'help', 'litigation', 'import']) {
  check(`a ${kind} needs no classification`, classificationMissing(kind, null), false)
  check(`...because needsCategory says so`, ESCALATION_KINDS[kind].needsCategory, false)
}
check('a dispute is the one that does', ESCALATION_KINDS.dispute.needsCategory, true)

/*
 * AND THERE IS SOMETHING TO PICK. A required field whose list is empty is a screen nobody can get
 * off, and "Other" has to be in it or a dispute the nine do not cover cannot be recorded at all.
 */
ok('there is a list to pick from', QUERY_CATEGORIES.length >= 5)
ok('...including one for anything the rest do not cover',
  QUERY_CATEGORIES.some((c) => c.value === CATEGORY_NEEDING_EXPLANATION))
/* WHICH STILL HAS TO SAY WHAT IT WAS. "Other" on its own is a classification that classifies
   nothing, so the two rules run together rather than one letting the other off. */
check('"Other" alone is not an answer', explanationMissing(CATEGORY_NEEDING_EXPLANATION, 'x'), true)

/* ---------------- door 1: the box ---------------- */

ok('the box asks that function rather than deciding for itself',
  /classificationMissing\(kind, category\)/.test(box))
/* NOT ON A LINK. The classification belongs to the dispute the email is being ADDED to, and that
   one already carries one -- asking again would be a second answer able to disagree. */
ok('...and not when the email is being added to an open dispute',
  /!linkedTo && classificationMissing/.test(box))
/*
 * "NONE" IS GONE, AND THE PLACEHOLDER CANNOT BE CHOSEN. An <option value=""> that is selectable is
 * the same optional field with a required flag in front of it -- and this is the one assertion that
 * would have caught the field being reopened by a one-word edit.
 */
ok('the picker no longer offers None', !/<option value="">None<\/option>/.test(box))
ok('...and its placeholder is disabled', /<option value="" disabled>/.test(box))
/* THE BUTTON REFUSES, AND THE BOX SAYS WHY. A dead button with no sentence beside it is the fault
   the compose box shipped with; the firm found that one by pressing Send and getting nothing. */
ok('the button is disabled without a classification', /\|\| needsClassification\}/.test(box))
ok('...and the reason is on the screen', /Pick what the debtor is disputing/.test(box))
/* AND submit() refuses as well, for the paths that reach it another way -- the same second lock the
   description already has. */
ok('submit refuses it too', /if \(needsClassification\) \{[\s\S]{0,120}?CLASSIFICATION_REQUIRED/.test(box))

/* ---------------- door 2: raiseQuery ---------------- */

ok('raiseQuery refuses an unclassified dispute',
  /if \(classificationMissing\(input\.kind, input\.category\)\) throw/.test(lib))
/* BEFORE THE INSERT, so the person gets the sentence rather than the trigger's errcode arriving as
   a Postgres string. The trigger is the guarantee; this is the message. */
/* raiseQuery's OWN insert, not the first one in the file -- the module reads the table in half a
   dozen places above this one, and `indexOf` would land on a select and make the order assertion
   pass on nothing. */
const raise = lib.slice(lib.indexOf('export async function raiseQuery('))
const insertAt = raise.indexOf(".from('account_queries')\n    .insert(")
const refuseAt = raise.indexOf('classificationMissing(input.kind')
ok('...and there is an insert to be before', insertAt > 0)
ok('...and refuses before it', refuseAt > 0 && refuseAt < insertAt)
/* AND "Other" WITHOUT THE WORDS IS REFUSED ON THE SAME PATH, or the one classification that says
   nothing becomes the way round a rule about saying something. */
ok('...and "Other" with nothing behind it', /explanationMissing\(input\.category, input\.description\)/.test(lib))

/* ---------------- door 3: the email endpoint ---------------- */

/*
 * THE DOOR THAT WOULD HAVE BEEN LEFT OPEN. This endpoint inserts with the service key and never
 * calls raiseQuery -- "This is a dispute" on an email posts here. A rule written only in the lib is
 * a rule with a door beside it, and this is the door the firm uses most.
 */
ok('the endpoint refuses an unclassified dispute',
  /classificationMissing\(kind, category\)/.test(api))
ok('...with the same words the browser uses', /CLASSIFICATION_REQUIRED/.test(api))
ok('...and refuses "Other" with nothing behind it', /explanationMissing\(category, description\)/.test(api))
/* NOT ON A LINK, for the same reason the box does not ask. */
ok('...and asks nothing when the email is being linked', /!queryId && classificationMissing/.test(api))
/* ONE SPELLING OF THE CATEGORY, read once and used twice. It used to be trimmed inline on the
   insert, which is how a value can be checked in one form and stored in another. */
ok('the category it checks is the category it stores',
  /const category = typeof body\.category === 'string'/.test(api)
  && /category: kind === 'dispute' \? \(category \|\| null\) : null/.test(api))

/* ---------------- door 4: the diary's call box ---------------- */

/*
 * THE DOOR THAT WOULD HAVE BROKEN THE DIARY. recordOutcome raises the dispute behind the
 * "They dispute it" outcome and passed no category. Making the field compulsory without this would
 * have meant raiseQuery refusing, recordOutcome collecting the failure -- and the sub-status NOT
 * being written, because it is written only when everything above it landed. Finishing a disputed
 * account would have failed outright, on the busiest box in the building.
 */
const picker = code('src/components/diary/OutcomePicker.tsx')
const outcome = code('src/lib/recordOutcome.ts')
const workbar = code('src/components/diary/DiaryWorkBar.tsx')
const complete = code('src/components/diary/CompleteDiaryModal.tsx')

ok('the call box asks what kind of dispute', /chosen === 'disputed' &&[\s\S]{0,400}?QUERY_CATEGORIES\.map/.test(picker))
ok('...with a placeholder that cannot be chosen', /<option value="" disabled>/.test(picker))
/* AND THE SAVE BUTTON WAITS FOR IT. outcomeReady is what the two boxes disable on, so a rule that
   is drawn but not required is a rule the collector discovers as a failure after the call. */
/*
 * AND THE SAVE BUTTON WAITS FOR IT, held on the function the two boxes disable on rather than on
 * its source. A dispute with words and no classification is the exact row this whole file exists
 * to prevent, so it is asked of the rule itself.
 */
const said = 'Says the last two invoices were for work never delivered.'
ok('...and the account cannot be finished without it',
  !outcomeReady({ ...EMPTY_OUTCOME, outcome: 'disputed', category: '', words: said }))
ok('...nor with "Other" and nothing behind it',
  !outcomeReady({
    ...EMPTY_OUTCOME, outcome: 'disputed', category: CATEGORY_NEEDING_EXPLANATION, words: 'Disputes.',
  }))
/*
 * AND `outcomeReady` STILL ANSWERS THE QUESTIONS IT ANSWERED BEFORE. It used to end
 * `if (needsWords(...)) return ...` -- an early RETURN, not a guard -- so adding a rule after it
 * would have been unreachable on every outcome that needs words, which includes 'disputed' itself.
 * This is the assertion that catches that: a dispute with PLENTY of words and no classification
 * must still be refused, which only happens if the words test falls THROUGH.
 */
ok('...and the words rule is a guard rather than a return',
  !outcomeReady({ ...EMPTY_OUTCOME, outcome: 'disputed', category: '', words: said })
  && outcomeReady({ ...EMPTY_OUTCOME, outcome: 'disputed', category: 'Amount in dispute', words: said }))

ok('recordOutcome carries the classification', /category: input\.category \?\? null,/.test(outcome))
/* NOT DEFAULTED THERE. A fallback -- 'Other', or the words -- is how a required field becomes a
   field nobody answers, which is how 60% of the book came to be unclassified to begin with. */
ok('...without inventing one', !/category: input\.category \?\? '/.test(outcome))
for (const [name, src] of [['the work bar', workbar], ['the diary modal', complete]]) {
  ok(`${name} hands it over`, /category: came\.outcome === 'disputed' \? came\.category : null,/.test(src))
}

/* ---------------- door 5: cancelling an arrangement for a dispute ---------------- */

/*
 * WORSE THAN A FAILURE IF IT IS MISSED. The cancellation lands first and the dispute is raised
 * after it, so an unclassified one would have left the arrangement cancelled, the dispute NOT
 * raised, and every collection sequence the promise was holding handed straight back -- on an
 * account the debtor has just disputed.
 */
const cancel = code('src/pages/accounts/CancelArrangementModal.tsx')
const account = code('src/pages/accounts/AccountDetail.tsx')
ok('the cancel box asks when the cause is a dispute',
  /cause === 'disputed' &&[\s\S]{0,600}?QUERY_CATEGORIES\.map/.test(cancel))
ok('...and will not cancel until it is answered',
  /const needsClassification = cause === 'disputed'[\s\S]{0,200}?classificationMissing\('dispute', category\)/.test(cancel))
ok('...which the button reads', /&& !needsClassification/.test(cancel))
ok('...and it reaches the dispute it raises', /category,/.test(account))

/* ---------------- door 6: the database, which cannot be gone round ---------------- */

/* schema.sql is append-only: the LAST definition is the live one, and the bare name also appears in
   the comment and the trigger that follow it. */
const at = sql.lastIndexOf('create or replace function public.dispute_says_what_it_is_about(')
ok('the database has the rule', at > 0)
const fn = at > 0 ? sql.slice(at, sql.indexOf('$$;', at)) : ''
ok('...refusing a dispute with no classification',
  /raise exception 'Say what the dispute is about/.test(fn))
/* THE SAME SENTENCE IN BOTH PLACES. Two wordings for one refusal is two things the firm has to
   recognise as the same problem. */
ok('...in the same words the app uses', fn.includes(CLASSIFICATION_REQUIRED))
/* ONLY A DISPUTE, and `is distinct from` rather than `<>` -- kind has a default but a comparison
   against NULL is NULL, and `if NULL then` does not return. */
ok('...only on a dispute', /new\.kind is distinct from 'dispute' then return new/.test(fn))
/*
 * AND A DISPUTE ALREADY ON THE BOOK WITHOUT ONE STAYS WORKABLE. This is the case a CHECK constraint
 * could not express and the reason this is a trigger: twelve existing disputes carry no
 * classification, and refusing every UPDATE to them would mean nobody could assign, answer or close
 * one. `old.kind` is in the test on purpose -- 'help' changed to 'dispute' arrives with a null
 * category, and that is a dispute being raised.
 */
ok('...leaving a dispute raised before the rule alone',
  /tg_op = 'UPDATE'[\s\S]{0,200}?old\.kind = 'dispute'[\s\S]{0,200}?old\.category is null/.test(fn))
/* WHICH IS ONLY SAFE BECAUSE REMOVAL IS STILL REFUSED. Without that, the exemption is a way to
   empty any classification in two updates. */
ok('...but a classification is never taken away',
  /new\.category is not null and length\(btrim\(new\.category\)\) > 0 then return new/.test(fn))
/* AND NO CHECK CONSTRAINT SNEAKED IN BESIDE IT, which would re-break every one of those twelve. */
ok('and it is not also a check constraint',
  !/account_queries[\s\S]{0,80}?check \(kind <> 'dispute' or \(category is not null/.test(sql))

/* ON EVERY UPDATE, not `update of kind, category`. A column list fires only when that column is in
   the SET clause, and the browser sends partial patches -- so the exemption above would never run
   for the legacy rows and the removal guard would be one PostgREST quirk away from silence. */
ok('the trigger is on insert and every update',
  /create trigger queries_dispute_says_what_it_is_about\s*\n\s*before insert or update on public\.account_queries/.test(sql))
ok('...for each row', /queries_dispute_says_what_it_is_about[\s\S]{0,200}?for each row execute function public\.dispute_says_what_it_is_about\(\)/.test(sql))

console.log(`\ncheck-dispute-classified: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
