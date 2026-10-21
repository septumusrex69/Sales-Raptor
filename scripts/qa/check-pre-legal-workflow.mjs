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
check('the handover notice is day 0', dayOf['handover-notice'], 0)
check('demand and section 129 is day 1', dayOf['demand-129'], 1)

/*
 * DAY 0 IS A NOTICE TO THE DEBTOR, NOT A FILE REVIEW, AND NOTHING ASKS AGAIN WHETHER THE ACCOUNT
 * IS COLLECTABLE.
 *
 * The chart opened with "Validate File" and a "Collectable?" decision with a No branch back to
 * the client. The firm took both out: "we don't upload files that are not collectible". A step
 * every single file passes is a step nobody reads, and one that nobody reads is worse than none
 * because it looks like a control.
 *
 * Asserted as an absence, because this is the kind of thing that comes back — somebody reading
 * the original chart will put it in again.
 */
ok('the first step sends the debtor something',
  PRE_LEGAL_160.spine[0].action.kind === 'notice')
check('nothing on the spine asks whether the file is collectable',
  PRE_LEGAL_160.spine.filter((s) => /collectab|validate/i.test(`${s.id} ${s.label}`)).map((s) => s.id), [])
/* And no branch is left dangling where that decision used to send files. */
ok('no branch is left for the answer it no longer asks',
  !PRE_LEGAL_160.branches.some((b) => /return to client|not collectable/i.test(b.name)))
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

/* ---------- a deadline is not a delay ---------- */

/*
 * THE DEBTOR'S PERIOD RUNS FROM THE DAY THE STEP ACTUALLY HAPPENED, not from its nominal day.
 *
 * A notice that would have gone out on the Saturday and goes out on the Monday gives its seven
 * days from the MONDAY — the debtor cannot be held to a clock that started before they were
 * written to. And the deadline itself never moves off a weekend: their clock does not stop
 * because the office is shut.
 *
 * BUILT HERE RATHER THAN READ OFF THE SCREEN, because no step in the firm's workflow currently
 * does both — every step that moves off a weekend is a job for a person, and none of those give
 * the debtor a period. So the browser check cannot see this distinction at all, and asserting it
 * there would have been a check that passes whichever way the code goes. Found by break-testing:
 * counting the deadline off the nominal date left the browser check green.
 */
const moved = resolveSteps([{
  id: 'weekend-notice',
  label: 'A notice that lands on a Saturday',
  after: 'start',
  /* 19 September 2026 is a Saturday. */
  when: { kind: 'calendar_days', days: 1 },
  onNonWorkingDay: 'forward',
  deadline: { kind: 'calendar_days', days: 7 },
  action: { kind: 'notice', template: null, channel: 'post' },
}], '2026-09-18')[0]
check('the step itself moves to the Monday', moved.on, '2026-09-21')
check('...while its day number stays where it was', moved.nominal, '2026-09-18'.slice(0, 8) + '19')
check('...and the debtor’s seven days run from the Monday, not the Saturday',
  moved.deadline, '2026-09-28')
/* A deadline that fell on a weekend would stay there: the debtor's clock does not stop. */
const weekendDeadline = resolveSteps([{
  id: 'ends-on-a-sunday',
  label: 'Ends on a Sunday',
  after: 'start',
  when: { kind: 'calendar_days', days: 0 },
  deadline: { kind: 'calendar_days', days: 2 },
  action: { kind: 'notice', template: null, channel: 'email' },
}], '2026-09-18')[0]
check('a deadline landing on a Sunday stays on the Sunday', weekendDeadline.deadline, '2026-09-20')
/* And a step with no period says so rather than inventing one. */
check('a step that gives no period has no deadline',
  resolveSteps(PRE_LEGAL_160.spine, '2026-09-18')
    .find((r) => r.step.id === 'handover-notice').deadline, null)
/* The two the firm's own workflow does give. */
check('the final notice gives seven days',
  resolved.find((r) => r.step.id === 'final-notice').deadline, '2026-10-30')
check('...and the intention to list gives twenty business days',
  resolved.find((r) => r.step.id === 'intention-to-list').deadline, '2026-10-26')

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

/* ---------- the definition and the stored workflow are two copies now ---------- */

/*
 * AND TWO COPIES OF A PROCESS DRIFT. That is not a theory here: the stored workflow spent months
 * as the mockup's day 1 to 80 version, with "Rotate to Clerk 2" still a spine step, while this
 * file held the corrected one — and the two disagreed in exactly the places the firm had
 * corrected. Nothing said so, because nothing compared them.
 *
 * THEY CANNOT BE MADE ONE. This file is the SPECIFICATION and says things workflow_nodes cannot:
 * relative timing ("20 business days after the intention to list"), steps that move off a
 * weekend, and the five branch exits. The database holds the EDITABLE copy, which is what the
 * builder reads and what a run will read. So the guard is not "they are identical" — it is that
 * the same steps exist in both, on the same days, which is the part that can silently diverge.
 *
 * Read out of schema.sql rather than out of the database, like check-select-columns.mjs: the
 * checks run with no network and no credentials, and schema.sql is the checked-in record.
 */
const seedBlock = schema.slice(schema.indexOf('THE STORED WORKFLOW WAS AN EARLIER TRANSCRIPTION'))
ok('the migration that seeds the workflow is in schema.sql', seedBlock.length > 0)

/* (v, p_x, 'step-key', 'kind', 'Label', ..., <day>, ... */
const storedDays = Object.fromEntries(
  [...seedBlock.matchAll(/\(v, p_\w+, '([a-z0-9-]+)', '\w+', '[^']*', (?:'(?:[^']|'')*'|null), (\d+),/g)]
    .map((m) => [m[1], Number(m[2])]))
ok(`the migration writes the spine (${Object.keys(storedDays).length} steps)`,
  Object.keys(storedDays).length >= 14)

/*
 * EVERY STEP IN THE SPECIFICATION IS STORED. Asserted as the missing LIST rather than as a count,
 * so a failure names the step somebody forgot rather than saying 14 is not 13.
 */
check('every step of the definition is in the stored workflow',
  PRE_LEGAL_160.spine.map((s) => s.id).filter((id) => !(id in storedDays)), [])
/* And nothing is stored that the definition no longer has -- which is how the rotations survived
   in the database for months after the firm took them off the chart. */
check('...and nothing is stored that the definition dropped',
  Object.keys(storedDays).filter((k) => !PRE_LEGAL_160.spine.some((s) => s.id === k)), [])

/*
 * ON THE SAME DAYS, with one known exception recorded rather than excused. "Listing confirmed" is
 * twenty BUSINESS days after the intention to list; workflow_nodes.day is an absolute calendar
 * day, so the stored 42 is that sum in an ordinary month while the definition resolves it to 38
 * from a September handover. The rule itself is not lost -- it is the 20 business days on the
 * intention step -- but the two numbers will not match and must not be asserted equal.
 */
const RELATIVE = new Set(['listing-confirmed'])
const disagree = PRE_LEGAL_160.spine
  .filter((s) => !RELATIVE.has(s.id) && s.id in storedDays && storedDays[s.id] !== dayOf[s.id])
  .map((s) => `${s.id}: definition ${dayOf[s.id]}, stored ${storedDays[s.id]}`)
check('the stored days are the definition\u2019s days', disagree, [])
/* The exception is real, not a hole: the two genuinely differ, and if they ever stop differing
   the list above should shrink rather than this line quietly guarding nothing. */
ok(`...except the one the schema cannot express (stored ${storedDays['listing-confirmed']}, `
  + `resolves to ${dayOf['listing-confirmed']})`,
  storedDays['listing-confirmed'] !== dayOf['listing-confirmed'])

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
