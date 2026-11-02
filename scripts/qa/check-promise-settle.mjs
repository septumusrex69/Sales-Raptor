/**
 * KEPT OR MISSED BY THE MORNING RUN (request #17, Raptor H16).
 *
 * The call centre pressed Kept or Payment missed on forty accounts a day. Stephan, 2 Nov: kept when approved
 * money covers the promise; missed two working days after it was due. A miss sends a charged notice of default,
 * so the cases that matter most here are the ones where it must NOT fire.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-promise-settle.mjs
 */
import { readFileSync } from 'node:fs'
import { settlePromise, GRACE_WORKING_DAYS, SETTLED_BY_RAPTOR_FROM } from '../../src/lib/promiseSettle.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)

const P = (x = {}) => ({ id: 'p', accountId: 'a', status: 'open', amount: 1000, dueOn: '2026-11-10', arrangement: 'once_off',
  dayOfMonth: null, onLastDay: false, dayOfWeek: null, instalmentsKept: 0, createdAt: '2026-11-02T10:00:00Z', countedAfter: null, ...x })
const pay = (id, amount, receivedAt, x = {}) => ({ id, amount, receivedAt, approved: true, undone: false, ...x })
const act = (s) => s.action

check('the grace is two working days, as Stephan chose', GRACE_WORKING_DAYS, 2)

/* ---------- kept ---------- */
const k = settlePromise(P(), [pay('x1', 1000, '2026-11-09T00:00:00+02:00')], '2026-11-09')
check('approved money covering a once-off keeps it, the day it is seen', [k.action, k.finished, k.paymentId, k.paid], ['keep', true, 'x1', 1000])
check('...two payments together keep it', act(settlePromise(P(), [pay('x1', 400, '2026-11-05T00:00:00+02:00'), pay('x2', 600, '2026-11-08T00:00:00+02:00')], '2026-11-09')), 'keep')
check('a payment dated midnight on the day the promise was made counts (bank lines are dated to the day)',
  act(settlePromise(P(), [pay('x1', 1000, '2026-11-02T00:00:00+02:00')], '2026-11-03')), 'keep')
check('...one the day before does not', act(settlePromise(P(), [pay('x1', 1000, '2026-11-01T23:00:00+02:00')], '2026-11-03')), 'wait')

/* ---------- waiting money never sends a notice ---------- */
check('money still waiting for approval does not KEEP it', act(settlePromise(P(), [pay('x1', 1000, '2026-11-09T00:00:00+02:00', { approved: false })], '2026-11-09')), 'wait')
check('...and does not MISS it either, however late', act(settlePromise(P(), [pay('x1', 1000, '2026-11-09T00:00:00+02:00', { approved: false })], '2026-11-30')), 'wait')
check('a rejected or reversed payment is not money paid', act(settlePromise(P(), [pay('x1', 1000, '2026-11-09T00:00:00+02:00', { undone: true })], '2026-11-13')), 'miss')

/* ---------- missed, and exactly when ---------- */
check('due Tuesday 10 Nov: nothing missed on the Thursday, the last day of grace', act(settlePromise(P(), [], '2026-11-12')), 'wait')
const m = settlePromise(P(), [pay('x1', 600, '2026-11-09T00:00:00+02:00')], '2026-11-13')
check('...missed on the Friday, and a part payment is not kept', [m.action, m.seen, m.graceEnded], ['miss', 600, '2026-11-12'])
check('Christmas and the weekend are not grace days used up (due Thu 24 Dec: grace ends Tue 29 Dec)',
  [act(settlePromise(P({ dueOn: '2026-12-24' }), [], '2026-12-29')), act(settlePromise(P({ dueOn: '2026-12-24' }), [], '2026-12-30'))], ['wait', 'miss'])
check(`a promise due before ${SETTLED_BY_RAPTOR_FROM} is left to a person, even long unpaid`,
  act(settlePromise(P({ dueOn: '2026-10-20', createdAt: '2026-10-01T10:00:00Z' }), [], '2026-11-20')), 'wait')

/* ---------- an arrangement ---------- */
const mo = P({ arrangement: 'monthly', amount: 500, dueOn: '2026-11-25', dayOfMonth: 25 })
const three = settlePromise(mo, [pay('x1', 1500, '2026-11-20T00:00:00+02:00')], '2026-11-20')
check('three months paid at once keeps three instalments and moves the date three months', [three.action, three.instalments, three.finished, three.nextDueOn], ['keep', 3, false, '2027-02-25'])
check('...and the payment used is where the next instalment starts counting', three.countedAfter, '2026-11-20T00:00:00+02:00')
check('a payment already counted does not keep the next instalment too',
  act(settlePromise({ ...mo, dueOn: '2026-12-25', countedAfter: '2026-11-20T00:00:00+02:00' }, [pay('x1', 500, '2026-11-20T00:00:00+02:00')], '2026-12-31')), 'miss')

/* ---------- already in default ---------- */
const d = P({ status: 'defaulted' })
check('money inside the 48 hours keeps a defaulted promise', act(settlePromise(d, [pay('x1', 1000, '2026-11-13T00:00:00+02:00')], '2026-11-14')), 'keep')
check('...and without money it is left to the 48 hours, never missed twice', act(settlePromise(d, [], '2026-11-30')), 'wait')

/* ---------- the morning run uses it, in the right place ---------- */
const run = readFileSync(new URL('../../api/_lib/workflow/run.ts', import.meta.url), 'utf8')
const settleAt = run.indexOf('await settleDuePromises(')
const expireAt = run.indexOf('await expireDefaultedPromises(')
ok('the sweep settles promises and ends the 48 hours', settleAt >= 0 && expireAt >= 0)
ok('...settling first, so money inside the window revives it before the window is checked', settleAt < expireAt)
const api = readFileSync(new URL('../../api/_lib/workflow/promises.ts', import.meta.url), 'utf8')
ok('every write is guarded on the status and due date it read (a clerk who pressed first wins)',
  /\.eq\('status', p\.status\)\s*\.eq\('due_on', p\.dueOn\)/.test(api))
ok('...and every move leaves a note on the account saying why', /from\('account_notes'\)\.insert\(\{ account_id: p\.accountId, body: note, source: 'system', author_name: 'Raptor' \}\)/.test(api))

console.log(`\ncheck-promise-settle: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
