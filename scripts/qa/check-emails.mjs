/**
 * Email with a debtor: the fee, the threading, and the address matching.
 *
 * The threading tests are the ones that matter. A reply finds its account by the Message-ID it
 * names in In-Reply-To or References — if that reading is wrong, a debtor's answer to a demand
 * letter silently goes nowhere, and nobody finds out until someone asks why the account looks
 * unworked.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-emails.mjs
 */
import {
  CORRESPONDENCE_ACTION_CODE, CORRESPONDENCE_DESCRIPTION, CORRESPONDENCE_ITEM_ID,
  EMAIL_ACTION_CODE, EMAIL_DESCRIPTION, EMAIL_IN_KIND, EMAIL_ITEM_ID, EMAIL_OUT_KIND,
  normaliseAddress, receivedEmailNote, replySubject, sentEmailNote, threadIds,
} from '../../src/lib/emailRules.ts'
import { scheduleFor } from '../../src/lib/annexureB.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n     expected ${e}\n     actual   ${a}`)
}

/* ------------------------------------------------------------------ *
 * The fee. The firm's instruction, verbatim: "25 rand for every email
 * sent or responded to."
 * ------------------------------------------------------------------ */
const schedule = scheduleFor(new Date('2026-09-12'))
const item = schedule.items.find((i) => i.id === EMAIL_ITEM_ID)

check('an email is charged under item 1(a)', EMAIL_ITEM_ID, '1a')
check('...which is the letter/e-mail item', /e-?mail/i.test(item.description), true)
check('...and it is R25 on the current schedule', item.amount, 25)
check('the statement calls it Email', EMAIL_DESCRIPTION, 'Email')
check('the timeline files it under email', EMAIL_ACTION_CODE, 'email')

// Item 1(a) has no total and no monthly cap, which is what makes "every email" chargeable
// rather than only the first one. If a future schedule changes that, this fails loudly.
check('item 1(a) carries no per-account total', item.itemTotal ?? null, null)
check('...and no monthly maximum', item.maxPerMonth ?? null, null)

/* ---- and what arrives: item 6, the correspondence fee ---- */
// The firm's instruction: "for every email received, there's also a correspondence fee." So an
// exchange bills TWICE, under two different items at two different rates, and the commonest way
// to get this wrong would be to charge one item for both directions.
const item6 = schedule.items.find((i) => i.id === CORRESPONDENCE_ITEM_ID)

check('an incoming email is charged under item 6', CORRESPONDENCE_ITEM_ID, '6')
check('...which is the correspondence-received item',
  /correspondence received/i.test(item6.description), true)
check('...and it is R13 on the current schedule', item6.amount, 13)
check('the statement distinguishes it from what we send',
  CORRESPONDENCE_DESCRIPTION === EMAIL_DESCRIPTION, false)
check('...as does the timeline', CORRESPONDENCE_ACTION_CODE === EMAIL_ACTION_CODE, false)

// The two directions must stay separate items at separate rates. If these ever collapse into
// one, every exchange starts billing the same fee twice.
check('the two directions are different items', CORRESPONDENCE_ITEM_ID === EMAIL_ITEM_ID, false)
check('...at different rates', item6.amount === item.amount, false)
check('an exchange therefore costs R38 excluding VAT', item.amount + item6.amount, 38)

// Item 6 has no total and no monthly cap either, which is what makes "every email received"
// chargeable rather than only the first.
check('item 6 carries no per-account total', item6.itemTotal ?? null, null)
check('...and no monthly maximum', item6.maxPerMonth ?? null, null)
check('...and counts towards the items 1-7 ceiling, like item 1(a)',
  [item6.countsTowardCap, item.countsTowardCap], [true, true])

/* ---- what the timeline says ---- */
const sent = sentEmailNote('ryno@example.co.za', 'Account 12345', 'Please call us back.')
check('a sent note names the recipient', sent.includes('ryno@example.co.za'), true)
check('...the subject', sent.includes('Subject: Account 12345'), true)
check('...the body, in full', sent.includes('Please call us back.'), true)

check('a message with no subject still reads',
  sentEmailNote('a@b.co', '', 'hi').includes('(no subject)'), true)

const got = receivedEmailNote('Ryno <ryno@example.co.za>', 'Re: Account 12345', 'I will pay Friday.')
check('a received note names the sender', got.includes('ryno@example.co.za'), true)
check('...and carries their words', got.includes('I will pay Friday.'), true)

/*
 * A note says what happened. It does NOT say what it cost.
 *
 * These notes used to end with "Charged R25,00 plus VAT under item 1(a)." and the firm had it
 * taken out: "don't have to say about the charges in the notes, it's on the transaction list."
 * Every fee is already its own entry on the same timeline as well as a line on Transactions, so
 * the sentence made one email read as two events.
 *
 * Asserted rather than just deleted, because the natural thing for anyone touching these
 * functions later is to helpfully put the amount back.
 */
const MONEY = /R\s?\d|VAT|charged|item 1\(a\)|item 6|ceiling|written off|allowance/i
for (const [name, note] of [
  ['a sent note', sent],
  ['a received note', got],
  ['a sent note with a long body', sentEmailNote('a@b.co', 's', 'x'.repeat(500))],
  ['a received note with no subject', receivedEmailNote('a@b.co', '', 'hi')],
]) {
  check(`${name} says nothing about money`, MONEY.test(note), false)
}
// The body is passed through verbatim, so a debtor who writes about money is still quoted in
// full -- it is OUR fee sentence that is gone, not their words.
check('...but a debtor writing about money is still quoted',
  receivedEmailNote('a@b.co', 's', 'I can pay R800 plus VAT on Friday').includes('R800 plus VAT'),
  true)

check('the two directions get different timeline kinds', EMAIL_OUT_KIND === EMAIL_IN_KIND, false)

/* ------------------------------------------------------------------ *
 * Threading. How a reply finds its own account.
 * ------------------------------------------------------------------ */
const PARENT = '<abc123@mail.example.com>'
const OLDER = '<older@mail.example.com>'

check('In-Reply-To names the parent', threadIds(PARENT, null), [PARENT])
check('References is read when In-Reply-To is missing',
  threadIds(null, `${OLDER} ${PARENT}`), [PARENT, OLDER])
check('...newest first, so a long thread resolves to its most recent turn',
  threadIds(null, `${OLDER} ${PARENT}`)[0], PARENT)
check('In-Reply-To is preferred over References',
  threadIds(PARENT, OLDER)[0], PARENT)
check('References as an array works too', threadIds(null, [OLDER, PARENT]), [PARENT, OLDER])
check('a first email names nothing', threadIds(null, null), [])
check('an empty In-Reply-To names nothing', threadIds('', ''), [])
check('whitespace is not an id', threadIds('   ', null), [])
check('multiple ids in In-Reply-To are all read',
  threadIds(`${PARENT} ${OLDER}`, null), [PARENT, OLDER])

/* ---- addresses ---- */
check('a bare address normalises to itself', normaliseAddress('ryno@example.co.za'), 'ryno@example.co.za')
check('case is ignored, because mail servers ignore it',
  normaliseAddress('Ryno@Example.CO.ZA'), 'ryno@example.co.za')
check('a display name is stripped',
  normaliseAddress('Ryno Buitendag <ryno@example.co.za>'), 'ryno@example.co.za')
check('...even with odd spacing', normaliseAddress('  "Buitendag, R" <RYNO@example.co.za>  '), 'ryno@example.co.za')
check('something that is not an address is not one', normaliseAddress('ryno'), null)
check('nothing is not an address', normaliseAddress(null), null)
check('an empty string is not an address', normaliseAddress(''), null)
check('two different debtors do not collide',
  normaliseAddress('a@x.co') === normaliseAddress('b@x.co'), false)

/* ---- reply subjects ---- */
check('a reply is prefixed', replySubject('Account 12345'), 'Re: Account 12345')
check('an existing Re: is not stacked', replySubject('Re: Account 12345'), 'Re: Account 12345')
check('...whatever its case', replySubject('RE: Account 12345'), 'RE: Account 12345')
check('replying three times still reads once',
  replySubject(replySubject(replySubject('Account 12345'))), 'Re: Account 12345')
check('a missing subject still gives something to send', replySubject(null), 'Re:')
check('so does an empty one', replySubject('   '), 'Re:')

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL ${f}`)
process.exit(failures.length ? 1 : 0)
