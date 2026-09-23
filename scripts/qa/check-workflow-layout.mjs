/**
 * THE WORKFLOW SCREENS, AS A CHART SOMEBODY READS.
 *
 * The firm looked at the builder and said the layout they had been shown elsewhere was clearer.
 * They were right about the shape and the reason is not taste: a workflow is a TABLE OF DAYS in
 * their own document, and it was drawn as a horizontal strip of cards you scrolled sideways
 * through. The intervals are the thing being checked — seven days, then five, then twenty — and
 * sideways they are invisible.
 *
 * WHAT THIS GUARDS, and every one of them is a way of looking fine and saying nothing:
 *
 *   - A LIST OF NAMES. A workflow's meaning is the event that starts it and what it then does.
 *     A row carrying only a name and a state badge means opening each one to find out which you
 *     meant, and the cost is opening the wrong one.
 *   - A SUMMARY SOMEBODY TYPED. A hand-written sequence line stops being true the first time a
 *     step is added, and this list is exactly where nobody would notice.
 *   - THE TRIGGER SAID TWICE. Announced in a dropdown and again in the banner underneath, the
 *     two are free to disagree — which is how a screen comes to state a fact it does not have.
 *   - A CHART THAT HIDES WHICH STEPS STOP. Day 39 says a default HAS been reported and day 49
 *     says the file HAS gone to the attorneys; a sequence drawn without them reads as though the
 *     whole thing runs by itself.
 *   - AND EXIT RULES NOBODY TYPED. A promise, a dispute, payment, tracing. Drawn from the
 *     runner's own list, so a screen promising the sequence stops is promising what happens.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-layout.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { sequenceLine, dayLabel } from '../../src/lib/workflowBuilder.ts'
import { EXIT_EVENTS } from '../../src/lib/workflowRun.ts'
import { accountFieldsNeeded } from '../../src/lib/messageTemplates.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const rail = read('src/components/workflows/WorkflowSchedule.tsx')
const page = read('src/pages/library/LibraryWorkflows.tsx')
const drawer = read('src/components/workflows/StepDrawer.tsx')
const store = read('src/lib/workflowStore.ts')

ok('the schedule rail exists', rail.length > 0)

/* ------------------------------------------------ the sequence line is derived */

const version = (over = {}) => ({
  id: 'v', version: 1, state: 'draft', publishedAt: null, dayUnit: 'business',
  trigger: 'by_hand', triggerNote: null, ...over,
})
const wf = (phases, nodes) => ({
  id: 'w', key: 'k', name: 'W', description: null, teamName: null,
  version: version(), phases, nodes, connections: [],
})
const node = (over) => ({
  id: over.id, phaseId: over.phaseId ?? null, key: over.id, kind: 'communication',
  label: over.id, description: null, day: over.day ?? 0, deadlineDays: null, deadlineUnit: null,
  channel: over.channel ?? null, templateId: null, templateCompanyId: null,
  afterMinutes: over.afterMinutes ?? null, needsRelease: false, statutory: false,
  assignTo: null, x: null, y: null, ordinal: over.ordinal ?? 0,
})
const phase = (id, ordinal, name) => ({ id, ordinal, name, subtitle: null, fromDay: 0, toDay: 0 })

/* MANY PHASES: their names, in order. Eleven steps do not fit on a list row; three phases do. */
check('a phased workflow is summarised by its phases',
  sequenceLine(wf(
    [phase('p1', 1, 'Demand'), phase('p2', 2, 'Listing'), phase('p3', 3, 'Legal')],
    [node({ id: 'a', phaseId: 'p1' }), node({ id: 'b', phaseId: 'p2' }), node({ id: 'c', phaseId: 'p3' })],
  )),
  'Demand → Listing → Legal')

/* ONE PHASE: the phase name says nothing the title did not, so it falls back to what happens. */
check('a single-phase workflow is summarised by what it actually sends',
  sequenceLine(wf(
    [phase('p1', 1, 'Handover')],
    [node({ id: 'a', phaseId: 'p1', channel: 'email', ordinal: 1 }),
      node({ id: 'b', phaseId: 'p1', channel: 'sms', afterMinutes: 7, ordinal: 2 })],
  )),
  'Email → 7 min → SMS → End')

/*
 * AND THE GAP IS PART OF IT. The firm's rule and the reason afterMinutes exists: the handover SMS
 * says "we emailed you", so a line reading "Email, SMS" is a line showing two things that could
 * happen in either order.
 */
ok('...including the wait between them', /7 min/.test(sequenceLine(wf(
  [phase('p1', 1, 'Handover')],
  [node({ id: 'a', phaseId: 'p1', channel: 'email', ordinal: 1 }),
    node({ id: 'b', phaseId: 'p1', channel: 'sms', afterMinutes: 7, ordinal: 2 })],
))))
/*
 * AN ABSENT COLUMN IS NOT A ZERO. A row whose after_minutes is missing arrives as undefined,
 * which is not null -- and every step on the chart read "undefined min after the one before".
 * Caught in the browser; every rule check passed the whole time.
 */
const missing = sequenceLine(wf(
  [phase('p1', 1, 'Handover')],
  [{ ...node({ id: 'a', phaseId: 'p1', channel: 'email', ordinal: 1 }), afterMinutes: undefined },
    { ...node({ id: 'b', phaseId: 'p1', channel: 'sms', ordinal: 2 }), afterMinutes: undefined }],
))
ok('a step with no wait recorded does not print "undefined"', !/undefined/.test(missing))
ok('...and the rail does not either', !/afterMinutes !== null/.test(rail))

check('an empty workflow says so rather than drawing an arrow to nothing',
  sequenceLine(wf([], [])), 'Nothing in it yet')

/* ------------------------------------------------ the list row */

ok('the list row names what starts it', /Trigger<\/p>/.test(page))
ok('...and what it then does', /Sequence<\/p>/.test(page))
/* DERIVED, NEVER TYPED. The store builds it from the version's own steps. */
ok('the sequence is computed from the steps, not written down', /sequenceLine\(\{/.test(store))
ok('...off the version the row is about', /shown\.workflow_nodes/.test(store))
/*
 * AND THE LIST FETCHES ENOUGH TO SAY IT. A summary that had to be filled in by opening each
 * workflow is a summary that shows a dash on every row.
 */
ok('the list query carries the steps', /workflow_nodes\([^)]*channel/.test(store))
ok('...and the trigger', /workflow_versions\([^)]*trigger_kind/.test(store))

/* ------------------------------------------------ said once */

/*
 * THE TRIGGER IS STATED IN THE BANNER, AND THE CONTROL THAT CHANGES IT LIVES THERE TOO. Split
 * across the page header and the banner, the screen announced the same fact twice.
 */
ok('the banner states what starts it', /\{trigger\.label\}/.test(rail))
ok('...and how its days are counted', /DAY_UNITS\[unit\]\.label/.test(rail))
ok('...and how to count them', /DAY_UNITS\[unit\]\.hint/.test(rail))
ok('the control that changes it is inside that banner', /\{controls && /.test(rail))
ok('...so the page header no longer states it a second time',
  !/<span className="text-slate-400">Starts when<\/span>/.test(page))

/* ------------------------------------------------ the rail itself */

ok('the day carries its unit on every row', /dayLabel\(node\.day, unit\)/.test(rail))
ok('...and the date it lands on beside it', /landsOn\(from, node\.day, unit\)/.test(rail))
/*
 * NUMBERED WHERE EVERY STEP SHARES A DAY. The handover is three steps inside ten minutes, and a
 * rail reading "Day 0 / Day 0 / Day 0" says only that somebody printed one number three times.
 */
ok('a same-day workflow is numbered instead of repeating one day',
  /const spread = new Set\(steps\.map\(\(n\) => n\.day\)\)\.size > 1/.test(rail))
ok('...and says so rather than claiming a unit it is not using',
  /'Same day, in order'/.test(rail))
/* The label helper is what the day chip uses, so the two cannot disagree about a unit. */
check('a business day announces itself', dayLabel(32, 'business'), 'Business day 32')
check('...and a calendar day reads as it always did', dayLabel(32, 'calendar'), 'Day 32')

/*
 * WHICH STEPS STOP, ON THE CHART. Day 39 says a default HAS been reported and day 49 says the
 * file HAS gone to the attorneys. A sequence drawn without them reads as though it all runs by
 * itself, which is the opposite of the firm's rule.
 */
ok('a step that waits for a person says so on its row', /node\.needsRelease &&/.test(rail))
ok('...in the words the collector will act on', /Waits for you/.test(rail))

/*
 * AND WHAT TAKES AN ACCOUNT OUT. Drawn from the runner's own list rather than typed, so a screen
 * promising that a promise stops the sequence is promising what the database actually does.
 */
ok('the exit rules are on the chart', /EXIT_EVENTS/.test(rail))
ok('...all four of them', Object.keys(EXIT_EVENTS).length === 4)
ok('...and none of them is retyped into the component',
  Object.values(EXIT_EVENTS).every((label) => !rail.includes(label)))

/* ------------------------------------------------ what a step will wait for */

/*
 * THE GUARD, SAID IN ADVANCE. The firm's instruction about the listing step -- "it must only send
 * once the submission has actually happened and those three values exist on the account" -- is
 * enforced by planSend at send time. On the builder it is shown before it happens.
 */
const needed = accountFieldsNeeded('collections', null,
  'Reported on {{listing_date}} under {{listing_reference}} to {{bureaus_listed}} by {{firm_name}}.')
check('the guard lists the account facts the wording quotes',
  needed.map((f) => f.key).sort(), ['bureaus_listed', 'listing_date', 'listing_reference'])
/*
 * AND NOT THE FIRM'S OWN DETAILS. Those come off firm_settings and always resolve; a step is
 * never held for want of the firm's bank account, so listing it as a requirement would be a
 * warning that fires when nothing is wrong.
 */
ok('...and not the firm’s own, which always resolve',
  !needed.some((f) => f.key.startsWith('firm_')))
check('a wording that quotes nothing about the account requires nothing',
  accountFieldsNeeded('collections', null, 'Dear {{debtor_name}}, telephone {{firm_phone}}.')
    .map((f) => f.key), ['debtor_name'])

ok('the step panel shows what it will wait for', /<BeforeSending /.test(drawer))
ok('...and what happens when something is missing', /it holds here and the collector is told/.test(drawer))
ok('...read off the wording rather than configured', /accountFieldsNeeded\('collections'/.test(drawer))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-workflow-layout: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
