/**
 * TEXT THAT A PDF CAN ACTUALLY PRINT.
 *
 * The firm, trying to attach a section 129 they had pasted in from Word: "WinAnsi cannot encode
 * ' ' (0x0009)". The letter would not attach, and the message named a character nobody can see.
 *
 * It was a TAB. The notice was copied out of a Word document on a tablet, and a Word TABLE copied
 * as plain text separates its cells with tabs. So the moment anybody pastes a table that way,
 * every row carries tabs -- invisible in the editor, because HTML collapses them, and fatal at
 * the PDF.
 *
 * WHAT THIS FILE IS REALLY FOR. `isPrintable` writes out the Windows-1252 repertoire by hand,
 * because a function that works by try/catch around a font cannot be reasoned about or run
 * without one. Written out, it can drift from what pdf-lib will actually accept -- so the first
 * and most important thing here holds the two against each other CHARACTER BY CHARACTER across
 * the whole of Unicode's first pages. If they ever disagree, this says which character.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-win-ansi.mjs
 */
import { StandardFonts, PDFDocument } from 'pdf-lib'
import { isPrintable, printableForPdf, unprintableMessage } from '../../src/lib/winAnsi.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ------------------------------------------------------------------ held against pdf-lib */

const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.TimesRoman)
/** What the real font says, which is the only authority on this. */
const fontTakes = (ch) => {
  try { font.widthOfTextAtSize(ch, 10); return true } catch { return false }
}

{
  /*
   * EVERY CODE POINT UP TO U+3000, which covers Latin, the punctuation block where the curly
   * quotes and dashes live, the arrows and the maths symbols people paste out of documents, and
   * the CJK space. Past that nothing is printable and nothing is in dispute.
   */
  const disagree = []
  for (let code = 0x20; code <= 0x3000; code += 1) {
    const ch = String.fromCodePoint(code)
    if (isPrintable(code) !== fontTakes(ch)) {
      disagree.push(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`)
    }
  }
  check(`the repertoire matches pdf-lib, character for character${disagree.length ? ` (${disagree.slice(0, 12).join(' ')})` : ''}`,
    disagree, [])
}

/*
 * THE 0x80-0x9F BAND, named on its own because it is the part people get wrong. In Latin-1 it is
 * control characters; in Windows-1252 it is the curly quotes, the dashes, the bullet and the
 * euro -- exactly what a letter written in Word is full of. Treating it as Latin-1 would strip
 * the punctuation out of every notice the firm has ever written.
 */
for (const [what, ch] of [
  ['a curly apostrophe', '’'], ['curly quotes', '“'], ['an en dash', '–'],
  ['an em dash', '—'], ['a bullet', '•'], ['an ellipsis', '…'],
  ['the euro sign', '€'], ['a dagger', '†'],
]) {
  ok(`${what} prints`, isPrintable(ch.codePointAt(0)) && fontTakes(ch))
}
/* And the Latin-1 half, which carries every surname with a diacritic in it. */
ok('an accented surname prints', [...'Böhmer Prätorius Zoë'].every((c) => isPrintable(c.codePointAt(0))))
/*
 * THE NON-BREAKING SPACE PRINTS, and that is worth its own line: en-ZA groups thousands with one,
 * so every Rand amount in every letter carries them. Had it needed replacing, "R 48 215.60" could
 * have broken across a line at the wrong place on a statutory notice.
 */
ok('the non-breaking space en-ZA groups with prints', isPrintable(0x00a0) && fontTakes(' '))

/* ------------------------------------------------------------------ the quiet fixes */

/*
 * THE ONE THE FIRM HIT. A tab becomes a single space -- it was a column separator in a document
 * that no longer has columns, and padding it out would leave ragged gaps mid-sentence.
 */
check('a tab becomes a space, silently',
  printableForPdf('DATE\t20 September\tREF\tBF104872'),
  { text: 'DATE 20 September REF BF104872', unprintable: [] })
/* A whole row of a Word table copied as text, which is where they come in threes. */
check('...however many of them a pasted table row carries',
  printableForPdf('Creditor\t\tNorthfield Credit').text, 'Creditor  Northfield Credit')

/*
 * Invisible characters a word processor leaves behind carry no ink and are simply dropped.
 *
 * THE SOFT HYPHEN IS THE INTERESTING ONE. Windows-1252 CAN encode it — at 0xAD, where the glyph
 * is an ordinary hyphen. So the character that means "you may break the word here", and is meant
 * to be invisible, prints as a hyphen in the middle of a word: a debtor reading "out-standing".
 * Being printable is not the same as being wanted, which is why the quiet fixes are asked before
 * the repertoire. Break-testing that order is what found this.
 */
for (const [what, ch] of [
  ['a zero-width space', '​'], ['a zero-width joiner', '‍'],
  ['a byte-order mark', '﻿'], ['a soft hyphen', '­'],
]) {
  check(`${what} is dropped without complaint`,
    printableForPdf(`a${ch}b`), { text: 'ab', unprintable: [] })
}
/* And the several Unicode spaces all say what an ordinary space says. */
check('a thin space becomes an ordinary one',
  printableForPdf('R 500').text, 'R 500')

/* ------------------------------------------------------------------ the ones that are words */

/*
 * SUBSTITUTING FOR THESE WOULD CHANGE WHAT THE DEBTOR IS TOLD, so they are reported instead and
 * the caller refuses. An arrow dropped out of "pay → the trust account" changes a sentence; a
 * dropped Chinese character changes a name.
 */
check('a real character that cannot be printed is reported, not guessed at',
  printableForPdf('pay → the trust account'),
  { text: 'pay  the trust account', unprintable: ['→'] })
check('...each one named once, however often it appears',
  printableForPdf('≥ a ≥ b → c').unprintable, ['≥', '→'])
/*
 * A NEWLINE IS REPORTED RATHER THAN SWALLOWED. By the time anything is drawn the layout engine
 * has already broken the letter into lines, so a newline arriving at the PDF is a fault in the
 * layout -- and quietly turning it into a space would hide that while producing a page with two
 * sentences run together.
 */
check('a newline reaching the PDF is reported as the fault it is',
  printableForPdf('one\ntwo').unprintable, ['\n'])

/* ------------------------------------------------------------------ what a person is told */

/*
 * "WinAnsi cannot encode" is the library talking to itself. What somebody needs is WHICH
 * character, so they can find it and take it out -- with its code, because several of these look
 * identical to something ordinary.
 */
const msg = unprintableMessage(['→'])
ok('the message names the character', msg.includes('→'))
ok('...and its code, because it may look like something ordinary', msg.includes('U+2192'))
ok('...and says what to do about it', /[Tt]ake it out/.test(msg))
ok('...and never mentions WinAnsi', !/WinAnsi|encode/i.test(msg))
check('...reading as English for one character', /a character that cannot/.test(msg), true)
check('...and for several', /characters that cannot/.test(unprintableMessage(['→', '≥'])), true)

/* ------------------------------------------------------------------ nothing ordinary is touched */

/*
 * THE WHOLE OF A REAL NOTICE GOES THROUGH UNCHANGED. A sanitiser that quietly altered ordinary
 * wording would be far worse than the bug it replaced, so this is asserted on the kind of
 * sentence the firm actually writes -- curly apostrophes, an en dash, a bullet, an accented
 * surname and a Rand amount with its non-breaking space.
 */
const real = 'Dear Mr Böhmer, you owe R 48 215.60 – see the creditor’s '
  + 'statement. • Pay in full. • Telephone us on 012 348 2156.'
check('a real sentence is not touched at all', printableForPdf(real), { text: real, unprintable: [] })
ok('...and the font agrees it can be drawn', fontTakes(real))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
What a PDF can print, written out by hand and held against pdf-lib character for character. The
tab a Word table leaves behind when it is copied as text -- the one that stopped the firm
attaching a section 129 -- is fixed quietly, along with every other invisible a word processor
leaves. A character that is a real word is reported instead, named and with its code, because
substituting for one would change what the debtor is told.`)
