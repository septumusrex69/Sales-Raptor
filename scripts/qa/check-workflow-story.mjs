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
import { isCurrentState, railEvents, workflowHeadline, workflowStory } from '../../src/lib/workflowStory.ts'

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
const storyLib = read('../../src/lib/workflowStory.ts')

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

/*
 * AND WHAT IS STILL RUNNING SORTS ABOVE WHAT HAS STOPPED, on a day that carries both.
 *
 * THE CASE IS THE FIRM'S OWN AND IT IS THE COMMONEST ONE THEY HAVE. An arrangement agreed this
 * afternoon starts the Promise to pay AND pauses the section 129 -- two events, one day. The
 * tiebreak was the event id, "hold:" sorts before "start:", and the pane put the PAUSED sequence
 * on top. The firm, reading it back: "I see a promise made like a PTP workflow in place. But I
 * think that should be on top."
 *
 * ASSERTED ON THE PAIR RATHER THAN ON THE RANK TABLE, because the table is an implementation of
 * this and the question somebody asks is about the screen.
 */
const bothToday = workflowStory([
  run({ id: 'r9', workflowName: 'Section 129', state: 'held', startedOn: '2026-09-25',
    holds: [{ id: 'h9', cause: 'promise', reason: 'A promise to pay was made',
      startedOn: '2026-09-27', endedOn: null, endedReason: null }] }),
  run({ id: 'r8', workflowName: 'Promise to pay', state: 'running', startedOn: '2026-09-27' }),
])
check('the live sequence is read before the one that stopped the same day',
  bothToday.filter((e) => e.on === '2026-09-27').map((e) => e.kind), ['started', 'paused'])
check('...so the top of the rail is the arrangement', bothToday[0].runName, 'Promise to pay')
/*
 * A RESUME BEATS A START ON THE SAME DAY: a section 129 let go this morning is further along than
 * a sequence that began this morning, and the pane is read to find out where things stand.
 */
check('a resume is read before a start',
  workflowStory([
    run({ id: 'r7', workflowName: 'Section 129', state: 'running', startedOn: '2026-09-20',
      holds: [{ id: 'h7', cause: 'promise', reason: 'A promise to pay was made',
        startedOn: '2026-09-22', endedOn: '2026-09-27', endedReason: 'broken' }] }),
    run({ id: 'r6', workflowName: 'Dispute', state: 'running', startedOn: '2026-09-27' }),
  ]).filter((e) => e.on === '2026-09-27').map((e) => e.kind), ['resumed', 'started'])
/* AND THE ID STILL BREAKS THE LAST TIE, or a pane reshuffles itself between two loads. */
check('two events of one kind on one day are still fixed',
  sameDay.map((e) => e.id).join(), ['start:a', 'start:b'].join())

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
/* DECIDED BY ONE FUNCTION, WHICH NOW LIVES BESIDE THE STORY rather than inside the panel --
   railEvents has to ask the same question, and a rule a check cannot import is a rule that
   drifts. The panel imports it. */
ok('...decided by one function', /export function isCurrentState/.test(storyLib))
ok('...and the panel asks that one', /isCurrentState\(run, event\)/.test(panel)
  && /isCurrentState[\s\S]{0,120}?from '\.\.\/\.\.\/lib\/workflowStory\.ts'/.test(panel))
/*
 * AND THAT CARD IS TITLED WITH THE RUN, not the event, or it says the state twice — "Section 129
 * paused" beside a chip reading "Paused", which is what the first build did.
 */
ok('the live card is titled with the run and chipped with the state',
  /\{latest && run \? run\.workflowName : event\.title\}/.test(panel))

/* Both halves read the SAME stream, reversed, so they cannot disagree about what happened. */
ok('the history is the same stream, oldest first', /\[\.\.\.story\]\.reverse\(\)/.test(panel))
ok('...under the firm’s own heading', /Past workflow history/.test(panel))

/* ------------------------------------------------ the rail does not say it twice */

/*
 * THE FIRM, READING THE PANE BACK: "the order of how things lie here doesn't make sense to me.
 * Like, it says letter of demand started, but why is it necessary to have like two of these
 * things? Because it's already there."
 *
 * EVERYTHING ON THEIR ACCOUNT HAPPENED ON ONE DAY, so the rail drew a bare "Section 129 / letter
 * of demand started" row and, below it, the Section 129 card with a Paused chip whose own second
 * line reads "Started 27 Sep 2026 · paused since 27 Sep 2026". The same fact in the same date
 * group, twice. The Handover did it too.
 */
/* SENT THE SAME DAY THEY STARTED, which is what makes this the firm's account: everything on it
   happened on 27 September. lastTouched dates an ending by its newest sent step, so a fixture
   whose step went out a week before the run began would date the ending into that week and the
   fold would correctly leave the start alone -- proving nothing. */
const onDay = (id) => step({ id, sentAt: '2026-09-27T18:30:00Z', dueOn: '2026-09-27' })
const oneDayRuns = [
  { id: 'r-promise', workflowName: 'Promise to pay', state: 'running', leftReason: null,
    startedOn: '2026-09-27', dayUnit: 'calendar', steps: [onDay('a')], holds: [] },
  { id: 'r-129', workflowName: 'Section 129', state: 'held', leftReason: null,
    startedOn: '2026-09-27', dayUnit: 'business', steps: [onDay('b')],
    holds: [{ id: 'h1', cause: 'promise', reason: 'A promise to pay was made', startedOn: '2026-09-27', endedOn: null }] },
  { id: 'r-hand', workflowName: 'Handover', state: 'finished', leftReason: null,
    startedOn: '2026-09-27', dayUnit: 'calendar', steps: [onDay('c')], holds: [] },
]
const wholeStory = workflowStory(oneDayRuns)
const rail = railEvents(wholeStory, oneDayRuns)
/* THE PREMISE FIRST: the stream really does carry the echoes, or the fold below proves nothing. */
check('the stream carries a start for every run', wholeStory.filter((e) => e.kind === 'started').length, 3)
check('...five rows in all', wholeStory.length, 5)
/* AND THE RAIL DRAWS THREE: one card per sequence, and no bare "started" beside any of them. */
check('the rail folds the rows that echo the card beside them', rail.length, 3)
check('...leaving one row per run',
  rail.map((e) => e.runId).sort().join(','), 'r-129,r-hand,r-promise')
/*
 * AND EVERY ROW LEFT IS A CARD. This is the assertion that says the fold took the right ones: a
 * fold that removed a run's CURRENT state would make the sequence vanish from the pane, track,
 * held steps, Send it now button and all.
 */
for (const e of rail) {
  const run = oneDayRuns.find((r) => r.id === e.runId)
  ok(`${e.runId} is still on the rail as its current state`, isCurrentState(run, e))
}
/*
 * ONLY THE SAME DAY. A sequence that started in March and paused in May is two facts on two days
 * and both belong on the rail -- that is the shape the firm drew, and folding it would lose the
 * day the sequence began.
 */
const spread = [{
  ...oneDayRuns[1], startedOn: '2026-03-02',
  holds: [{ id: 'h2', cause: 'promise', reason: 'A promise to pay was made', startedOn: '2026-05-11', endedOn: null }],
}]
const apart = railEvents(workflowStory(spread), spread)
check('a start on another day stays on the rail', apart.length, 2)
check('...with the pause above it', apart.map((e) => e.kind).join(','), 'paused,started')
/*
 * AND NOTHING BUT A START IS EVER FOLDED. A pause and a resume on one day are two real facts about
 * an account -- the firm's own case, where an arrangement is agreed and then cancelled the same
 * afternoon -- and collapsing those would hide why a sequence moved.
 */
const oneDayResume = [{
  ...oneDayRuns[1], state: 'running', startedOn: '2026-03-02',
  holds: [{ id: 'h3', cause: 'promise', reason: 'A promise to pay was made', startedOn: '2026-05-11', endedOn: '2026-05-11' }],
}]
const resumedRail = railEvents(workflowStory(oneDayResume), oneDayResume)
check('a pause and a resume on one day are both kept',
  resumedRail.map((e) => e.kind).join(','), 'resumed,paused,started')

/*
 * THE HISTORY IS NOT FOLDED AND MUST NOT BE. It is a log, one line per event, collapsed until
 * somebody opens it -- and "started, then paused" on one day is exactly what a log is for.
 */
/* ASSERTED ON WHAT IS HANDED TO IT, not on what it calls the prop inside itself -- the component
   names it `story` either way, so reading its body cannot tell the two streams apart. */
ok('the history below is handed the unfolded stream', /<PastHistory story=\{story\}/.test(panel))
ok('...and the rail draws the folded one', /\{rail\.map\(\(e\) =>/.test(panel))
ok('...which are two different lists', /const rail = railEvents\(story, runs\)/.test(panel))

/*
 * AND THE ROW A RUN STANDS ON IS NEVER FOLDED, WHATEVER SHARES ITS DAY.
 *
 * NOT REACHABLE FROM CONSISTENT DATA, which is why it is written down. A `running` run whose
 * current event is its start has no other event that day -- an open hold would make it `held`. But
 * a half-applied resume leaves exactly this row behind: state running, hold still open. Folded
 * there, the sequence would vanish from the pane -- track, held steps, Send it now and all -- on
 * the one account where somebody is looking for it.
 */
const halfResumed = [{
  id: 'r-odd', workflowName: 'Section 129', state: 'running', leftReason: null,
  startedOn: '2026-09-27', dayUnit: 'business', steps: [onDay('d')],
  holds: [{ id: 'h4', cause: 'promise', reason: 'A promise to pay was made', startedOn: '2026-09-27', endedOn: null }],
}]
const oddRail = railEvents(workflowStory(halfResumed), halfResumed)
ok('a run whose current state IS its start keeps that row',
  oddRail.some((e) => e.kind === 'started' && isCurrentState(halfResumed[0], e)))

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

/* ------------------------------------------------ a run with no steps yet */

/*
 * A RUN IS BORN WITH NO STEPS AND THAT LOOKS LIKE A BROKEN ONE.
 *
 * A database trigger creates it the moment an arrangement is agreed; dating the steps needs the
 * working-day calendar, which lives in the app, so the app asks immediately and the gap is a few
 * seconds. THE FIRM OPENED THE TAB INSIDE IT: "I don't see the others that's waiting, the other
 * steps that are still waiting for." What they saw was a card headed "Promise to pay · Active"
 * with nothing at all under it, which reads as a workflow that has started and does nothing.
 *
 * ONLY WHILE IT IS RUNNING. A finished or left run with no steps is the imported-handover case --
 * the sequence was written after the account arrived -- where there is genuinely nothing to draw
 * and nothing coming, and a line promising dates would be a lie.
 */
/* THE WHOLE CONDITION, FROM ITS OPENING BRACE. Matched on the tail alone, the assertion passes
   on `{false && latest && run && ...}` -- a guard switched off and a check that never noticed. */
ok('a run still being dated says so rather than drawing nothing',
  /\{latest && run && run\.steps\.length === 0 && run\.state === 'running' && \(/.test(panel))
ok('...in words that say what is happening', /Working out the dates/.test(panel))
ok('...and a run with steps still draws its track',
  /run\.steps\.length > 0 && <RunBlock/.test(panel))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-workflow-story: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
