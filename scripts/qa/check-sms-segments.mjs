/**
 * What an SMS costs to send, which is what the debtor is charged.
 *
 * Annexure B item 1(c) is R3.50 per communication, and the network decides how many
 * communications a message is. Getting this wrong misprices every SMS the system sends.
 *
 * Run: node --experimental-strip-types scripts/qa/check-sms-segments.mjs
 */
import { smsCost, unitsUntilNextSegment } from '../../src/lib/smsSegments.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n     expected ${e}\n     actual   ${a}`)
}
const seg = (t) => smsCost(t).segments
const enc = (t) => smsCost(t).encoding

/* ---- plain messages ---- */
check('an empty message costs nothing', smsCost('').segments, 0)
check('a short message is one', seg('Good day, your account is in arrears.'), 1)
check('exactly 160 is still one', seg('a'.repeat(160)), 1)
check('161 becomes two', seg('a'.repeat(161)), 2)
// Split messages lose 7 characters a segment to the concatenation header, so two segments hold
// 306, not 320.
check('306 is two', seg('a'.repeat(306)), 2)
check('307 is three', seg('a'.repeat(307)), 3)
check('459 is three', seg('a'.repeat(459)), 3)
check('460 is four', seg('a'.repeat(460)), 4)

/* ---- the GSM alphabet ---- */
check('plain text is GSM-7', enc('Bredell Ferreira: your account ACF10001 is overdue.'), 'GSM-7')
check('a pound sign is in the alphabet', enc('Pay £10'), 'GSM-7')
check('so are the Afrikaans vowels in it', enc('Grüße, Ö, ä, ñ'), 'GSM-7')

/* ---- the seven that cost double ---- */
check('a square bracket costs two', smsCost('[').units, 2)
check('a euro sign costs two', smsCost('€').units, 2)
check('...and stays GSM-7', enc('€'), 'GSM-7')
// 80 brackets is 160 units: still one segment, even though it is only 80 characters.
check('80 brackets fill one segment', seg('['.repeat(80)), 1)
check('81 brackets need two', seg('['.repeat(81)), 2)

/* ---- one wrong character doubles the bill ---- */
const plain = 'a'.repeat(140)
check('140 plain characters are one segment', seg(plain), 1)
// A curly apostrophe pasted out of Word is the classic one.
check('...but one curly quote forces UCS-2', enc(`${plain}’`), 'UCS-2')
check('...and that is three segments', seg(`${plain}’`), 3)
check('70 UCS-2 characters are one', seg('’'.repeat(70)), 1)
check('71 are two', seg('’'.repeat(71)), 2)
check('what forced it is reported', smsCost(`${plain}’`).offending, ['’'])

/* ---- emoji are two units each in UCS-2 ---- */
check('an emoji is UCS-2', enc('Paid \u{1F44D}'), 'UCS-2')
// Counted by code point, not UTF-16 length: "Paid " is 5, the emoji is 2.
check('an emoji costs two units, not one', smsCost('Paid \u{1F44D}').units, 7)
// Reported as the emoji, not as the two halves of a surrogate pair -- this string is shown to the
// person writing the message, and "what forced this to UCS-2 was \uD83D" helps nobody.
check('an emoji is reported whole', smsCost('Paid \u{1F44D}').offending, ['\u{1F44D}'])
check('35 emoji fill a segment', seg('\u{1F44D}'.repeat(35)), 1)
check('36 do not', seg('\u{1F44D}'.repeat(36)), 2)

/* ---- what is left before it costs more ---- */
check('an empty message has 160 to spend', unitsUntilNextSegment(''), 160)
check('160 used leaves none', unitsUntilNextSegment('a'.repeat(160)), 0)
check('161 used leaves 145 of the second', unitsUntilNextSegment('a'.repeat(161)), 145)
check('a UCS-2 message counts in 70s', unitsUntilNextSegment('’'), 69)

/* ---- a real collections message ---- */
const real = 'Bredell Ferreira: Your account ACF10001 is in arrears. Please contact us on 010 444 0044 to arrange payment. Ref Q-2026-0041.'
check('a real reminder is one segment', seg(real), 1)
check('...in GSM-7', enc(real), 'GSM-7')

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  !! ${f}`)
process.exit(failures.length ? 1 : 0)
