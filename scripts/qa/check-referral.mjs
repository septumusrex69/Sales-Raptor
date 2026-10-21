/**
 * PUTTING AN ACCOUNT ON SOMEBODY ELSE'S DAY -- AND THE DIARY ENTRY IS THE REFERRAL.
 *
 * THREE THINGS THE FIRM ASKED FOR, and they are one mechanism:
 *
 *   A TEAM LEADER REFERS AN ACCOUNT, and "the referral is the diary entry" -- not a note beside
 *   one, not a message as well. A referral that is a note is a referral somebody has to notice.
 *
 *   RECEPTION TRANSFERS A CALLER, and the account goes with the call. Without it the collector
 *   picks up a stranger and starts asking for a reference number.
 *
 *   AND THE LIAISON'S DAY IS MEETINGS, TASKS AND TICKETS. A client liaison's work is mostly
 *   tickets, and the day page showed them meetings and tasks only -- so their day said they had
 *   nothing on while a board they had to go and look at said otherwise.
 *
 * NEITHER REFERRING NOR TRANSFERRING MOVES THE ACCOUNT, which is asserted here: reassignment puts
 * a file on somebody's book against their ceiling and is a different act with its own box.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-referral.mjs
 */
import { readFileSync } from 'node:fs'
import {
  REFERRAL_DIARY_KIND, referralDone, referralDueOn, referralReason,
} from '../../src/lib/accountReferral.ts'
import { DIARY_PRIORITY } from '../../src/lib/diaryPriority.ts'
import { dayCountSentence, dayCounts, dayHeadline, planDay } from '../../src/lib/dayPlan.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* ------------------------------------------------ what the entry says */

const referral = referralReason({
  kind: 'refer', fromName: 'Stefnova Mc Donald',
  ask: 'Ring the employer and confirm he still works there before we list it.',
})
/* IT NAMES WHO SENT IT. An entry that appeared overnight with no author reads as a system booking
   and gets worked last; one that says the team leader asked for it is a different instruction. */
ok('the referral names who referred it', /Referred by Stefnova Mc Donald/.test(referral))
ok('...and carries the ask verbatim', /confirm he still works there/.test(referral))
/* AND WITH NO NAME IT STILL SAYS WHAT IT IS, rather than opening with "Referred by null". */
ok('a session with no name still produces a sentence',
  /^Referred by A team leader\./.test(referralReason({ kind: 'refer', fromName: null, ask: 'Ring him.' })))

const transfer = referralReason({
  kind: 'transfer', fromName: 'Reception', ask: 'He says he has paid.', callerNumber: '082 555 1234',
})
ok('a transfer says somebody is on the line now', /transferring a caller now/.test(transfer))
/*
 * AND IT CARRIES THE NUMBER, which is the half that survives a dropped transfer -- what happens on
 * a switchboard often enough to plan for. Without it the collector has a caller who has gone and
 * no way back to them.
 */
ok('...and the number to ring back on', /082 555 1234/.test(transfer))
ok('...said as what it is for', /If the call drops/.test(transfer))
check('no number means no promise of one',
  /If the call drops/.test(referralReason({ kind: 'transfer', fromName: 'Reception', ask: 'x' })), false)

/* ------------------------------------------------ when it lands */

/* A TRANSFER IS TODAY AND CANNOT BE ANYTHING ELSE: there is a person on the telephone. */
check('a transfer is today', referralDueOn('transfer', '2026-10-04', '2026-11-20'), '2026-10-04')
/* A REFERRAL TAKES A DATE. A team leader reading a file on Friday may well want it worked on
   Monday, and forcing it onto today is how a referral becomes something that gets moved. */
check('a referral takes the date given', referralDueOn('refer', '2026-10-04', '2026-10-07'), '2026-10-07')
check('...and today where none was', referralDueOn('refer', '2026-10-04', null), '2026-10-04')
check('...and an empty string is none', referralDueOn('refer', '2026-10-04', '  '), '2026-10-04')

/*
 * A CALLBACK AND NOT A REVIEW. A review is the diary ladder's LAST rung and explicitly the kind
 * with no event behind it; a referral from the floor's leader and a debtor on the line are both
 * events, and filing either as a review would sort them below a trace on the day's list.
 */
check('it goes on the ladder as a callback', REFERRAL_DIARY_KIND, 'callback')
ok('...which outranks a review', DIARY_PRIORITY.callback < DIARY_PRIORITY.review)
ok('...and a trace', DIARY_PRIORITY.callback < DIARY_PRIORITY.trace)
/* AND IT DOES NOT OUTRANK A BROKEN PROMISE, which is the top of the firm's own ladder: a referral
   is somebody asking, and a broken arrangement is money that did not arrive. */
ok('...but not a broken promise', DIARY_PRIORITY.callback > DIARY_PRIORITY.promise_broken)

/* WHAT THE SENDER IS TOLD, which has to include what did NOT happen. */
const done = referralDone({ kind: 'refer', toName: 'Tumelo', dueOn: '7 Oct 2026' })
ok('the sender is told whose day it landed on', /Tumelo/.test(done))
ok('...and when', /7 Oct 2026/.test(done))
ok('...and that the account has not moved', /does not hand it over/.test(done))
ok('a transfer says to put the call through',
  /Transfer the call/.test(referralDone({ kind: 'transfer', toName: 'Tumelo', dueOn: 'today' })))

/* ------------------------------------------------ the box, and what it writes */

const modal = read('src/pages/accounts/ReferAccountModal.tsx')
const account = read('src/pages/accounts/AccountDetail.tsx')

/* THE DIARY ENTRY IS THE REFERRAL. One write, and it is a diarise. */
ok('the box books a diary entry', /await diarise\(\{/.test(code(modal)))
ok('...on the person it is going to', /ownerId: to\.id/.test(code(modal)))
ok('...with the referral as the reason', /reason: referralReason\(\{/.test(code(modal)))
/* AND NOTHING ELSE IS SENT. No reassignment, no second message: both would be a second thing to
   keep in step with the first. */
check('it does not reassign the account',
  /assigned_to|reassign|allocate/i.test(code(modal)), false)
ok('...and the box says so', /the account stays with/.test(modal))
/* IT REFUSES AN EMPTY ASK. A referral with no ask is a date, which is what the diary already does
   on its own. */
ok('an empty ask is refused', /A referral with no ask is a date/.test(modal))

/*
 * THE REFER BUTTON IS GONE FROM THE ACCOUNT, AND THAT IS THE ASSERTION.
 *
 * THE FIRM: "you can remove that Refer button on the debtor's pane, because I forgot that if you
 * tick on the agent's name, as a team leader or anybody -- well, except being another agent --
 * then you can refer it."
 *
 * IT WAS THE SAME ACT TWICE. The agent's name in the hero opens the hand-out box, whose "Refer
 * only" books somebody to work the account and does not change whose it is -- which is exactly
 * what the button did. Two doors onto one act is two places to keep in step, and the hero's is
 * the one that can also ALLOCATE.
 *
 * SO THE DOOR THAT SURVIVED IS ASSERTED TOO, not just the one that went: a check that only said
 * the button was absent would pass on an account page with no way to refer at all.
 */
check('the account page no longer carries a Refer button',
  /label="Refer"/.test(code(account)), false)
ok('...and the agent\u2019s name is still what opens the hand-out box',
  /onClick=\{\(\) => setHandOut\(true\)\}/.test(code(account)))
ok('...which can refer without allocating',
  /Refer only/.test(read('src/pages/accounts/HandOutModal.tsx')))
/* TRANSFER IS EVERYBODY'S AND STAYS. Somebody is on the telephone: it is dated by that fact and
   carries the number in case the line drops, neither of which a hand-out knows about. */
ok('transferring a caller is still offered, to everybody',
  /onTransfer=\{\(\) => setReferring\('transfer'\)\}/.test(code(account)))
ok('...and its button is on the bar', /label="Transfer"/.test(code(account)))
/* AND THE CALLER'S NUMBER IS THE ONE THE ACCOUNT WOULD HAVE ANSWERED ON. */
ok('the transfer carries the number', /callerNumber=\{callContact\?\.value \?\? null\}/.test(code(account)))

/* ------------------------------------------------ the liaison's day */

const ticket = (over) => ({
  id: 't1', description: 'Client has not answered on the Smit dispute', kind: 'dispute',
  chaseOn: '2026-10-07', status: 'open', ownerId: 'me', accountId: 'a1', ...over,
})
const plan = planDay({
  day: '2026-10-07', meetings: [], tasks: [], tickets: [ticket({})],
})
check('a ticket due that day is on the day', plan.tickets.length, 1)
check('...and counted in the day’s total', plan.total, 1)
/* A CLOSED TICKET'S CHASE DATE IS THE DAY SOMEBODY WAS GOING TO COME BACK TO IT before it was
   answered. Drawn, it would put finished work on a future Tuesday. */
check('a closed one is not', planDay({
  day: '2026-10-07', meetings: [], tasks: [], tickets: [ticket({ status: 'closed' })],
}).tickets.length, 0)
/* A TICKET WITH NO CHASE DATE IS OPEN WORK WITH NO DAY ATTACHED and belongs on the queue. */
check('one with no chase date is not on any day', planDay({
  day: '2026-10-07', meetings: [], tasks: [], tickets: [ticket({ chaseOn: null })],
}).tickets.length, 0)
check('one chased on another day is not on this one', planDay({
  day: '2026-10-07', meetings: [], tasks: [], tickets: [ticket({ chaseOn: '2026-10-08' })],
}).tickets.length, 0)
/* AND A DAY WITH NO TICKETS AT ALL STILL WORKS -- the calendar draws its counts before the
   tickets have loaded, so the list is optional. */
check('tickets are optional', planDay({ day: '2026-10-07', meetings: [], tasks: [] }).tickets, [])

/*
 * COUNTED APART FROM TASKS, like the meetings and for the same reason: a liaison choosing a day
 * needs to know how much of it is a conversation somebody else is waiting on.
 */
ok('the day says how many tickets', /1 ticket/.test(dayHeadline(plan)))
const counted = dayCounts({ meetings: [], tasks: [], tickets: [ticket({})] })
check('the square under the 7th counts it', counted.get('2026-10-07')?.tickets, 1)
check('...in its total', counted.get('2026-10-07')?.total, 1)
ok('...and names it', /1 ticket/.test(dayCountSentence(counted.get('2026-10-07'))))
/*
 * THE SAME TWO RULES IN BOTH PLACES, or the number under the 8th is not the number of rows the 8th
 * then shows -- the drift dayPlan exists to prevent.
 */
check('a closed ticket is not counted either',
  dayCounts({ meetings: [], tasks: [], tickets: [ticket({ status: 'closed' })] }).size, 0)
check('nor one with no chase date',
  dayCounts({ meetings: [], tasks: [], tickets: [ticket({ chaseOn: null })] }).size, 0)

const day = read('src/pages/tasks/TasksPage.tsx')
ok('the day page draws the tickets', /plan\.tickets\.length > 0/.test(code(day)))
ok('...only the signed-in person’s', /t\.ownerId === currentUser\?\.id/.test(code(day)))
ok('...and links to the ticket rather than the account', /\/queries\/\$\{t\.id\}/.test(code(day)))
/* THE SAME THREE LISTS THE DAY IS DRAWN FROM GO INTO ITS COUNTS, or the picker and the day
   disagree about a Tuesday. */
ok('the day picker counts the same three lists', /tickets: myTickets/.test(code(day)))
/* AND A TICKET IS NOT COPIED INTO `tasks`, which is the rule a meeting already follows: two
   things to complete for one obligation, and nothing keeps them in step. */
check('no ticket is written into the task list',
  /addTask\(\{[\s\S]{0,200}?ticket/i.test(code(day)), false)

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-referral: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
