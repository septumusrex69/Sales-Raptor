/**
 * A STEP CAN BE ABOUT AN INSTALMENT RATHER THAN ABOUT THE RUN.
 *
 * THE FIRM, READING THE ARRANGEMENT SEQUENCE BACK: "it says that the payment, the PTP workflow is
 * only one step. What about the reminder before, two days before, the reminder on the date?"
 *
 * THEY WERE RIGHT AND THE REASON WAS ONE MISSING COLUMN. `workflow_nodes.day` is an absolute day
 * counted from the day the run started, which is exactly what a section 129 needs -- every date in
 * that sequence is measured from the demand. An arrangement is the other shape: the confirmation is
 * dated from the run, and the reminder, the day-of message, the receipt and the notice of default
 * are dated from EACH INSTALMENT. A day number counted off the run can name one date, and a
 * three-instalment arrangement needs the reminder on three of them -- so the sequence shipped with
 * the one step a run-anchored number could honestly express.
 *
 * WHAT THIS HOLDS, in the order it matters:
 *
 *   - the arithmetic, which is NOT landsOn's and must not become it: there is no press here and no
 *     1-based day one, only a signed distance from a date the debtor chose;
 *   - the planner writing one step per instalment, and none at all where there is no arrangement;
 *   - the four places that pair an SMS with its email, which used to key on the date alone -- on a
 *     weekly arrangement two different instalments' steps share a date;
 *   - and the copy in workflow_take_draft, which CLAUDE.md records has dropped a column three
 *     times.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-instalment-anchor.mjs
 */
import { readFileSync } from 'node:fs'
import { landsOn, landsOnInstalment, anchorBadge, anchorPhrase } from '../../src/lib/workflowBuilder.ts'
import { planRun, PLANNED_INSTALMENTS } from '../../src/lib/workflowRun.ts'
import { noticesOf, leadOf } from '../../src/lib/stepPairs.ts'
import { stepName } from '../../src/lib/runSteps.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const schema = read('../../supabase/schema.sql')
const plan = read('../../api/_lib/workflow/plan.ts')
const step = read('../../api/_lib/workflow/step.ts')
const release = read('../../api/_lib/workflow/release.ts')
const store = read('../../src/lib/accountRun.ts')
const pairs = read('../../src/lib/stepPairs.ts')
const chart = read('../../src/components/workflows/WorkflowSchedule.tsx')

/* ------------------------------------------------ the arithmetic */

/*
 * ZERO IS THE INSTALMENT DAY AND IS NEVER NORMALISED, not even off a Saturday. The message due
 * then says "your payment of R2 500 is due today"; moved onto the Monday it says "today" two days
 * after the day. The debtor's clock does not stop when the office shuts, which is the same rule
 * deadline_unit exists for -- and an instalment date is the debtor's.
 *
 * 2026-03-07 is a Saturday.
 */
check('on the day is the day', landsOnInstalment('2026-03-07', 0, 'business'), '2026-03-07')
check('...in calendar days too', landsOnInstalment('2026-03-07', 0, 'calendar'), '2026-03-07')

/*
 * TWO WORKING DAYS BEFORE WALKS BACK OVER THE WEEKEND. Monday 2026-03-09 less two working days is
 * Thursday 2026-03-05, not Saturday the 7th -- which is what a calendar-day offset would give and
 * what the firm did NOT ask for ("this is all working days, not normal days").
 */
check('two working days before a Monday', landsOnInstalment('2026-03-09', -2, 'business'), '2026-03-05')
check('...where calendar days would land on the Saturday',
  landsOnInstalment('2026-03-09', -2, 'calendar'), '2026-03-07')
/* AND FORWARD IS A DIFFERENT WALK, because working days are not symmetric and addWorkingDays'
   own contract floors at zero -- there is no arithmetic that gets backwards by adding a negative. */
check('three working days after a Thursday', landsOnInstalment('2026-03-05', 3, 'business'), '2026-03-10')
check('...and calendar days just add', landsOnInstalment('2026-03-05', 3, 'calendar'), '2026-03-08')

/*
 * IT IS NOT landsOn AND MUST NOT BECOME IT. landsOn is the firm's own chart number: 1-based and
 * inclusive on a business sequence, because day 1 is the press. Passed an instalment offset it
 * would clamp -2 to the start date and read 0 as the same day as 1 -- so the reminder would go out
 * ON the instalment and the check would still pass on every positive number.
 */
ok('the two are different functions',
  landsOn('2026-03-09', -2, 'business') !== landsOnInstalment('2026-03-09', -2, 'business'))
ok('...and landsOn clamps where this does not',
  landsOn('2026-03-09', -2, 'business') === '2026-03-09')

/* ------------------------------------------------ how it reads on the chart */

/*
 * "EACH PAYMENT", NEVER A DAY NUMBER, because there is no single day to print. A badge reading
 * "Day 0" beside an arrangement reminder describes how the row is stored instead of answering what
 * the reader asked -- CLAUDE.md's first rule -- and it is also false on two of three instalments.
 */
check('the badge says which clock', anchorBadge({ anchor: 'instalment' }), 'Each payment')
check('...and says nothing on an ordinary step', anchorBadge({ anchor: 'run' }), null)
/* THE OFFSET IN THE FIRM'S OWN WORDS. "payment" rather than "instalment" is the word they use
   when they are talking to the debtor about it. */
check('two working days before, as a sentence',
  anchorPhrase({ anchor: 'instalment', anchorOffset: -2, anchorUnit: 'business' }),
  '2 working days before each payment')
check('...three after', anchorPhrase({ anchor: 'instalment', anchorOffset: 3, anchorUnit: 'business' }),
  '3 working days after each payment')
check('...one, singular', anchorPhrase({ anchor: 'instalment', anchorOffset: -1, anchorUnit: 'calendar' }),
  '1 day before each payment')
/* ON THE DAY, not "0 days before" -- which reads as a step somebody forgot to fill in. */
check('...and on the day says so',
  anchorPhrase({ anchor: 'instalment', anchorOffset: 0, anchorUnit: 'business' }),
  'on the day of each payment')
check('...nothing on a run-anchored step',
  anchorPhrase({ anchor: 'run', anchorOffset: null, anchorUnit: null }), null)
/* AND THE DATE COLUMN DRAWS A DASH rather than landsOn(from, node.day), which on such a node is
   the day the run STARTED -- `day` there is a position on the chart, not a date. */
ok('the chart draws no single date for one',
  /node\.anchor === 'instalment' \? '\\u2014' : shortDate\(landsOn/.test(chart))
ok('...and the badge asks the anchor first', /anchorBadge\(node\) \?\? \(spread/.test(chart))

/* ------------------------------------------------ the planner */

const node = (over) => ({
  id: over.id, day: over.day ?? 0, ordinal: over.ordinal ?? 0,
  needsRelease: false, statutory: false,
  anchor: over.anchor ?? 'run', anchorOffset: over.anchorOffset ?? null,
  anchorUnit: over.anchorUnit ?? null,
})

/* The firm's own arrangement sequence, as the v3 draft has it: the confirmation on the day the
   arrangement is recorded, then a reminder two working days before every instalment and a message
   on the day, each of them an email with the SMS linked behind it. */
const NODES = [
  node({ id: 'conf-email', ordinal: 0 }),
  node({ id: 'conf-sms', ordinal: 1 }),
  node({ id: 'rem-email', ordinal: 2, anchor: 'instalment', anchorOffset: -2, anchorUnit: 'business' }),
  node({ id: 'rem-sms', ordinal: 3, anchor: 'instalment', anchorOffset: -2, anchorUnit: 'business' }),
  node({ id: 'due-email', ordinal: 4, anchor: 'instalment', anchorOffset: 0, anchorUnit: 'business' }),
  node({ id: 'due-sms', ordinal: 5, anchor: 'instalment', anchorOffset: 0, anchorUnit: 'business' }),
]
/* R7 500 at R2 500 on the 9th, three instalments. 2026-03-09, 2026-04-09 and 2026-05-09 are all
   working days, which keeps this fixture about the anchor rather than about the holiday table. */
const THREE = [
  { no: 1, amount: 2500, dueOn: '2026-03-09' },
  { no: 2, amount: 2500, dueOn: '2026-04-09' },
  { no: 3, amount: 2500, dueOn: '2026-05-09' },
]

const planned = planRun({ nodes: NODES, dayUnit: 'calendar', startedOn: '2026-03-02', instalments: THREE })

/*
 * FOURTEEN STEPS, NOT SIX. Two dated off the run and four per instalment -- which is the whole of
 * what the firm asked about: "only one step" was two rows on the chart and a sequence that went
 * quiet the moment it had confirmed itself.
 */
check('one step per instalment per anchored node', planned.length, 2 + 3 * 4)
check('...and the confirmation is still dated off the run',
  planned.filter((s) => s.instalmentNo === 0).length, 2)
check('...with instalment 0 on it, not null', planned.find((s) => s.nodeId === 'conf-email').instalmentNo, 0)

/* THE REMINDER IS THREE DATES, and they are the debtor's dates less two working days each. */
const remindersOn = planned.filter((s) => s.nodeId === 'rem-email').map((s) => s.dueOn)
check('the reminder lands before every instalment', remindersOn.join(' '),
  '2026-03-05 2026-04-07 2026-05-07')
check('...numbered as the firm counts them',
  planned.filter((s) => s.nodeId === 'rem-email').map((s) => s.instalmentNo).join(''), '123')
const dueOn = planned.filter((s) => s.nodeId === 'due-email').map((s) => s.dueOn)
check('the day-of message lands on the instalment', dueOn.join(' '),
  '2026-03-09 2026-04-09 2026-05-09')

/*
 * THE PAIR STAYS TOGETHER AND THE EMAIL COMES FIRST. This is the sort the firm already found the
 * cost of: an SMS drawn to the left of the notice it says it follows, and a Send it now button
 * under it that can never work. On an instalment run the ordinal is the only thing separating the
 * two -- they share a date, and `day` is no longer even a date.
 */
const order = planned.map((s) => `${s.dueOn}/${s.nodeId}`)
check('the sequence reads in date order, email before SMS', order.join('\n'), [
  '2026-03-02/conf-email', '2026-03-02/conf-sms',
  '2026-03-05/rem-email', '2026-03-05/rem-sms',
  '2026-03-09/due-email', '2026-03-09/due-sms',
  '2026-04-07/rem-email', '2026-04-07/rem-sms',
  '2026-04-09/due-email', '2026-04-09/due-sms',
  '2026-05-07/rem-email', '2026-05-07/rem-sms',
  '2026-05-09/due-email', '2026-05-09/due-sms',
].join('\n'))

/*
 * AND A STEP WHOSE DAY HAD ALREADY PASSED IS CANCELLED, NEVER SENT.
 *
 * THE FIRM FOUND THIS ON THEIR FIRST ARRANGEMENT. Agreed on the 27th with the first payment due
 * that same day: the reminder is two working days BEFORE each instalment, so it was dated the
 * 23rd -- four days before the arrangement existed. The runner sends anything overdue, so the
 * debtor got "your payment is due on 27 September", then "we confirm your arrangement", then
 * "your payment is due today", inside twelve seconds. Three emails at R25 each, and the reminder
 * arriving BEFORE the confirmation of the thing it was reminding them about.
 *
 * OVERDUE STILL SENDS EVERYWHERE ELSE and that rule is right where it applies: a final notice the
 * firm is late with is still true, because the period it describes HAS elapsed. A reminder is the
 * other shape -- "this is coming" is false the moment the day arrives.
 */
const sameDay = planRun({
  nodes: NODES, dayUnit: 'calendar', startedOn: '2026-03-09',
  /* The arrangement agreed on the 9th with the first payment due that day. */
  instalments: THREE,
})
const reminder1 = sameDay.find((s) => s.nodeId === 'rem-email' && s.instalmentNo === 1)
check('a reminder dated before the run began is cancelled', reminder1?.state, 'cancelled')
check('...and says why, in the firm’s words', reminder1?.note,
  'This date had already passed when the arrangement was agreed, so it was not sent.')
check('...its SMS with it',
  sameDay.find((s) => s.nodeId === 'rem-sms' && s.instalmentNo === 1)?.state, 'cancelled')

/*
 * AND SO IS THE MESSAGE DUE ON THE DAY THE ARRANGEMENT WAS AGREED.
 *
 * THE FIRM RULED ON THIS AFTER SEEING THE FIRST ONE: "if a payment is due today, the same day
 * arrangement, then it's not necessary to send two SMSs... in fact, you don't even have to send
 * one, because you get sent the payment arrangement confirmation letter and the SMS."
 *
 * THE DEBTOR HAS ALREADY BEEN TOLD TWICE -- in the conversation that agreed the terms, and in the
 * confirmation that put them in writing an hour later. A third message the same afternoon saying
 * the payment is due today adds nothing and costs them a segment under item 1(c).
 */
const dueToday = sameDay.find((s) => s.nodeId === 'due-email' && s.instalmentNo === 1)
check('the day-of message is cancelled on a same-day arrangement', dueToday?.state, 'cancelled')
check('...and says why, in the firm’s words', dueToday?.note,
  'The arrangement was agreed on this day and the confirmation of it said so, so this was not '
  + 'sent as well.')
check('...its SMS with it',
  sameDay.find((s) => s.nodeId === 'due-sms' && s.instalmentNo === 1)?.state, 'cancelled')
/* STILL PLANNED, NOT DROPPED. The chart carries them greyed with the reason on each; left out, a
   three-instalment arrangement would show ten steps where the version says fourteen. */
check('...but they are still on the chart', sameDay.length, 2 + 3 * 4)
/* AND NOTHING BEYOND THAT DAY IS TOUCHED. */
check('the reminder for the next instalment still goes',
  sameDay.find((s) => s.nodeId === 'rem-email' && s.instalmentNo === 2)?.state, 'pending')
check('...and the confirmation itself', sameDay.find((s) => s.nodeId === 'conf-email')?.state, 'pending')

/*
 * THE OTHER TWO CASES THE FIRM SPELLED OUT, AND THEY ARE THE SAME RULE READ A DAY AND FOUR DAYS
 * LATER. Held as whole days rather than as one boundary, because the three sentences they gave
 * are three sentences a collector will be asked about.
 */

/* "IF THE PAYMENT IS DUE TOMORROW... THE CONFIRMATION EMAIL IS ENOUGH, AND THEN ON THE NEXT DAY
   IT WILL BE REMINDED." The reminder is still in the past and goes; the day-of message is not. */
const tomorrow = planRun({
  nodes: NODES, dayUnit: 'calendar', startedOn: '2026-03-08',
  instalments: [{ no: 1, amount: 2500, dueOn: '2026-03-09' }],
})
check('an instalment due tomorrow still gets its message on the day',
  tomorrow.find((s) => s.nodeId === 'due-email')?.state, 'pending')
check('...dated the day it falls', tomorrow.find((s) => s.nodeId === 'due-email')?.dueOn, '2026-03-09')
check('...while its reminder, two working days back, is still in the past',
  tomorrow.find((s) => s.nodeId === 'rem-email')?.state, 'cancelled')
check('...leaving the confirmation as the only thing that goes today',
  tomorrow.filter((s) => s.dueOn === '2026-03-08' && s.state === 'pending').length, 2)

/* "IF THE SMS IS FOR TWO DAYS BEFORE, THEN YOU CAN SEND THE REMINDER AND THE CONFIRMATION AND
   THEN A REMINDER ON THE DAY." The ordinary arrangement: all three go. */
const roomy = planRun({
  nodes: NODES, dayUnit: 'calendar', startedOn: '2026-03-02',
  instalments: [{ no: 1, amount: 2500, dueOn: '2026-03-09' }],
})
check('an instalment a week out sends all three', roomy.filter((s) => s.state === 'pending').length, 6)
check('...the confirmation today', roomy.find((s) => s.nodeId === 'conf-email')?.dueOn, '2026-03-02')
check('...the reminder two working days before it', roomy.find((s) => s.nodeId === 'rem-email')?.dueOn, '2026-03-05')
check('...and the day-of message on the day', roomy.find((s) => s.nodeId === 'due-email')?.dueOn, '2026-03-09')
check('...with nothing cancelled at all', roomy.filter((s) => s.state === 'cancelled').length, 0)
/*
 * ONLY AN INSTALMENT STEP CAN LAND HERE, AND IT TAKES A MALFORMED NODE TO PROVE IT.
 *
 * A run-anchored day is counted from `startedOn` and cannot precede it, so on every workflow the
 * firm has drawn the `instalmentNo > 0` term never decides anything -- which is exactly why a
 * check that only walked normal data reported this guard as dead when it was deleted.
 *
 * A NEGATIVE DAY IS THE ONE CONSTRUCTION THAT REACHES IT. workflowProblems refuses one and the
 * builder floors the box at zero, but the COLUMN is a plain integer and nothing in the database
 * stops it -- so a bad row, an import or a hand-written migration can produce a step dated before
 * its own run. Without the term, that step is silently cancelled: on the section 129 that is a
 * statutory demand quietly not sent, on a chart that still shows eleven steps.
 */
const backdated = planRun({
  nodes: [node({ id: 'impossible', ordinal: 9, day: -1 }), NODES[0]],
  dayUnit: 'calendar', startedOn: '2026-03-02',
})
check('a run-anchored step really can be dated before its run',
  backdated.find((s) => s.nodeId === 'impossible')?.dueOn, '2026-03-01')
check('...and is NOT cancelled, because only an instalment date is the debtor’s',
  backdated.find((s) => s.nodeId === 'impossible')?.state, 'pending')
check('nothing dated off the run is ever cancelled this way',
  planned.filter((s) => s.instalmentNo === 0 && s.state === 'cancelled').length, 0)

/*
 * NO ARRANGEMENT IS SILENCE, NOT AN ERROR. There is no instalment to remind anybody of, and a step
 * dated off a date that does not exist would be a message quoting a blank amount. The run's own
 * steps still plan, which is what keeps the confirmation working on an account whose promise was
 * recorded and then withdrawn before the sweep reached it.
 */
const bare = planRun({ nodes: NODES, dayUnit: 'calendar', startedOn: '2026-03-02' })
check('no arrangement plans no reminders', bare.length, 2)
check('...and the confirmation still plans', bare.map((s) => s.nodeId).join(','), 'conf-email,conf-sms')

/* BOUNDED, because the steps are dated up front. Five years of monthly instalments is past
   anything the firm writes -- their own letters report more than six as SLOW PAYING. */
const many = Array.from({ length: PLANNED_INSTALMENTS + 12 }, (_, i) => ({
  no: i + 1, amount: 100, dueOn: `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
}))
check('the planner is bounded',
  planRun({ nodes: [NODES[2]], dayUnit: 'calendar', startedOn: '2026-03-02', instalments: many }).length,
  PLANNED_INSTALMENTS)
ok('...and the bound is five years of monthly instalments', PLANNED_INSTALMENTS === 60)

/* ------------------------------------------------ pairing an SMS with the right email */

/*
 * THE COLLISION THIS EXISTS FOR, and it takes a weekly arrangement to reach. The notice of default
 * three working days after instalment 1 and the reminder two working days before instalment 2 land
 * on the same Thursday. Paired on the date alone the default's SMS attaches to the reminder's
 * email -- one dot claiming to be a notice the debtor never got, the other message orphaned.
 */
const runStep = (over) => ({
  id: over.id, label: over.label ?? 'Step', channel: over.channel ?? null,
  dueOn: over.dueOn, state: 'pending', note: null, sentAt: null,
  day: 0, needsRelease: false, afterMinutes: over.afterMinutes ?? null,
  ordinal: over.ordinal ?? 0, instalmentNo: over.instalmentNo ?? 0,
})
const SAME_DAY = [
  runStep({ id: 'd1-email', dueOn: '2026-03-12', ordinal: 6, instalmentNo: 1, label: 'Notice of default' }),
  runStep({ id: 'd1-sms', dueOn: '2026-03-12', ordinal: 7, instalmentNo: 1, afterMinutes: 7 }),
  runStep({ id: 'r2-email', dueOn: '2026-03-12', ordinal: 2, instalmentNo: 2, label: 'Reminder' }),
  runStep({ id: 'r2-sms', dueOn: '2026-03-12', ordinal: 3, instalmentNo: 2, afterMinutes: 7 }),
]
const notices = noticesOf(SAME_DAY)
check('two instalments falling on one day are two notices', notices.length, 2)
check('...the default keeps its own SMS', notices[0].follower?.id, 'd1-sms')
check('...and the reminder keeps its own', notices[1].follower?.id, 'r2-sms')
check('...read the other way round too', leadOf(SAME_DAY, 'r2-sms')?.id, 'r2-email')
/* IT IS KEYED ON BOTH, and two steps of a real pair always share both -- so nothing that was
   right before is narrowed. */
ok('the pairing key carries the instalment',
  /\$\{step\.dueOn\}#\$\{step\.instalmentNo\}/.test(pairs))

/*
 * AND THE RUNNER'S OWN TWO COPIES OF THE SAME RULE. step.ts asks "did the message before this one
 * go?"; release.ts asks "what goes out with this press?". Both matched on the date alone.
 */
ok('the runner asks about the same instalment',
  /\.eq\('due_on', step\.due_on\)\s*\n\s*\.eq\('instalment_no', step\.instalment_no \?\? 0\)/.test(step))
ok('...and so does the release',
  /\.eq\('instalment_no', step\.instalment_no \?\? 0\)/.test(release))

/* ------------------------------------------------ what the collector reads */

/*
 * FOUR IDENTICAL DOTS ARE A CHART THAT LIES BY REPETITION. An arrangement of three instalments
 * plans the reminder three times, every one labelled "Reminder before the payment"; six identical
 * rows with six different dates reads as a sequence somebody has duplicated by mistake.
 */
check('a step about an instalment says which',
  stepName(runStep({ id: 'x', dueOn: '2026-03-05', label: 'Reminder before the payment', instalmentNo: 2 })),
  'Reminder before the payment · instalment 2')
check('...and one about the run says nothing extra',
  stepName(runStep({ id: 'x', dueOn: '2026-03-02', label: 'Confirmation of arrangement' })),
  'Confirmation of arrangement')
ok('the screen reads the column', /instalmentNo: s\.instalment_no \?\? 0/.test(store))
/*
 * AND THE SORT DROPPED THE DAY NUMBER, which on an instalment step is a position on the chart
 * rather than a date -- comparing it against a run-anchored node's day would interleave the
 * reminder for instalment 5 with the confirmation.
 */
ok('...and sorts on the date, the ordinal and the instalment',
  /a\.dueOn\.localeCompare\(b\.dueOn\) \|\| a\.ordinal - b\.ordinal \|\| a\.instalmentNo - b\.instalmentNo/.test(store))

/* ------------------------------------------------ the planner's own reads and writes */

ok('the planner asks for the three columns',
  /select\('id, day, ordinal, needs_release, statutory, anchor, anchor_offset, anchor_unit'\)/.test(plan))
ok('...and passes them through', /anchorOffset: \(n\.anchor_offset as number \| null\) \?\? null/.test(plan))
/* ONLY WHERE A NODE ASKS. A section 129 has no business querying the promises table to be dated. */
ok('...reading the arrangement only where a node is anchored to one',
  /if \(nodes\.some\(\(n\) => n\.anchor === 'instalment'\)\)/.test(plan))
ok('...and it is the LIVE arrangement', /instalmentSchedule\(liveArrangement\(/.test(plan))
/* AND HANDED TO THE PLANNER. Working the schedule out and then not passing it is the one
   break of this that left every other assertion here true: the dates are computed, thrown
   away, and the sequence goes quiet after the confirmation exactly as it did before. */
ok('...and handed to the planner', /startedOn: run\.started_on,\s*\n\s*instalments,/.test(plan))
ok('...written with the instalment on the row', /instalment_no: s\.instalmentNo/.test(plan))
/*
 * A PAUSE MOVES OUR DATES AND NOT THE DEBTOR'S, and this is the half that would have been silently
 * wrong. `day` on an instalment node is a chart position, so re-dating one off `started_on` does
 * not merely make it late -- it rewrites every reminder to the day the run began.
 */
ok('a hold does not move an instalment date',
  /if \(step\.workflow_nodes\?\.anchor === 'instalment'\) continue/.test(plan))
ok('...nor does the planner apply the lost days to one',
  /due_on: s\.instalmentNo === 0 \? movedOn\(s\.dueOn, lost, unit\) : s\.dueOn/.test(plan))
ok('...and the resume reads the column to know', /workflow_nodes!inner\(day, ordinal, anchor\)/.test(plan))

/* ------------------------------------------------ the database */

ok('a node says which clock it is on',
  /add column if not exists anchor text not null default 'run'/.test(schema))
/* BOTH OR NEITHER: an instalment node with no offset would be dated off a null and land nowhere. */
ok('...and an instalment node must carry an offset and a unit',
  /check \(anchor = 'run' or \(anchor_offset is not null and anchor_unit is not null\)\)/.test(schema))
ok('a step says which instalment it is about',
  /add column if not exists instalment_no integer not null default 0/.test(schema))
/*
 * THE RACE GUARD KEPT, WIDENED. (run_id, node_id) was unique and plan.ts leans on it: two planners
 * racing -- the app nudging while the cron sweeps -- are refused by the database rather than found
 * at month end. One node now legitimately makes several steps, so the instalment joins the key.
 */
ok('...and the race guard grew rather than went',
  /unique \(run_id, node_id, instalment_no\)/.test(schema))
ok('...with the old key dropped', /drop constraint if exists workflow_run_steps_run_id_node_id_key/.test(schema))

/*
 * THE COPY, READ OFF THE LAST DEFINITION -- schema.sql is append-only, so an earlier one is the
 * superseded copy, and the name also appears in this function's own grant. CLAUDE.md records that
 * workflow_take_draft has dropped a column three times; dropped here, a draft of the arrangement
 * sequence comes back with every reminder re-anchored to the run.
 */
const draftAt = schema.lastIndexOf('create or replace function public.workflow_take_draft(')
ok('the draft copier is there to read', draftAt > 0)
const draftFn = schema.slice(draftAt, schema.indexOf('$$;', draftAt) + 3)
ok('...and it copies the anchor', /ordinal, anchor, anchor_offset, anchor_unit\)/.test(draftFn))
ok('...on both sides of the insert', /o\.anchor, o\.anchor_offset, o\.anchor_unit/.test(draftFn))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-instalment-anchor: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
