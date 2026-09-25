/**
 * THE SEQUENCE AS A ROW OF DOTS, AND WHICH DOT IT OPENS ON.
 *
 * THE FIRM, LOOKING AT THE LIST THIS REPLACED: "this doesn't work for me. The layout here, it's
 * long... I have an idea. I'll draw you something. So it'll be like a flow diagram almost... it'll
 * be little things and it'll have different like colours if it's been successful or not
 * successful. But you can also like extend it to show every single step in the process." Then they
 * drew it: dots joined by a line, filled behind, hollow ahead, and a drop-down underneath.
 *
 * WHAT THE OLD LIST ACTUALLY COST. An eleven-step sequence written out is eleven rows of equal
 * weight, and the account screen carries two runs of one — so the section 129 that had STOPPED was
 * a row in a twenty-row table, drawn exactly like the nine steps that were simply not due yet. The
 * held reason and its button were lifted out above it, which is what made the panel long enough to
 * scroll past.
 *
 * SO THE TWO THINGS WORTH HOLDING ARE HERE: what a dot's colour means, and which dot the panel
 * opens on. Both are pure functions for that reason — written inline in the component they would
 * be a useState initialiser no check could reach.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-track.mjs
 */
import { readFileSync } from 'node:fs'
import { shapeOf, stepInFocus } from '../../src/lib/runSteps.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const track = read('../../src/components/collections/WorkflowTrack.tsx')
const panel = read('../../src/components/collections/WorkflowRunPanel.tsx')

/* Asserted present before anything about their contents, or a deleted file passes vacuously. */
ok('there is a track to read', track.length > 1000)
ok('...and the panel draws it', /<WorkflowTrack steps=\{run\.steps\}/.test(panel))

/* ------------------------------------------------ what a dot means */

const step = (over) => ({
  id: 'x', label: 'Section 129', channel: 'email', dueOn: '2026-09-25',
  state: 'pending', note: null, sentAt: null, day: 1, needsRelease: false, ...over,
})

check('a step that went is filled', shapeOf(step({ state: 'sent' })), 'sent')
check('one still to come is hollow', shapeOf(step({ state: 'pending' })), 'waiting')
check('one crossed off is its own thing', shapeOf(step({ state: 'cancelled' })), 'cancelled')
/*
 * HELD AND FAILED ARE ONE DOT. They are different rows in the database — one is a step the runner
 * would not send, the other a step a provider refused — and on the track the reading is identical:
 * this one stopped, go and look. The difference is a sentence in the detail, where there is room.
 */
check('a held step has stopped', shapeOf(step({ state: 'held' })), 'stopped')
check('...and so has one the provider refused', shapeOf(step({ state: 'failed' })), 'stopped')

/* ------------------------------------------------ which dot it opens on */

const SENT = step({ id: 'a', state: 'sent', sentAt: '2026-09-25T08:00:00Z' })
const SENT2 = step({ id: 'b', state: 'sent', sentAt: '2026-09-26T08:00:00Z' })
const HELD = step({ id: 'c', state: 'held', note: 'It needs {{listing_reference}}.' })
const DUE = step({ id: 'd', state: 'pending', day: 12 })
const DUE2 = step({ id: 'e', state: 'pending', day: 39 })
const OFF = step({ id: 'f', state: 'cancelled', day: 60 })

/*
 * ANYTHING STOPPED COMES FIRST. A held section 129 is the reason the notification sent somebody to
 * this account; a track that opens on the finished handover at the far left makes them hunt.
 */
check('it opens on what has stopped', stepInFocus([SENT, HELD, DUE, DUE2]), 'c')
check('...even with something sent after it', stepInFocus([SENT, HELD, SENT2, DUE]), 'c')
/* Then what happens next, which is the question on a run where nothing is wrong. */
check('otherwise on the next thing due', stepInFocus([SENT, SENT2, DUE, DUE2]), 'd')
/*
 * AND ONLY ON A FINISHED RUN, THE LAST THING SENT — because there the useful fact is what the
 * debtor last received. LAST SENT, not last of all: a cancelled tail is not something they got.
 */
check('a finished run opens on the last thing sent', stepInFocus([SENT, SENT2, OFF]), 'b')
/* Read defensively: a run with no steps is a run the planner has not dated yet, and indexing
   into it would throw two lines below the check that should have reported it. */
check('a run with no steps chooses nothing', stepInFocus([]), null)

/* ------------------------------------------------ what the track draws */

/*
 * FILLED BEHIND AND HOLLOW AHEAD, which is the firm's own drawing and the one convention that
 * needs no key. Gold is Raptor's attention colour everywhere else, so a stopped step reads as
 * "this one is yours" without a legend.
 */
ok('a sent dot is filled in the outcome colour', /sent: 'bg-\[var\(--color-positive\)\]/.test(track))
ok('a stopped one is gold', /stopped: 'bg-\[var\(--c-gold\)\]/.test(track))
ok('...and one still to come is hollow', /waiting: 'bg-white border-slate-300'/.test(track))

/*
 * EVERY DOT IS PRESSABLE AND SAYS WHAT IT IS. The firm works on an iPad: a track you can only
 * look at has to be expanded before it can be used, and a colour with no words behind it is
 * unreadable to anybody using a screen reader.
 */
ok('a dot is a button', /<button type="button" onClick=\{\(\) => onSelect\(step\.id\)\}/.test(track))
ok('...that says its step and its state in words',
  /aria-label=\{`\$\{step\.label\} — \$\{RUN_STEP_WORDS\[step\.state\]\.label\}`\}/.test(track))
/*
 * THE CONNECTOR IS COLOURED BY THE STEP BEFORE IT, so the filled part of the line is the part
 * that has happened — and it is drawn by the step on its RIGHT, which is what stops a stray tail
 * hanging off the last dot.
 */
ok('the line between is drawn once per gap', /\{i > 0 && \(/.test(track))
ok('...and coloured by what came before it', /shapeOf\(steps\[i - 1\]\) === 'sent'/.test(track))

/*
 * IT CHANGES WITH THE ROOM IT IS GIVEN — a container query, not the page's width, because this
 * panel sits in the account's narrow rail and the same component has to read on a wide screen.
 * Narrow, a dot carries its day number; wide, the firm's words for the step as well.
 */
ok('the track measures its own container', /@container/.test(track))
ok('...and the name appears only where there is room for it', /hidden[^"]*@sm:block/.test(track))
/* THE DAY NUMBER IS WHAT SURVIVES THE NARROW READING, because it is the one thing short enough
   to sit under a dot — and two dots reading "1 1" are the email and the SMS that go together. */
ok('the day number is always under the dot', /\{step\.day\}/.test(track))

/* ------------------------------------------------ and nothing is hidden */

/*
 * "YOU CAN ALSO LIKE EXTEND IT TO SHOW EVERY SINGLE STEP IN THE PROCESS." The list is not gone,
 * it is shut — what a file went through, with dates, is a question an attorney asks eighteen
 * months later.
 */
ok('every step is still there, behind a drop-down', /Every step \(\$\{run\.steps\.length\}\)/.test(panel))
ok('...and it says how to put it away again', /Hide the steps/.test(panel))
ok('...with the whole run in it, not only part', /\{run\.steps\.map\(\(s\) => \(\n\s*<StepRow/.test(panel))

/*
 * THE COUNT IS ON THE HEADER, NOT ONLY IN THE COLOUR. One dot is in focus and the others are not;
 * two steps waiting would otherwise leave the second as a gold dot nobody counted.
 */
ok('the panel counts what is waiting on a person', /steps are waiting on you/.test(panel))
ok('...read from the one function that decides it', /needsAttention\(run\.steps\)/.test(panel))

/*
 * AND THE SENTENCES ARE DRAWN IN ONE PLACE. The panel printed a held reason twice once already —
 * once on the lifted card and once from the attempt — and the firm asked whether that was a bug.
 * A row of the drop-down SELECTS a step rather than expanding into a second copy of its detail.
 */
ok('a row of the list selects the step rather than repeating it',
  /onClick=\{onSelect\}/.test(panel) && !/\{step\.note\}[\s\S]{0,400}\{step\.note\}/.test(panel))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-workflow-track: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
