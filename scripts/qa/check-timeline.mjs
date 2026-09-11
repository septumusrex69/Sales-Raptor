/**
 * Check the timeline's ordering, and what it hides.
 *
 * Ordering is the part of a timeline that looks right when it is wrong. Two rules fight here and
 * both are real: within one day the newest thing goes on top, AND most of the imported book has
 * no time of day at all -- every one of the 1,070 migrated payments is stamped midnight, and so
 * are 59,158 of the 59,215 fees. So the clock decides where it can, and a fixed rank per kind
 * decides where it cannot, or the page reshuffles itself between two loads.
 *
 *   node --experimental-strip-types scripts/qa/check-timeline.mjs
 */
import { buildTimeline, filterTimeline, groupByDay } from '../../src/lib/accountTimeline.ts'
import { styleFor } from '../../src/pages/accounts/timelineStyle.ts'

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && detail) console.log(`        ${detail}`)
}

const ledgers = {
  // Midnight, which is what a migrated date becomes in a timestamptz column. The 04-05 payment
  // is date-only, the shorter form the ledger also yields — both must behave the same way.
  payments: [
    { id: 'p1', receivedAt: '2026-08-05T00:00:00+00:00', amount: 1500, method: 'Direct', reference: 'EFT 1', details: null, paidToClient: false, reversedAt: null },
    { id: 'p2', receivedAt: '2026-04-05', amount: 1500, method: 'Direct', reference: 'EFT 2', details: null, paidToClient: false, reversedAt: '2026-04-12' },
  ],
  fees: [
    { id: 'f1', incurredAt: '2026-08-05T00:00:00+00:00', description: 'Letter of Demand', amountExclVat: 96, vatAmount: 14.4, billed: true, actionCode: 'LOD', segments: 1, cancelledAt: null, performedBy: 'Amanda' },
    { id: 'f2', incurredAt: '2026-08-05T00:00:00+00:00', description: 'SMS', amountExclVat: 0, vatAmount: 0, billed: false, actionCode: 'SMS', segments: 1, cancelledAt: null, performedBy: 'Amanda' },
  ],
  accruals: [{ id: 'i1', accruedOn: '2026-08-05', days: 30, amountAccrued: 370, amountRecoverable: 370 }],
  totals: { paid: 0, feesExclVat: 0, feesInclVat: 0, interest: 0, feeCount: 2 },
}

const notes = [
  { id: 'n1', accountId: 'a', body: 'Spoke to debtor.', pinned: false, authorName: 'Amanda', createdBy: null, createdAt: '2026-08-05T09:12:00Z', source: 'manual' },
]
const promises = [
  { id: 'pr1', accountId: 'a', amount: 5000, dueOn: '2026-09-07', method: 'EFT', status: 'open', resolvedAt: null, notes: null, createdBy: null, createdAt: '2026-08-05T09:12:00Z' },
]

const t = buildTimeline(ledgers, notes, promises)

/* Within a day, the clock wins. Anything with a real time sits above the midnight pile. */
{
  const day = t.filter((e) => e.date === '2026-08-05')
  check('a timed event leads a day that also holds untimed ones',
    day[0]?.at === '2026-08-05T09:12:00Z', `got ${day[0]?.at}`)
  check('the untimed rows fall to the bottom of their day, in rank order',
    day.map((e) => e.kind).join(',') === 'promise,note,payment,action,action',
    `got ${day.map((e) => e.kind).join(',')}`)
  check('and money still leads the rows nobody recorded a time on',
    day.slice(2)[0]?.kind === 'payment', `got ${day.slice(2).map((e) => e.kind).join(',')}`)
}

/*
 * The complaint this was rewritten for: a dispute closed in the afternoon sat underneath a
 * promise taken that morning, because the kind rank beat the clock.
 */
{
  const sameDay = buildTimeline(
    { payments: [], fees: [], accruals: [], totals: { paid: 0, feesExclVat: 0, feesInclVat: 0, interest: 0, feeCount: 0 } },
    [{ id: 'q1', accountId: 'a', body: 'Query closed — valid', pinned: false, authorName: 'Stephan', createdBy: null, createdAt: '2026-09-10T15:12:00Z', kind: 'query', source: 'manual' }],
    [{ id: 'pr9', accountId: 'a', amount: 500, dueOn: '2026-10-01', method: null, status: 'open', resolvedAt: null, notes: null, createdBy: null, createdAt: '2026-09-10T09:30:00Z' }],
  )
  check('a dispute closed at 15:12 sits above a promise taken at 09:30',
    sameDay.map((e) => e.id).join(',') === 'note:q1,promise:pr9',
    `got ${sameDay.map((e) => e.id).join(',')}`)
}

/* Two identical midnight rows must not swap places between loads. */
{
  const twice = [0, 1].map(() => buildTimeline(ledgers, notes, promises).map((e) => e.id).join(','))
  check('the order is stable across builds', twice[0] === twice[1])
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

/*
 * What hides, and what never does.
 *
 * The firm's split: "all of the actions, and then you can just hide the automated actions ... so
 * it only shows the writings, the comments, that type of important stuff."
 */
{
  check('a fee line is automatic', t.filter((e) => e.kind === 'action').every((e) => e.automated))
  check('a payment is not', t.filter((e) => e.kind === 'payment').every((e) => !e.automated))
  check('a promise is not', t.filter((e) => e.kind === 'promise').every((e) => !e.automated))
  check('a note somebody typed is not', t.find((e) => e.id === 'note:n1')?.automated === false)

  const written = buildTimeline(
    { payments: [], fees: [], accruals: [], totals: { paid: 0, feesExclVat: 0, feesInclVat: 0, interest: 0, feeCount: 0 } },
    [
      { id: 's1', accountId: 'a', body: 'Trace done — 4 credit bureau searches. Charged R64,00 plus VAT under item 4(c).', pinned: false, authorName: 'Stephan', createdBy: null, createdAt: '2026-09-10T10:00:00Z', source: 'system' },
      { id: 'h1', accountId: 'a', body: 'Trace done, nothing came back. Will try the sister.', pinned: false, authorName: 'Stephan', createdBy: null, createdAt: '2026-09-10T10:01:00Z', source: 'manual' },
      { id: 'i1', accountId: 'a', body: 'Debtor says he paid the branch.', pinned: false, authorName: 'Old system', createdBy: null, createdAt: '2026-09-10T10:02:00Z', source: 'swordfish' },
    ],
    [],
  )
  check('a note Raptor composed is automatic', written.find((e) => e.id === 'note:s1')?.automated === true)
  // The reason this is read off the row instead of matched against the body.
  check('a person writing like the app is still a person',
    written.find((e) => e.id === 'note:h1')?.automated === false)
  check('an imported comment is a person’s writing too',
    written.find((e) => e.id === 'note:i1')?.automated === false)

  check('showing everything hides nothing', filterTimeline(t, true).length === t.length)
  const people = filterTimeline(t, false)
  check('hiding the automatic drops the fee lines', people.every((e) => e.kind !== 'action'))
  check('...and keeps the payment, the promise and the note',
    people.map((e) => e.kind).sort().join(',') === 'note,payment,payment,promise',
    `got ${people.map((e) => e.kind).sort().join(',')}`)
  check('filtering never reorders what survives',
    people.map((e) => e.id).join(',') === t.filter((e) => !e.automated).map((e) => e.id).join(','))
}

/*
 * Icons and colour.
 *
 * A timeline whose rows all look the same is the thing this styling exists to prevent, and it is
 * exactly what a careless edit reverts it to. These pin the two properties that matter: a
 * channel is distinguishable from the other channels, and unbilled work recedes.
 */
{
  const at = '2026-08-05'
  const row = (title, actionCode, free = false) =>
    ({ id: title, kind: 'action', date: at, at, title, actionCode, free })

  const channels = ['phone_call', 'sms', 'whatsapp', 'email_out', 'email_in', 'letter', 'trace']
  const styles = channels.map((c) => styleFor(row(c, c)))
  check('every channel has an icon', styles.every((s) => typeof s.icon === 'function' || typeof s.icon === 'object'))
  check('a call, a letter and a payment do not share a colour',
    new Set([styleFor(row('c', 'phone_call')).ring, styleFor(row('l', 'letter')).ring,
      styleFor({ id: 'p', kind: 'payment', date: at, at, title: 'Payment received', amount: 1 }).ring]).size === 3)
  check('at least four distinct colours across the channels',
    new Set(styles.map((s) => s.ring)).size >= 4,
    `got ${new Set(styles.map((s) => s.ring)).size}`)
  check('no channel falls back to a stock Tailwind hue',
    styles.every((s) => !/emerald|amber|rose|indigo|violet|sky/.test(`${s.ring} ${s.fg}`)),
    'the palette is navy, gold, positive and negative')
  check('unbilled work recedes', styleFor(row('SMS', 'sms', true)).fg !== styleFor(row('SMS', 'sms')).fg)
  check('unbilled work keeps its own icon', styleFor(row('SMS', 'sms', true)).icon === styleFor(row('SMS', 'sms')).icon)
  check('an unmapped legacy name still gets a channel by its wording',
    styleFor(row('Outbound Telephone Call', null)).ring === styleFor(row('x', 'phone_call')).ring)
}

console.log(failed === 0 ? '\nAll checks passed.\n' : `\n${failed} check(s) failed.\n`)
process.exit(failed ? 1 : 0)
