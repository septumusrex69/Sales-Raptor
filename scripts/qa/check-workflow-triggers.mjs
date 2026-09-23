/**
 * WHAT STARTS A WORKFLOW.
 *
 * The builder could say what happens to a file and had no way to say how the file got there, so
 * every workflow was implicitly "an account is handed over" -- the only trigger its day numbers
 * were ever written for. The firm's next four are not: an arrangement workflow starts when an
 * arrangement breaks, a dispute workflow when a dispute is raised.
 *
 * THE THREE THINGS THIS HOLDS, because each of them fails silently:
 *
 *   - THE LIST IS IN FOUR PLACES. A TypeScript union, a table of labels, an order for the
 *     buttons, and a CHECK constraint in the database. Three of them agreeing and the fourth not
 *     is a trigger somebody can pick and nothing can save, or one the database allows and the
 *     screen renders as undefined. They are held against each other in BOTH directions.
 *   - A DRAFT HAS TO CARRY THE TRIGGER OVER. workflow_take_draft copies a version column by
 *     column, and the day trigger_kind was added it did not copy it -- so a draft off a
 *     published arrangement workflow came back as "somebody starts it by hand" and the builder
 *     would have shown that as the truth. Exactly the mapper-drift hazard CLAUDE.md names, in SQL.
 *   - DAY 0 MOVES WITH THE TRIGGER. A node carries an ABSOLUTE day. "Day 10" is ten days after a
 *     handover in one workflow and ten days after a broken promise in another, and nothing in the
 *     number says which. The sentence that says which is built in one place and printed wherever
 *     a day is.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-triggers.mjs
 */
import { readFileSync } from 'node:fs'
import {
  TRIGGERS, TRIGGER_ORDER, dayZeroLabel, landsOn, workflowProblems, canSave,
} from '../../src/lib/workflowBuilder.ts'
import { isWorkingDay } from '../../src/lib/workingDays.ts'
import { DIARY_KINDS } from '../../src/lib/diaryPriority.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const schema = readFileSync('supabase/schema.sql', 'utf8')
const store = readFileSync('src/lib/workflowStore.ts', 'utf8')

/* ------------------------------------------------------------------ the four lists agree */

const inCode = Object.keys(TRIGGERS).sort()

/*
 * THE DATABASE'S OWN LIST, read out of the CHECK constraint rather than written here a second
 * time. A copy in this file could agree with itself and disagree with the column.
 */
const constraint = /trigger_kind text not null default '[a-z_]+'\s*\n\s*check \(trigger_kind in \(([\s\S]*?)\)\)/
  .exec(schema)
ok('the trigger column is a closed list in the database', constraint !== null)
const inDb = constraint
  ? [...constraint[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  : []

check('every trigger the code offers is one the database will take', inCode, inDb)
check('...and the order the buttons are offered in covers all of them',
  [...TRIGGER_ORDER].sort(), inCode)
check('...with nothing listed twice', TRIGGER_ORDER.length, new Set(TRIGGER_ORDER).size)

/*
 * AND THE VOCABULARY IS THE DIARY'S. Every trigger but the three Raptor raises no diary work for
 * is a diary kind, which is what makes it an event something could one day honour rather than a
 * phrase somebody wrote. Held against DIARY_KINDS so a rename on one side is a failure here.
 */
const diary = Object.keys(DIARY_KINDS)
const NOT_IN_THE_DIARY = ['handover', 'allocated', 'arrangement_broken', 'payment_received',
  'dispute_logged', 'trace_returned', 'by_hand']
for (const t of TRIGGER_ORDER) {
  if (NOT_IN_THE_DIARY.includes(t)) continue
  ok(`"${t}" is the diary's own word for it`, diary.includes(t))
}
/*
 * `review` IS DELIBERATELY NOT A TRIGGER. CLAUDE.md: a routine review is the last rung and the
 * only diary kind with no event behind it. There is nothing for a workflow to wait for, so a
 * trigger named after it could never fire -- and a trigger that can never fire is a workflow the
 * firm believes is running.
 */
ok('a routine review is not a trigger, because nothing raises it', !inCode.includes('review'))
ok('...and it is a diary kind, so this is a deliberate omission rather than an oversight',
  diary.includes('review'))

/* ------------------------------------------------------------------ day 0 follows the trigger */

/*
 * THE FAULT THIS GUARDS. Until there were triggers, every day number meant "days from the
 * handover" and the schema said so. With a trigger it does not, and a chart still labelled
 * "dated from a handover" on an arrangement workflow is a section 129 dated from the wrong event.
 */
for (const t of TRIGGER_ORDER) {
  const line = dayZeroLabel(t)
  ok(`${t}: the day column says what day 0 is`, line.includes(TRIGGERS[t].dayZero))
  if (t === 'handover') continue
  ok(`...and ${t} does not call it a handover`, !/handover/i.test(line))
}
check('a handover workflow still counts from the handover',
  dayZeroLabel('handover'), 'Day 0 is the day the account was handed over.')
ok('every trigger has a label somebody would say out loud',
  TRIGGER_ORDER.every((t) => TRIGGERS[t].label.trim().length > 3))

const page = readFileSync('src/pages/library/LibraryWorkflows.tsx', 'utf8')
ok('the builder labels its date box from the trigger rather than from a handover',
  /Dated from \{triggerMeta\(workflow\.version\.trigger\)\.dayZero\}/.test(page))

/*
 * AND A VERSION WITH NO TRIGGER DOES NOT TAKE THE LIBRARY DOWN. Reading TRIGGERS[undefined].label
 * inside a render throws, and what it throws away is the whole page rather than one line of it.
 */
const { triggerMeta } = await import('../../src/lib/workflowBuilder.ts')
check('a version with no trigger falls back to by hand rather than throwing',
  triggerMeta(undefined).label, TRIGGERS.by_hand.label)
ok('...and the header says what sets the workflow off', /Starts when/.test(page))
ok('a new workflow is asked what sets it off before anything else',
  /What sets it off/.test(page))

/* ------------------------------------------------------------------ business days */

/*
 * THE FIRM'S SECTION 129 SEQUENCE IS COUNTED IN WORKING DAYS. "This is all working days, not
 * normal days. Business days, not normal days." A day number carrying no unit was read as
 * calendar days everywhere, so day 32 meant a month where the firm meant a month and a half --
 * and the interval that matters most, the twenty business days before a credit bureau listing,
 * was a third of its real length.
 *
 * ASSERTED AGAINST REAL DATES, not against the arithmetic restated. Wednesday 23 September 2026
 * is the anchor; Thursday 24 September is Heritage Day, which the firm's calendar already knows.
 */
check('business day 1 is the day the workflow starts, not the day after',
  landsOn('2026-09-23', 1, 'business'), '2026-09-23')
/* 23rd is day 1, the 24th is a public holiday, so day 2 is Friday the 25th. */
check('...a public holiday is not one of the days', landsOn('2026-09-23', 2, 'business'), '2026-09-25')
/* ...and day 3 skips the weekend to Monday the 28th. */
check('...nor is a weekend', landsOn('2026-09-23', 3, 'business'), '2026-09-28')

/*
 * A WORKFLOW DOES NOT BEGIN ON A DAY THE OFFICE IS SHUT. Started on a Saturday, day 1 is the
 * Monday -- otherwise the whole chart is dated from a day nobody worked.
 */
check('a workflow started on a Saturday has its day 1 on the Monday',
  landsOn('2026-09-26', 1, 'business'), '2026-09-28')
ok('...and every business day of a workflow is a working day',
  [1, 7, 12, 32, 39, 49].every((d) => isWorkingDay(landsOn('2026-09-23', d, 'business'))))

/*
 * CALENDAR IS 0-BASED AND UNCHANGED, because every workflow written before this meant that, and
 * moving it would silently re-date every step of one already drawn.
 */
check('a calendar day 0 is the day it started', landsOn('2026-09-23', 0, 'calendar'), '2026-09-23')
check('...and calendar days do not skip anything',
  landsOn('2026-09-23', 3, 'calendar'), '2026-09-26')

/*
 * AND THE TWO UNITS DISAGREE BY WEEKS OVER THE LENGTH OF THIS SEQUENCE, which is the whole
 * reason the unit has to be carried. Day 49 read as calendar days is 11 November 2026; read as
 * business days it is 2 December. Three weeks of difference on the step that tells a debtor
 * their file has gone to the attorneys.
 */
check('day 49 in calendar days', landsOn('2026-09-23', 49, 'calendar'), '2026-11-11')
/* 1 December, counted independently by walking the calendar and numbering the working days --
   the first expected value written here was 2 December, and the check was right. */
check('day 49 in business days', landsOn('2026-09-23', 49, 'business'), '2026-12-01')

const canvas = readFileSync('src/components/workflows/WorkflowCanvas.tsx', 'utf8')
/*
 * THE CHART DATES ITS CARDS THROUGH THE SAME RULE. It had a dayPlus() of its own that added
 * calendar days, so a business-day workflow would have drawn every card against the wrong date
 * while the day numbers underneath were right -- the two disagreeing, with nothing saying which.
 */
ok('the canvas dates a card through the shared rule',
  /landsOn\(from, node\.day, dayUnit\)/.test(canvas))
ok('...and no longer has a calendar-only one of its own', !/function dayPlus/.test(canvas))

/* ------------------------------------------------------------------ nothing drops the column */

/*
 * THE MAPPER, IN BOTH DIRECTIONS. A column in the database, in the type and in the select but
 * missing from the mapper reads as undefined for ever and nothing fails -- diary_capacity sat in
 * that state for months.
 */
/*
 * READ AS WHOLE SELECT STRINGS. A `.select('a, b, versions(c, d)')` has brackets inside it, so an
 * expression that stops at the first `)` reports a column as missing that is plainly there -- and
 * a check that fails on correct code gets deleted rather than fixed.
 */
const selects = [...store.matchAll(/\.select\('([^']*)'\)/g)].map((m) => m[1])
ok('the store selects something at all', selects.length > 0)

for (const column of ['trigger_kind', 'trigger_note']) {
  ok(`the workflow select asks for ${column}`, selects.some((q) => q.includes(column)))
  ok(`...and the mapper reads ${column} back`, new RegExp(`chosen\\.${column}`).test(store))
}

/*
 * AND THE SAME HAZARD IN SQL. workflow_take_draft copies a version column by column; the version
 * insert listed four columns and the trigger was not among them, so a draft came back with the
 * column's DEFAULT.
 */
const takeDraft = /create or replace function public\.workflow_take_draft[\s\S]*?\n\$\$;/g
const drafts = [...schema.matchAll(takeDraft)].map((m) => m[0])
ok('workflow_take_draft is in the checked-in schema', drafts.length > 0)
/* The LAST one, because schema.sql is append-only and a later definition replaces an earlier. */
const draft = drafts[drafts.length - 1] ?? ''
ok('...and the draft it takes carries the trigger over', /o\.trigger_kind/.test(draft))
ok('...and the firm\'s own narrowing with it', /o\.trigger_note/.test(draft))

/*
 * THE NODE'S THREE NEW COLUMNS, held the same way and for the same reason. Each of them changes
 * what a debtor receives: the company wording, whether the SMS overtakes the email, and whether
 * a step that asserts something has already happened waits for a person to confirm it has.
 */
for (const column of ['day_unit', 'template_company_id', 'after_minutes', 'needs_release']) {
  ok(`the select asks for ${column}`, selects.some((q) => q.includes(column)))
  /* Either mapper: the node's reads `r.x`, the version's reads `chosen.x`. Written as `r.` only,
     this reported day_unit as dropped when it is plainly read two lines above the nodes. */
  ok(`...and a mapper reads ${column} back`,
    new RegExp(`(r|chosen)\\.${column}`).test(store))
  /* Named in the message: three identical "carries it over" lines said which check failed and
     not which column, which is a failure report somebody has to go and decode. */
  ok(`...and taking a draft carries ${column} over`, new RegExp(`o\\.${column}`).test(draft))
}

ok('a workflow can be started from nothing', /function public\.workflow_create/.test(schema))
ok('...and it comes with a phase, or the builder has nowhere to put the first step',
  /insert into public\.workflow_phases[\s\S]{0,200}?values \(v_version/.test(schema))

/*
 * WHAT STARTS A PUBLISHED VERSION CANNOT BE CHANGED, and it has to be the database that says so:
 * workflow_versions is the one table here with no frozen-row trigger, because publishing is an
 * update of state on that very row.
 */
ok('the trigger of a published version is frozen in the database',
  /refuse_trigger_change_when_frozen/.test(schema))
ok('...narrowly, so publishing itself still works',
  /old\.state <> 'draft'[\s\S]{0,200}?trigger_kind is distinct from/.test(schema))

/* ------------------------------------------------------------------ an empty workflow */

const empty = {
  id: 'w', key: 'w', name: 'New one', description: null, teamName: null,
  version: { id: 'v', version: 1, state: 'draft', publishedAt: null, trigger: 'handover', triggerNote: null },
  phases: [{ id: 'p', ordinal: 1, name: 'Phase 1', subtitle: null, fromDay: 0, toDay: 30 }],
  nodes: [],
  connections: [],
}
/*
 * Every workflow now starts empty, so without this the first thing anybody can do with a new one
 * is publish it and have it do nothing to every account that triggers it.
 */
const problems = workflowProblems(empty)
ok('a workflow with no steps cannot be published',
  !canSave(problems) && problems.some((p) => /no steps/.test(p.message)))
const withStep = {
  ...empty,
  nodes: [{
    id: 'n', phaseId: 'p', key: 'first', kind: 'task', label: 'Open the file', description: null,
    day: 0, deadlineDays: null, deadlineUnit: null, channel: null, templateId: null,
    templateCompanyId: null, afterMinutes: null, needsRelease: false,
    statutory: false, assignTo: null, x: null, y: null, ordinal: 0,
  }],
}
ok('...and one with a step can', canSave(workflowProblems(withStep)))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-workflow-triggers: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
