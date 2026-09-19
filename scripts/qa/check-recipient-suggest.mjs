/**
 * Finding the person you meant from three letters.
 *
 * THE FIRM'S OWN TEST: "if I've sent an email to Reno, I can paste in R, E, N, and then it picks
 * it up." That is the whole feature and it is one assertion; everything else here exists because
 * an autocomplete that is nearly right is worse than none. A list that offers forty addresses on
 * two letters is a list people stop reading, and then the one time it had the right answer they
 * typed the address by hand anyway.
 *
 * Four ways it goes wrong:
 *
 *   - matching the address only, so REN never finds Reno, whose address is r.buitendag@
 *   - matching the whole string only, so "buitendag" never finds "Reno Buitendag"
 *   - ranking a match in the middle of a word level with one at the start, so "an" buries the one
 *     person called Andries under every address containing an A and an N
 *   - ranking by recency, so the person written to every week is second to somebody written to
 *     once this morning
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-recipient-suggest.mjs
 */
import {
  describe, looksLikeAddress, rankOf, suggestRecipients, wordsOf,
} from '../../src/lib/recipientSuggest.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const s = (address, name = null, uses = 1, lastUsed = '2026-09-01') => ({ address, name, uses, lastUsed })

const RENO = s('r.buitendag@gpsprop.co.za', 'Reno Buitendag', 9, '2026-09-10')
const ANDRIES = s('andries@moloto.co.za', 'Andries Moloto', 3, '2026-09-18')
const SHARED = s('accounts@bredellferreira.co.za', null, 40, '2026-09-19')
const BOOK = [RENO, ANDRIES, SHARED, s('l.naidoo@acf.co.za', 'Leanne Naidoo', 2),
  s('info@gpsprop.co.za', null, 1)]

/* ---------- the firm's own test ---------- */

/*
 * "I CAN PASTE IN R, E, N, AND THEN IT PICKS IT UP." Reno's address begins with r.buitendag, so
 * an autocomplete that matches addresses alone never finds him — which is what a <datalist> built
 * from email columns does, and is the thing being replaced.
 */
check('REN finds Reno', suggestRecipients(BOOK, 'REN').map((x) => x.address), [RENO.address])
check('...and so does one letter', suggestRecipients(BOOK, 'r')[0].address, RENO.address)
check('...and the whole first name', suggestRecipients(BOOK, 'reno')[0].address, RENO.address)
/* The surname too: people reach for whichever half they remember. */
check('the surname finds him as well', suggestRecipients(BOOK, 'buit')[0].address, RENO.address)
/* And the address, once somebody starts typing it. */
check('so does the start of the address', suggestRecipients(BOOK, 'r.bui')[0].address, RENO.address)
check('nobody matches nonsense', suggestRecipients(BOOK, 'zzzz'), [])

/* ---------- the words a match can start at ---------- */

/*
 * A NAME AND AN ADDRESS BREAK ON DIFFERENT THINGS. A name splits on spaces; an address splits on
 * the punctuation people actually put in them, and the domain is its own word so that typing a
 * company name finds everybody there.
 */
const words = wordsOf(RENO)
for (const w of ['reno', 'buitendag', 'r', 'gpsprop', 'gpsprop.co.za', 'co', 'za']) {
  ok(`"${w}" is one of the words of Reno's entry`, words.includes(w))
}
check('...and each only once', words.length, new Set(words).size)
check('a company name finds everybody there',
  suggestRecipients(BOOK, 'gpsprop').map((x) => x.address).sort(),
  ['info@gpsprop.co.za', 'r.buitendag@gpsprop.co.za'])
/* Underscores and hyphens are word breaks too — addresses are written all three ways. */
ok('an underscore breaks a word', wordsOf(s('reno_b@x.co.za')).includes('b'))
ok('...and a hyphen', wordsOf(s('reno-buitendag@x.co.za')).includes('buitendag'))
ok('...and a plus', wordsOf(s('reno+tag@x.co.za')).includes('tag'))

/* ---------- where the match is decides the order ---------- */

/*
 * SOMEBODY TYPING THREE LETTERS IS NOT SEARCHING, THEY ARE RECOGNISING — so what they typed is
 * nearly always the start of something. A substring match level with a prefix match is how "an"
 * offers every address containing those letters before the one person called Andries.
 */
check('an exact address beats everything', rankOf(RENO, RENO.address), 0)
check('...then the start of the address', rankOf(RENO, 'r.bui'), 1)
check('...then the start of the name as typed', rankOf(RENO, 'reno b'), 1)
check('...then the start of any word', rankOf(RENO, 'buit'), 2)
check('...and a match in the middle is last', rankOf(RENO, 'uitend'), 3)
check('no match at all is nothing', rankOf(RENO, 'qqq'), null)
/*
 * TWO LETTERS DO NOT MATCH IN THE MIDDLE. They match somewhere inside nearly every address, and a
 * substring tier that took them would bury the prefix matches under noise on exactly the keystroke
 * where the list is most useful.
 */
check('two letters mid-word match nothing', rankOf(RENO, 'ui'), null)
check('...while three do', rankOf(RENO, 'uit'), 3)
/* A prefix still works at any length, which is the common case. */
check('two letters at the start of a word still match', rankOf(RENO, 'bu'), 2)

/*
 * A HEAVILY USED ADDRESS THAT ONLY MATCHES IN THE MIDDLE STILL LOSES, and on a two-letter query it
 * does not appear at all. Written first with two entries that both matched at the same tier, which
 * proved nothing — the example has to be one prefix and one substring or the assertion is about
 * the use count.
 */
const mixed = [s('andries@moloto.co.za', 'Andries Moloto', 1), s('x@y.co.za', 'Zoe Fanana', 500)]
check('two letters do not reach into the middle of a word at all',
  suggestRecipients(mixed, 'an').map((x) => x.address), ['andries@moloto.co.za'])
check('...and at three letters the prefix still leads, 500 uses or not',
  suggestRecipients(mixed, 'and').map((x) => x.address), ['andries@moloto.co.za'])
check('...while the one it is inside is reachable on its own word',
  suggestRecipients(mixed, 'fan').map((x) => x.address), ['x@y.co.za'])

/* ---------- frequency, not recency ---------- */

/*
 * The person written to every week leads even on a day somebody else was written to. Recency
 * breaks the tie and does not set the order: an address used once this morning outranking one
 * used forty times is how the useful suggestion ends up second every day.
 */
const often = s('a@x.co.za', 'Tie One', 40, '2026-01-01')
const lately = s('b@x.co.za', 'Tie Two', 2, '2026-09-19')
check('the one written to most often leads',
  suggestRecipients([lately, often], 'tie').map((x) => x.address), ['a@x.co.za', 'b@x.co.za'])
check('...and recency only breaks a tie',
  suggestRecipients([s('c@x.co.za', 'Tie Three', 5, '2026-01-01'), s('d@x.co.za', 'Tie Four', 5, '2026-09-19')], 'tie')
    .map((x) => x.address), ['d@x.co.za', 'c@x.co.za'])
/* And the address breaks THAT tie, so the list does not reshuffle between two identical rows. */
check('the order is stable where everything else is equal',
  suggestRecipients([s('z@x.co.za', 'Same', 1, '2026-01-01'), s('a@x.co.za', 'Same', 1, '2026-01-01')], 'same')
    .map((x) => x.address), ['a@x.co.za', 'z@x.co.za'])

/* ---------- an empty box shows the people you write to ---------- */

/*
 * Opening the field with nothing typed offers the list rather than nothing: the firm's complaint
 * was that the box remembered nobody, and a box that only remembers once you have guessed the
 * first letter correctly still remembers nobody.
 */
check('an empty query offers everybody, most used first',
  suggestRecipients(BOOK, '').map((x) => x.address),
  [SHARED.address, RENO.address, ANDRIES.address, 'l.naidoo@acf.co.za', 'info@gpsprop.co.za'])
check('...and whitespace is the same as empty', suggestRecipients(BOOK, '   ').length, 5)
/* The list is a glance, not a scroll. */
check('it is capped', suggestRecipients(BOOK, '', 2).length, 2)
check('a cap of nothing shows nothing', suggestRecipients(BOOK, '', 0).length, 0)

/* ---------- when to stop offering ---------- */

ok('a finished address is recognised', looksLikeAddress('reno@gpsprop.co.za'))
ok('...and a half-typed one is not', !looksLikeAddress('reno@gpsprop'))
ok('...nor a name', !looksLikeAddress('Reno Buitendag'))
ok('...nor an address with a space in it', !looksLikeAddress('reno @x.co.za'))

check('a remembered person reads as name and address', describe(RENO), 'Reno Buitendag <r.buitendag@gpsprop.co.za>')
check('...and an address with no name reads as itself', describe(SHARED), SHARED.address)

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
REN finds Reno, whose address begins with r.buitendag — which is the firm's own test and the one a
match on the address alone fails. A prefix beats a match in the middle, so three letters do not
return the whole book; two letters never match mid-word at all; and the person written to every
week leads over somebody written to once this morning.`)
