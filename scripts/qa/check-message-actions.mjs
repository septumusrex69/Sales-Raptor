/**
 * Answering a message from the record it is filed on.
 *
 * WHAT CHANGED AND WHY. Four screens carry a conversation somebody can take part in: a debtor
 * account's correspondence, and the email cards on a lead, a deal and a client. Between them they
 * offered Reply and Mark unread, in two different styles, at the BOTTOM of an opened message. The
 * firm, working an account: "to put these things at the top, currently it's still at the bottom,
 * so if you want to reply, you have to go all the way down... and yeah, the same functions for
 * the emailing inside the leads, the deals, the clients as well."
 *
 * The part that cannot be checked by reading source is where the buttons ARE — that is
 * e2e/record-email.mjs. The part that can be checked here is the arithmetic behind them, and it
 * is the half with silent failure modes:
 *
 *   - COPYING YOURSELF. Your own address is on every message you received. Left in a reply-all,
 *     every round puts a copy back in your own inbox and the thread doubles.
 *   - DROPPING SOMEBODY. A reply-all that quietly loses one recipient is a private reply wearing
 *     a reply-all's label, and nobody finds out until the person who was dropped asks why.
 *   - OFFERING IT WHEN THERE IS NOBODY. "Reply all, if there are other people that are CC'd."
 *     A Reply all that does exactly what Reply does is a button people learn to ignore.
 *   - QUOTING THE WRONG WAY ROUND. A reply must not quote (the other side already has the
 *     message, and their own chain is in it); a forward must (its reader was never on the thread).
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-message-actions.mjs
 */
import { readFileSync } from 'node:fs'
import { hasOthers, openingFor, othersBesides } from '../../src/lib/emailActivity.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const ME = 'stephan@bredellferreira.co.za'
const DEBTOR = { name: 'Olwethu Matshoba', address: 'olwethu@example.co.za' }
const ATTORNEY = { name: 'Danielle Louwrens', address: 'danielle@louwrens-attorneys.co.za' }
const COLLEAGUE = { name: 'Camille', address: 'camille@bredellferreira.co.za' }

const message = (over = {}) => ({
  rawSubject: 'Email received: Arrangement on APM0143',
  fromName: DEBTOR.name,
  fromAddress: DEBTOR.address,
  to: [{ name: 'Stephan', address: ME }],
  cc: [ATTORNEY],
  body: 'I cannot pay this month.',
  occurredAt: '2026-09-18T09:29:00.000Z',
  messageId: '<abc@example.co.za>',
  ...over,
})

/* ---------- a plain reply ---------- */

const reply = openingFor(message(), 'reply', [ME])
check('a reply goes to whoever wrote it', reply.to, DEBTOR.address)
check('...and copies nobody', reply.cc, '')
/*
 * THREADED. Without In-Reply-To the answer arrives in the recipient's client as a fresh message
 * beside the question, which is how a debtor ends up insisting they were never answered.
 */
check('...and threads back to what it answers', reply.inReplyTo, '<abc@example.co.za>')
check('...under the subject, framing stripped', reply.subject, 'Re: Arrangement on APM0143')
/*
 * AND IT DOES NOT QUOTE. Tried and removed on the account composer: a debtor's reply already
 * carries their own client's quoted chain, so quoting it again opens the box with two layers of
 * "> " before anybody has typed a word.
 */
check('...and the box starts empty', reply.body, undefined)

check('"Re:" is not stacked on a reply to a reply',
  openingFor(message({ rawSubject: 'Email received: Re: Arrangement' }), 'reply', [ME]).subject,
  'Re: Arrangement')

/* ---------- reply all ---------- */

const all = openingFor(message(), 'replyAll', [ME])
check('a reply-all still goes to the sender', all.to, DEBTOR.address)
check('...and copies everybody else who was on it', all.cc,
  'Danielle Louwrens <danielle@louwrens-attorneys.co.za>')
ok('...and never copies you back to yourself', !all.cc.includes(ME))

/*
 * CASE-FOLDED. A mail server does not care about case and the same person is routinely written
 * three ways across one thread; matching literally is how your own address survives as a Cc.
 */
const shouty = openingFor(
  message({ to: [{ name: null, address: ME.toUpperCase() }] }), 'replyAll', [ME],
)
ok('...however the original spelled your address', !shouty.cc.toLowerCase().includes(ME))

/* A person on both To and Cc is one person, not two. */
check('nobody is copied twice',
  openingFor(message({ to: [ATTORNEY, { name: null, address: ME }], cc: [ATTORNEY] }), 'replyAll', [ME]).cc,
  'Danielle Louwrens <danielle@louwrens-attorneys.co.za>')

/* The sender is already the To of the answer, so copying them as well is copying them twice. */
check('the sender is not also copied',
  openingFor(message({ cc: [DEBTOR, ATTORNEY] }), 'replyAll', [ME]).cc,
  'Danielle Louwrens <danielle@louwrens-attorneys.co.za>')

/* An agent is reachable at more than one address — their own, and whatever the firm forwards. */
check('every address that is yours is dropped, not just the first',
  openingFor(message({ cc: [COLLEAGUE, ATTORNEY] }), 'replyAll', [ME, COLLEAGUE.address]).cc,
  'Danielle Louwrens <danielle@louwrens-attorneys.co.za>')

/* A name is what lets somebody check the list before they send it. */
ok('a copied person is shown by name where the message carried one',
  all.cc.startsWith('Danielle Louwrens <'))
check('...and by address alone where it did not',
  openingFor(message({ cc: [{ name: null, address: ATTORNEY.address }] }), 'replyAll', [ME]).cc,
  ATTORNEY.address)

/* ---------- when reply-all is worth offering ---------- */

ok('there is somebody else to answer', hasOthers([{ name: null, address: ME }], [ATTORNEY], [ME]))
/*
 * AND WHEN THERE IS NOT. A message addressed to you alone has nothing for the button to do, and
 * one that quietly did the same as Reply is the second button people stop reading.
 */
ok('a message addressed to you alone offers nothing more',
  !hasOthers([{ name: null, address: ME }], [], [ME]))
ok('...and neither does one with nothing recorded either way', !hasOthers([], [], [ME]))
/* Everything filed before the columns existed. Reads as "nobody else known", which is honest. */
check('an empty pair yields nobody', othersBesides([], [], [ME]), [])

/* ---------- a forward ---------- */

const fwd = openingFor(message(), 'forward', [ME])
/*
 * NOT ADDRESSED AND NOT THREADED. A forward goes to somebody who was never in the conversation:
 * a prefilled To would be the wrong person, and In-Reply-To would drop our message into a thread
 * they have never seen.
 */
check('a forward is addressed to nobody yet', fwd.to, '')
check('...copies nobody', fwd.cc, '')
check('...and is not threaded', fwd.inReplyTo, null)
check('...under a forwarded subject', fwd.subject, 'Fwd: Arrangement on APM0143')
check('"Fwd:" is not stacked either',
  openingFor(message({ rawSubject: 'Email sent: Fwd: Arrangement' }), 'forward', [ME]).subject,
  'Fwd: Arrangement')
/*
 * AND IT IS THE ONE THAT CARRIES THE ORIGINAL. Headers first: who sent it, when, and what it
 * said it was about are the whole reason it is being passed on.
 */
ok('the original is quoted under it', (fwd.body ?? '').includes('I cannot pay this month.'))
ok('...saying who wrote it', (fwd.body ?? '').includes('Olwethu Matshoba'))
ok('...and their address', (fwd.body ?? '').includes(DEBTOR.address))
ok('...and when', (fwd.body ?? '').includes('2026'))
ok('...and what it was about', (fwd.body ?? '').includes('Subject: Arrangement on APM0143'))

/* ---------- the account's own copy, which has its own type ---------- */

/*
 * THE SAME QUESTION, ASKED OF A DEBTOR ACCOUNT. othersOn is EmailsPanel's own version, because an
 * AccountEmail names the other side "debtorAddress" rather than carrying a From. It has to drop
 * both our mailbox AND the debtor: one is us, the other is already the To of a plain reply.
 */
const panel = readFileSync(new URL('../../src/pages/accounts/EmailsPanel.tsx', import.meta.url), 'utf8')
ok('the account asks the same question', /export function othersOn/.test(panel))
/*
 * AND ASKS IT OF THE SHARED RULE. It had its own copy for one commit, and that is the shape that
 * drifts: the two disagreed about case, so one thread offered Reply all on a lead and hid it on
 * the account. Asserted as the CALL, because a regex about how the copy was written passes just
 * as well over a second copy -- which is how the first break test of this line stayed green.
 */
const othersOnBody = panel.slice(panel.indexOf('export function othersOn'))
  .slice(0, panel.slice(panel.indexOf('export function othersOn')).indexOf('\n}') + 2)
ok('...through the one shared rule', /return hasOthers\(/.test(othersOnBody))
ok('...and does not write the matching out again', !/toLowerCase\(\)/.test(othersOnBody))
ok('...passing both lists', /email\.toRecipients,[\s\S]{0,40}email\.ccRecipients,/.test(othersOnBody))
ok('...and excusing our mailbox and the debtor',
  /\[email\.ourAddress, email\.debtorAddress\]/.test(othersOnBody))

/* ---------- the bar itself ---------- */

const actions = readFileSync(new URL('../../src/components/email/MessageActions.tsx', import.meta.url), 'utf8')
ok('there is one action bar to read', actions.length > 1000)
/*
 * A BUTTON THAT IS PRESENT AND DOES NOTHING teaches people not to trust the row. Every one of the
 * four is offered only when the caller passes a handler, and the bar disappears entirely when
 * none of them applies.
 */
for (const name of ['onReply', 'onReplyAll', 'onForward', 'onMarkUnread']) {
  ok(`${name} is drawn only when it is given`, new RegExp(`\\{${name} && \\(`).test(actions))
}
ok('...and the whole bar goes when nothing applies', /if \(nothingToDo\) return null/.test(actions))
/*
 * MARK UNREAD IS NOT A SEND. It is a note to yourself about your own list, so a missing mailbox
 * must not grey it out — that would take away the one action still available to somebody whose
 * mailbox has disconnected.
 */
/*
 * BOUNDED TO ITS OWN BLOCK. The first version of this read from the mark-unread block to the end
 * of the file, which sweeps in WriteButton -- and WriteButton is disabled by !canSend, correctly.
 * So the check failed on right code, and the obvious "fix" would have been to delete it.
 */
const unreadAt = actions.indexOf('{onMarkUnread && (')
const unreadButton = actions.slice(unreadAt, actions.indexOf('</div>', unreadAt))
ok('there is a mark-unread block to read', unreadButton.length > 50)
ok('mark unread does not need a mailbox', !/disabled=/.test(unreadButton))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A reply answers the sender and threads; a reply-all reaches everybody the original did and never
the person sending it, however their address was spelled; a forward is addressed to nobody, is not
threaded, and is the only one that quotes. Reply all is offered only where somebody else was
actually on the message, which is the firm's own condition for it.`)
