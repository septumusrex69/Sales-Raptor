/**
 * THE ONE FONT THIS REPOSITORY SHIPS.
 *
 * The firm, looking at their own section 129: "do you have the font charter? I like that… I think
 * we should use this font in our writing." Charter is not one of the fourteen standard PDF faces,
 * so honouring that means EMBEDDING a font in every notice — which is the thing letterPdf was
 * written not to do. charter.ts argues the reversal; this file holds the four facts it rests on,
 * because every one of them is the kind that stops being true quietly.
 *
 *   - THE LICENCE NOTICE MUST TRAVEL WITH THE FILES. Bitstream's grant is conditional on it. A
 *     tidy-up that deletes a stray LICENCE.txt from a fonts folder is an ordinary-looking commit
 *     and it is the one that makes shipping the font unlawful.
 *   - THE FONT ITSELF DECIDES WHAT IT CAN DRAW, not CHARTER_GAPS. The list is asked of the four
 *     files, character by character, across the whole Windows-1252 repertoire — so replacing the
 *     files with a fuller or a thinner cut is reported here rather than discovered as a hollow
 *     box in the middle of a Rand amount on a statutory demand.
 *   - THE .ttf AND THE .woff2 ARE THE SAME OUTLINES. The sheet is typed in one and the PDF is
 *     drawn in the other; if they ever differ, the page and the paper disagree about where a line
 *     ends and nothing says so.
 *   - A NOTICE STILL GOES OUT WHEN THE FONT DOES NOT. The firm sends statutory demands from this
 *     button; a 404 on a font file may make a letter look wrong and may not stop it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-charter.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument } from 'pdf-lib'
import {
  CHARTER_EMAIL_STACK, CHARTER_GAPS, CHARTER_STACK, CHARTER_TTF, isCharter,
} from '../../src/lib/charter.ts'
import {
  EMAIL_FONTS, emailBodyCss, emailBodyHtml, emailBodyStyle,
} from '../../src/lib/emailStyle.ts'
import { isPrintable, printableForPdf } from '../../src/lib/winAnsi.ts'
import { letterToPdf, standardFamilyFor } from '../../src/lib/letterPdf.ts'
import { A4_LETTERHEAD, blankLetter } from '../../src/lib/letterDocument.ts'
import { planLetter } from '../../src/lib/letterLayout.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/**
 * A string with its invisible characters shown.
 *
 * BECAUSE THE WHOLE POINT IS A CHARACTER NOBODY CAN SEE. Breaking the non-breaking-space gap on
 * purpose, as the convention in CLAUDE.md requires, produced a failure that read
 * `expected "R 12 345,67" got "R 12 345,67"` -- correct, useless, and exactly the kind of warning
 * people stop reading. Compared through here it says U+00A0 against a space.
 *
 * The escapes in this file are written \\u00a0 rather than typed, for the same reason: a literal
 * non-breaking space in the source of a check ABOUT non-breaking spaces is indistinguishable from
 * a space to everybody who reads it afterwards.
 */
const visible = (text) => text.replace(/[^\x20-\x7e]/g,
  (c) => `<U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}>`)

const DIR = 'public/fonts/charter'
const FACES = ['regular', 'bold', 'italic', 'bold-italic']

/* ------------------------------------------------------------------ the files and the licence */

for (const face of FACES) {
  ok(`${face} is shipped as a .ttf, which is what pdf-lib can embed`,
    existsSync(`${DIR}/charter-${face}.ttf`))
  ok(`${face} is shipped as a .woff2, which is what the editor's sheet is typed in`,
    existsSync(`${DIR}/charter-${face}.woff2`))
}

/*
 * THE GRANT, IN THE WORDS IT WAS GIVEN IN. Not "a licence file exists" — a file called LICENCE
 * containing the wrong licence would pass that, and the permission this repository relies on is
 * specifically Bitstream's, which names redistribution and requires the notice to stay put.
 */
const licence = existsSync(`${DIR}/LICENCE.txt`) ? readFileSync(`${DIR}/LICENCE.txt`, 'utf8') : ''
ok('the licence notice ships beside the fonts, as the grant requires', licence.length > 0)
ok('...and it is Bitstream\'s grant, naming redistribution', /redistribute/i.test(licence))
ok('...conditional on the notice being left intact, which is why it is here',
  /left intact/i.test(licence))
ok('...and acknowledging the trademark, which the grant also requires',
  /BITSTREAM CHARTER is a registered trademark/i.test(licence))

/*
 * THE TWO FORMATS ARE THE SAME FONT. A WOFF2's header declares the size of the sfnt it
 * decompresses to; the .ttf here was produced by decompressing that very file, so the two numbers
 * are equal to the byte. Replace one without the other and this is what says so.
 */
for (const face of FACES) {
  const woff2 = readFileSync(`${DIR}/charter-${face}.woff2`)
  const ttf = readFileSync(`${DIR}/charter-${face}.ttf`)
  check(`${face}: the .ttf is the decompression of the .woff2`,
    woff2.length >= 20 && woff2.toString('latin1', 0, 4) === 'wOF2'
      ? woff2.readUInt32BE(16) : 'not a woff2',
    ttf.length)
}

/* ------------------------------------------------------------------ what the font can draw */

/**
 * Every code point Windows-1252 can write, asked of winAnsi rather than written out a second
 * time — a copy of the repertoire here could agree with itself and disagree with the letter.
 */
const REPERTOIRE = []
for (let code = 0x20; code <= 0xffff; code += 1) if (isPrintable(code)) REPERTOIRE.push(code)
ok('the repertoire read back from winAnsi is Windows-1252 whole', REPERTOIRE.length === 218)
ok('...and it includes the non-breaking space this is all about', REPERTOIRE.includes(0x00a0))

/**
 * AND ONLY THE PART OF IT THAT CAN REACH A FONT. winAnsi takes some characters out before
 * anything is measured — the soft hyphen above all, which Windows-1252 CAN encode and draws as a
 * real hyphen mid-word. Charter has no glyph for it either, and it does not matter, because the
 * font is never asked. Asking the font about it anyway is how this file would demand that
 * CHARTER_GAPS declare a character no letter can carry.
 */
const survives = (code) => {
  const ch = String.fromCodePoint(code)
  return printableForPdf(ch).text === ch
}
const REACHES_THE_FONT = REPERTOIRE.filter(survives)
ok('the soft hyphen never reaches the font, so Charter not having it is nothing',
  !survives(0x00ad) && !fontkit.create(readFileSync(`${DIR}/charter-regular.ttf`))
    .hasGlyphForCodePoint(0x00ad))

/**
 * WHAT THE FONT SAYS, which is the only authority on this. The same question check-win-ansi asks
 * of pdf-lib's standard faces, asked of the file this repository actually ships.
 */
const missingIn = (file) => {
  const font = fontkit.create(readFileSync(file))
  return REACHES_THE_FONT.filter((code) => !font.hasGlyphForCodePoint(code))
}

const declared = [
  ...Object.keys(CHARTER_GAPS.substitute).map(Number),
  ...CHARTER_GAPS.unprintable,
].sort((a, b) => a - b)

for (const face of FACES) {
  check(`${face}: the characters Charter has no glyph for are exactly the declared gaps`,
    missingIn(`${DIR}/charter-${face}.ttf`).sort((a, b) => a - b), declared)
}

/*
 * AND THE GAPS ARE SORTED INTO THE RIGHT TWO HEAPS. Knowing a character is missing is half of it;
 * the half that reaches a debtor is whether it is quietly replaced or loudly refused.
 */
ok('the non-breaking space is substituted, not refused — it is in every Rand amount',
  CHARTER_GAPS.substitute[0x00a0] === ' ')
ok('the euro is refused, not substituted — a currency symbol is a word',
  CHARTER_GAPS.unprintable.has(0x20ac))
ok('...and nothing visible is quietly substituted',
  Object.keys(CHARTER_GAPS.substitute).map(Number).every((c) => c === 0x00a0))

/* ------------------------------------------------------------------ through printableForPdf */

check('a Rand amount drawn in Charter keeps its shape and loses only the glyph it has not got',
  visible(printableForPdf('R\u00a012\u00a0345,67', CHARTER_GAPS).text), 'R 12 345,67')
check('...and the euro is the only thing it would refuse',
  printableForPdf('R\u00a012\u00a0345,67', CHARTER_GAPS).unprintable, [])
check('...and the same amount in a standard face is untouched, because those faces have it',
  visible(printableForPdf('R\u00a012\u00a0345,67').text), 'R<U+00A0>12<U+00A0>345,67')
check('a euro in a Charter letter is reported rather than silently dropped',
  printableForPdf('€400 outstanding', CHARTER_GAPS).unprintable, ['€'])
check('...and a euro in a standard face still prints',
  printableForPdf('€400 outstanding').text, '€400 outstanding')
check('an ordinary sentence is not touched by the gaps at all',
  printableForPdf('Böhmer owes R 500 — pay by Friday', CHARTER_GAPS),
  { text: 'Böhmer owes R 500 — pay by Friday', unprintable: [] })
check('the tab a Word table leaves behind is still fixed quietly under Charter',
  printableForPdf('DATE\t20 September', CHARTER_GAPS).text, 'DATE 20 September')

/* ------------------------------------------------------------------ the stack, and the fallback */

ok('the picker\'s value is recognised as Charter', isCharter(CHARTER_STACK))
ok('Georgia is not', !isCharter('Georgia, "Times New Roman", serif'))
ok('nor is a stack that merely falls back to Charter',
  !isCharter('Georgia, "Bitstream Charter", serif'))
check('a Charter letter whose font files did not load falls back to a serif, not Helvetica',
  standardFamilyFor(CHARTER_STACK), 'Times')

/* ------------------------------------------------------------------ the layout keeps it whole */

/**
 * A ruler this file controls, as in check-letter-pdf: every character the same width, so where a
 * line ends is arithmetic rather than a guess about what Charter does with a lowercase f.
 */
const measure = (text, sizePt) => text.length * sizePt * 0.2
const amount = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })
  .format(12345.67)
ok('en-ZA still groups thousands with a non-breaking space, which is what this is about',
  amount.includes(' '))

const doc = {
  ...blankLetter(),
  blocks: [{
    kind: 'paragraph',
    spans: [{ text: `The balance of ${amount} is due on Friday and must be paid in full.` }],
  }],
}
const plan = planLetter(doc, A4_LETTERHEAD, { measure, filled: true, values: {} })
const lines = plan.pages.flatMap((pg) => pg.ops.filter((o) => o.op === 'text').map((o) => o.text))
ok('the notice wrapped onto more than one line, or this proves nothing', lines.length > 1)
ok('a Rand amount is never broken across a line: the whole of it is on one',
  lines.some((l) => l.includes(amount)))
ok('...and no line ends part-way through one',
  !lines.some((l) => /R( |\s)?[\d  ]*$/.test(l) && !l.includes(amount)))

/* ------------------------------------------------------------------ a real PDF */

const bytesOf = (face) => new Uint8Array(readFileSync(`${DIR}/charter-${face}.ttf`))
const charter = {
  regular: bytesOf('regular'),
  bold: bytesOf('bold'),
  italic: bytesOf('italic'),
  boldItalic: bytesOf('bold-italic'),
}
const notice = (blocks) => ({ ...blankLetter(), blocks })
const body = [
  { kind: 'heading', level: 1, spans: [{ text: 'SECTION 129(1)(a) NOTICE' }] },
  { kind: 'paragraph', spans: [{ text: `The balance outstanding is ${amount}.` }] },
]

/**
 * WHICH FACES A FINISHED PDF ACTUALLY CARRIES.
 *
 * READ BACK THROUGH pdf-lib, NOT OUT OF THE BYTES. pdf-lib packs its dictionaries into compressed
 * object streams, so a regex over the raw file finds no /BaseFont at all and an assertion written
 * that way passes or fails for reasons that have nothing to do with fonts. Loading the document
 * expands them.
 */
const facesIn = async (bytes) => {
  const loaded = await PDFDocument.load(bytes)
  const names = new Set()
  for (const [, obj] of loaded.context.enumerateIndirectObjects()) {
    const m = String(obj).match(/\/BaseFont \/([^\s/>]+)/)
    if (m) names.add(m[1])
  }
  return [...names]
}

const embedded = await letterToPdf({
  doc: notice(body), page: A4_LETTERHEAD, filled: true, values: {}, charter,
})
const carried = await facesIn(embedded)
ok(`the PDF made from a Charter letter carries Charter (${carried.join(', ')})`,
  carried.length > 0 && carried.every((n) => /Charter/.test(n)))
ok('...all four faces of it, so a bold heading is Charter bold and not something else',
  carried.length === 4)
/*
 * THE NUMBER THE WHOLE DECISION TURNED ON. "An embedded Unicode font would add a megabyte to
 * every notice" is what the standard-faces rule was written to avoid; a subsetted embed of the
 * faces a notice actually uses is two orders of magnitude off that. If this ever fails, somebody
 * has turned subsetting off and every letter the firm sends has grown by the whole font.
 */
ok(`a notice with Charter embedded is a few tens of kB, not a megabyte (${embedded.length})`,
  embedded.length < 60_000)

const plain = await letterToPdf({
  doc: notice(body), page: A4_LETTERHEAD, filled: true, values: {}, charter: null,
})
ok('a Charter letter whose font files did not load is still a letter', plain.length > 0)
const fellBackTo = await facesIn(plain)
ok(`...drawn in Times, because that is what its own font stack falls back to (${fellBackTo})`,
  fellBackTo.length > 0 && fellBackTo.every((n) => n.startsWith('Times')))

/*
 * AND EVERY STANDARD FAMILY GIVES FOUR FACES OF ITSELF.
 *
 * Found here rather than guessed at: the faces were built by concatenating `${family}Bold`, which
 * is not what pdf-lib calls Times's bold, so the undefined name fell through to the HELVETICA
 * default beside it and the firm's Times notices had Helvetica headings. Three of Courier's four
 * faces were Helvetica. The failure is invisible in a preview of page one and obvious on paper.
 */
const mixed = [
  { kind: 'paragraph', spans: [
    { text: 'plain ' }, { text: 'bold', bold: true },
    { text: ' italic', italic: true }, { text: ' both', bold: true, italic: true },
  ] },
]
for (const [stack, family] of [
  ['Georgia, "Times New Roman", serif', 'Times'],
  ['Arial, Helvetica, sans-serif', 'Helvetica'],
  ['"Courier New", monospace', 'Courier'],
]) {
  const doc2 = blankLetter()
  const bytes = await letterToPdf({
    doc: { ...doc2, defaults: { ...doc2.defaults, font: stack }, blocks: mixed },
    page: A4_LETTERHEAD, filled: true, values: {}, charter: null,
  })
  const used = await facesIn(bytes)
  check(`${family}: bold and italic are drawn in ${family}, not in whatever was next to it`,
    used.filter((n) => !n.startsWith(family)), [])
  ok(`...and all four of its faces are there (${used.join(', ')})`, used.length === 4)
}

/*
 * AND THE EURO REFUSES, end to end. Not the substitution — the refusal, which is the half that
 * protects what the debtor is told. It has to come from the real drawing path rather than from
 * printableForPdf alone, because the gaps are chosen by which face was actually embedded.
 */
let refused = ''
try {
  await letterToPdf({
    doc: notice([{ kind: 'paragraph', spans: [{ text: 'The sum of €400 is due.' }] }]),
    page: A4_LETTERHEAD, filled: true, values: {}, charter,
  })
} catch (e) { refused = e.message }
ok('a Charter notice containing a euro is refused, and the message names the character',
  refused.includes('€') && refused.includes('U+20AC'))

const allowed = await letterToPdf({
  doc: notice([{ kind: 'paragraph', spans: [{ text: 'The sum of €400 is due.' }] }]),
  page: A4_LETTERHEAD, filled: true, values: {}, charter: null,
})
ok('...and the same letter in a standard face is not, because Times has a euro', allowed.length > 0)

/* ------------------------------------------------------------------ the sheet matches the paper */

const css = readFileSync('src/index.css', 'utf8')
ok('the editor\'s sheet has Charter to type in', /@font-face[^}]*"Charter"/.test(css))
for (const face of FACES) {
  ok(`...including ${face}`, css.includes(`/fonts/charter/charter-${face}.woff2`))
}
ok('the four .ttf paths the PDF fetches are the four files that are shipped',
  Object.values(CHARTER_TTF).every((url) => existsSync(`public${url}`)))

const editor = readFileSync('src/pages/library/LetterPageEditor.tsx', 'utf8')
ok('Charter is offered in the editor\'s font picker', /label: 'Charter'/.test(editor))

/* ------------------------------------------------------------------ and in an email */

/*
 * THE FIRM ASKED FOR CHARTER ON "THE LETTERS IN THE EMAILS" TOO, and an email is the one place
 * this cannot be delivered outright: Gmail, Outlook and Apple Mail all ignore @font-face, so a
 * reader without Charter installed sees whatever comes next in the stack. What is checked here is
 * therefore not that emails are in Charter — they are not, for most readers — but that the two
 * things that CAN be true are: Charter is asked for first, and what actually draws is Georgia,
 * which is the same designer's screen face and the nearest thing every machine already has.
 */
const emailFamilies = CHARTER_EMAIL_STACK.split(',').map((f) => f.replace(/["']/g, '').trim())
check('an email asks for Charter first', emailFamilies[0], 'Charter')
ok('...and for Charter under its full name as well, which is how a Linux machine has it',
  emailFamilies.includes('Bitstream Charter'))
check('...and what almost every reader will actually draw is Georgia',
  emailFamilies.find((f) => !/charter/i.test(f)), 'Georgia')
ok('...never a sans-serif, which would make the covering email a different firm from the notice',
  !emailFamilies.some((f) => /arial|helvetica|verdana|calibri|sans-serif/i.test(f)))
ok('the stack ends in a generic, so a machine with none of them still gets a serif',
  emailFamilies[emailFamilies.length - 1] === 'serif')

const offered = EMAIL_FONTS.find((f) => f.value === CHARTER_EMAIL_STACK)
ok('Charter is offered in the firm\'s email settings', offered !== undefined)
/*
 * AND THE LABEL SAYS WHAT WILL HAPPEN. A bare "Charter" in that picker would be promising the
 * firm something a debtor's inbox cannot honour, and the first person to compare the sent folder
 * with the attachment would be right to stop trusting the setting.
 */
ok('...labelled honestly, because most recipients will not see Charter',
  /georgia/i.test(offered?.label ?? ''))
/*
 * READ BACK AS TEXT, not imported: firmSettings.ts pulls in the Supabase client, which a check
 * cannot load — the same reason check-firm-settings reads that file rather than importing it.
 */
const settings = readFileSync('src/lib/firmSettings.ts', 'utf8')
ok('a firm that has filled nothing in still writes in it',
  /emailFont: CHARTER_EMAIL_STACK,/.test(settings))

/*
 * THE BOX SOMEBODY TYPES IN AND THE MESSAGE THAT GOES OUT ARE THE SAME RULE.
 *
 * They were not: the outgoing mail has always been wrapped in the firm's face at the firm's size
 * and the compose box was the app's sans-serif, so where a paragraph ended on the screen had
 * nothing to do with where it ended in the inbox.
 */
const face = { emailFont: CHARTER_EMAIL_STACK, emailSizePt: 10.5 }
const style = emailBodyStyle(face)
ok(`the outgoing message carries the stack (${style})`, style.includes(CHARTER_EMAIL_STACK))
check('...and the box on the screen is the same rule, parsed rather than written twice',
  emailBodyCss(face).fontFamily, CHARTER_EMAIL_STACK)
check('...at the same size', emailBodyCss(face).fontSize, '10.5pt')

/* ------------------------------------------------------------------ the spaces in the email */

/*
 * THE FIRM, LOOKING AT A FINAL NOTICE THAT HAD ACTUALLY GONE OUT: "you should remember the spaces
 * in the email. This is how it came out." Every line of a four-paragraph statutory notice was
 * jammed against the next, because the composer turned every newline into one <br> -- so the
 * blank line between paragraphs, which is what anybody typing an email puts there, drew as
 * nothing at all.
 */
check('a blank line is a paragraph',
  emailBodyHtml('First paragraph.\n\nSecond paragraph.'),
  'First paragraph.<br><br>Second paragraph.')
check('...and a single newline is a line, so a contact block stays one block',
  emailBodyHtml('Office line: 012\nEmail: a@b.test'),
  'Office line: 012<br>Email: a@b.test')
check('...and several blank lines are still one paragraph break',
  emailBodyHtml('One.\n\n\n\nTwo.'), 'One.<br><br>Two.')
check('...including one with spaces left on it, which is what a real draft has',
  emailBodyHtml('One.\n   \nTwo.'), 'One.<br><br>Two.')
check('a message with no blank lines is unchanged',
  emailBodyHtml('Dear Sir\nThank you'), 'Dear Sir<br>Thank you')

/*
 * AND IT ESCAPES. This did not, so a debtor called "Smit & Seun" put a raw ampersand into the
 * markup of a legal notice, and anything a collector typed between angle brackets became HTML.
 */
check('an ampersand in a debtor\'s name is not markup',
  emailBodyHtml('Smit & Seun'), 'Smit &amp; Seun')
check('...and nothing typed can become a tag',
  emailBodyHtml('pay <b>now</b>'), 'pay &lt;b&gt;now&lt;/b&gt;')

const composer = readFileSync('src/components/ComposeEmailModal.tsx', 'utf8')
ok('the compose box is typed in the firm\'s own face', /emailBodyCss\(firm\)/.test(composer))
ok('...and that is on the message box, not on the dialog around it',
  /<textarea[^>]*[\s\S]{0,200}?emailBodyCss\(firm\)/.test(composer))
/*
 * AND THE MESSAGE THAT LEAVES GOES THROUGH THE PARAGRAPH RULE. The composer had its own
 * `.replace(/\n/g, '<br>')`, which is the line the firm was looking at.
 */
ok('the outgoing body is rendered as paragraphs', /emailBodyHtml\(body\)/.test(composer))
ok('...and not by turning every newline into one break',
  !/replace\(\/\\n\/g, '<br>'\)/.test(composer))

/*
 * AND ONE EMAIL IS ONE FACE. The corrections sheet pinned Calibri on its heading and its table
 * while the message around it was wrapped in the firm's face, so a client got a covering sentence
 * in one hand and the table that IS the request in another.
 */
const corrections = readFileSync('src/lib/importCorrections.ts', 'utf8')
ok('the corrections table inherits the firm\'s face rather than pinning one',
  !/font-family:/.test(corrections.replace(/<!--[\s\S]*?-->/g, '')))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-charter: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
