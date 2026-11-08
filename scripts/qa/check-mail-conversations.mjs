/**
 * CONVERSATION MODE (R-13's second half, S19 · Raptor H18; Rinda: "have all the emails together that is in a trail").
 *
 * A trail is the subject with its Re:/Fw: taken off, AMONG PEOPLE IN COMMON -- the person's own addresses left out.
 * The second half is what a debt collector needs: two debtors who each write "Proof of payment" are not one
 * conversation, and a rule on the subject alone would put them in one.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mail-conversations.mjs
 */
import { conversationSubject, groupConversations, inConversation, participants } from '../../src/lib/mailConversations.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ME = 'rinda@bredellferreira.co.za'
let n = 0
const mail = (subject, from, to = ME, cc = [], at = n) => ({
  id: `m${n += 1}`, subject, fromAddress: from, toAddress: to, toRecipients: [{ address: to }],
  ccRecipients: cc.map((address) => ({ address })), occurredAt: new Date(Date.UTC(2026, 10, 1, 8, at)).toISOString(), readAt: null,
})

check('Re:, Fw:, AW: and [EXT], however deep, come off', conversationSubject('RE: Fw: AW:[EXT] Statement  for October'), 'statement for october')
check('...and Fwd: and a numbered Re[2]:', conversationSubject('Fwd: Re[2]: Payment'), 'payment')
check('a subject that only looks like a prefix is left alone', conversationSubject('Regarding the statement'), 'regarding the statement')
check('my own address is not a participant', [...participants(mail('x', 'client@alianna.co.za'), [ME])], ['client@alianna.co.za'])

/* One client trail: the client writes, the firm's colleague is copied on the reply, the colleague answers. */
const a1 = mail('Statement for October', 'accounts@alianna.co.za', ME, [], 1)
const a2 = mail('RE: Statement for October', 'accounts@alianna.co.za', ME, ['camille@bredellferreira.co.za'], 2)
const a3 = mail('Re: RE: Statement for October', 'camille@bredellferreira.co.za', ME, [], 3)
/* Two debtors, the same words, nobody in common. */
const d1 = mail('Proof of payment', 'debtor.one@gmail.com', ME, [], 4)
const d2 = mail('Proof of payment', 'debtor.two@gmail.com', ME, [], 5)
const blank = mail('', 'debtor.one@gmail.com', ME, [], 6)
const groups = groupConversations([a1, a2, a3, d1, d2, blank], [ME])
const of = (m) => groups.find((g) => g.members.some((x) => x.id === m.id))
check('the client trail is one conversation of three, joined through the colleague', of(a1).members.map((m) => m.id).sort(), [a1.id, a2.id, a3.id].sort())
check('...newest first', of(a1).latest.id, a3.id)
check('...all three unread counted', of(a1).unread, 3)
check('two debtors\' "Proof of payment" are NOT one conversation', of(d1) === of(d2), false)
check('a message with no subject is a trail of its own', of(blank).members.length, 1)
check('every message is in exactly one trail', groups.reduce((t, g) => t + g.members.length, 0), 6)
check('trails in the order their newest arrived', groups.map((g) => g.key)[0], blank.id)

/* The rest of a trail, read from the mailbox: my sent reply joins through the client. */
const sent = { ...mail('Re: Statement for October', ME, 'accounts@alianna.co.za', [], 7), isSent: true }
check('my sent reply belongs to the client trail', inConversation(sent, [a1], [ME]), true)
check('...but not to the other debtor\'s', inConversation(mail('Re: Proof of payment', ME, 'debtor.two@gmail.com'), [d1], [ME]), false)

console.log(`check-mail-conversations: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
