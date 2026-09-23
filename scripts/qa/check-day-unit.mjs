/**
 * A DAY NUMBER NEVER APPEARS WITHOUT SAYING WHICH KIND OF DAY IT IS.
 *
 * The firm corrected us once: "this is all working days, not normal days. Business days, not
 * normal days." A day number carried no unit and the whole chart was read as calendar days, so
 * day 32 meant a month where the firm meant a month and a half -- and the twenty business days
 * before a credit bureau listing were a third of their real length.
 *
 * `day_unit` came out of that. It is stored, `landsOn` applies it and `workflow_take_draft`
 * carries it -- and it appeared on NO SCREEN and could be set from NOWHERE. A chart reads
 * "Day 32" either way, so the reader supplied the unit themselves and half of them supplied the
 * wrong one. That is the same failure as before with a column added to it.
 *
 * WHAT THIS GUARDS:
 *
 *   - EVERY DAY NUMBER ON A WORKFLOW SCREEN CARRIES ITS UNIT. Asserted as the rule -- no bare
 *     "Day {" left in any of the three components -- rather than by checking that one particular
 *     line says the right thing.
 *   - THE FIELD SOMEBODY TYPES INTO COUNTS FROM THE TRIGGER. It said "days after the handover",
 *     hard-coded, on a screen that can build a workflow triggered by a broken arrangement.
 *   - DAY 0 DOES NOT EXIST ON A BUSINESS CHART. Business days are 1-based and inclusive, and
 *     `landsOn` clamps, so a step typed as 0 silently becomes day 1.
 *   - AND A PUBLISHED VERSION CANNOT BE FLIPPED. Changing the unit re-dates every step of the
 *     chart at once, so the archived version an attorney reads back would stop saying what the
 *     firm actually did.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-day-unit.mjs
 */
import { readFileSync } from 'node:fs'
import { DAY_UNITS, dayLabel, dayRangeLabel, landsOn } from '../../src/lib/workflowBuilder.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(p, 'utf8')

/* ------------------------------------------------ the words */

check('a business chart marks its numbers', dayLabel(32, 'business'), 'Business day 32')
/* CALENDAR IS THE UNMARKED CASE, deliberately: it is the model's default, it is what every
   workflow drawn before this meant, and an unlabelled "Day 32" read as calendar days is read
   correctly. Business days are the ones that have to announce themselves. */
check('a calendar chart reads as it always did', dayLabel(32, 'calendar'), 'Day 32')
check('a phase range carries the same unit as the cards under it',
  dayRangeLabel(5, 12, 'business'), 'Business day 5 – 12')
ok('both units say how to count them', Object.values(DAY_UNITS).every((u) => u.hint.length > 20))

/*
 * AND THE TWO REALLY DO DIFFER, which is the whole reason any of this exists. Day 32 from Monday
 * 1 June 2026, counted both ways -- if these ever agree the unit stopped being applied and every
 * assertion above is decoration.
 */
const asBusiness = landsOn('2026-06-01', 32, 'business')
const asCalendar = landsOn('2026-06-01', 32, 'calendar')
ok(`day 32 lands on different dates by unit (${asBusiness} vs ${asCalendar})`, asBusiness !== asCalendar)
/* Business is 1-BASED and inclusive: day 1 is the day it starts, "that's day one". */
check('business day 1 is the day the workflow starts', landsOn('2026-06-01', 1, 'business'), '2026-06-01')
/* Calendar is 0-based and unchanged, or every workflow already drawn would silently move. */
check('calendar day 0 is the day the workflow starts', landsOn('2026-06-01', 0, 'calendar'), '2026-06-01')

/* ------------------------------------------------ every screen that prints one */

const SCREENS = {
  'src/components/workflows/WorkflowCanvas.tsx': read('src/components/workflows/WorkflowCanvas.tsx'),
  'src/components/workflows/StepDrawer.tsx': read('src/components/workflows/StepDrawer.tsx'),
  'src/pages/library/LibraryWorkflows.tsx': read('src/pages/library/LibraryWorkflows.tsx'),
}

/**
 * Source with the comments taken out.
 *
 * The comments explaining all of this necessarily QUOTE the bad pattern -- "'days after the
 * handover' was hard-coded" is in the file that fixed it -- so a search over raw source reports
 * the explanation as the offence.
 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

for (const [path, src] of Object.entries(SCREENS)) {
  /*
   * THE RULE, NOT THE LINE: no day number is interpolated after a bare "Day". Written as a check
   * on one particular JSX expression this would pass the moment somebody adds a fourth place that
   * prints one, which is exactly how the unit went missing from three screens at once.
   */
  const bare = [...code(src).matchAll(/\bDay\s*\{/g)].length
  check(`${path.split('/').pop()}: no day number is printed without its unit`, bare, 0)
}

/* Asserted PRESENT before anything about how it is used -- an order-only or absence-only test
   passes vacuously once the thing it guards is deleted. */
const canvas = SCREENS['src/components/workflows/WorkflowCanvas.tsx']
ok('the canvas labels its cards through the shared helper', /dayLabel\(node\.day, dayUnit\)/.test(canvas))
ok('...and its phase bars through the same one', /dayRangeLabel\(/.test(canvas))
ok('...reading the unit off the version rather than per card',
  /const dayUnit = workflow\.version\.dayUnit/.test(canvas))

/* ------------------------------------------------ the field somebody types into */

const drawer = SCREENS['src/components/workflows/StepDrawer.tsx']
ok('the step drawer names the unit on the day field',
  /DAY_UNITS\[workflow\.version\.dayUnit\]\.label/.test(drawer))
/*
 * AND COUNTS FROM WHAT ACTUALLY STARTS THE WORKFLOW. "days after the handover" was hard-coded on
 * a screen that can build a workflow triggered by a broken arrangement, where day 5 is five days
 * after the arrangement broke. triggerMeta().dayZero has said so since triggers were built; the
 * header printed it and the field being typed into did not.
 */
ok('...and counts from whatever starts the workflow, not from a handover',
  /triggerMeta\(workflow\.version\.trigger\)\.dayZero/.test(drawer))
ok('...so nothing on it still hard-codes a handover',
  !/days after the handover/.test(code(drawer)))

/*
 * DAY 0 DOES NOT EXIST ON A BUSINESS CHART. landsOn clamps with Math.max(0, day - 1), so a step
 * typed as 0 becomes day 1 -- the chart then reads as though something happens before the
 * workflow starts, and the number in the box is not the number that runs.
 */
check('business day 0 and day 1 are the same date, which is why 0 must not be typeable',
  landsOn('2026-06-01', 0, 'business'), landsOn('2026-06-01', 1, 'business'))
ok('the day box floors at 1 on a business chart and 0 on a calendar one',
  /min=\{workflow\.version\.dayUnit === 'business' \? 1 : 0\}/.test(drawer))

/* ------------------------------------------------ setting it, and not setting it */

const store = read('src/lib/workflowStore.ts')
ok('the unit can be set at all', /export async function setDayUnit/.test(store))
ok('...and writes the column it reads', /day_unit: unit/.test(store))
/*
 * AND IT IS STILL SELECTED. A column present in the database, in the type and in the mapper but
 * missing from the SELECT reads as undefined for ever and nothing fails -- diary_capacity sat in
 * that state for months.
 *
 * MATCHED INSIDE THE SUB-SELECT, not with [^)]*, which is the trap this codebase has hit twice:
 * the select string contains `teams(name)`, so a negated-paren class stops at ITS closing bracket
 * and never reaches the version columns. This assertion reported red on correct code the first
 * time it ran, for exactly that reason.
 */
ok('...and the column is still selected, or it reads as undefined for ever',
  /workflow_versions\([^)]*day_unit/.test(store))
ok('...and lands on the version the builder reads', /dayUnit: \(chosen\.day_unit/.test(store))

const page = SCREENS['src/pages/library/LibraryWorkflows.tsx']
ok('the builder offers it beside what starts the workflow', /setDayUnit\(workflow\.version\.id/.test(page))
/* On a draft only. A published version is frozen, and the control has to agree with the database
   or the firm meets a refusal from a box that let them press it. */
ok('...on a draft only', /state === 'draft' && mayEdit[\s\S]{0,400}?setDayUnit/.test(page))

/*
 * AND THE DATABASE IS WHAT ACTUALLY REFUSES IT. A disabled select is a courtesy; the protection
 * is the trigger, because the unit is reachable from anything holding a session.
 */
const schema = read('supabase/schema.sql')
const frozen = schema.slice(schema.lastIndexOf('function public.refuse_trigger_change_when_frozen'))
ok('a published version refuses a change of unit',
  /new\.day_unit is distinct from old\.day_unit/.test(frozen))
ok('...with its own sentence, not the trigger’s',
  /what kind of day it counts in/.test(frozen))
/* Publishing is itself an UPDATE of state on that row, so a blanket refusal would refuse
   publishing. The freeze stays narrow, and that is deliberate. */
ok('...while the version can still be published', !/old\.state <> 'draft' then\s*raise/.test(frozen))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-day-unit: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
