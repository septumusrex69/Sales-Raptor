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
import { markerIndex, shapeOf, stepInFocus, words } from '../../src/lib/runSteps.ts'
import { dayNumberOn, landsOn } from '../../src/lib/workflowBuilder.ts'

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

/* ------------------------------------------------ where today is */

/*
 * THE FIRM, ON THE TRACK: "it's important to show where in the workflow is it currently and on
 * which day." Two halves, and they are worked out in two places — the caret's position from the
 * steps' own dates, the day number from the day the run started — so the thing worth holding is
 * that they cannot disagree about which side of a step today is on.
 */

const due = (id, d) => step({ id, dueOn: d })
const WEEK = [due('a', '2026-09-25'), due('b', '2026-09-28'), due('c', '2026-10-05'), due('d', '2026-10-12')]

/* AFTER THE LAST STEP THAT HAS COME DUE: everything left of the mark should have happened. */
check('the mark sits after what has come due', markerIndex(WEEK, '2026-09-29'), 2)
/*
 * A STEP DUE TODAY IS ON THE LEFT OF IT, because today IS its day — it is late only tomorrow,
 * and a caret drawn in front of a step the runner is sending this morning reads as "not yet".
 */
check('...with a step due today behind it', markerIndex(WEEK, '2026-09-25'), 1)
check('...and a run dated into the future marked at the front', markerIndex(WEEK, '2026-09-01'), 0)
check('...and a finished sequence marked at the end', markerIndex(WEEK, '2027-01-01'), 4)
/* Read defensively: a run the planner has not dated yet has no steps to sit between. */
check('a run with no steps marks at nothing', markerIndex([], '2026-09-25'), 0)

/*
 * AND TODAY'S DAY NUMBER IS landsOn READ BACKWARDS. Nothing in the database moves as the day
 * turns, so this is arithmetic — and worked out by any other arithmetic than the one that dated
 * the steps, the caption and the caret eventually disagree.
 */
for (const unit of ['business', 'calendar']) {
  for (const n of [1, 2, 7, 12, 39, 49]) {
    check(`${unit} day ${n} reads back as itself`,
      dayNumberOn('2026-09-25', landsOn('2026-09-25', n, unit), unit), n)
  }
}
/* Business is 1-based and inclusive, so the day a run starts is day 1 — and a Saturday is still
   the Friday's business day, because no business day has passed. */
check('the day a run starts is business day 1', dayNumberOn('2026-09-25', '2026-09-25', 'business'), 1)
check('...and so is the Saturday after it', dayNumberOn('2026-09-25', '2026-09-26', 'business'), 1)
/* Calendar is 0-based, unchanged, or every workflow already drawn would silently move. */
check('calendar still counts from zero', dayNumberOn('2026-09-25', '2026-09-25', 'calendar'), 0)

/* Drawn as a line rather than a dot of its own: today is not a step and must not be counted as
   one, and the track is a row of steps. */
ok('today is a line through the track, not another dot', /aria-label="Today"/.test(track))
ok('...in the colour the rest of Raptor asks with', /bg-\[var\(--c-gold\)\]/.test(track))
/*
 * AND NOT DRAWN AT ALL ON A RUN THAT IS OVER. A caret past the last dot of a finished sequence
 * says it is still counting when it is not.
 */
ok('a run that is over has no today on it', /today=\{run\.state === 'running' \? today : null\}/.test(panel))
ok('...which the track reads as no mark', /today === null \? -1/.test(track))

/* THE DAY NUMBER IN WORDS, under the track, because a dot cannot carry one. */
ok('the panel says which day of the workflow today is',
  /dayNumberOn\(run\.startedOn, today, run\.dayUnit\)/.test(panel))
ok('...with the unit it counts in', /dayLabel\(dayNumberOn/.test(panel))
/* AND WHEN THE NEXT ONE GOES, which is the other half of the firm's sentence: a dot says a step
   has not gone, this says when it will. A HELD step is not "next" — it waits for a person. */
ok('...and when the next step goes out', /next: \{next\.label\}, \{shortDate\(next\.dueOn\)\}/.test(panel))
ok('...which is the next one still waiting for its date',
  /run\.steps\.find\(\(s\) => s\.state === 'pending'\)/.test(panel))

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
ok('...that says its step, its state and its date in words', /aria-label=\{words\(step\)\}/.test(track))
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

/*
 * BIG ENOUGH TO PRESS, AND FILLING THE WIDTH IT IS GIVEN. The firm: "it could be maybe a little
 * bit bigger those little circles because it's not filling the whole screen." Eleven dots at a
 * pressable size do not fit across the account's rail on one line, so the row WRAPS — which is
 * what bought the size. Scrolling was the trade that made them too small and left the right-hand
 * end of the rail empty at the same time.
 */
ok('the track wraps rather than scrolling', /flex flex-wrap items-start/.test(track)
  && !/overflow-x-auto/.test(track))
ok('...and a dot is a fingertip, not a bead', /h-5 w-5 items-center justify-center rounded-full/.test(track))

/*
 * AND A DOT SAYS WHEN IT WENT, read rather than looked at. There is no room for a date under a
 * dot in the rail — it is twice the width — so the date rides on the label a long press reads
 * out, and "sent" and "due" are kept apart: printing them in the same words is how a step that
 * never went comes to look like one that did.
 */
check('a dot carries the date it went out',
  words(step({ state: 'sent', sentAt: '2026-09-25T08:00:00Z' })),
  'Section 129 — Sent, sent 25 Sep 2026')
check('...and one that has not gone says what it is due for',
  words(step({ state: 'pending', dueOn: '2026-10-05' })),
  'Section 129 — Due, due 5 Oct 2026')

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
