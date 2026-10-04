/**
 * THE ORDER THE WORKFLOW PANE IS READ IN, WHICH IS THE FIRM'S INSTRUCTION AND NOT A PREFERENCE.
 *
 * THE FIRM, looking at the pane on a debtor's file: "the current workflow should be on top. And
 * then the workflow queued should be, or waiting, should be at the bottom, right below that. And
 * then other workflows have been completed, chronological order below that -- from the newest to
 * the oldest going down. Also, that's really bulky and big. Can we make it smaller so you don't
 * have to scroll all the way down?"
 *
 * THREE THINGS CAN GO WRONG AND EACH IS WORSE THAN A WRONG-LOOKING SCREEN:
 *
 *   A DEAD SEQUENCE AT THE TOP, under the heading "Running now" -- which is the one part of this
 *   pane somebody acts on, and acting on it means sending a notice off a sequence that ended.
 *
 *   A PAUSED SEQUENCE FILED AS COMPLETED. A held section 129 is coming back the moment the promise
 *   behind it breaks; read as finished, the account looks like one nobody has to re-start.
 *
 *   COMPLETED ONES IN THE WRONG ORDER. They are sorted by when they ENDED, and a run has no
 *   ended_on column -- so the sort is built out of its steps and its holds, and start dates are
 *   not that order.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-groups.mjs
 */

import { readFileSync } from 'node:fs'
import {
  GROUP_HEADINGS, groupOf, groupRuns, lastActivityOn,
} from '../../src/lib/workflowRunGroups.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const run = (over) => ({
  id: 'r', state: 'running', startedOn: '2026-01-05', steps: [], holds: [], ...over,
})

/* ------------------------------------------------ which group */

check('a running sequence is what is running now', groupOf(run({})), 'running')
/*
 * HELD IS WAITING, AND THAT IS THE FIRM'S OWN WORD. Nothing goes out of a paused sequence
 * tomorrow morning, so it is not running; and the thing holding it will end, so it is not over.
 */
check('a paused sequence is waiting', groupOf(run({ state: 'held' })), 'waiting')
check('a finished sequence is completed', groupOf(run({ state: 'finished' })), 'done')
/* LEFT IS COMPLETED TOO. A promise, a dispute or payment in full takes an account out of a
   sequence -- it is over, and the row says which of the three it was. */
check('one that left is completed', groupOf(run({ state: 'left' })), 'done')
/*
 * AND ANYTHING UNRECOGNISED IS COMPLETED RATHER THAN RUNNING. A state nobody has thought about
 * must not put a sequence under "Running now" beside a Send it now button.
 */
check('a state nobody knows is not drawn as live', groupOf(run({ state: 'queued' })), 'done')

/* ------------------------------------------------ when it ended */

/* THE START, where nothing has happened on it yet. */
check('a bare run is dated by its start', lastActivityOn(run({})), '2026-01-05')
/* A STEP THAT WENT, read off the timestamp and cut to the day. */
check('a sent step dates it later', lastActivityOn(run({
  steps: [{ dueOn: '2026-02-01', sentAt: '2026-02-03T06:00:00Z' }],
})), '2026-02-03')
/*
 * A STEP THAT NEVER WENT STILL DATES IT, by the day it was due. A sequence that was taken out in
 * March has steps dated into May that nobody will ever send, and those dates are how far it got.
 */
check('an unsent step dates it by its due day', lastActivityOn(run({
  steps: [{ dueOn: '2026-05-20', sentAt: null }],
})), '2026-05-20')
/* A HOLD, both ends of it: a sequence paused in June and let go in August ended no earlier. */
check('a closed hold dates it', lastActivityOn(run({
  holds: [{ startedOn: '2026-06-01', endedOn: '2026-08-14' }],
})), '2026-08-14')
check('an open hold dates it', lastActivityOn(run({
  holds: [{ startedOn: '2026-06-01', endedOn: null }],
})), '2026-06-01')
/* AND THE LATEST OF ALL THREE WINS, whichever carries it. */
check('the latest of everything wins', lastActivityOn(run({
  startedOn: '2026-01-05',
  steps: [{ dueOn: '2026-03-01', sentAt: '2026-03-01T06:00:00Z' }],
  holds: [{ startedOn: '2026-02-01', endedOn: '2026-09-09' }],
})), '2026-09-09')
/* IT NEVER GOES BACKWARDS off a step dated before the run began -- a re-issued sequence carries
   steps from the one it replaced, and an ending dated before the start is a row that sorts last. */
check('an older step cannot drag the date back', lastActivityOn(run({
  startedOn: '2026-07-01', steps: [{ dueOn: '2026-01-01', sentAt: '2026-01-01T06:00:00Z' }],
})), '2026-07-01')

/* ------------------------------------------------ the three lists */

const book = [
  run({ id: 'live', workflowName: 'Section 129', state: 'running' }),
  run({ id: 'old', state: 'finished', startedOn: '2025-02-01',
    steps: [{ dueOn: '2025-03-01', sentAt: '2025-03-01T06:00:00Z' }] }),
  run({ id: 'paused', state: 'held',
    holds: [{ startedOn: '2026-04-04', endedOn: null }] }),
  run({ id: 'recent', state: 'left', startedOn: '2025-01-01',
    steps: [{ dueOn: '2026-06-30', sentAt: '2026-06-30T06:00:00Z' }] }),
]
const g = groupRuns(book)
check('what is running', g.running.map((r) => r.id), ['live'])
check('what is waiting', g.waiting.map((r) => r.id), ['paused'])
/*
 * NEWEST FIRST, BY WHEN IT ENDED AND NOT BY WHEN IT STARTED. `recent` started in January 2025 --
 * a year before `old` finished -- and ended in June 2026. Sorted by start date it would be at the
 * bottom of the list, which is the mistake this fixture exists to catch.
 */
check('what is completed, newest first', g.done.map((r) => r.id), ['recent', 'old'])
/* AND NOTHING IS LOST OR DUPLICATED BETWEEN THE THREE. Every run is in exactly one list, which is
   what makes the pane's three sections the whole account rather than a selection of it. */
check('every run lands in exactly one group',
  g.running.length + g.waiting.length + g.done.length, book.length)
check('...and the set is the same',
  [...g.running, ...g.waiting, ...g.done].map((r) => r.id).sort().join(','),
  book.map((r) => r.id).sort().join(','))
/* THE INPUT IS NOT REORDERED UNDER THE CALLER. The pane draws the groups and the account page
   keeps the same array for its badge; sorting in place would reshuffle somebody else's list. */
check('the array handed in is untouched', book.map((r) => r.id).join(','), 'live,old,paused,recent')

/* ------------------------------------------------ what the pane draws */

const panel = read('../../src/components/collections/WorkflowRunPanel.tsx')

check('the headings are the firm’s words',
  [GROUP_HEADINGS.running, GROUP_HEADINGS.waiting, GROUP_HEADINGS.done],
  ['Running now', 'Waiting', 'Completed'])
/* WRITTEN ONCE AND READ FROM THERE. Spelled out in the markup, the heading over the live section
   and the rule deciding what goes under it could come apart. */
ok('the pane reads the headings from the library', /GROUP_HEADINGS\.running/.test(panel))
ok('...and groups with the same function', /groupRuns\(runs\)/.test(panel))
/* PRESENT BEFORE ORDERED -- indexOf returns -1 and an order-only assertion passes vacuously once
   the thing it orders is deleted. */
ok('all three sections are drawn',
  /GROUP_HEADINGS\.running/.test(panel) && /GROUP_HEADINGS\.waiting/.test(panel)
  && /GROUP_HEADINGS\.done/.test(panel))
ok('...running, then waiting, then completed',
  panel.indexOf('GROUP_HEADINGS.running') < panel.indexOf('GROUP_HEADINGS.waiting')
  && panel.indexOf('GROUP_HEADINGS.waiting') < panel.indexOf('GROUP_HEADINGS.done'))
/*
 * AND THE COMPLETED SECTION IS NOT LIVE. `live` decides whether a row carries its track, its step
 * detail and its Send it now button -- true under the completed heading, the pane would offer to
 * send a step off a sequence that ended.
 */
ok('the completed section is drawn dead', /GROUP_HEADINGS\.done[\s\S]{0,160}?live=\{false\}/.test(panel))
ok('...and the running one live', /GROUP_HEADINGS\.running[\s\S]{0,160}?\slive\s/.test(panel))

if (failures.length > 0) {
  console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
}
console.log(`check-workflow-groups: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
