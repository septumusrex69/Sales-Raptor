/**
 * A STEP OF THE FIRM'S CHART IS A NOTICE AND THE TEXT MESSAGE BEHIND IT.
 *
 * THE FIRM, LOOKING AT AN ELEVEN-DOT SECTION 129: "we can possibly make that one. So there'll be
 * much less steps in here. You know, it'll look smaller and better." And the other half of the same
 * complaint: "you need to send the SMS manually, all right? And you need to, even after you've sent
 * this 129."
 *
 * THEIR CHART HAS SIX STEPS AND RAPTOR STORED ELEVEN, because every one of those six is two rows --
 * the letter and the SMS telling the debtor to go and read it. Two rows is right in the database:
 * two channels, two Annexure B charges, two things that fail separately. Two DOTS is wrong on a
 * screen, and two PRESSES is wrong in the work.
 *
 * WHAT WOULD BREAK WITHOUT THIS, and both are silent. A dot rolled up to the BETTER of its two
 * rows draws green on a notice whose SMS is still waiting on somebody -- so the collector reads
 * "done" and the one message needing a press is the one nobody presses. And a follower paired to
 * the wrong day sends an SMS saying "we have emailed you" behind a letter that never went.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-step-pairs.mjs
 */
import { readFileSync } from 'node:fs'
import {
  followerOf, leadOf, noticeChannels, noticeShape, noticesOf,
} from '../../src/lib/stepPairs.ts'
import { shapeOf } from '../../src/lib/runSteps.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

/** A row, with only what pairs it and colours it. */
const step = (over) => ({
  id: 'x', label: 'Step', channel: 'email', dueOn: '2026-09-28', state: 'pending',
  note: null, sentAt: null, day: 1, needsRelease: false, afterMinutes: null, ...over,
})
/* The firm's own section 129: six steps, eleven rows. */
const s129 = [
  step({ id: 'a1', label: 'Section 129 / letter of demand', day: 1, dueOn: '2026-09-27' }),
  step({ id: 'a2', label: 'Section 129 / letter of demand SMS', channel: 'sms', day: 1, dueOn: '2026-09-27', afterMinutes: 7 }),
  step({ id: 'b1', label: 'Reminder', day: 7, dueOn: '2026-10-06' }),
  step({ id: 'c1', label: 'Final notice', day: 12, dueOn: '2026-10-13' }),
  step({ id: 'c2', label: 'Final notice SMS', channel: 'sms', day: 12, dueOn: '2026-10-13', afterMinutes: 7 }),
  step({ id: 'd1', label: 'Notice of intention to list', day: 32, dueOn: '2026-11-10' }),
  step({ id: 'd2', label: 'Notice of intention to list SMS', channel: 'sms', day: 32, dueOn: '2026-11-10', afterMinutes: 7 }),
  step({ id: 'e1', label: 'Listed', day: 39, dueOn: '2026-11-19' }),
  step({ id: 'e2', label: 'Listed SMS', channel: 'sms', day: 39, dueOn: '2026-11-19', afterMinutes: 7 }),
  step({ id: 'f1', label: 'Intended summons', day: 49, dueOn: '2026-12-03' }),
  step({ id: 'f2', label: 'Intended summons SMS', channel: 'sms', day: 49, dueOn: '2026-12-03', afterMinutes: 7 }),
]

/* ---------- the chart the firm drew ---------- */

const notices = noticesOf(s129)
check('eleven rows are the six steps the firm drew', notices.length, 6)
check('...named by the notice, not by the SMS behind it',
  notices.map((n) => n.lead.label),
  ['Section 129 / letter of demand', 'Reminder', 'Final notice',
    'Notice of intention to list', 'Listed', 'Intended summons'])
/* THE REMINDER IS ONE MESSAGE, and most steps of most sequences are: a step with no SMS behind it
   is not a broken pair. */
check('a step that is one message has no follower', notices[1]?.follower ?? null, null)
check('...and one that is two has one', notices[0]?.follower?.id ?? null, 'a2')
/* NOTHING IS LOST. Six dots on the chart, eleven rows still reachable -- which is the firm's own
   condition on the track: "you can also like extend it to show every single step in the process." */
check('every row is still in a notice', notices.flatMap((n) => n.steps).length, s129.length)
check('...exactly once', new Set(notices.flatMap((n) => n.steps.map((s) => s.id))).size, s129.length)
/* ORDER IS PRESERVED, or the chart tells a different story from the list under it. */
check('the order is the order the rows arrived in',
  notices.flatMap((n) => n.steps.map((s) => s.id)), s129.map((s) => s.id))

/* ---------- which row is the follower ---------- */

/*
 * THE RULE IS THE RUNNER'S OWN -- `afterMinutes` -- and no column was added for this. Paired on
 * CHANNEL instead, a sequence whose notice goes by SMS and whose follower is an email would pair
 * backwards; paired on ADJACENCY, a row arriving between them would break it.
 */
const backwards = [
  step({ id: 'p1', label: 'Notice', channel: 'sms', dueOn: '2026-10-01' }),
  step({ id: 'p2', label: 'Follow-up', channel: 'email', dueOn: '2026-10-01', afterMinutes: 5 }),
]
check('the follower is the one that says it follows', noticesOf(backwards)[0]?.follower?.id ?? null, 'p2')
check('...whatever channel each of them is on', noticesOf(backwards)[0]?.lead?.id ?? null, 'p1')
/* A DIFFERENT DAY IS A DIFFERENT STEP, which is what stops an SMS being paired to a letter it was
   never meant to follow -- and what would send "we have emailed you" behind nothing. */
const apart = [
  step({ id: 'q1', label: 'Notice', dueOn: '2026-10-01' }),
  step({ id: 'q2', label: 'SMS', channel: 'sms', dueOn: '2026-10-02', afterMinutes: 7 }),
]
check('a follower on another day is its own step', noticesOf(apart).length, 2)
check('...and is not attached to the day before', noticesOf(apart)[0]?.follower ?? null, null)

/* A FOLLOWER WITH NOTHING TO FOLLOW STANDS ALONE rather than vanishing: it should not happen, a
   version could be drawn that way, and a step that exists and is invisible is the failure the whole
   track was built to stop. */
const orphan = [step({ id: 'r1', label: 'SMS', channel: 'sms', afterMinutes: 7 })]
check('a follower with no notice is still drawn', noticesOf(orphan).length, 1)
/* READ DEFENSIVELY PAST IT, which is CLAUDE.md's second trap and was live here: with the orphan
   dropped, the line above reported the failure correctly and then this one threw a TypeError --
   so the file printed a stack and no count at all, and run-all reads the count. */
check('...as its own step', noticesOf(orphan)[0]?.lead?.id ?? null, 'r1')
/* TWO FOLLOWERS ON ONE DAY ARE NOT SWALLOWED BY ONE DOT. The firm has drawn none; this decides
   what happens the day they do, and a dot too many beats a message nobody can see. */
const three = [
  step({ id: 't1', dueOn: '2026-10-01' }),
  step({ id: 't2', channel: 'sms', dueOn: '2026-10-01', afterMinutes: 7 }),
  step({ id: 't3', channel: 'whatsapp', dueOn: '2026-10-01', afterMinutes: 12 }),
]
check('a third message on one day is not hidden', noticesOf(three).length, 2)
check('...and every row is still there', noticesOf(three).flatMap((n) => n.steps).length, 3)
check('nothing at all is no notices', noticesOf([]), [])

/* ---------- what one dot looks like ---------- */

/*
 * THE WORSE OF THE TWO, AND THAT IS THE WHOLE POINT. A notice whose letter went and whose SMS waits
 * on somebody has NOT gone: drawn green it tells a collector the debtor has been dealt with, and
 * the message still needing a press is the one nobody presses.
 */
const pairWith = (a, b) => noticesOf([
  step({ id: 'z1', dueOn: '2026-10-01', ...a }),
  step({ id: 'z2', channel: 'sms', dueOn: '2026-10-01', afterMinutes: 7, ...b }),
])[0]
check('both sent is sent',
  noticeShape(pairWith({ state: 'sent', sentAt: '2026-10-01T08:00:00Z' }, { state: 'sent', sentAt: '2026-10-01T08:07:00Z' })), 'sent')
check('the letter sent and the SMS waiting on somebody is NOT sent',
  noticeShape(pairWith({ state: 'sent', sentAt: '2026-10-01T08:00:00Z' }, { state: 'held', needsRelease: true })), 'stopped')
check('the letter held and the SMS pending is stopped',
  noticeShape(pairWith({ state: 'held' }, { state: 'pending' })), 'stopped')
check('both still ahead is waiting',
  noticeShape(pairWith({ state: 'pending' }, { state: 'pending' })), 'waiting')
/* CANCELLED IS THE BOTTOM OF THE RANKING, not the top: half a notice cancelled with an account that
   left the workflow has still had its other half SENT, and the sending is the fact that matters. */
check('a sent letter beside a cancelled SMS still reads as sent',
  noticeShape(pairWith({ state: 'sent', sentAt: '2026-10-01T08:00:00Z' }, { state: 'cancelled' })), 'sent')
check('both cancelled is cancelled',
  noticeShape(pairWith({ state: 'cancelled' }, { state: 'cancelled' })), 'cancelled')
/* A lone step is coloured exactly as it always was, or every sequence with no SMS in it moves. */
for (const state of ['sent', 'pending', 'held', 'cancelled', 'failed']) {
  const one = step({ state, sentAt: state === 'sent' ? '2026-10-01T08:00:00Z' : null })
  check(`a step on its own is still shaped as itself (${state})`,
    noticeShape(noticesOf([one])[0]), shapeOf(one))
}

/* ---------- the icons inside it ---------- */

check('a step that is a letter and a text carries both',
  notices[0] ? noticeChannels(notices[0]) : [], ['email', 'sms'])
check('...in the order they go out',
  noticesOf(backwards)[0] ? noticeChannels(noticesOf(backwards)[0]) : [], ['sms', 'email'])
check('a step that is one message carries one', notices[1] ? noticeChannels(notices[1]) : [], ['email'])
/* NOT TWICE. Two rows on one channel are one icon, or a dot grows a second envelope for no reason
   anybody looking at it could work out. */
check('the same channel twice is drawn once',
  noticeChannels(noticesOf([
    step({ id: 'u1', dueOn: '2026-10-01' }),
    step({ id: 'u2', dueOn: '2026-10-01', afterMinutes: 7 }),
  ])[0]), ['email'])
check('a step with no channel carries none',
  noticeChannels(noticesOf([step({ channel: null })])[0]), [])

/* ---------- the SMS that goes with a press ---------- */

check('the letter names the SMS behind it', followerOf(s129, 'a1')?.id, 'a2')
check('...and a step that is one message names none', followerOf(s129, 'b1'), null)
/* Asked of the SMS itself, there is nothing behind it -- which is what stops a press on the
   follower trying to send the letter a second time. */
check('the SMS has nothing behind it', followerOf(s129, 'a2'), null)

/* ---------- and the press sends both ---------- */

const release = read('../../api/_lib/workflow/release.ts')
ok('there is a release route to read', release.length > 2000)
/*
 * THE OTHER HALF OF WHAT THE FIRM ASKED FOR. Six steps on the chart and eleven presses in the work
 * is the same complaint as eleven dots, moved one place along.
 */
ok('releasing a notice also sends the SMS behind it', /\.eq\('due_on', step\.due_on\)/.test(release)
  && /after_minutes/.test(release))
ok('...and a pending one counts, not only a held one', /\.in\('state', \['pending', 'held'\]\)/.test(release))
/*
 * ONLY AFTER THE LETTER ACTUALLY WENT. The SMS says "we have emailed you"; behind a letter that
 * held, it tells the debtor to go and read something that was never sent.
 */
ok('...only once the notice itself has gone', /if \(outcome\.result === 'sent'\) \{/.test(release))
/* AND THE PRESS SAYS WHAT WENT WITH IT, rather than leaving somebody to wonder whether the second
   message is still waiting. */
ok('the press reports what went with it', /alsoSent:/.test(release) && /alsoHeld:/.test(release))
/* One message's failure is not the other's: the notice HAS gone, and the press must say so. */
ok('...and one failing does not undo the other', /companions\.push\(\{/.test(release))

/* ---------------- the order the steps arrive in must not matter ---------------- */

/*
 * THE BUG THE FIRM FOUND, and it is the reason this block exists rather than a preference for
 * robustness.
 *
 * accountRun sorted the run's steps by due date and then by day number -- and the two steps of a
 * PAIR share both, so on exactly those two the comparison returned nought and the order was
 * whatever PostgREST handed over. On their section 129 it handed the SMS over first. Reading in
 * that order, the old one-pass noticesOf saw a follower with no notice open, called it a step with
 * nothing to follow, and every step of the sequence drew TWICE.
 *
 * NOTHING REPORTED IT, which is the part worth guarding. A chart that fails to collapse is merely
 * longer, and a longer chart looks like a longer workflow. What the firm actually noticed was three
 * steps further on: the panel opened on the SMS and its Send it now button could not work.
 */
{
  const lead = step({ id: 'e', label: 'Section 129', channel: 'email', afterMinutes: null })
  const follower = step({ id: 's', label: 'Section 129 SMS', channel: 'sms', afterMinutes: 10 })
  const one = noticesOf([lead, follower])
  const other = noticesOf([follower, lead])
  check('a notice and its SMS are one dot', one.length, 1)
  check('...and still one dot read the other way round', other.length, 1)
  /* THE LEAD IS THE NOTICE WHICHEVER ORDER THEY ARRIVE IN. Reversed, the SMS became the lead of a
     dot of its own -- so the track drew it first and the panel offered it first. */
  check('the notice is the lead, not the message behind it',
    [one[0].lead.id, other[0].lead.id], ['e', 'e'])
  check('...and the SMS is its follower both ways',
    [one[0].follower?.id, other[0].follower?.id], ['s', 's'])
  /* AND THE CALLER'S ORDER IS STILL THE ORDER DRAWN. Pairing must not quietly re-sort the track:
     a chart redrawn in a different order from the list beneath it is two accounts of one sequence. */
  const three = [
    step({ id: 'a', dueOn: '2026-09-25', afterMinutes: null, label: 'First' }),
    step({ id: 'b', dueOn: '2026-10-05', afterMinutes: null, label: 'Second' }),
    step({ id: 'c', dueOn: '2026-10-12', afterMinutes: null, label: 'Third' }),
  ]
  check('the order the caller sorted is the order drawn',
    noticesOf(three).map((n) => n.lead.id), ['a', 'b', 'c'])
}

/*
 * AND THE SORT ITSELF, read back off the query that feeds all of this. The third key is what was
 * missing; asserted on the source because only the browser could otherwise prove it, and by then
 * the symptom is a chart nobody can tell is wrong.
 */
{
  const run = read('../../src/lib/accountRun.ts')
  ok('the run asks for the node ordinal', /workflow_nodes!inner\([^)]*\bordinal\b/.test(run))
  ok('...carries it onto the step', /ordinal: s\.workflow_nodes\?\.ordinal \?\? 0/.test(run))
  /*
   * THREE KEYS, AND THE DAY NUMBER IS NO LONGER ONE OF THEM. Date, then the ordinal, then the
   * instalment.
   *
   * WHY THE DAY WENT. It was never doing any work here -- the date is resolved FROM the day, so
   * two steps agreeing about the date already agree about the day -- and once a step can be
   * anchored to an instalment it is actively wrong: `day` on such a node is a position on the
   * chart rather than a date, so comparing it against a run-anchored node's day interleaves the
   * reminder for instalment 5 with the confirmation.
   *
   * THE ORDINAL IS STILL THE KEY THIS BLOCK EXISTS FOR, and it still separates the two steps of a
   * pair, which share a date. The instalment is last, for the same reason the ordinal used to be:
   * it only ever separates steps that already agree about everything before it.
   */
  ok('...and sorts on it after the date, with the instalment last',
    /a\.dueOn\.localeCompare\(b\.dueOn\) \|\| a\.ordinal - b\.ordinal \|\| a\.instalmentNo - b\.instalmentNo/.test(run))
}

/* ---------------- a follower knows what it is waiting for ---------------- */

/*
 * THE OTHER DIRECTION OF THE SAME FACT, and what the card under a held SMS needs.
 *
 * A follower cannot be sent on its own: planSend refuses it while the message it refers to has not
 * gone. So a Send it now under one is a button that presses and reports that nothing changed --
 * which is exactly what the firm pressed, twice, before asking why it was not working.
 */
{
  const lead = step({ id: 'e', label: 'Section 129', afterMinutes: null })
  const follower = step({ id: 's', label: 'Section 129 SMS', channel: 'sms', afterMinutes: 10 })
  const steps = [lead, follower]
  check('an SMS can name the notice it goes behind', leadOf(steps, 's')?.id, 'e')
  check('...and the notice names the SMS behind it', followerOf(steps, 'e')?.id, 's')
  /* NULL EACH WAY ROUND FOR A STEP THAT IS NEITHER, and null is not a failure: most steps of most
     sequences are one message. */
  check('a notice has no notice of its own', leadOf(steps, 'e'), null)
  check('...and a lone step has neither', [leadOf([lead], 'e'), followerOf([lead], 'e')], [null, null])
}

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-step-pairs: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
