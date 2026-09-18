/**
 * The workflow builder's rules.
 *
 * A WORKFLOW IS A THING THAT RUNS WITHOUT ANYBODY WATCHING, and this screen is where somebody
 * types the days it runs on. A mistake here is not a wrong screen, it is a statutory notice on the
 * wrong day, to everybody, found when one of them is challenged.
 *
 * The one rule worth reading before the rest: a node carries an absolute DAY and the connections
 * carry the ORDER. Two facts, not two spellings of one. They agree about everything except an
 * edge pointing at an earlier day, and that is refused rather than reconciled — the firm's own
 * mockup put three ways of saying when on one form and any two of them can disagree in silence.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-builder.mjs
 */
import { readFileSync } from 'node:fs'
import {
  canSave, nextOf, nodesOfPhase, orderedNodes, problemsAfterEdit, workflowFacts, workflowProblems,
} from '../../src/lib/workflowBuilder.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* A small workflow shaped like the firm's: two phases, a notice with a deadline, a rotation. */
const node = (over = {}) => ({
  id: 'n1', phaseId: 'p1', key: 'k', kind: 'action', label: 'A step', description: null,
  day: 0, deadlineDays: null, deadlineUnit: null, channel: null, templateId: null,
  statutory: false, assignTo: null, x: null, y: null, ordinal: 1, ...over,
})
const build = (nodes, connections = [], phases = [
  { id: 'p1', ordinal: 1, name: 'Phase 1 · Notice', subtitle: null, fromDay: 0, toDay: 40 },
  { id: 'p2', ordinal: 2, name: 'Phase 2 · Legal', subtitle: null, fromDay: 40, toDay: 80 },
]) => ({
  id: 'w', key: 'standard-collections', name: 'Standard Collections', description: null,
  teamName: 'Pre-legal', version: { id: 'v', version: 1, state: 'draft', publishedAt: null },
  phases, nodes, connections,
})

const refusals = (w) => workflowProblems(w).filter((p) => p.level === 'refuse').map((p) => p.message)
const warnings = (w) => workflowProblems(w).filter((p) => p.level === 'warn').map((p) => p.message)

/* ---------- an edge may not point backwards ---------- */

/*
 * THE RULE THE WHOLE MODEL RESTS ON. The day says when and the edge says what follows. An edge
 * from day 35 to day 21 is a workflow that cannot be run either way round, and picking one
 * silently is how a section 129 goes out after a final notice on four hundred files.
 */
const forwards = build(
  [node({ id: 'a', day: 21, label: 'Follow-up' }), node({ id: 'b', day: 35, label: 'Final notice' })],
  [{ id: 'e', fromNodeId: 'a', toNodeId: 'b', toWorkflowId: null, label: null }],
)
check('a forward edge is fine', refusals(forwards), [])
const backwards = build(
  [node({ id: 'a', day: 35, label: 'Final notice' }), node({ id: 'b', day: 21, label: 'Follow-up' })],
  [{ id: 'e', fromNodeId: 'a', toNodeId: 'b', toWorkflowId: null, label: null }],
)
check('an edge pointing at an earlier day is refused', refusals(backwards).length, 1)
ok('...and it says which two steps disagree',
  /Final notice is day 35 and points at Follow-up on day 21/.test(refusals(backwards)[0]))
/* Same day is allowed: two things can happen on one day and one still follows the other. */
const sameDay = build(
  [node({ id: 'a', day: 40 }), node({ id: 'b', day: 40 })],
  [{ id: 'e', fromNodeId: 'a', toNodeId: 'b', toWorkflowId: null, label: null }],
)
check('two steps on one day may follow each other', refusals(sameDay), [])
const loop = build([node({ id: 'a', day: 1 })],
  [{ id: 'e', fromNodeId: 'a', toNodeId: 'a', toWorkflowId: null, label: null }])
ok('a step cannot follow itself', refusals(loop).some((m) => /cannot follow itself/.test(m)))
/* An edge to a step that is not there at all — which is what a half-finished delete leaves. */
const dangling = build([node({ id: 'a', day: 1 })],
  [{ id: 'e', fromNodeId: 'a', toNodeId: 'gone', toWorkflowId: null, label: null }])
ok('an edge into nothing is refused', refusals(dangling).some((m) => /not in the workflow/.test(m)))
/* An edge that LEAVES the workflow carries no day to compare, and must not be judged as if it did. */
const handOff = build([node({ id: 'a', day: 52 })],
  [{ id: 'e', fromNodeId: 'a', toNodeId: null, toWorkflowId: 'other', label: 'Payment arrangement' }])
check('an edge into another workflow is not judged on days', refusals(handOff), [])

/* ---------- a deadline is two facts or it is none ---------- */

/*
 * "20" ON ITS OWN IS NOT A PERIOD. It is twenty calendar days or twenty business days, and on a
 * statutory notice the two are about a month apart — the difference between a valid notice and
 * one that has to be served again.
 */
ok('a number with no kind of day is refused',
  refusals(build([node({ deadlineDays: 20, deadlineUnit: null })])).some((m) => /both a number of days and the kind of day/.test(m)))
ok('...and a kind of day with no number', 
  refusals(build([node({ deadlineDays: null, deadlineUnit: 'business' })])).some((m) => /both a number of days and the kind of day/.test(m)))
check('the two together are fine', refusals(build([node({ deadlineDays: 20, deadlineUnit: 'business' })])), [])
check('neither is fine — most steps give no period', refusals(build([node()])), [])
ok('a period of nothing is refused',
  refusals(build([node({ deadlineDays: 0, deadlineUnit: 'calendar' })])).length > 0)

/* ---------- a step that sends something says how ---------- */

ok('a communication with no channel is refused',
  refusals(build([node({ kind: 'communication', channel: null })])).some((m) => /post, email, SMS/.test(m)))
check('...and with one is fine',
  refusals(build([node({ kind: 'communication', channel: 'registered_post' })])), [])
/* A channel left behind on a step that no longer sends anything is a half-finished edit. */
ok('a channel on a step that sends nothing is refused',
  refusals(build([node({ kind: 'task', channel: 'email' })])).some((m) => /does not send anything/.test(m)))

/*
 * NO WORDING IS A WARNING, NOT A REFUSAL, and the difference is who it is for. The attorney
 * settles the statutory ones and they arrive when they arrive; a form that blocked on them would
 * stop the firm writing the workflow at all, and a form that blocks on the ordinary is a form
 * whose warnings get ignored.
 */
const unwritten = build([node({ kind: 'communication', channel: 'post', templateId: null, statutory: true })])
check('an unwritten notice does not stop the workflow', refusals(unwritten), [])
ok('...but it is said', warnings(unwritten).some((m) => /No wording yet/.test(m)))
ok('...and a statutory one says whose job it is',
  warnings(unwritten).some((m) => /attorney settles this one/.test(m)))
ok('the ordinary one does not invoke the attorney',
  !warnings(build([node({ kind: 'communication', channel: 'post', statutory: false })]))
    .some((m) => /attorney/.test(m)))
ok('a workflow with only warnings can still be saved', canSave(workflowProblems(unwritten)))
ok('...and one with a refusal cannot', !canSave(workflowProblems(backwards)))

/* A step outside its own phase's range is a chart that disagrees with itself. */
ok('a step outside its phase is a warning',
  warnings(build([node({ day: 60, phaseId: 'p1' })])).some((m) => /outside Phase 1/.test(m)))
check('...and inside it is not', warnings(build([node({ day: 10, phaseId: 'p1' })])), [])

/* ---------- the order the canvas draws in ---------- */

/*
 * SORTED BY DAY, then by ordinal for steps that share one. Sorting by ordinal alone would leave a
 * card edited to day 5 sitting between day 35 and day 40 until somebody renumbered everything —
 * the drawing disagreeing with the workflow, which is the one thing this screen must not do.
 */
const jumbled = build([
  node({ id: 'c', day: 35, ordinal: 1 }),
  node({ id: 'a', day: 5, ordinal: 9 }),
  node({ id: 'b', day: 10, ordinal: 5 }),
])
check('the canvas draws them by day, not by the order they were made',
  orderedNodes(jumbled).map((n) => n.id), ['a', 'b', 'c'])
check('...and by ordinal where a day is shared',
  orderedNodes(build([node({ id: 'y', day: 40, ordinal: 2 }), node({ id: 'x', day: 40, ordinal: 1 })]))
    .map((n) => n.id), ['x', 'y'])
check('a phase only draws its own steps',
  nodesOfPhase(build([node({ id: 'a', phaseId: 'p1' }), node({ id: 'b', phaseId: 'p2' })]), 'p1')
    .map((n) => n.id), ['a'])

check('what follows a step is read off the edge', nextOf(forwards, 'a').id, 'b')
check('...and nothing follows the last one', nextOf(forwards, 'b'), null)

/* ---------- the figures under the canvas ---------- */

const facts = workflowFacts(build([
  node({ id: 'a', day: 0 }),
  node({ id: 'b', day: 80 }),
  node({ id: 'c', day: 35, kind: 'communication', channel: 'post', statutory: true, templateId: null }),
]))
check('the duration is the span of the days', facts.days, 80)
check('...the steps are counted', facts.steps, 3)
check('...the phases too', facts.phases, 2)
check('...and the notices nobody has written', facts.unwritten, 1)
check('...of which the statutory ones are counted apart', facts.statutory, 1)
/* An empty workflow is nought days, not a crash on Math.max of nothing. */
check('an empty workflow is nought days', workflowFacts(build([])).days, 0)

/* ---------- an edit is judged before it is saved ---------- */

/*
 * The form refuses IN PLACE rather than saving and then reporting. Typing a day that contradicts
 * an edge has to stop at the keyboard: once it is in the database the workflow is already the
 * thing that cannot be run.
 */
check('an edit that keeps the order is allowed',
  problemsAfterEdit(forwards, { id: 'b', day: 36 }).filter((p) => p.level === 'refuse'), [])
ok('an edit that reverses two steps is refused before it is saved',
  problemsAfterEdit(forwards, { id: 'b', day: 5 }).some((p) => p.level === 'refuse'))
/* And the workflow it was given is not changed by asking. */
check('...without changing the workflow it was asked about', forwards.nodes[1].day, 35)

/* ---------- the branches are not in this workflow ---------- */

/*
 * The firm's instruction, and it is a design decision rather than a tidy-up: payment arrangement,
 * default, dispute, sequestration and liquidation each become a workflow of their own. Hung
 * underneath the main line they made the main line look like the exception.
 */
const src = readFileSync(new URL('../../src/components/workflows/WorkflowCanvas.tsx', import.meta.url), 'utf8')
for (const gone of ['Payment Arrangement', 'Dispute', 'Sequestration', 'Liquidation', 'Branch']) {
  ok(`the canvas does not draw ${gone}`, !new RegExp(gone, 'i').test(src.replace(/\/\*[\s\S]*?\*\//g, '')))
}
/* And the way out is kept open: a connection can already point at another workflow. */
const store = readFileSync(new URL('../../src/lib/workflowStore.ts', import.meta.url), 'utf8')
ok('a connection can leave for another workflow', /to_workflow_id/.test(store))

/* ---------- every column the select asks for reaches the type ---------- */

/*
 * THE HAZARD THIS CODEBASE ALREADY HAS FORM FOR. A column present in the database, in the select
 * and in the type, but missing from the hand-written mapper, reads as undefined for ever and
 * nothing fails — diary_capacity sat in that state for months. So the select list and the mapper
 * are compared to each other rather than trusted.
 */
const selectList = /\.select\('(id, phase_id, key, kind[^']*)'\)/.exec(store)
ok('the node select is there to read', Boolean(selectList))
const asked = selectList[1].split(',').map((c) => c.trim())
const mapper = store.slice(store.indexOf('const toNode'), store.indexOf('const toConnection'))
const dropped = asked.filter((c) => !new RegExp(`r\\.${c}\\b`).test(mapper))
check('every column the node query asks for is mapped', dropped, [])

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A day that says when and an edge that says what follows, with the one way they can disagree made
illegal rather than resolved; a period given to the debtor that is two facts or none, because "20"
is twenty of something nobody has said; wording that is a warning rather than a refusal, since the
attorney settles the statutory ones; and a canvas that draws by day, so the picture cannot come
apart from the workflow.`)
