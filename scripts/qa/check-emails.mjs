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

// The road not taken, asserted so nobody quietly takes it: an inbound message is item 6, and
// item 6 is R13. Charging R25 for receiving would be charging the wrong item at the wrong rate.
const item6 = schedule.items.find((i) => i.id === '6')
check('the item for incoming post is a different item', item6.id !== EMAIL_ITEM_ID, true)
check('...at a different price', item6.amount === item.amount, false)
check('...and it requires attending to, not merely arriving',
  /attended to/i.test(item6.description), true)

/* ---- what the timeline says ---- */
const charged = { exclVat: 25, vat: 3.75, reason: 'charged' }
const sent = sentEmailNote('ryno@example.co.za', 'Account 12345', 'Please call us back.', charged)
check('a sent note names the recipient', sent.includes('ryno@example.co.za'), true)
check('...the subject', sent.includes('Subject: Account 12345'), true)
check('...the body, in full', sent.includes('Please call us back.'), true)
check('...and what it earned, under the right item', sent.includes('under item 1(a)'), true)

check('a message with no subject still reads',
  sentEmailNote('a@b.co', '', 'hi', charged).includes('(no subject)'), true)

for (const [reason, expected] of [
  ['written-off', 'written off'],
  ['at-ceiling', 'ceiling'],
  ['item-total-spent', 'already been used'],
  ['monthly-limit', 'monthly allowance'],
]) {
  check(`a ${reason} send says why it did not charge`,
    sentEmailNote('a@b.co', 's', 'b', { exclVat: 0, vat: 0, reason }).toLowerCase().includes(expected),
    true)
}

const got = receivedEmailNote('Ryno <ryno@example.co.za>', 'Re: Account 12345', 'I will pay Friday.')
check('a received note names the sender', got.includes('ryno@example.co.za'), true)
check('...and carries their words', got.includes('I will pay Friday.'), true)
// No fee is due on an inbound message, so the note must not discuss one at all. Saying "not
// charged" would read as a charge that failed rather than one that was never owed.
check('...and says nothing about a charge', /charg/i.test(got), false)

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
