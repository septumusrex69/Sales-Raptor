/**
 * THE ROW OF THINGS YOU CAN DO TO A RECORD, AND WHY IT HAS TO BE ONE SIZE.
 *
 * THE FIRM, LOOKING AT AN ACCOUNT: "all these things bigger, smaller." They were looking at ten
 * buttons of four different heights, wrapping onto two lines, with their labels floating in the
 * middle of boxes twice as tall as the text in them.
 *
 * ONE MISSING WORD CAUSED ALL OF IT. A flex line stretches its children to the height of the
 * tallest by default, and three of the buttons in this row are not plain buttons: Call, Trace and
 * the dial link inside Call each print a line of status under themselves after they are used --
 * "XDS opened, 2 searches, charged R32.00 + VAT". So the moment a collector recorded a trace that
 * column became 66px tall and every OTHER button on the line stretched to match it, while Call
 * itself stayed 38px because its own wrapper is a column. Four heights in one row, out of one
 * default nobody wrote down.
 *
 * TWO RULES FOLLOW AND NEITHER IS COSMETIC:
 *
 *   - THE ROW NEVER STRETCHES ITS CHILDREN. Every button is its own natural height, on every page,
 *     whatever else is on the line with it.
 *   - A BUTTON'S STATUS IS OUT OF THE FLOW. In the flow it makes its own column two lines taller
 *     than its neighbours, which pushes the wrap and moves every button after it down the page for
 *     the ten seconds the message lasts. A confirmation that rearranges the row it is confirming
 *     is worse than no confirmation.
 *
 * AND THE GEOMETRY ITSELF IS MEASURED IN A REAL BROWSER -- see e2e/account-templates.mjs, which
 * puts something tall in the row and holds every button to one height. This file guards the source
 * the browser check cannot explain: that the rule is written down in one place and that the three
 * components which report status all go through it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-action-row.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const shell = read('src/components/record/RecordShell.tsx')
const trace = read('src/pages/accounts/TraceButton.tsx')
const call = read('src/pages/accounts/CallButton.tsx')
const phone = read('src/components/PhoneLink.tsx')
const account = read('src/pages/accounts/AccountDetail.tsx')

/* ---------- the row ---------- */

/* PRESENT BEFORE ANYTHING ABOUT IT. A renamed or deleted component makes every assertion below
   pass on a file that no longer draws the row. */
ok('there is one component for the row', /export function RecordActions\(/.test(shell))
const row = shell.slice(shell.indexOf('export function RecordActions('), shell.indexOf('export function RecordActionNote('))
ok('...and it does not stretch what is in it', /items-start/.test(row))
/* STILL A ROW THAT WRAPS. `items-start` fixes the height; taking the wrap with it would push the
   row off the side of an iPad, which is the screen the collectors actually use. */
ok('...and still wraps rather than scrolling the page sideways', /flex-wrap/.test(row))
/* The hook the browser check measures through. Asserted here so renaming it fails fast rather
   than leaving the e2e check silently measuring nothing. */
ok('...and is findable in a real browser', /data-qa="record-actions"/.test(row))

/* ---------- the status under a button ---------- */

ok('there is one place a button reports what it just did', /export function RecordActionNote\(/.test(shell))
/* THE FUNCTION ITSELF, not everything after it -- sliced to the end of the file, `absolute` and
   `top-full` from some later component would satisfy assertions about this one. */
const noteAt = shell.indexOf('export function RecordActionNote(')
const note = shell.slice(noteAt, shell.indexOf('\n}', noteAt) + 2)
/*
 * AND IT IS DRAWN UNDER THE WHOLE ROW, NOT UNDER ITS OWN BUTTON.
 *
 * THE FIRM: "look at what's going on there between the phone calls and the scripts and the stuff.
 * It just looks crappy."
 *
 * The line used to hang from its own button with `absolute top-full`, which is right while the row
 * fits on one line and wrong the moment it wraps -- and on an iPad it wraps. "Voicemail or no
 * answer · no consultation" was painted on top of the SECOND line of buttons, across Section 129
 * and Trace: a confirmation covering the next thing you were going to press.
 *
 * THE ORIGINAL REASON IT LEFT THE FLOW STILL HOLDS AND IS STILL HONOURED. No button moves, because
 * the band sits below every one of them. What shifts for the seconds a message lasts is the
 * content under the bar, which is a page settling rather than a row rearranging under a thumb.
 */
ok('...and no button is overlaid by another button’s status',
  !/absolute/.test(note) && !/top-full/.test(note))
ok('...because the notes collect in one band under the row',
  /data-qa="record-actions-notes"/.test(row))
/* THE BAND IS IN FLOW, so it cannot land on top of whatever is under the action bar either. */
ok('...drawn in flow rather than floated over the page',
  /record-actions-notes"[^>]*className="mt-1\.5 flex flex-col/.test(row))
/*
 * KEYED PER BUTTON. Two buttons can each be saying something -- a trace and a call -- and a button
 * that falls silent must clear only its own line.
 */
ok('...one line per button that is saying something', /publish\(id, note \?\? null\)/.test(note))
/* AND IT TAKES ITS LINE WITH IT. A collector who leaves the account mid-message must not leave a
   stale "charged R32.00" standing on the next one. */
ok('...and the line goes when the button does', /return \(\) => publish\(id, null\)/.test(note))

/* ---------- and the three that use it ---------- */

/*
 * ALL THREE, BECAUSE ONE LEFT BEHIND IS THE ONE THAT BREAKS THE ROW. Trace prints two lines after
 * a search, Call prints the consultation it recorded, and the dial link inside Call prints
 * "Ringing extension 201" while the call is going out.
 */
for (const [name, src] of [['Trace', trace], ['Call', call], ['the dial link', phone]]) {
  ok(`${name} reports through that one place`, /<RecordActionNote/.test(src))
  ok(`...importing it rather than writing its own`,
    /import \{ RecordActionNote \} from '[^']*record\/RecordShell'/.test(src))
}
/*
 * AND NONE OF THEM KEEPS THE OLD IN-FLOW COLUMN AS WELL. This is the assertion that would have
 * caught the bug: the wrapper each of them used was `inline-flex flex-col items-start`, which is
 * exactly what puts the status back into the row's height.
 */
for (const [name, src] of [['Trace', trace], ['Call', call]]) {
  ok(`${name} no longer hangs its status in the row`,
    !/inline-flex flex-col items-start/.test(src))
}

/*
 * THE DIAL LINK IS THE EXCEPTION AND IT IS DELIBERATE. PhoneLink is used in fifteen places -- in a
 * sentence, in a table cell, in a list of numbers to choose from -- where a status pushing its own
 * line down is right and floating it over the next row is not. So it keeps both and the caller
 * says which, and the account row is the caller that asks.
 */
ok('the dial link still has its in-flow form for everywhere else',
  /inline-flex/.test(phone) && /flex-col items-start min-w-0/.test(phone))
ok('...chosen by the caller rather than guessed', /inActionRow/.test(phone))
ok('...and the account row asks for the floating one',
  /<PhoneLink[^>]*inActionRow/.test(call))

/* ---------- one size, by class as well as by layout ---------- */

/*
 * ACTION_BASE IS THE SIZE. Every button in the row wears it, including the two that are links
 * rather than Actions -- see where AccountDetail hands it to CallButton and TraceButton. A second
 * padding or a second text size anywhere in the row is the same defect by another route, and the
 * browser cannot tell you WHICH class did it.
 */
ok('there is one class that sizes an action', /export const ACTION_BASE\b/.test(shell))
const base = shell.slice(shell.indexOf('export const ACTION_BASE'), shell.indexOf('export const ACTION_ENABLED'))
ok('...with one padding', /px-3\.5 py-2/.test(base))
ok('...and one text size', /text-sm/.test(base))
check('the account row hands that same class to the buttons that are not Actions',
  (account.match(/\$\{ACTION_BASE\} \$\{ACTION_ENABLED\}/g) ?? []).length, 2)

/* ---------------------------------------------------------------------------------------------
 * AND "ONE COLUMN" ENDS IN ONE COLUMN'S WORTH, NOT THREE.
 *
 * THE FIRM, of the three arrangements: "the one where everything is under one another — that one
 * is weird, it doesn't work properly. But the other two work fine. The one with the three columns
 * and the one with the two columns, that works fine."
 *
 * WHAT WAS WEIRD WAS MEASURABLE. The stacked arrangement is capped to a 64rem measure and ended
 * with its short cards three across — about 320px a card, which is NARROWER than the right-hand
 * rail of the three-column arrangement. So the card you came to work in, the promise and its
 * simulation, was most cramped in the layout named after having only one column. A label that
 * promises one thing and a foot that does another is a choice nobody can predict, and
 * predictability is the entire reason this control exists.
 *
 * NOT ONE ACROSS EITHER: these are the SHORT cards, and a single column of them on a 27" screen is
 * a page of mostly empty boxes with a scrollbar. Two is what the label can carry.
 * ------------------------------------------------------------------------------------------- */

const stacked = shell.slice(shell.indexOf("if (layout === 'stacked')"),
  shell.indexOf("if (layout === 'wide')"))
ok('the stacked arrangement was found', stacked.length > 200)
/*
 * READ OUT OF THE SHORT-CARD ROW ITSELF, not the whole arrangement -- the false positive this
 * walked into first. The block OPENS with its own `lg:grid-cols-3`: the details card spanning two
 * of three with the summary beside it, which is a different row and a deliberate one. A pattern
 * loose enough to catch the foot caught that instead and reported a bug in correct code.
 */
const shortCards = stacked.slice(stacked.indexOf('{keyed(rest)}') - 160,
  stacked.indexOf('{keyed(rest)}') + 20)
ok('the short-card row was found', /keyed\(rest\)/.test(shortCards))
ok('...and lays them two across', /md:grid-cols-2/.test(shortCards))
ok('...not three', !/grid-cols-3/.test(shortCards))
/* ITEMS-START SURVIVES, which is a different rule and the one that keeps a busy card from
   stretching its neighbours into empty boxes of the same height. */
ok('...without stretching them to one height', /items-start/.test(shortCards))
/* AND THE MEASURE IS STILL CAPPED. A full-width timeline on a wide screen is a worse read than a
   narrow one, which is why this arrangement has a maximum at all. */
ok('...inside a readable measure', /max-w-5xl/.test(stacked))
/* THE THREE-COLUMN ONE IS UNTOUCHED, which the firm said works fine. Held so that "fixing" the
   stacked one never quietly reshapes the arrangement nobody complained about. */
const columns = shell.slice(shell.indexOf("if (layout === 'wide')"))
ok('the three-column arrangement still has three', /xl:grid-cols-\[minmax/.test(columns))

console.log(`\ncheck-action-row: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
