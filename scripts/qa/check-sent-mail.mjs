/**
 * Sent mail, forwarding, and the one thing that must never happen to either.
 *
 * THE MONEY RISK. The sync files an incoming message onto a debtor's account and raises Annexure
 * B item 6 for RECEIVING it. A message the firm SENT is item 1(a) and was already charged when it
 * went out. Pulling the Sent folder through the same code would bill the debtor twice for one
 * email — silently, on every message, for ever. Most of what is checked here is that sent mail
 * leaves the sync before it can reach any of that.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-sent-mail.mjs
 */
import { readFileSync } from 'node:fs'
import {
  companyFromDomain, forwardBody, forwardSubject, recipientLine, recipientNames, replyAllTo,
  replySubject, senderName, splitPersonName,
} from '../../src/lib/emailRules.ts'

let pass = 0
const failures = []
const eq = (name, actual, expected) => check(name, JSON.stringify(actual), JSON.stringify(expected))
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const sync = readFileSync(new URL('../../api/_lib/emailSync.ts', import.meta.url), 'utf8')
const mail = readFileSync(new URL('../../src/lib/userMail.ts', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')

/* ---------- sent mail must never be filed or charged ---------- */

ok('the sync knows which kind of folder it is reading', /kind: 'inbox' \| 'junk' \| 'sent'/.test(sync))
ok('sent mail leaves before anything is filed', /if \(isSent\) \{/.test(sync))
{
  /*
   * ORDER IS THE WHOLE GUARANTEE. The early return has to come before findAccount, which is where
   * a message starts being filed onto a debtor and charged. Asserted as presence first: indexOf
   * returns -1 for a string that is gone, and -1 beats everything, so an order-only check passes
   * vacuously the moment the guard is deleted.
   */
  ok('...and the guard exists at all', sync.includes('if (isSent) {'))
  ok('...before the account match that charges item 6',
    sync.indexOf('if (isSent) {') < sync.indexOf('await findAccount('))
}
// includes() rather than a regex: the pattern is two literal backslashes and escaping them
// through a regex literal is how a check ends up asserting nothing.
ok('the Sent folder is found by special-use, not by guessing one name',
  sync.includes("findFolder(mailboxes, '\\\\Sent'"))
ok('sent mail carries its own watermark', /last_seen_uid_sent/.test(sync))
ok('...which is stored', /last_seen_uid_sent integer/.test(schema))

/* ---------- and it stays out of the working lists ---------- */

ok('the mailbox row records that it was sent', /is_sent: message\.isSent/.test(sync))
ok('sent mail arrives settled, not as work',
  /noRecordNeeded \|\| message\.isSent/.test(sync))
ok('Needs matching excludes sent mail', /needs-filing'\) out = .*eq\('is_sent', false\)/.test(mail))
ok('All excludes sent mail', /'all'\) out = out\.eq\('is_junk', false\)\.eq\('is_sent', false\)/.test(mail))
ok('Sent has its own tab', /'sent'\) out = out\.eq\('is_sent', true\)/.test(mail))
// The recipient is the useful address on a sent message; From is always us.
ok('who it went to is stored', /to_address: message\.toAddress/.test(sync))

/* ---------- forwarding ---------- */

check('a forward is marked as one', forwardSubject('Payment arrangement'), 'Fwd: Payment arrangement')
// Passed along twice must not arrive as "Fwd: Fwd:".
check('forwarding twice does not stutter', forwardSubject('Fwd: Payment arrangement'), 'Fwd: Payment arrangement')
check('...whatever the case', forwardSubject('FWD: Payment arrangement'), 'FWD: Payment arrangement')
check('an empty subject still says what it is', forwardSubject(null), 'Fwd:')
/*
 * "Re:" is left alone deliberately. Forwarding a reply is a forward OF that reply, and stripping
 * it would lose which turn of the thread was passed on.
 */
check('a reply forwarded keeps both', forwardSubject('Re: Payment arrangement'), 'Fwd: Re: Payment arrangement')
ok('reply and forward do not produce the same subject',
  replySubject('Query') !== forwardSubject('Query'))

{
  const original = {
    fromName: 'Ryno Buitendag', fromAddress: 'ryno@example.co.za',
    subject: 'Payment arrangement', occurredAt: '2026-09-12T13:58:51Z',
  }
  const out = forwardBody(original, 'I can pay R2 000 on the 30th.')
  // Headers first: a forward without them is a wall of text nobody can place.
  ok('the forward names who sent it', /Ryno Buitendag/.test(out))
  ok('...and their address', /ryno@example\.co\.za/.test(out))
  ok('...and when', /12 September 2026/.test(out))
  ok('...and the original subject', /Subject: Payment arrangement/.test(out))
  ok('...and carries the body', /I can pay R2 000 on the 30th\./.test(out))
  ok('a complete body is not apologised for', !/stored preview/.test(out))
  /*
   * The mailbox stores a 240-character snippet and keeps the message in the mailbox. Sending the
   * snippet as though it were the whole message is the failure to avoid — so where only the
   * snippet was available, the forward says so rather than passing itself off as complete.
   */
  ok('a truncated one says so', /stored preview/.test(forwardBody(original, 'I can pay…', false)))
  check('a missing subject is named, not left blank',
    /Subject: \(no subject\)/.test(forwardBody({ ...original, subject: null }, 'x')), true)
}

const page = readFileSync(new URL('../../src/pages/mail/MailPage.tsx', import.meta.url), 'utf8')
ok('the mail page can start a message to anybody', /setComposing\(true\)/.test(page))
ok('...and forward one', /onForward=\{\(\) => startForward\(m\)\}/.test(page))
// A forward starts a new conversation. Threading it would file the recipient's reply against the
// debtor the original came from.
{
  const fwd = page.slice(page.indexOf('{forwarding && ('), page.indexOf('{replying && ('))
  // The PROP, not the word — the comment beside it explains why it is absent and would match.
  ok('a forward is not threaded onto the original', !/inReplyTo=\{/.test(fwd))
}
// The body is fetched rather than taken from the row, which holds only a snippet.
ok('forwarding fetches the real message', /await fetchMailBody\(mail\.id, token\)/.test(page))

/* ---------- and the unmatch tells the truth ---------- */

/*
 * It said "It is back under Needs matching" unconditionally. For a junk message that is false —
 * Needs matching excludes junk — so an agent unmatched a newsletter, was told where to look, and
 * found an empty list. Junk is the COMMON case for an unmatch: matching a newsletter to a debtor
 * by mistake is exactly the thing being undone.
 */
ok('the unmatch names the tab it actually lands in', /You will find it under \$\{landsIn\}/.test(page))
ok('...and knows junk goes to Junk', /mail\.isJunk \? 'Junk'/.test(page))
ok('...and that free mail does not go to the queue either', /mail\.noRecordAt \? 'Free mail'/.test(page))

/* ---------- replying to everybody ---------- */

/*
 * THE FIRM ASKED FOR IT: "I also can't respond to all recipients." A debtor who copies their
 * attorney arrived looking like a private message, and Reply answered the sender alone -- so the
 * attorney never saw the answer to the question they were copied on.
 */
const P = (address, name = null) => ({ name, address })

{
  const out = replyAllTo({
    from: P('ernest@example.co.za', 'Ernest Mohlalisi'),
    to: [P('stephan@bredellferreira.co.za')],
    cc: [P('camille@bredellferreira.co.za')],
    mine: ['stephan@bredellferreira.co.za'],
  })
  /* The sender leads: they asked the question and the answer is addressed to them. */
  eq('the sender is who the reply is to', out.to.map((p) => p.address), ['ernest@example.co.za'])
  /*
   * COPYING YOURSELF is the first way this goes wrong. Your own address is on the original --
   * that is how it reached you -- and left in, every reply-all drops a copy back in your own
   * inbox and the thread doubles every round.
   */
  eq('...and you are not copied on your own reply', out.cc.map((p) => p.address), ['camille@bredellferreira.co.za'])
}

/*
 * DROPPING SOMEBODY is the second, and it is the worse one: the whole point is that everybody who
 * saw the question sees the answer, so a list that quietly loses one person is a private reply
 * wearing a reply-all's label.
 */
eq('everybody else on it is carried', replyAllTo({
  from: P('a@x.co.za'),
  to: [P('me@firm.co.za'), P('b@x.co.za')],
  cc: [P('c@y.co.za'), P('d@z.co.za')],
  mine: ['me@firm.co.za'],
}).cc.map((p) => p.address), ['b@x.co.za', 'c@y.co.za', 'd@z.co.za'])

/* A mail server does not care about case, and one person is routinely written three ways. */
eq('the same person in two cases is one person', replyAllTo({
  from: P('a@x.co.za'),
  to: [P('B@X.co.za')],
  cc: [P('b@x.co.za')],
  mine: [],
}).cc.length, 1)
eq('...and that is how you are recognised too', replyAllTo({
  from: P('a@x.co.za'),
  to: [P('Me@Firm.co.za')],
  cc: [],
  mine: ['me@firm.co.za'],
}).cc.length, 0)
/* An agent's mail reaches them at their own address and at anything the firm forwards. */
eq('any of your addresses is still you', replyAllTo({
  from: P('a@x.co.za'),
  to: [P('me@firm.co.za'), P('info@firm.co.za')],
  cc: [],
  mine: ['me@firm.co.za', 'info@firm.co.za'],
}).cc.length, 0)

/*
 * THE SENDER IS CLAIMED FIRST, so a sender who also appears on Cc -- which Outlook does on its
 * own messages -- is not both replied to and copied.
 */
eq('the sender is not copied as well as addressed', replyAllTo({
  from: P('a@x.co.za'), to: [P('b@x.co.za')], cc: [P('a@x.co.za')], mine: [],
}).cc.map((p) => p.address), ['b@x.co.za'])

/* A message to you alone has nobody to copy, and reply-all is then just reply. */
eq('a private message copies nobody', replyAllTo({
  from: P('a@x.co.za'), to: [P('me@firm.co.za')], cc: [], mine: ['me@firm.co.za'],
}).cc.length, 0)
/* An empty address is not a person and must not become an empty entry on the line. */
eq('a blank address is not a recipient', replyAllTo({
  from: P('a@x.co.za'), to: [P('')], cc: [], mine: [],
}).cc.length, 0)

/* And the header line, which is what somebody reads before pressing send. */
eq('a named recipient reads as a name and an address',
  recipientLine([P('jane@x.co.za', 'Jane Smith')]), 'Jane Smith <jane@x.co.za>')
eq('...and an unnamed one as the address alone', recipientLine([P('bob@y.co.za')]), 'bob@y.co.za')
eq('several are one line', recipientLine([P('a@x.co'), P('b@x.co')]), 'a@x.co, b@x.co')
eq('nobody is nothing', recipientLine([]), '')

/* ---------- whose name is on it ---------- */

/*
 * THE BUG THIS EXISTS FOR: the sync stored mailparser's `.text` for the From header, which is the
 * whole formatted address and not the display name. Every list row read `"Urban Haus"
 * <info@urbanhaus...` truncated, the open message printed the address twice, and a button
 * offering to open the record was as wide as an email address. The sync now stores the name
 * alone; this cleans up what is already synced, which cannot be re-read because the upsert
 * ignores duplicates on purpose.
 */
check('a whole From header gives up its name',
  senderName('"Urban Haus" <info@urbanhausgroup.co.za>', 'info@urbanhausgroup.co.za'), 'Urban Haus')
check('...quoted or not',
  senderName('Urban Haus <info@urbanhausgroup.co.za>', 'info@urbanhausgroup.co.za'), 'Urban Haus')
check('a plain name is left alone', senderName('Ernest Mohlalisi', 'e@x.co.za'), 'Ernest Mohlalisi')
/*
 * NULL, NOT THE ADDRESS. An address masquerading as a name is worse than an honest address: it
 * gets greeted in a letter. The caller decides the fallback.
 */
check('no name at all is nothing', senderName(null, 'e@x.co.za'), null)
check('...and so is an empty one', senderName('  ', 'e@x.co.za'), null)
check('a bare address is not a name', senderName('e@x.co.za', 'e@x.co.za'), null)
check('...whatever case it is written in', senderName('E@X.co.za', 'e@x.co.za'), null)
check('an address with no display name in front of it is nothing',
  senderName('<e@x.co.za>', 'e@x.co.za'), null)

/*
 * ON SCREEN, RECIPIENTS ARE NAMES. recipientLine writes real header values, which is what a Cc box
 * needs and what goes out on the wire; printed, three of them is four wrapped lines. The firm:
 * "all of this is underneath each other, make it in a line next to each other to save space."
 */
check('recipients read as names', recipientNames([
  P('stephan@bredellferreira.co.za', 'Stephan Ferreira'),
  P('ryno@bredellferreira.co.za', 'Ryno'),
]), 'Stephan Ferreira, Ryno')
/* Somebody with no name is their address, which is still all there is to call them. */
check('...and an unnamed one by their address',
  recipientNames([P('joycem@cfdc.org.za')]), 'joycem@cfdc.org.za')
/* You are "you", which is shorter and is what every mail client does. */
check('you are not listed by name', recipientNames(
  [P('stephan@bredellferreira.co.za', 'Stephan Ferreira'), P('ryno@bredellferreira.co.za', 'Ryno')],
  ['stephan@bredellferreira.co.za'],
), 'you, Ryno')
check('...whatever case the header wrote it in', recipientNames(
  [P('Stephan@BredellFerreira.co.za', 'Stephan Ferreira')], ['stephan@bredellferreira.co.za'],
), 'you')
/* A name that is really an address is still cleaned up on the way past. */
check('a recipient whose "name" is their address is not printed twice',
  recipientNames([P('e@x.co.za', 'e@x.co.za')]), 'e@x.co.za')

/* ---------- a lead, out of the sender ---------- */

/*
 * ONE NAME FIELD, TWO BOXES. Mail carries "Ernest Mohlalisi" and a lead wants a first name and a
 * surname, so the split happens somewhere it can be argued with rather than inside a modal.
 * Everything here lands in an EDITABLE box -- these are guesses, and the person creating the lead
 * is reading the message while they look at them.
 */
eq('an ordinary name splits at the space',
  splitPersonName('Ernest Mohlalisi'), { firstName: 'Ernest', lastName: 'Mohlalisi' })
/*
 * Outlook writes surname-first on its own, and the comma is the whole signal. Read straight
 * through, it is the difference between phoning "Mr Ernest" and phoning Mr Mohlalisi.
 */
eq('a surname-first name is turned round',
  splitPersonName('Mohlalisi, Ernest'), { firstName: 'Ernest', lastName: 'Mohlalisi' })
/* Everything after the first word is the surname, which beats taking the last word alone --
   "van der Merwe" and "du Plessis" are ordinary South African surnames, not middle names. */
eq('a three-word surname stays whole',
  splitPersonName('Johan van der Merwe'), { firstName: 'Johan', lastName: 'van der Merwe' })
eq('one word is a first name', splitPersonName('Felicia'), { firstName: 'Felicia', lastName: '' })
/* info@ has no name behind it, and a blank beats inventing one. */
eq('no name at all fills nothing in', splitPersonName(null), { firstName: '', lastName: '' })
eq('...and neither does a blank one', splitPersonName('   '), { firstName: '', lastName: '' })
/* A stray comma with nothing on one side is not a surname-first name. */
eq('a trailing comma is not an ordering', splitPersonName('Mohlalisi,'), { firstName: 'Mohlalisi', lastName: '' })

/*
 * THE COMPANY, GUESSED OFF THE DOMAIN. Nearly always right and always quicker to correct than to
 * type -- and the caller only asks when the domain belongs to a company at all, because "Gmail"
 * in the Company box would be worse than an empty one.
 */
check('a domain becomes a company name', companyFromDomain('sasolburg-motors.co.za'), 'Sasolburg Motors')
/* co.za has to be stripped as a unit, or every local company would be called "Co" -- and nearly
   every company the firm deals with is local. */
check('co.za is stripped as one suffix', companyFromDomain('bredellferreira.co.za'), 'Bredellferreira')
check('a plain .com works too', companyFromDomain('acme.com'), 'Acme')
check('a mail subdomain is not the company', companyFromDomain('mail.acme.co.za'), 'Acme')
check('nothing in, nothing out', companyFromDomain(null), '')

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Sent mail is pulled but never filed and never charged, a forward carries the real message with
its headers, and an unmatched email says which tab it actually went to.`)
