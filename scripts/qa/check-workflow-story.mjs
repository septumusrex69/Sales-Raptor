/**
 * WHAT HAPPENED TO THIS DEBTOR'S SEQUENCES, IN ORDER — THE STREAM THE WHOLE PANE IS DRAWN FROM.
 *
 * THE FIRM DREW THE PANE. A dated rail with one card per thing that happened — "Promise to Pay ·
 * Broken", "Section 129 resumed", "Section 129 · Active" — and a "Past workflow history"
 * underneath listing the same events one line each, oldest first.
 *
 * WHY THAT IS NOT THE RUNS. A run is a row with ONE state on it: today's. The pane has to say
 * what happened on the 24th, on the 10th and on the 11th, which is three different facts about
 * the same two rows — started, paused, resumed. Those moments live in workflow_run_holds and in
 * the steps, and nowhere was there a list of them. workflowStory makes one, and both halves of
 * the pane read it, so the rail and the history can never disagree about what happened.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-story.mjs
 */
import { readFileSync } from 'node:fs'
import { workflowHeadline, workflowStory } from '../../src/lib/workflowStory.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const panel = read('../../src/components/collections/WorkflowRunPanel.tsx')

const step = (over) => ({
  id: 's', label: 'Section 129', channel: 'email', dueOn: '2026-09-21',
  state: 'sent', note: null, sentAt: '2026-09-21T08:10:00Z', day: 1, needsRelease: false, ...over,
})
const run = (over) => ({
  id: 'r1', workflowName: 'Section 129', state: 'running', leftReason: null,
  startedOn: '2026-09-21', dayUnit: 'business', steps: [step({})], holds: [], ...over,
})

/* ------------------------------------------------ the stream */

/* The firm's own case, and the one their mockup is drawn of: a section 129 paused by a promise. */
const HELD = run({
  state: 'held',
  holds: [{ id: 'h1', cause: 'promise', reason: 'A payment arrangement was captured.',
    startedOn: '2026-09-24', endedOn: null, endedReason: null }],
})
const held = workflowStory([HELD])
check('a started-then-paused run is two events', held.length, 2)
check('...newest first', held.map((e) => e.kind), ['paused', 'started'])
check('...the pause dated when it happened', held[0].on, '2026-09-24')
/* THE REASON IS THE POINT. "Paused" says a thing happened; "a payment arrangement was captured"
   says why, and it is what stops somebody restarting a sequence that was stopped on purpose. */
check('...carrying the reason somebody gave', held[0].detail, 'A payment arrangement was captured.')

const RESUMED = run({
  state: 'running',
  /* Started before its hold, or the fixture describes a run paused three weeks before it began. */
  startedOn: '2026-09-01',
  holds: [{ id: 'h1', cause: 'promise', reason: 'A payment arrangement was captured.',
    startedOn: '2026-09-03', endedOn: '2026-09-16', endedReason: 'promise_broken' }],
})
const resumed = workflowStory([RESUMED])
check('a hold that ended adds a third event', resumed.length, 3)
check('...started, paused, resumed', resumed.map((e) => e.kind), ['resumed', 'paused', 'started'])
/*
 * THE FIRM'S OWN SENTENCE, off their mockup: "Continued from the paused point. Completed notices
 * are preserved; upcoming dates recalculated." Worth saying every time, because it answers the
 * question somebody has when a sequence starts moving again after six weeks — did we lose
 * anything, and are the dates right.
 */
ok('...saying what a resume does to the dates',
  /what is still to\s+come was moved on by the length of the pause/.test(resumed[0].detail ?? ''))

/*
 * AN ENDING IS DATED BY WHAT ENDED IT, NOT BY TODAY. A run that left in March must sit in March
 * on the rail — dated now, the pane would say a promise broke this morning.
 */
const LEFT = run({
  id: 'r2', workflowName: 'Promise to pay', state: 'left', leftReason: 'The promise was broken',
  startedOn: '2026-09-03',
  steps: [step({ id: 'p1', dueOn: '2026-09-16', sentAt: '2026-09-16T09:15:00Z' })],
})
const left = workflowStory([LEFT])
check('an ended run is dated by the last thing that happened on it',
  left.find((e) => e.kind === 'left')?.on, '2026-09-16')
check('...in the firm’s words', left.find((e) => e.kind === 'left')?.detail, 'The promise was broken')

/*
 * TIES BROKEN THE SAME WAY EVERY TIME. Several events land on one day — a promise captured and
 * the sequence paused are the same afternoon — and two rows that sort equal come back in whatever
 * order the array was in, which is how a pane reshuffles itself between two loads. The contacts
 * panel learned this the hard way: an UPDATE moved a row and the screen showed a different one.
 */
const sameDay = workflowStory([
  run({ id: 'a', workflowName: 'A', startedOn: '2026-09-24' }),
  run({ id: 'b', workflowName: 'B', startedOn: '2026-09-24' }),
])
check('two events on one day come back in a fixed order',
  sameDay.map((e) => e.id), workflowStory([
    run({ id: 'b', workflowName: 'B', startedOn: '2026-09-24' }),
    run({ id: 'a', workflowName: 'A', startedOn: '2026-09-24' }),
  ]).map((e) => e.id))

/* ------------------------------------------------ the headline */

const head = workflowHeadline([
  HELD,
  run({ id: 'r3', workflowName: 'Promise to pay', state: 'running', startedOn: '2026-09-24',
    steps: [step({ id: 'n1', state: 'pending', sentAt: null, dueOn: '2026-10-09' })] }),
])
check('the strip names what is active', head.active.map((r) => r.workflowName), ['Promise to pay'])
check('...and what is paused', head.paused.map((r) => r.workflowName), ['Section 129'])
check('...and what happens next', head.next?.step.dueOn, '2026-10-09')

/*
 * NEXT NEVER COMES OFF A PAUSED RUN. A held sequence's dates are the dates it had when it
 * stopped, and every one of them moves when it is let go — so quoting one as "next" is quoting a
 * date already known to be wrong. What happens next on a paused run is the pause ending.
 */
const pausedOnly = workflowHeadline([run({
  state: 'held',
  steps: [step({ id: 'x', state: 'pending', sentAt: null, dueOn: '2026-09-29' })],
  holds: [{ id: 'h', cause: 'dispute', reason: 'In writing.', startedOn: '2026-09-22', endedOn: null, endedReason: null }],
})])
check('a paused run offers no "next"', pausedOnly.next, null)

/* AND WHAT IS WAITING ON A PERSON IS COUNTED ACROSS EVERY RUN, because an account can carry a
   paused section 129 and a live promise at once — that IS the case the firm drew. */
const waiting = workflowHeadline([
  run({ steps: [step({ id: 'w1', state: 'held', sentAt: null })] }),
  run({ id: 'r4', workflowName: 'Dispute', steps: [step({ id: 'w2', state: 'failed', sentAt: null })] }),
])
check('what waits on a person is counted across the account', waiting.waiting.length, 2)

/* ------------------------------------------------ what the pane draws */

ok('the pane is built from the stream', /workflowStory\(runs\)/.test(panel))
ok('...and the strip from the headline', /workflowHeadline\(runs\)/.test(panel))
/* The firm's own words for the pane, which are the right ones: it is read to find out what is
   happening, not to audit a sequence. */
ok('...under the firm’s own heading', /Follow what is active, paused, and next/.test(panel))

/*
 * THE TRACK IS DRAWN ONCE PER RUN, NOT ONCE PER EVENT. A section 129 started, paused and resumed
 * is three rows; eleven dots three times is the wall of steps this redesign exists to stop being.
 * Only the card that IS the run's state today carries the track.
 */
ok('only the current-state card carries the track',
  /\{latest && run && run\.steps\.length > 0 && <RunBlock/.test(panel))
/* AND A RUN WITH NO STEPS DRAWS NOTHING BUT ITS CARD. The handover on an imported account is a
   row with no steps -- the sequence was written after the account arrived -- and the block under
   it read "Every step (0)" over an empty track, which is a control that opens nothing. */
ok('...and a run with no steps draws no track at all', /run\.steps\.length > 0 && <RunBlock/.test(panel))
ok('...decided by one function', /function isCurrentState/.test(panel))
/*
 * AND THAT CARD IS TITLED WITH THE RUN, not the event, or it says the state twice — "Section 129
 * paused" beside a chip reading "Paused", which is what the first build did.
 */
ok('the live card is titled with the run and chipped with the state',
  /\{latest && run \? run\.workflowName : event\.title\}/.test(panel))

/* Both halves read the SAME stream, reversed, so they cannot disagree about what happened. */
ok('the history is the same stream, oldest first', /\[\.\.\.story\]\.reverse\(\)/.test(panel))
ok('...under the firm’s own heading', /Past workflow history/.test(panel))

/* ------------------------------------------------ ends it vs pauses it */

/*
 * THE FIRM'S OWN CORRECTION, ON THE SCREEN THEY CIRCLED. The Library's exit-rules panel listed
 * all three events under one heading, which told a collector that a promise CANCELS a statutory
 * sequence -- which it did, and no longer does. "A payment was made, it's not an exit rule, it's
 * kind of a pause rule."
 */
const store = read('../../src/lib/workflowRun.ts')
const schedule = read('../../src/components/workflows/WorkflowSchedule.tsx')

ok('the two kinds are named apart', /export const ENDS_IT/.test(store) && /export const PAUSES_IT/.test(store))
/* PAID IN FULL FIRST, at the firm's asking: "I think that should be the first rule." */
ok('paid in full leads what ends it', /ENDS_IT: string\[\] = \[\s*\n\s*'The account was paid in full'/.test(store))
ok('...with a dispute upheld beside it', /A dispute was upheld/.test(store))
/* ONCE, NOT TWICE, said on the chip itself -- it is the rule a collector most needs to know
   before recording a second promise. */
ok('the promise chip says it holds only once', /the first one only/.test(store))
ok('...and the dispute chip says it must be in writing', /A dispute raised in writing/.test(store))

ok('the panel draws both lists', /ENDS_IT\.map/.test(schedule) && /PAUSES_IT\.map/.test(schedule))
ok('...under headings that say which is which',
  /Ends the sequence/.test(schedule) && /Pauses it/.test(schedule))
/* And says what a pause DOES, because "paused" alone leaves somebody wondering what happened to
   the dates -- which is the question the firm asked of their own mockup. */
ok('...saying a pause cancels nothing', /Nothing is cancelled/.test(schedule))
ok('...and what it does to the dates', /moves on by the working days the pause lasted/.test(schedule))
/*
 * EXIT_EVENTS IS STILL THE SET workflow_exit_account ACCEPTS, untouched. It is not the list of
 * things that end a run any more -- nothing calls it with 'promise' -- but check-workflow-send
 * compares it against the SQL in both directions, and narrowing it here would break a comparison
 * that is still true and still worth having.
 */
ok('the runner’s accepted-name list is left alone', /export const EXIT_EVENTS/.test(store))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-workflow-story: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
