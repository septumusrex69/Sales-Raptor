/**
 * The query state machine: what is owed to the debtor today, and whether the account may be
 * worked while the clock runs.
 *
 * Run: node --experimental-strip-types scripts/qa/check-query-lifecycle.mjs
 */
import {
  canTake, collectionsHeld, deadlineFor, letterDue, reminderDateFor, senderFor,
  transitionsFor, windowLapsed,
} from '../../src/lib/queryLifecycle.ts'
import { longDate, queryLetter } from '../../src/lib/queryLetters.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n     expected ${e}\n     actual   ${a}`)
}

/* ---- the clock ---- */
// Raised Thursday 10 Sep 2026 -> due Monday 21 Sep, reminder Thursday 17 Sep.
const RAISED = '2026-09-10'
const DUE = '2026-09-21'
check('the deadline is seven working days out', deadlineFor(RAISED), DUE)
check('the reminder is two working days before it', reminderDateFor(DUE), '2026-09-17')

const fresh = { raisedOn: RAISED }
const acknowledged = { raisedOn: RAISED, acknowledgementSentOn: RAISED }

/* ---- which letter is owed ---- */
check('a new query owes an acknowledgement', letterDue(fresh, 'awaiting_written', RAISED), 'acknowledgement')
check('...only once', letterDue(acknowledged, 'awaiting_written', RAISED), null)
check('nothing is owed mid-window', letterDue(acknowledged, 'awaiting_written', '2026-09-15'), null)
check('the reminder is owed on its day', letterDue(acknowledged, 'awaiting_written', '2026-09-17'), 'reminder')
check('a missed reminder still goes out late', letterDue(acknowledged, 'awaiting_written', '2026-09-18'), 'reminder')
check('...but not once the deadline has passed', letterDue(acknowledged, 'awaiting_written', '2026-09-22'), null)
check(
  'a sent reminder is never repeated',
  letterDue({ ...acknowledged, reminderSentOn: '2026-09-17' }, 'awaiting_written', '2026-09-18'),
  null,
)
check(
  'a query received in writing owes nothing further',
  letterDue({ ...acknowledged, receivedOn: '2026-09-15' }, 'awaiting_written', '2026-09-17'),
  null,
)
check(
  'a paused query owes nothing',
  letterDue({ ...acknowledged, automationPaused: true }, 'awaiting_written', '2026-09-17'),
  null,
)
for (const state of ['received', 'with_liaison', 'with_client', 'resolved']) {
  check(`nothing automated goes out from "${state}"`, letterDue(acknowledged, state, '2026-09-17'), null)
}
// A window short enough that the reminder date falls on the day of raising: the debtor must not
// get an acknowledgement and a reminder in the same post.
check(
  'the acknowledgement and reminder never land on the same day',
  letterDue({ raisedOn: RAISED, acknowledgementSentOn: RAISED }, 'awaiting_written', RAISED),
  null,
)

/* ---- lapsing ---- */
check('the window has not lapsed on the deadline itself', windowLapsed(acknowledged, 'awaiting_written', DUE), false)
check('it has lapsed the day after', windowLapsed(acknowledged, 'awaiting_written', '2026-09-22'), true)
check(
  'a query received in time never lapses',
  windowLapsed({ ...acknowledged, receivedOn: '2026-09-15' }, 'awaiting_written', '2026-09-30'),
  false,
)
check('a paused query still lapses', windowLapsed({ ...acknowledged, automationPaused: true }, 'awaiting_written', '2026-09-22'), true)

/* ---- the collections hold ---- */
check('collections are held while the clock runs', collectionsHeld(fresh, 'awaiting_written', '2026-09-15'), true)
check('...including on the deadline itself', collectionsHeld(fresh, 'awaiting_written', DUE), true)
check('...and released the day after', collectionsHeld(fresh, 'awaiting_written', '2026-09-22'), false)
check(
  'a written query in hand releases the hold',
  collectionsHeld({ ...fresh, receivedOn: '2026-09-15' }, 'awaiting_written', '2026-09-16'),
  false,
)
for (const state of ['received', 'with_liaison', 'with_client', 'resolved']) {
  check(`"${state}" does not hold collections`, collectionsHeld(fresh, state, '2026-09-15'), false)
}

/* ---- who signs what ---- */
check('debtors hear from the pre-legal agent', senderFor('debtor'), 'query_owner')
check('clients hear from the liaison', senderFor('client'), 'client_liaison')

/* ---- the ladder ---- */
const labels = (s) => transitionsFor(s).map((t) => t.label)
check('a waiting query can only be received or resolved', labels('awaiting_written'), ['Written query received', 'Resolve'])
check('a received query escalates or resolves', labels('received'), ['Escalate to liaison', 'Resolve'])
check('the liaison can go up, back, or finish', labels('with_liaison'), ['Send to client', 'Send back to the agent', 'Resolve'])
check('a resolved query can only reopen', labels('resolved'), ['Reopen'])
for (const s of ['awaiting_written', 'received', 'with_liaison', 'with_client']) {
  check(`"${s}" can always be resolved`, labels(s).includes('Resolve'), true)
}

const toClient = transitionsFor('with_liaison').find((t) => t.to === 'with_client')
check('an agent may not write to a client', canTake(toClient, 'Sales Representative'), false)
check('a liaison may', canTake(toClient, 'Liaison'), true)
check('an administrator may', canTake(toClient, 'Administrator'), true)
check('an unrestricted step is open to anyone', canTake(transitionsFor('received')[0], 'Pre-legal Agent'), true)

/* ---- the letters ---- */
check('a date in a letter is not ISO', longDate('2026-09-21'), '21 September 2026')
const ctx = {
  debtorName: 'Mr Buitendag', accountReference: 'ACF10004', clientName: 'Tjobecom',
  queryNumber: 'Q-2026-0041', deadline: longDate(DUE), agentName: 'Stephan Bredell',
  firmName: 'Bredell Ferreira',
}
const ack = queryLetter('acknowledgement', ctx)
check('the acknowledgement carries the reference', ack.subject.includes('Q-2026-0041'), true)
check('...and the deadline in words', ack.body.includes('21 September 2026'), true)
check('...and says how many working days', ack.body.includes('seven working days'), true)
check('...and names the client', ack.body.includes('Tjobecom'), true)
check('...and is signed by the agent', ack.body.trimEnd().endsWith('Stephan Bredell\nBredell Ferreira'), true)
check('the reminder says it is one', queryLetter('reminder', ctx).subject.startsWith('Reminder:'), true)
check('the lapsed letter says the account is back in collections', queryLetter('lapsed', ctx).body.includes('returned to collections'), true)
for (const kind of ['acknowledgement', 'reminder', 'lapsed']) {
  const l = queryLetter(kind, ctx)
  check(`"${kind}" leaves no placeholder unfilled`, /\{|\}|undefined/.test(l.subject + l.body), false)
}

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  !! ${f}`)
process.exit(failures.length ? 1 : 0)
