/**
 * Check the timeline's ordering.
 *
 * Ordering is the part of a timeline that looks right when it is wrong. Fees and payments come
 * from date columns and carry no time of day; notes and promises carry full timestamps. Sorting
 * those together on the raw string silently sinks every payment below every note made the same
 * day, and nothing about the rendered page says so.
 *
 *   node --experimental-strip-types scripts/qa/check-timeline.mjs
 */
import { buildTimeline, groupByDay } from '../../src/lib/accountTimeline.ts'

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && detail) console.log(`        ${detail}`)
}

const ledgers = {
  // Date-only, exactly as the ledger tables store them.
  payments: [
    { id: 'p1', receivedAt: '2026-08-05', amount: 1500, method: 'Direct', reference: 'EFT 1', details: null, paidToClient: false, reversedAt: null },
    { id: 'p2', receivedAt: '2026-04-05', amount: 1500, method: 'Direct', reference: 'EFT 2', details: null, paidToClient: false, reversedAt: '2026-04-12' },
  ],
  fees: [
    { id: 'f1', incurredAt: '2026-08-05', description: 'Letter of Demand', amountExclVat: 96, vatAmount: 14.4, billed: true, actionCode: 'LOD', segments: 1, cancelledAt: null, performedBy: 'Amanda' },
    { id: 'f2', incurredAt: '2026-08-05', description: 'SMS', amountExclVat: 0, vatAmount: 0, billed: false, actionCode: 'SMS', segments: 1, cancelledAt: null, performedBy: 'Amanda' },
  ],
  accruals: [{ id: 'i1', accruedOn: '2026-08-05', days: 30, amountAccrued: 370, amountRecoverable: 370 }],
  totals: { paid: 0, feesExclVat: 0, feesInclVat: 0, interest: 0, feeCount: 2 },
}

const notes = [
  { id: 'n1', accountId: 'a', body: 'Spoke to debtor.', pinned: false, authorName: 'Amanda', createdBy: null, createdAt: '2026-08-05T09:12:00Z' },
]
const promises = [
  { id: 'pr1', accountId: 'a', amount: 5000, dueOn: '2026-09-07', method: 'EFT', status: 'open', resolvedAt: null, notes: null, createdBy: null, createdAt: '2026-08-05T09:12:00Z' },
]

const t = buildTimeline(ledgers, notes, promises)

/* The bug this file exists for: a date-only payment must not sink below a timestamped note. */
{
  const day = t.filter((e) => e.date === '2026-08-05')
  check('payment leads the day it arrived on', day[0]?.kind === 'payment', `got ${day.map((e) => e.kind).join(', ')}`)
  check('kinds are in rank order within a day',
    day.map((e) => e.kind).join(',') === 'payment,promise,action,action,note',
    `got ${day.map((e) => e.kind).join(',')}`)
}

/* Newest first, across days. */
{
  const dates = t.map((e) => e.date)
  const sorted = [...dates].sort().reverse()
  check('days run newest first', dates.join() === sorted.join(), `got ${dates.join()}`)
}

/* Interest is the Statement's business, not the timeline's -- 56 accruals would bury the story. */
check('interest accruals stay out', !t.some((e) => /interest/i.test(e.title)))

/* An unbilled action is history with no money on it. */
{
  const sms = t.find((e) => e.title === 'SMS')
  check('unbilled action carries no amount', sms?.amount == null && sms?.free === true)
  const lod = t.find((e) => e.title === 'Letter of Demand')
  check('billed action carries VAT-inclusive amount', Math.abs((lod?.amount ?? 0) - 110.4) < 0.005)
}

/* A reversed payment still appears -- it happened -- but is marked. */
check('reversed payment is kept and flagged',
  t.some((e) => e.kind === 'payment' && e.status === 'reversed'))

/* Grouping must not reorder what the sort decided. */
{
  const flat = groupByDay(t).flatMap((d) => d.entries.map((e) => e.id))
  check('grouping preserves order', flat.join() === t.map((e) => e.id).join())
  const days = groupByDay(t).map((d) => d.date)
  check('each day appears once', new Set(days).size === days.length)
}

console.log(failed === 0 ? '\nAll checks passed.\n' : `\n${failed} check(s) failed.\n`)
process.exit(failed ? 1 : 0)
