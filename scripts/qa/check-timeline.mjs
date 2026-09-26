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
let passed = 0
function check(name, ok, detail) {
  if (ok) passed++; else failed++
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


/* ---------------------------------------------------- when the account opened, and when it came */

/*
 * THE FIRM: "on the activity timeline in a debtor, it doesn't show which date it's imported --
 * date it handed over, and imported."
 *
 * The timeline began at the first fee or the first note, so an account with neither had an empty
 * one and an account with both started in the middle of its own story.
 */
{
  const opened = buildTimeline(null, [], [], {
    handoverDate: '2026-03-18', importedAt: '2026-09-22T11:04:41Z', batchReference: 'handover 1.xlsx',
  })
  check('an account with no history still has its opening', opened.length === 1)
  const first = opened[0]
  check('...headed for what it is', first?.title === 'Handed over')
  check('...naming the day the debt fell due', /18\/03\/2026/.test(first?.detail ?? ''),
    first?.detail)
  check('...and the day it reached us', /22\/09\/2026/.test(first?.detail ?? ''), first?.detail)
  /* TWO DIFFERENT DAYS, and the entry is worthless if it conflates them: one is what interest,
     in duplum and prescription run from, the other is when the sheet arrived. */
  check('...which are not the same date', !/18\/03\/2026[\s\S]*18\/03\/2026/.test(first?.detail ?? ''))
  check('...and the batch it came in on', /handover 1\.xlsx/.test(first?.detail ?? ''), first?.detail)
  /*
   * DATED AT THE HANDOVER, not at the import. Dated at the import it would jump to the TOP of a
   * book brought across from Swordfish and bury six years of history under a row saying the
   * account exists.
   */
  check('...dated at the handover so it sits where the story starts', first?.date === '2026-03-18')
  /*
   * NOT AUTOMATED, although Raptor wrote it. That flag hides bookkeeping about actions somebody
   * else took; this is the account's first fact, and hidden it would take the answer with it.
   */
  check('...and not hidden with the automated bookkeeping', first?.automated === false)
  check('...so it survives the filter the firm asked for',
    filterTimeline(opened, { automated: false }).length === 1)
}

/* IT SITS UNDER EVERYTHING ELSE, which is the whole reason for dating it at the handover. */
{
  const withWork = buildTimeline(
    { fees: [{
      id: 'f1', incurredAt: '2026-06-01T09:00:00Z', description: 'Letter', amountExclVat: 25,
      vatAmount: 3.75, billed: true, actionCode: 'letter', segments: null, cancelledAt: null,
      performedBy: 'A Clerk',
    }], payments: [], accruals: [] },
    [], [],
    { handoverDate: '2026-03-18', importedAt: '2026-09-22T11:04:41Z' },
  )
  check('the opening is the oldest thing on the account',
    withWork[withWork.length - 1]?.id === 'opened', withWork.map((e) => e.id).join(','))
}

/*
 * NOTHING TO SAY, NOTHING SAID. An account with neither date gets no entry rather than one
 * reading "no date of default is recorded" over an empty timeline.
 *
 * CAUGHT, NOT CALLED BARE. Removing the guard does not make this return a bad entry -- it makes
 * buildTimeline THROW, on `dayOf(null)`, which kills the process before anything is printed: a
 * stack trace with no failing assertion in it. CLAUDE.md names that one, and this file earned it.
 */
const built = (...args) => { try { return buildTimeline(...args) } catch (e) { return String(e) } }
check('an account with neither date gets no opening entry',
  built(null, [], [], { handoverDate: null, importedAt: null }).length === 0,
  built(null, [], [], { handoverDate: null, importedAt: null }))
check('...and so does one that was never asked about the opening',
  buildTimeline(null, [], []).length === 0)
/* One of the two is enough: an account keyed in by hand has no import date worth showing. */
check('one date alone is still worth an entry',
  buildTimeline(null, [], [], { handoverDate: '2026-03-18', importedAt: null }).length === 1)

/* ---------------------------------------------------------------- what somebody decided ---- */

/*
 * VERIFYING AND RETIRING A NUMBER ARE THINGS A PERSON DID, AND THEY LEFT NO TRACE.
 *
 * THE FIRM, having retired an email as a wrong address: "it doesn't show in my activity timeline.
 * It should show things like this -- oh, I just verified an email address on this date, or I just
 * retired this and the retire reason is there."
 *
 * IT MATTERS MORE THAN IT LOOKS. A verified number is the one the Call button dials and the one a
 * notice quotes; a retired one is deliberately never offered again. Neither was recorded
 * anywhere a person reads, so an address that stopped being used had no answer to "who decided
 * that, and why" -- which is the question asked eighteen months later when a debtor says nobody
 * ever contacted them.
 */
const contact = (over) => ({
  id: 'c1', accountId: 'a', kind: 'email', value: 'debtor@example.co.za', label: null,
  personName: null, personRole: null, isPrimary: false,
  verifiedAt: null, retiredAt: null, retiredReason: null, notes: null,
  createdAt: '2026-01-01T00:00:00Z', ...over,
})

const verified = buildTimeline(null, [], [], null, [
  contact({ verifiedAt: '2026-09-20T10:00:00Z' }),
])
check('verifying a contact lands on the timeline', verified.length === 1,
  JSON.stringify(verified))
check('...saying what was verified, in words',
  verified[0]?.title === 'Verified the email address debtor@example.co.za',
  verified[0]?.title)
/*
 * NOT AUTOMATED. The "just what people wrote" filter exists to hide bookkeeping about actions
 * somebody else took -- a fee line beside the call that caused it. This IS the action.
 */
check('...and survives the "just what people wrote" filter',
  filterTimeline(verified, false).length === 1)

const retired = buildTimeline(null, [], [], null, [
  contact({ retiredAt: '2026-09-26T16:40:00Z', retiredReason: 'wrong email' }),
])
check('retiring a contact lands on the timeline too', retired.length === 1)
/* THE REASON IS THE POINT. "Retired" says a thing happened; "wrong email" says why, and it is
   the only thing that stops the next collector using it all over again. */
check('...carrying the reason somebody typed', retired[0]?.detail === 'wrong email',
  retired[0]?.detail)
check('...dated when it was retired, not when it was added',
  retired[0]?.date === '2026-09-26', retired[0]?.date)

/* Both, on one contact, are two entries: they happened on different days and each is a decision. */
const both = buildTimeline(null, [], [], null, [
  contact({ verifiedAt: '2026-09-20T10:00:00Z', retiredAt: '2026-09-26T16:40:00Z', retiredReason: 'wrong email' }),
])
check('a contact verified and later retired is two entries', both.length === 2)
check('...newest first, like everything else', both[0]?.date === '2026-09-26')

/*
 * AND ADDING ONE IS NOT AN ENTRY, which is the half that keeps the timeline readable. The book
 * came across from Swordfish with its numbers already on it; one entry per imported contact would
 * bury six years of history under a list of telephone numbers dated the day of the import.
 */
/*
 * READ DEFENSIVELY. Removing the two guards makes buildTimeline hand a null date to dayOf, which
 * throws -- and a thrown check file prints a stack and NO COUNT, which run-all reads as zero and
 * cannot tell from a healthy file. Found by break-testing this very assertion.
 */
let untouched = null
try { untouched = buildTimeline(null, [], [], null, [contact({})]).length }
catch (e) { untouched = `threw: ${String(e).slice(0, 80)}` }
check('a contact nobody has acted on says nothing', untouched === 0, String(untouched))

/*
 * THE LINE run-all.mjs READS. A file that prints no count is counted as ZERO in the
 * headline and is indistinguishable from a healthy one -- a review of this suite found 20
 * files silent that way, about 800 assertion sites reported as nothing.
 */
if (failed === 0) console.log(`${passed} passed, 0 failed`)
console.log(failed === 0 ? '\nAll checks passed.\n' : `\n${failed} check(s) failed.\n`)
process.exit(failed ? 1 : 0)
