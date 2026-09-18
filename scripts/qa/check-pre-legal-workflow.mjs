/**
 * The firm's pre-legal workflow, as data, against the chart it was transcribed from.
 *
 * A WORKFLOW IS A THING THAT RUNS WITHOUT ANYBODY WATCHING IT. That is the whole point of one,
 * and it is also why a mistake in it is expensive: a step dated wrong does not produce a wrong
 * screen, it produces a statutory notice that went out on the wrong day, to everybody, and the
 * firm finds out when one of them is challenged.
 *
 * What this guards, in the order the damage runs:
 *
 *   - THE STATUTORY WAITS ARE BUSINESS DAYS. The chart says "20 business days" and then dates the
 *     listing at day 42. That was right by a sum somebody did once, in a month with no holidays.
 *   - A STEP MAY ONLY WAIT ON A STEP BEFORE IT. A forward reference has no date to count from and
 *     resolves to nothing, which is a notice that silently never goes out.
 *   - EVERY BRANCH HAS A WAY BACK. A branch with no outcome is a file that leaves the sequence and
 *     is never seen again, and nobody reports an account that stopped being worked.
 *   - THE ROTATIONS ARE NOT IN HERE. Rotation is a calendar rule now, and a day-numbered rotation
 *     left in the spine would put two different answers on one screen.
 *   - AND EVERY NOTICE IT NAMES EITHER EXISTS IN THE LIBRARY OR IS COUNTED AS OUTSTANDING. A
 *     template key that points at nothing is a send that fails at three in the morning.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-pre-legal-workflow.mjs
 */
import { readFileSync } from 'node:fs'
import { PRE_LEGAL_160 } from '../../src/lib/preLegalWorkflow.ts'
import { definitionProblems, noticesWanted, resolveSteps } from '../../src/lib/workflowDefinition.ts'
import { rotationSchedule } from '../../src/lib/workflowSchedule.ts'
import { isWorkingDay } from '../../src/lib/workingDays.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------- it is a sound definition ---------- */

check('nothing is wrong with the definition', definitionProblems(PRE_LEGAL_160), [])
ok('the spine has the chart’s steps on it', PRE_LEGAL_160.spine.length >= 14)
check('there are five ways off the spine', PRE_LEGAL_160.branches.length, 5)
check('...and they are the chart’s five',
  PRE_LEGAL_160.branches.map((b) => b.id),
  ['arrangement', 'default', 'dispute', 'sequestration', 'liquidation'])
/* The firm's own rules travel with the definition rather than living only in a PDF. */
check('the six rules at the foot of the chart are carried', PRE_LEGAL_160.rules.length, 6)
ok('...including the one the whole branch model turns on',
  PRE_LEGAL_160.rules.some((r) => /returns to it on day 52 — never at day 1/.test(r)))
ok('...and the one about re-issuing statutory notices',
  PRE_LEGAL_160.rules.some((r) => /never re-issued/.test(r)))

/*
 * A BRANCH WITH NO OUTCOME IS A FILE NOBODY SEES AGAIN. Nothing reports an account that quietly
 * stopped being worked — it simply sits there, and the client asks about it eleven months later.
 */
for (const branch of PRE_LEGAL_160.branches) {
  ok(`${branch.id} has a way out`, branch.outcomes.length > 0)
  ok(`...and every outcome says what happens`,
    branch.outcomes.every((o) => o.detail.trim() !== '' && o.effect.kind !== undefined))
}
/* The chart sends a missed instalment straight to the default branch, and that branch exists. */
const missed = PRE_LEGAL_160.branches.find((b) => b.id === 'arrangement').outcomes.find((o) => o.id === 'missed')
check('a missed instalment goes to the default branch', missed.effect, { kind: 'goto_branch', branch: 'default' })
ok('...with no renegotiation first, as the chart says', /no renegotiation first/.test(missed.detail))

/* ---------- the days, against the chart ---------- */

/*
 * 18 SEPTEMBER 2026 — the day the firm handed this over, so the numbers can be read against the
 * chart they drew. Day numbers first, because that is what the chart is labelled with.
 */
const resolved = resolveSteps(PRE_LEGAL_160.spine, '2026-09-18')
check('every step resolved to a date', resolved.length, PRE_LEGAL_160.spine.length)
const dayOf = Object.fromEntries(resolved.map((r) => [r.step.id, r.day]))
check('handover is day 0', dayOf['handover'], 0)
check('demand and section 129 is day 1', dayOf['demand-129'], 1)
check('intention to list is day 10', dayOf['intention-to-list'], 10)
check('follow-up and offer is day 21', dayOf['follow-up-offer'], 21)
check('final notice is day 35', dayOf['final-notice'], 35)
check('intended legal action is day 50', dayOf['intended-legal-action'], 50)
check('court process explained is day 60', dayOf['court-process-explained'], 60)
check('final settlement window is day 70', dayOf['final-settlement-window'], 70)
check('draft summons is day 75', dayOf['draft-summons'], 75)
check('open strategy is day 80', dayOf['open-strategy'], 80)
check('viability review is day 110', dayOf['viability-review'], 110)
check('closure report is day 155', dayOf['closure-report'], 155)
check('the recommendation is day 160', dayOf['recommendation'], 160)

/*
 * AND MOVING A STEP OFF A SATURDAY DOES NOT MOVE WHAT COMES AFTER IT.
 *
 * Day 155 from this handover is a Saturday, so the closure report is written on the Monday — but
 * the recommendation is still day 160, not day 164. Chaining off the date a step actually
 * happened was the first version and it drifts four days over one workflow, compounding, so two
 * files handed over a day apart end up permanently out of step and a workflow's length depends on
 * which weekends it crossed.
 */
const closure = resolved.find((r) => r.step.id === 'closure-report')
ok(`the closure report's own day is a Saturday (${closure.nominal})`, !isWorkingDay(closure.nominal))
ok(`...so it is actually written on the next working day (${closure.on})`, closure.on > closure.nominal)
check('...while its day number does not move', closure.day, 155)
check('...and the step after it is still day 160', dayOf['recommendation'], 160)
/* Which is only true because the anchor is the nominal date. Counted from the Monday it would be
   day 162, and then moved off its own weekend again, 164. */
ok('...rather than the 164 that chaining off the Monday would give',
  resolved.find((r) => r.step.id === 'recommendation').day !== 164)

/*
 * THE ONE DAY NUMBER THAT MOVED, and it moved because it was never really a day number.
 *
 * The chart dates the listing confirmation at day 42, twenty business days after the intention to
 * list on day 10. In an ordinary month that sum comes out near 42. Expressed as the twenty
 * business days it actually is, it lands where the calendar puts it — and a listing confirmed
 * before its statutory period has run is a listing that has to be removed again.
 */
ok(`listing confirmed is near the chart's day 42 (${dayOf['listing-confirmed']})`,
  dayOf['listing-confirmed'] >= 36 && dayOf['listing-confirmed'] <= 46)
ok('...and it is counted in business days, not calendar days',
  PRE_LEGAL_160.spine.find((s) => s.id === 'listing-confirmed').when.kind === 'business_days')
/*
 * Proved over a holiday rather than asserted: an intention going out in mid-December pushes the
 * confirmation into the new year, and a fixed day 42 would confirm it while the courts are shut.
 */
const december = resolveSteps(PRE_LEGAL_160.spine, '2026-12-01')
const decDay = december.find((r) => r.step.id === 'listing-confirmed').day
ok(`over the December holidays the same step takes longer (${decDay} days)`, decDay > dayOf['listing-confirmed'])

/* ---------- the rotations are NOT in the spine ---------- */

/*
 * The chart has "Day 40 · Rotate to Clerk 2", day 80 and day 120. Rotation is a calendar rule
 * now — the 5th, two months on — and a day-numbered rotation left in here would put two different
 * answers on one screen for the same question.
 */
const rotationish = PRE_LEGAL_160.spine.filter((s) => /rotate|clerk \d/i.test(`${s.label} ${s.note ?? ''}`))
check('no step in the spine rotates a clerk', rotationish.map((s) => s.id), [])
ok('no step action rotates either',
  PRE_LEGAL_160.spine.every((s) => !/rotat/i.test(s.action.kind)))
/* The phase labels survive, but they are labels: they no longer say who holds the file. */
ok('the chart’s phases are still on the steps',
  new Set(PRE_LEGAL_160.spine.map((s) => s.phase)).size >= 3)
ok('...without naming a clerk',
  PRE_LEGAL_160.spine.every((s) => !/clerk/i.test(s.phase ?? '')))

/*
 * AND THE TWO TRACKS REALLY HAVE COME APART, which is the consequence the firm should see rather
 * than be told about. The chart put "Day 42 · Listing Confirmed" just after Clerk 2 took over on
 * day 40. Under the rotation rule the firm asked for, Clerk 2 does not take over until day 48.
 */
const rotations = rotationSchedule('2026-09-18', 3)
const firstRotation = rotations[0]
check('the chart\u2019s four clerks need three rotations',
  rotations, ['2026-11-05', '2027-01-05', '2027-03-05'])
check('the first rotation is 5 November', firstRotation, '2026-11-05')

/*
 * AND CLERK 4 NEVER RECEIVES THE FILE, which is a consequence of the correction rather than a
 * fault in it — but it is not a small one and nobody would find it by reading the chart.
 *
 * The chart staffs the workflow with four clerks. Under the rotation rule the firm asked for, the
 * third rotation falls on 5 March 2027; the notice spine reaches its recommendation on 25 February
 * 2027, eight days earlier. So the file closes on Clerk 3's desk and the fourth clerk is never
 * reached. Either the spine has to run longer, or the workflow is a three-clerk workflow.
 *
 * Asserted rather than noted, so that whichever way the firm decides, the decision is recorded
 * here as a failing check rather than forgotten.
 */
const closesOn = resolved.find((r) => r.step.id === 'recommendation').on
check('the recommendation is reached on 25 February 2027', closesOn, '2027-02-25')
ok(`...before the third rotation on ${rotations[2]}, so Clerk 4 never sees the file`,
  closesOn < rotations[2])
ok('...while Clerk 3 does receive it', rotations[1] < closesOn)
const rotationDay = resolveSteps(
  [{ id: 'r', label: 'r', after: 'start', when: { kind: 'calendar_days', days: 48 }, action: { kind: 'task', title: 'x' } }],
  '2026-09-18',
)[0]
check('...which is day 48 of the file, not day 40', rotationDay.on, firstRotation)
ok('...so the listing is confirmed before the second clerk ever sees it',
  dayOf['listing-confirmed'] < 48)

/* ---------- what still has to be written ---------- */

/*
 * EVERY NOTICE THE WORKFLOW NAMES, AND WHETHER ANYBODY HAS WRITTEN IT.
 *
 * This is the reason for transcribing the chart at all. "I don't have the content yet" becomes a
 * numbered list of exactly which letters to write, each with the day it goes out and the deadline
 * already on it. The outstanding ones are COUNTED rather than failed — the wording is the
 * attorney's and it arrives when it arrives — but a template key that points at nothing is a send
 * that fails in the middle of the night, so the ones that are filled in must be real.
 */
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const seeded = new Set([...schema.matchAll(/\('([a-z0-9-]+)', '(?:sms|email|call_script)'/g)].map((m) => m[1]))
ok(`the template library has drafts in it (${seeded.size})`, seeded.size >= 18)

const notices = noticesWanted(PRE_LEGAL_160)
ok(`the workflow sends notices (${notices.length})`, notices.length >= 8)
const dangling = notices.filter((n) => n.template !== null && !seeded.has(n.template))
check('every template it names exists in the library', dangling.map((n) => n.template), [])
const outstanding = notices.filter((n) => n.template === null)
const statutoryOutstanding = outstanding.filter((n) => n.statutory)

/*
 * AND THE STATUTORY ONES ARE COUNTED SEPARATELY, because they are not the same job. A follow-up
 * offer is the firm's own words and a collector could draft it this afternoon; a section 129 is
 * the Act's and it is the attorney's to settle. Reporting one number would let five easy letters
 * hide the four that actually gate the workflow.
 */
ok(`the statutory notices are the ones that gate it (${statutoryOutstanding.length} of ${outstanding.length})`,
  statutoryOutstanding.length >= 3)
ok('the section 129 is one of them',
  notices.some((n) => n.step.id === 'demand-129' && n.statutory && n.template === null))
/* And it is described as the demand BEFORE court, not as legal action. */
ok('...and it is not described as legal action',
  /statutory demand BEFORE court/.test(PRE_LEGAL_160.spine.find((s) => s.id === 'demand-129').note ?? ''))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)

/* ---------- the spine, printed, so the firm can read it back ---------- */
console.log('\nTHE SPINE, from a handover on 18 September 2026\n')
for (const r of resolved) {
  const a = r.step.action
  const what = a.kind === 'notice'
    ? `notice (${a.channel}${a.statutory ? ', statutory' : ''}) ${a.template ?? '— NOT WRITTEN'}`
    : a.kind === 'task' ? `task: ${a.title}`
      : a.kind === 'flag' ? `flag: ${a.flag}`
        : a.kind === 'decision' ? `decision: ${a.question}`
          : `stop collection: ${a.reason}`
  console.log(`  day ${String(r.day).padStart(3)}  ${r.on}  ${r.step.label.padEnd(26)} ${what}`)
}
console.log('\nCLERK ROTATION, on its own track')
for (const [i, d] of rotations.entries()) {
  const reached = d < closesOn ? '' : '   <- after the file has already closed'
  console.log(`  clerk ${i + 2} takes it on ${d}${reached}`)
}
console.log(`
  The spine reaches its recommendation on ${closesOn}. The third rotation is ${rotations[2]}, so
  CLERK 4 IS NEVER REACHED: the file closes on Clerk 3's desk. The chart staffs this with four.
  Either the spine runs longer than 160 days, or this is a three-clerk workflow.`)
console.log(`\n${outstanding.length} notices still to be written, ${statutoryOutstanding.length} of them statutory:`)
for (const n of outstanding) {
  console.log(`  ${n.statutory ? '[statutory] ' : '            '}${n.where}/${n.step.id} — ${n.step.label}`)
}
