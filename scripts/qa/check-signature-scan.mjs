/**
 * Does the signature scanner find real numbers, and — far more important — does it leave alone
 * the things that merely look like numbers?
 *
 * The asymmetry is the whole point. A number it misses costs a collector nothing they had. A
 * number it invents gets ticked by a busy agent, written onto a debtor's account, and then
 * MATCHED by the sync — which files future mail automatically and charges item 6 every time.
 * So the refusals below matter more than the finds, and there are deliberately more of them.
 *
 *   node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-signature-scan.mjs
 */
import { findContactDetails, topBlock } from '../../src/lib/signature.ts'

let failures = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) {
    failures += 1
    console.error(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`)
  } else {
    console.log(`ok   ${name}`)
  }
}

const values = (body) => findContactDetails(body).map((c) => `${c.kind}:${c.value}`)

/* ---------------------------------------------------------------- *
 * Finds what it should
 * ---------------------------------------------------------------- */

// The real one, from staging: a debtor volunteering a new number mid-sentence.
check('debtor gives a new number in Afrikaans',
  values('Goeie dag. Ek het julle brief ontvang oor die Edgars rekening. Ek kan R600 per maand betaal vanaf 30 Oktober. My nuwe nommer is 083 555 0199.'),
  ['mobile:083 555 0199'])

check('+27 international form', values('Please call me on +27 82 555 1234.'), ['mobile:082 555 1234'])
check('27 without the plus', values('Reach me: 2721 555 1234'), ['phone:021 555 1234'])
check('no spaces', values('cell 0835550199'), ['mobile:083 555 0199'])
check('dashes and brackets', values('Tel: (021) 555-1234'), ['phone:021 555 1234'])
check('landline is not a mobile', values('Office: 011 234 5678'), ['phone:011 234 5678'])
check('087 VoIP is a phone, not a mobile', values('Support: 087 550 1000'), ['phone:087 550 1000'])
check('086 share-call is a phone', values('Fax to 086 123 4567'), ['phone:086 123 4567'])

check('a signature block with two numbers',
  values(['Regards', 'J M van Wyk', 'Mobile: 083 555 0199', 'Work: 021 555 1234'].join('\n')),
  ['mobile:083 555 0199', 'phone:021 555 1234'])

check('the same number twice is offered once',
  values('Call 083 555 0199 or 0835550199'),
  ['mobile:083 555 0199'])

/* ---------------------------------------------------------------- *
 * Refuses what it should — the half that protects a statement
 * ---------------------------------------------------------------- */

check('a 13-digit SA identity number', values('My ID is 8001015009087, please update it.'), [])
check('an account number', values('Account 0123456789 is in dispute.'), [])
check('a reference', values('Reference: 0211234567'), [])
check('an Afrikaans rekening number', values('Rekening 0835550199 is verkeerd.'), [])
check('an amount', values('I can pay R600 per month from 30 October.'), [])
check('a date and an amount together', values('Paid R1 234.56 on 2026/09/13.'), [])
check('09 is not an allocated prefix', values('Call 091 234 5678'), [])
check('too few digits', values('Ext 0215'), [])

/* ---------------------------------------------------------------- *
 * The quoted chain belongs to somebody else
 * ---------------------------------------------------------------- */

const reply = [
  'Thanks, my number is 083 555 0199.',
  '',
  'On 13 Sep 2026 at 00:37, Bredell Ferreira wrote:',
  '> Please contact our offices on 012 345 6789 to discuss.',
  '> Steyn Attorneys, 021 999 8888',
].join('\n')
check('only the sender\'s own number, not the quoted chain', values(reply), ['mobile:083 555 0199'])

const forwarded = [
  'See below.',
  '',
  '---------- Forwarded message ---------',
  'From: Steyn Attorneys <admin@steyn.co.za>',
  'Mobile: 082 111 2222',
].join('\n')
check('nothing out of a forwarded block', values(forwarded), [])

check('Outlook header form cuts the block',
  topBlock('My cell is 083 555 0199.\n\nFrom: Someone\nSent: Monday\nMobile: 082 111 2222').includes('082'),
  false)

/* ---------------------------------------------------------------- *
 * Shape of what comes back
 * ---------------------------------------------------------------- */

const one = findContactDetails('Regards\nJ M van Wyk\nMy nuwe nommer is 083 555 0199.')[0]
check('carries the line it was found on, for a person to judge',
  one.context, 'My nuwe nommer is 083 555 0199.')
check('kind matches account_contacts', one.kind, 'mobile')

check('never floods the list',
  findContactDetails(
    ['083 555 0199', '082 111 2222', '021 555 1234', '011 234 5678', '031 222 3333', '041 999 8888']
      .join('\n'),
  ).length <= 5,
  true)

check('an empty body is not an error', values(''), [])

console.log(failures === 0
  ? '\nPASS — signature scan finds real numbers and refuses references, IDs, amounts and quoted chains'
  : `\nFAILED ${failures} check(s)`)
process.exit(failures === 0 ? 0 : 1)
