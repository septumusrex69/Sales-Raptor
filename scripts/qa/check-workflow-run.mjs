/**
 * A FILE GOING THROUGH A WORKFLOW.
 *
 * The firm: "I'll send every letter by hand once and every SMS once. And then I want these things
 * working automatically in the workflow."
 *
 * THE ONE DECISION THIS FILE IS REALLY ABOUT: the dates are worked out ONCE, when the run starts,
 * and stored. The alternative -- a scheduler that works out each morning which steps are due --
 * needs the business-day calendar wherever that scheduler lives, which for a cron in Postgres
 * means a SECOND copy of the South African public holidays. That copy is the one that is wrong
 * about Heritage Day in the year nobody checks, on a sequence whose intervals are statutory. So
 * the calendar stays in workingDays.ts, the dates are resolved here, and the thing that wakes up
 * each morning only compares a stored date with today.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-run.mjs
 */
import { readFileSync } from 'node:fs'
import {
  EXIT_EVENTS, cancelRemaining, dueNow, holdReason, isFinished, planRun,
} from '../../src/lib/workflowRun.ts'
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

/** The firm's section 129 sequence, as it stands on staging. */
const node = (id, day, over = {}) => ({
  id, phaseId: 'p', key: id, kind: 'communication', label: id, description: null,
  day, deadlineDays: null, deadlineUnit: null, channel: 'email', templateId: 't',
  templateCompanyId: 'tc', afterMinutes: null, needsRelease: false, statutory: false,
  assignTo: null, x: null, y: null, ordinal: 0, ...over,
})
const S129 = [
  node('s129', 1, { needsRelease: true, statutory: true }),
  node('s129-sms', 1, { channel: 'sms', ordinal: 1, needsRelease: true }),
  node('reminder', 7),
  node('final', 12, { statutory: true }),
  node('final-sms', 12, { channel: 'sms', ordinal: 1 }),
  node('intention', 32),
  node('listed', 39, { needsRelease: true }),
  node('summons', 49, { needsRelease: true }),
]

/* ------------------------------------------------------------------ the dates */

/* Wednesday 23 September 2026. The 24th is Heritage Day, which the firm's calendar knows. */
const plan = planRun({ nodes: S129, dayUnit: 'business', startedOn: '2026-09-23' })

check('every step of the workflow is laid out at once', plan.length, S129.length)
check('the section 129 goes on the day the clerk starts it',
  plan.find((s) => s.nodeId === 's129')?.dueOn, '2026-09-23')
check('the reminder on business day 7', plan.find((s) => s.nodeId === 'reminder')?.dueOn, '2026-10-02')
check('the final notice on business day 12', plan.find((s) => s.nodeId === 'final')?.dueOn, '2026-10-09')
check('the intention to list on business day 32',
  plan.find((s) => s.nodeId === 'intention')?.dueOn, '2026-11-06')
check('the listing on business day 39', plan.find((s) => s.nodeId === 'listed')?.dueOn, '2026-11-17')
check('the summons on business day 49', plan.find((s) => s.nodeId === 'summons')?.dueOn, '2026-12-01')

/*
 * NOT ONE OF THEM LANDS ON A DAY THE OFFICE IS SHUT. The whole point of the unit: a statutory
 * demand dated to a Saturday is a demand nobody sent and nobody can prove they sent.
 */
ok('no step falls on a weekend or a public holiday',
  plan.every((s) => isWorkingDay(s.dueOn)))
/* And they run forwards. A sequence that doubled back would be a notice out of order. */
ok('the steps run forwards',
  plan.every((s, i) => i === 0 || plan[i - 1].dueOn <= s.dueOn))

/*
 * THE EMAIL AND THE SMS OF ONE STEP SHARE A DAY AND KEEP THEIR ORDER. The SMS says "we emailed
 * you", so an SMS ahead of its email is a message about something that has not happened.
 */
const dayTwelve = plan.filter((s) => s.dueOn === '2026-10-09').map((s) => s.nodeId)
check('the email and its SMS share a day, email first', dayTwelve, ['final', 'final-sms'])

/*
 * A CALENDAR WORKFLOW IS UNCHANGED, or every workflow drawn before the unit existed would
 * silently move. The handover is day 0 and goes the day it is triggered.
 */
const calendar = planRun({ nodes: [node('handover', 0)], dayUnit: 'calendar', startedOn: '2026-09-26' })
check('a calendar day 0 is the day it started', calendar[0].dueOn, '2026-09-26')

/* ------------------------------------------------------------------ what waits for a person */

/*
 * NOTHING IS BORN HELD, NOT EVEN THE STEPS THAT WAIT FOR A PERSON — and they used to be.
 *
 * The reasoning was that needing a person is a fact about the step, so saying it on day one lets
 * a collector read "day 39 · waits for you" beside the dates. What the firm actually saw when
 * they started their first section 129: FOUR notices "waiting on you" with a Send it now button
 * under each, the credit bureau listing dated 18 November and the intended summons dated 2
 * December — both two and a half months out. Pressing one would have told a debtor their default
 * HAS been listed before it had been.
 *
 * HELD IS A THING THAT HAPPENED, not a property of a step. Every other hold is written by the
 * runner on the morning the step comes due, out of a reason that is true that morning; the runner
 * holds these the same way on the day they fall due, so nothing is lost but the false urgency.
 */
check('nothing is held before anybody has looked at it',
  plan.filter((s) => s.state === 'held').map((s) => s.nodeId), [])
check('...every step starts pending', plan.filter((s) => s.state === 'pending').length, plan.length)
ok('...and carries no reason, because nothing has happened to it yet',
  plan.every((s) => s.note === null))
/*
 * AND THE FACT ITSELF IS NOT LOST: it lives on the NODE, which is where the library's chart reads
 * it to draw "Waits for you" on the row. A step's state is what has happened to it; the node says
 * what it is.
 */
ok('what waits for a person is still readable off the workflow',
  S129.filter((n) => n.needsRelease).length > 0)

/*
 * THE SENTENCE NAMES THE CHECK, NOT THE STATE. "Needs release" is the database talking to
 * itself; what the person needs is which facts to confirm before a statutory demand goes.
 */
const statutory = holdReason(node('x', 1, { needsRelease: true, statutory: true }))
ok('a statutory demand names the checks', /address/.test(statutory) && /dispute/.test(statutory))
ok('...and does not say "release"', !/releas/i.test(statutory))
ok('a step that asserts something says so',
  /has already happened/.test(holdReason(node('x', 1, { needsRelease: true }))))

/* ------------------------------------------------------------------ leaving */

/*
 * THE FIRM: "if there is a dispute raised or a PTP put in place, then a new workflow starts. And
 * then that one ceases."
 */
/*
 * THE THREE EVENTS THAT TAKE AN ACCOUNT OUT, and tracing is deliberately not one of them.
 *
 * The firm, reading the four back: "the contact details are wrong and the file went for tracing
 * -- no. That can just continue... sometimes we trace and even though we trace, the email address
 * was right. So it just continues going on to the right email address. The people just ignore
 * it." A trace is lodged because a NUMBER or an ADDRESS is wrong; the email the sequence runs on
 * is usually the one thing still working, and stopping for it rewards not answering.
 *
 * Asserted as the WHOLE list rather than as "tracing is absent": compared whole, this cannot pass
 * with a fourth quietly added back under another name.
 */
check('the three events that take an account out', Object.keys(EXIT_EVENTS).sort(),
  ['dispute', 'paid_in_full', 'promise'])
ok('a trace does not stop the sequence', !Object.keys(EXIT_EVENTS).includes('tracing'))
/*
 * PART PAYMENT IS NOT ONE, at the firm's own instruction: "part payment without a PTP does not
 * exit the workflow. Flag those to the collector." A debtor who pays R500 off R48,000 and then
 * hears nothing more is a debtor nobody is collecting from.
 */
ok('part payment is not an exit', !Object.keys(EXIT_EVENTS).includes('part_payment'))

const inFlight = [
  { id: 'a', state: 'sent' },
  { id: 'b', state: 'pending' },
  { id: 'c', state: 'held' },
  { id: 'd', state: 'cancelled' },
]
const leaving = cancelRemaining(inFlight, 'promise')
/*
 * A HELD STEP IS CANCELLED WITH THE REST. It has not gone, and leaving it on a collector's list
 * is how a section 129 goes out three weeks after the debtor agreed to pay.
 */
check('everything not yet sent is cancelled, held included', leaving.cancel.sort(), ['b', 'c'])
/*
 * AND WHAT WENT, STAYS. A sent step is the record of a notice a debtor received; rewriting it
 * would be rewriting the file.
 */
ok('a notice that went out is left alone', !leaving.cancel.includes('a'))
check('the run says why it stopped, in the firm\'s words',
  leaving.reason, 'A promise to pay was made')

/* ------------------------------------------------------------------ when it is over */

ok('a run with work outstanding is not finished',
  !isFinished([{ state: 'sent' }, { state: 'pending' }]))
ok('...nor one whose last step is held', !isFinished([{ state: 'sent' }, { state: 'held' }]))
/*
 * NOR ONE THAT FAILED. A failed send is not an ending -- somebody has to look at it -- and a run
 * that called itself finished would take it off every list that would have shown it.
 */
ok('...nor one whose send was refused', !isFinished([{ state: 'sent' }, { state: 'failed' }]))
ok('a run with nothing outstanding is finished',
  isFinished([{ state: 'sent' }, { state: 'cancelled' }]))
ok('an empty run is not finished, because it never ran', !isFinished([]))

/* ------------------------------------------------------------------ what the runner picks up */

const steps = [
  { id: 'past', dueOn: '2026-10-01', state: 'pending' },
  { id: 'today', dueOn: '2026-10-09', state: 'pending' },
  { id: 'future', dueOn: '2026-11-06', state: 'pending' },
  { id: 'waiting', dueOn: '2026-10-01', state: 'held' },
  { id: 'done', dueOn: '2026-10-01', state: 'sent' },
]
check('the runner takes what is due and pending', dueNow(steps, '2026-10-09').map((s) => s.id),
  ['past', 'today'])
/*
 * A HELD STEP IS NEVER PICKED UP however long it has been waiting: its day came, and what it is
 * waiting for is a person. That is the whole protection on a statutory demand.
 */
ok('...and never a held one, whatever its date',
  !dueNow(steps, '2026-12-31').some((s) => s.id === 'waiting'))
/*
 * TAKES `today` RATHER THAN READING A CLOCK, so the day that matters can be tested. A function
 * that asks the machine what day it is can only be checked on the day it is run.
 */
const source = readFileSync('src/lib/workflowRun.ts', 'utf8')
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
ok('nothing in the rule reads a clock', !/new Date\(\)|Date\.now/.test(code))
ok('...or the database', !/supabase|\.insert\(|\.update\(/.test(code))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-workflow-run: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
