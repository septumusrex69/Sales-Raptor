/**
 * EVERY TICKET'S CLOCK (S14, Raptor H13). Office hours (08:00-16:30, working days), time with us and the
 * whole time open, first response, and each person's averages. See src/lib/ticketClock.ts.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-ticket-clock.mjs
 */
import { formatWorkingTime, statsByOwner, ticketTimes, workingMinutes, WORKING_DAY_MINUTES } from '../../src/lib/ticketClock.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
/* Johannesburg wall-clock times, written as UTC (two hours earlier). */
const sast = (d, hm) => { const [h, m] = hm.split(':').map(Number); return new Date(Date.parse(`${d}T00:00:00Z`) + ((h - 2) * 60 + m) * 60_000).toISOString() }

check('a working day is eight and a half hours', WORKING_DAY_MINUTES, 510)
check('inside office hours, minute for minute', workingMinutes(sast('2026-10-27', '09:00'), sast('2026-10-27', '10:30')), 90)
check('before opening and after closing do not count', workingMinutes(sast('2026-10-27', '06:00'), sast('2026-10-27', '19:00')), 510)
check('four on a Friday to nine on Monday is ninety minutes, not three days',
  workingMinutes(sast('2026-10-23', '16:00'), sast('2026-10-26', '09:00')), 90)
check('a public holiday is a day off (Christmas, 25 Dec 2026, a Friday)', workingMinutes(sast('2026-12-24', '16:00'), sast('2026-12-28', '08:30')), 60)
check('backwards is nothing', workingMinutes(sast('2026-10-27', '10:00'), sast('2026-10-27', '09:00')), 0)

/* Raised Mon 09:00; to the client Mon 12:00; back from the client Wed 12:00; resolved Thu 12:00. */
const t = ticketTimes({
  raisedAt: sast('2026-10-26', '09:00'), closedAt: sast('2026-10-29', '12:00'),
  stages: [
    { stage: 'liaison', status: 'open', at: sast('2026-10-26', '09:00') },
    { stage: 'client', status: 'open', at: sast('2026-10-26', '12:00') },
    { stage: 'liaison', status: 'open', at: sast('2026-10-28', '12:00') },
    { stage: 'liaison', status: 'closed', at: sast('2026-10-29', '12:00') },
  ],
  firstReplyAt: sast('2026-10-26', '11:00'),
}, sast('2026-10-30', '09:00'))
check('the whole time open, in office time', t.open, 3 * 510 + 180)
check('...the time the client had it', t.withClient, 2 * 510)
check('...and the time it sat with us', t.withUs, 510 + 180)
check('...first response: the first email, two hours in', t.firstResponse, 120)
check('...resolved', t.resolved, true)
const open = ticketTimes({ raisedAt: sast('2026-10-27', '09:00'), closedAt: null, stages: [{ stage: 'agent', status: 'open', at: sast('2026-10-27', '09:00') }] }, sast('2026-10-27', '11:00'))
check('an open ticket runs to now, and nothing has answered it yet', [open.open, open.withUs, open.firstResponse, open.resolved], [120, 120, null, false])
const noHistory = ticketTimes({ raisedAt: sast('2026-10-27', '09:00'), closedAt: sast('2026-10-27', '10:00'), stages: [] }, sast('2026-10-28', '09:00'))
check('no history is one stretch with us', [noHistory.open, noHistory.withUs, noHistory.withClient], [60, 60, 0])

check('times read in working days and hours', [formatWorkingTime(15), formatWorkingTime(200), formatWorkingTime(510), formatWorkingTime(510 + 125), formatWorkingTime(null)],
  ['15 min', '3 h 20 min', '1 d', '1 d 2 h', '—'])

const done = (fr, us, op) => ({ firstResponse: fr, withUs: us, withClient: op - us, open: op, resolved: true })
const stats = statsByOwner([
  { ownerId: 'nicole', times: done(60, 300, 900) },
  { ownerId: 'nicole', times: done(120, 500, 600) },
  { ownerId: 'nicole', times: { ...done(null, 50, 50), resolved: false } },
  { ownerId: 'bongi', times: done(30, 30, 30) },
  { ownerId: null, times: done(1, 1, 1) },
])
check('each person: resolved, still open, and the averages over the resolved ones', stats,
  [{ ownerId: 'nicole', resolved: 2, open: 1, avgFirstResponse: 90, avgWithUs: 400, avgOpen: 750 },
   { ownerId: 'bongi', resolved: 1, open: 0, avgFirstResponse: 30, avgWithUs: 30, avgOpen: 30 }])

if (failures.length) {
  console.log(`check-ticket-clock: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-ticket-clock: ${pass} passed, 0 failed`)
