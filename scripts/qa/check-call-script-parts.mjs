/**
 * A CALL SCRIPT, READ BACK OUT OF THE ONE TEXT THE LIBRARY STORES -- AND THE PARSE IS TOTAL.
 *
 * THE FIRM'S BRIEF asks for five parts because the screen draws each differently: the words to
 * read, the bracketed directions that are never read aloud, the branches, what must be captured,
 * and what must never be said. This file holds two things about that:
 *
 *   1. THE PARSE IS TOTAL. Every line of every one of the firm's 31 scripts lands in exactly one
 *      part, and `unplaced` is empty on all of them. A parser that quietly swallowed a DO NOT line
 *      would take the one part of a script a complaint to the Council for Debt Collectors is
 *      founded on -- the same rule the letter editor runs on, and for the same reason.
 *   2. IT IS READ FROM THE SEED, NOT FROM A DATABASE. scripts/call-scripts/seed.sql is the record
 *      of what was imported, so this runs with no network and catches a regression in the parser
 *      against the firm's real words rather than against a fixture somebody wrote to pass.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-call-script-parts.mjs
 */
import { readFileSync } from 'node:fs'
import {
  fieldsInScript, isAllDirection, mergeSegments, parseCallScript, spokenText, splitRuns,
  unanswered,
} from '../../src/lib/callScriptParts.ts'
import { ALL_SCRIPTS } from '../../src/lib/callScripts.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

/* ------------------------------------------------ the runs */

check('a plain line is all words',
  splitRuns('Good morning, may I speak to {{debtor_name}} please?'),
  [{ kind: 'say', text: 'Good morning, may I speak to {{debtor_name}} please?' }])
/* A WHOLE LINE IN BRACKETS IS AN INSTRUCTION, and the firm writes a good many of them. */
check('a bracketed line is an instruction',
  splitRuns('[Pause. Let them answer. Do not fill the silence.]'),
  [{ kind: 'direction', text: 'Pause. Let them answer. Do not fill the silence.' }])
/*
 * AND AN INSTRUCTION CAN SIT AT THE END OF A SENTENCE SOMEBODY READS OUT, which is why this splits
 * rather than classifying whole lines: classified by line, half the sentence is read aloud and the
 * instruction goes with it.
 */
check('an instruction inside a line is split out',
  splitRuns('Please email the proof the moment you have paid. [Capture PIF pending.]'),
  [{ kind: 'say', text: 'Please email the proof the moment you have paid.' },
    { kind: 'direction', text: 'Capture PIF pending.' }])
check('...and in the middle of one',
  splitRuns('Is that right? [Wait.] Thank you.').map((r) => r.kind),
  ['say', 'direction', 'say'])
/*
 * AN UNCLOSED BRACKET IS WORDS. A stray "[" must not turn the rest of a script into something
 * nobody reads aloud -- the same trade as the letter parser's closed tag set, and the cheaper
 * failure of the two.
 */
check('an unclosed bracket stays words',
  splitRuns('Tell them [this is fine'), [{ kind: 'say', text: 'Tell them [this is fine' }])
check('an empty bracket adds nothing', splitRuns('Say this []'),
  [{ kind: 'say', text: 'Say this' }])

ok('a line of nothing but instructions is marked as such',
  isAllDirection({ runs: splitRuns('[After verification]') }))
check('...and a mixed line is not',
  isAllDirection({ runs: splitRuns('Thank you. [Pause.]') }), false)
/* WHAT IS ACTUALLY SAID OUT LOUD, instructions dropped. */
check('the spoken words drop the instructions',
  spokenText({ runs: splitRuns('Thank you. [Pause.] Can you pay?') }), 'Thank you. Can you pay?')

/* ------------------------------------------------ the five parts */

const sample = `Kind
Call script
Goes to
Individual
Workflow day
Day 1
Pops up
On the handover node.
Goal of the call
Make first contact.
WHAT THE COLLECTOR SAYS
[After verification]
The balance is {{balance}}.
IF THEY SAY
Cannot pay it all
That is fine. [Go to script-ptp-setup.]
Refuses outright
I hear you.
CAPTURE ON THE ACCOUNT
—  PIF, PTP or RTP
—  The reason in their own words
DO NOT
Promise that paying stops a listing.`
const p = parseCallScript(sample)
check('the header facts are read', [p.goesTo, p.workflowDay, p.popsUp, p.goal],
  ['Individual', 'Day 1', 'On the handover node.', 'Make first contact.'])
check('the spoken lines are the spoken lines', p.spoken.length, 2)
ok('...and the first of them is an instruction', isAllDirection(p.spoken[0]))
check('the branches pair up', p.branches.map((b) => b.heard), ['Cannot pay it all', 'Refuses outright'])
check('...with the reply under each', spokenText(p.branches[0].reply), 'That is fine.')
/* THE BULLET IS THE DOCUMENT'S, NOT THE FIRM'S WORDS, so it comes off rather than being drawn
   twice beside a list marker. */
check('the capture lines lose their bullets', p.capture,
  ['PIF, PTP or RTP', 'The reason in their own words'])
check('the DO NOT lines are kept', p.never, ['Promise that paying stops a listing.'])
/* "Kind" and "Call script" carry nothing and must not land in `unplaced` -- every row in the
   library is a call script, which is what the kind column says. */
check('nothing is left unplaced', p.unplaced, [])

/*
 * A SCRIPT WITH NO HEADING AT ALL KEEPS ITS WORDS, in `unplaced`, rather than coming back empty.
 *
 * THIS IS THE RULE THAT MATTERS. A script pasted in without its WHAT THE COLLECTOR SAYS heading
 * shows up as a problem on the screen instead of as a blank panel, and the panel draws it.
 */
const headless = parseCallScript('Good morning, may I speak to the debtor?\nThank you.')
check('a script with no headings is not silently empty', headless.unplaced.length, 2)
check('...and its spoken part is honestly empty', headless.spoken.length, 0)
/* AN UNKNOWN HEADING TAKES ITS LINES TO `unplaced` TOO -- not into whichever part came last. */
const odd = parseCallScript('WHAT THE COLLECTOR SAYS\nHello.\nSOMETHING NEW\nA line nobody expected.')
check('an unknown heading does not swallow its lines into the part above', odd.spoken.length, 1)
check('...they are unplaced', odd.unplaced, ['A line nobody expected.'])
/* A HALF-WRITTEN BRANCH IS STILL SOMETHING THE DEBTOR SAID. Dropping it would lose the one line a
   collector is hunting for while being asked that exact question. */
const halfBranch = parseCallScript('IF THEY SAY\n“I already paid”')
check('a branch with no reply is kept', halfBranch.unplaced, ['I already paid'])
check('...and is not a branch', halfBranch.branches.length, 0)

/* ------------------------------------------------ the fields */

check('every field in the script is found, wherever it sits',
  fieldsInScript(parseCallScript(`WHAT THE COLLECTOR SAYS
The balance is {{balance}}.
IF THEY SAY
Asks for proof
Send it to {{firm_email}}.
CAPTURE ON THE ACCOUNT
—  Quote {{reference}}
DO NOT
Quote {{case_number}} to a third party.`)).sort(),
  ['balance', 'case_number', 'firm_email', 'reference'])
check('what this account cannot answer',
  unanswered(parseCallScript('WHAT THE COLLECTOR SAYS\n{{balance}} and {{respond_by}}.'),
    { balance: 'R 1,00' }),
  ['respond_by'])
/* A VALUE OF SPACES IS NOT AN ANSWER. It renders as a gap a collector reads straight past. */
check('whitespace is not an answer',
  unanswered(parseCallScript('WHAT THE COLLECTOR SAYS\n{{balance}}.'), { balance: '   ' }),
  ['balance'])

/* ------------------------------------------------ what the screen draws */

/*
 * A MISSING FIELD BECOMES A MARKED GAP THAT NAMES ITSELF, and the firm asked for exactly that:
 * "if a field is empty, show the field name in red rather than an empty space." Both alternatives
 * get read out on a recorded call -- the braces, or a sentence that stops mid-air.
 */
check('a filled field becomes its value',
  mergeSegments('owes {{balance}} today', { balance: 'R 48 250,00' }),
  [{ kind: 'text', text: 'owes ' }, { kind: 'text', text: 'R 48 250,00' },
    { kind: 'text', text: ' today' }])
check('an empty one becomes a named gap',
  mergeSegments('owes {{balance}} today', {}),
  [{ kind: 'text', text: 'owes ' }, { kind: 'missing', field: 'balance' },
    { kind: 'text', text: ' today' }])
/* THE BRACES NEVER SURVIVE INTO WHAT IS DRAWN -- which is the whole failure being prevented. */
ok('no braces reach the screen',
  mergeSegments('{{balance}} and {{reference}}', { reference: 'X' })
    .every((s) => s.kind === 'missing' || !/\{\{/.test(s.text)))

/* ------------------------------------------------ the firm's own 31 */

const seed = read('../call-scripts/seed.sql')
const re = /\('(script-[a-z0-9-]+)', 'collections', 'call_script', '(?:[^']|'')*', null,\n   '((?:[^']|'')*)',/g
const scripts = new Map()
for (const m of seed.matchAll(re)) scripts.set(m[1], m[2].replace(/''/g, "'"))

check('all 31 of the firm’s scripts are in the seed', scripts.size, 31)
/* THE SAME 31 THE RULES EXPECT. Written in two places -- the roster in callScripts.ts and the
   seed -- and a script in one and not the other is either a panel button that opens nothing or a
   script nothing ever shows. */
check('the roster and the seed agree',
  ALL_SCRIPTS.filter((k) => !scripts.has(k)), [])
check('...in both directions',
  [...scripts.keys()].filter((k) => !ALL_SCRIPTS.includes(k)), [])

for (const [key, body] of scripts) {
  const s = parseCallScript(body)
  /* THE PARSE IS TOTAL ON EVERY ONE OF THEM. This is the assertion the whole file is for. */
  check(`${key}: nothing is unplaced`, s.unplaced, [])
  ok(`${key}: has words to say`, s.spoken.length > 0)
  ok(`${key}: has a DO NOT list`, s.never.length > 0)
  ok(`${key}: says what to capture`, s.capture.length > 0)
  /* AND NO SCRIPT CARRIES SECTION G. The objections are sixteen one-liners shown beside whichever
     script is open -- OBJECTIONS in callScripts.ts -- and the last script in the document is
     followed by them, which is how the first import put all sixteen inside
     script-close-no-agreement. */
  ok(`${key}: carries no objection list`, !/Answers to what they actually say/.test(body))
}

/*
 * EVERY FIELD THE FIRM'S SCRIPTS USE IS ONE THE BOOK OFFERS -- now with no exceptions.
 *
 * {{settlement_amount}}, {{settlement_expiry}} AND {{settlement_saving}} WERE THE THREE, held here
 * by name while there was no settlement record to answer them (task #69). The store landed with
 * account_settlements, and the fields answer only off an APPROVED, unlapsed offer -- the firm's
 * DO NOT on script-settlement-call is "quote a settlement figure that is not approved on the
 * account", and settlement.isQuotable is the one place that decides it. So the exception was
 * deleted rather than left as a stale apology, which is what its own reverse assertion was for.
 */
const { MERGE_FIELDS } = await import('../../src/lib/messageTemplates.ts')
const known = new Set(MERGE_FIELDS.collections.map((f) => f.key))
const unknown = new Set()
for (const [, body] of scripts) {
  for (const f of fieldsInScript(parseCallScript(body))) if (!known.has(f)) unknown.add(f)
}
check('every field the scripts quote is in the collections vocabulary', [...unknown], [])
check('...the settlement three among them',
  ['settlement_amount', 'settlement_expiry', 'settlement_saving'].filter((f) => known.has(f)).length, 3)

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-call-script-parts: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
