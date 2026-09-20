/**
 * A LETTER, AS DATA — and the two places it can go wrong quietly.
 *
 * WHY THIS FILE EXISTS AT ALL. A section 129 notice is a STATUTORY DEMAND. What the debtor
 * receives has to be exactly what somebody approved, because a defective notice is a defective
 * demand and the credit provider cannot go to court on it. Two faults in this model would produce
 * a page that looks right and is not:
 *
 *   - A MERGE FIELD THAT SURVIVES UNRESOLVED. renderTemplate deliberately leaves an unknown
 *     placeholder standing rather than printing a gap, so "{{firm_bank}}" goes out on the firm's
 *     letterhead over a director's name. Caught when the letter is SAVED or never.
 *   - A ROUND TRIP THAT LOSES A MARK. The editor is a contenteditable box; what is STORED is the
 *     block model, parsed back out of whatever the browser emitted. If that parse drops the bold
 *     on "This is a formal legal notice", the writer sees bold and the debtor does not.
 *
 * And one that is not quiet at all but is worth a check anyway: every piece of text in a letter
 * is merged from an account, and an account holds surnames with ampersands in them.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-letter-document.mjs
 */
import { readFileSync } from 'node:fs'
import {
  A4_LETTERHEAD, blankLetter, canUseLetter, editableHtmlToSpans, letterCss, letterProblems,
  letterToHtml, lettersText, parseLetter, runningHeaderHtml, serialiseLetter, spansToEditableHtml,
} from '../../src/lib/letterDocument.ts'
import { sampleValues } from '../../src/lib/messageTemplates.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const p = (text, o = {}) => ({ kind: 'paragraph', spans: [{ text }], ...o })

/* ---------- reading one back ---------- */

/*
 * NULL RATHER THAN A HALF-BUILT DOCUMENT, and this is the one that protects somebody's work: a
 * letter that will not parse must NOT open as an empty editor, or the next save writes an empty
 * letter over a notice the attorney settled.
 */
check('a letter round-trips through storage',
  parseLetter(serialiseLetter(blankLetter()))?.blocks.length, 1)
check('plain text is not a letter', parseLetter('Dear {{debtor_name}}'), null)
check('...nor is broken JSON', parseLetter('{"blocks":'), null)
check('...nor JSON that is not a document', parseLetter('{"hello":true}'), null)
check('...nor one with no defaults', parseLetter('{"blocks":[]}'), null)
/*
 * A BLOCK KIND NOTHING CAN DRAW is a hole in the page. Refused at the door rather than rendered
 * around, because a notice missing a paragraph reads as a complete notice.
 */
check('...nor one carrying a block nothing can draw',
  parseLetter('{"defaults":{},"blocks":[{"kind":"marquee"}]}'), null)

/* ---------- what stands between it and being sent ---------- */

const sound = { ...blankLetter(), blocks: [p('Dear {{debtor_name}}, you owe {{balance}}.')] }
check('a letter using real fields is fit to send', letterProblems(sound, 'collections'), [])
ok('...and says so', canUseLetter(letterProblems(sound, 'collections')))

const typo = { ...blankLetter(), blocks: [p('You owe {{ballance}}.')] }
ok('a mistyped field is refused, not warned',
  letterProblems(typo, 'collections').some((x) => x.level === 'refuse'))
ok('...naming the field so it can be fixed',
  letterProblems(typo, 'collections')[0].message.includes('ballance'))
ok('...and it cannot be sent', !canUseLetter(letterProblems(typo, 'collections')))
/* The sales vocabulary is a different set, so a collections field is unknown there and the other
   way round. A letter cannot borrow from the other library. */
ok('a collections field is unknown on the sales side',
  letterProblems(sound, 'sales').some((x) => x.level === 'refuse'))

/*
 * THE PRINTER'S TWO FIELDS. {{page}} and {{pages}} are filled when the letter is laid out, not
 * from the account -- so they are legal in the running header and NOWHERE else. A paragraph
 * cannot know which page it landed on, and one that asks renders in the editor and is wrong on
 * the second page.
 */
const header = { ...blankLetter(), runningHeader: 'Ref {{reference}} · Page {{page}} of {{pages}}', blocks: [p('x')] }
check('the running header may count pages', letterProblems(header, 'collections'), [])
ok('...and the body may not',
  letterProblems({ ...blankLetter(), blocks: [p('see page {{page}}')] }, 'collections')
    .some((x) => x.level === 'refuse'))
ok('...while a real typo in the header is still caught',
  letterProblems({ ...blankLetter(), runningHeader: '{{nonsense}}', blocks: [p('x')] }, 'collections')
    .some((x) => x.level === 'refuse'))

/*
 * A RAGGED TABLE renders as a page that looks fine and is missing a cell. Refused rather than
 * padded in the renderer, which would hide it for ever.
 */
const cell = (t) => ({ spans: [{ text: t }] })
const ragged = { ...blankLetter(), blocks: [{ kind: 'table', rows: [[cell('a'), cell('b')], [cell('c')]] }] }
ok('a table with rows of different lengths is refused',
  letterProblems(ragged, 'collections').some((x) => x.level === 'refuse'))
ok('...and an empty table too',
  letterProblems({ ...blankLetter(), blocks: [{ kind: 'table', rows: [] }] }, 'collections')
    .some((x) => x.level === 'refuse'))
ok('...and more column widths than columns',
  letterProblems({ ...blankLetter(), blocks: [{ kind: 'table', rows: [[cell('a')]], widths: [50, 50] }] },
    'collections').some((x) => x.level === 'refuse'))

/* ---------- drawing it ---------- */

const values = sampleValues()
const draw = (doc, filled = true) => letterToHtml(doc, { filled, values })

/*
 * EVERY PIECE OF TEXT IS ESCAPED, with no exception for "this one is ours". A debtor's surname is
 * merged into this letter and a surname can contain an ampersand; a client's trading name can
 * contain anything at all.
 */
const nasty = { ...blankLetter(), blocks: [p('Cost & <b>risk</b> "quoted" at R1 <script>')] }
ok(`text is escaped on the way out (${draw(nasty).slice(3, 48)})`,
  !/<b>|<script>/.test(draw(nasty)) && draw(nasty).includes('&amp;') && draw(nasty).includes('&lt;b&gt;'))
/* And so is a merged VALUE, which is the half that is easy to miss: the template is the firm's
   and the field is the debtor's. */
ok('...and so is what a field is filled with',
  letterToHtml({ ...blankLetter(), blocks: [p('{{debtor_name}}')] },
    { filled: true, values: { debtor_name: 'Smith & <b>Co</b>' } }).includes('&amp;')
  && !letterToHtml({ ...blankLetter(), blocks: [p('{{debtor_name}}')] },
    { filled: true, values: { debtor_name: 'Smith & <b>Co</b>' } }).includes('<b>Co</b>'))

/*
 * A COLOUR ENDS UP INSIDE A STYLE ATTRIBUTE, which is a place a string can do more than colour
 * text. Hex only; anything else falls back rather than being passed through.
 */
const coloured = (c) => draw({ ...blankLetter(), blocks: [{ kind: 'paragraph', spans: [{ text: 'x', colour: c }] }] })
ok('a hex colour is used', coloured('#c9a052').includes('color:#c9a052'))
ok('...and anything else is not', !coloured('red;background:url(x)').includes('url('))
ok('...falling back rather than dropping the words', coloured('javascript:x').includes('x<'))

/*
 * THE SECTION NUMBERS ARE COUNTED, NOT TYPED. The firm's notice runs 1, 2, 3, an UNNUMBERED
 * heading, then 4 -- and a section inserted into typed numbering is three silent renumberings
 * nobody makes.
 */
const numbered = {
  ...blankLetter(),
  blocks: [
    { kind: 'heading', level: 2, spans: [{ text: 'ONE' }], numbered: true },
    { kind: 'heading', level: 2, spans: [{ text: 'TWO' }], numbered: true },
    { kind: 'heading', level: 2, spans: [{ text: 'ASIDE' }] },
    { kind: 'heading', level: 2, spans: [{ text: 'THREE' }], numbered: true },
  ],
}
check('headings number themselves',
  [...draw(numbered).matchAll(/class="ltr-n">(\d+)</g)].map((m) => m[1]).join(','), '1,2,3')
ok('...and an unnumbered heading takes no number and consumes none',
  /ltr-n">3<\/span>THREE/.test(draw(numbered)))

/* Merge fields stand or resolve, and the toggle is what decides which. */
ok('unfilled shows the fields', draw(sound, false).includes('{{balance}}'))
ok('...and filled shows the values', draw(sound, true).includes('R 48,250.00'))

/* A newline inside a span is a real break: an address is one paragraph on four lines. */
ok('a newline becomes a line break', draw({ ...blankLetter(), blocks: [p('a\nb')] }).includes('a<br>b'))

check('the running header counts the pages',
  runningHeaderHtml(header, { filled: true, values, page: 2, pages: 3 }).includes('Page 2 of 3'), true)

/* The stylesheet is driven by the page, or the preview and the print disagree about the frame. */
ok('the stylesheet uses the page it is given',
  letterCss(blankLetter(), { ...A4_LETTERHEAD, marginTopMm: 41 }).includes('41mm'))
ok('...and draws the letterhead behind it when there is one',
  letterCss(blankLetter(), { ...A4_LETTERHEAD, backgroundUrl: 'https://x/y.png' })
    .includes('url("https://x/y.png")'))
ok('...and nothing when there is not',
  !letterCss(blankLetter(), A4_LETTERHEAD).includes('background-image'))

/* ---------- the editor's round trip ---------- */

/*
 * THE EDITOR IS A CONTENTEDITABLE BOX AND THE MODEL IS THE TRUTH. Text goes out as a tiny tag
 * set and whatever comes back is parsed against the same tiny tag set. A mark lost in that trip
 * is a letter the writer saw in bold and the debtor did not.
 */
const trip = (spans) => editableHtmlToSpans(spansToEditableHtml(spans))
const same = (spans) => JSON.stringify(trip(spans).map(sorted)) === JSON.stringify(spans.map(sorted))
const sorted = (s) => Object.fromEntries(Object.entries(s).sort(([a], [b]) => a.localeCompare(b)))

ok('plain text survives the editor', same([{ text: 'plain' }]))
ok('bold survives', same([{ text: 'Pay in full. ', bold: true }, { text: 'Payment settles it.' }]))
ok('nested marks survive',
  same([{ text: 'a' }, { text: 'b', bold: true, italic: true }, { text: 'c', underline: true }]))
ok('colour and size survive', same([{ text: 'small', size: 9, colour: '#6b7280' }]))
ok('a line break survives', same([{ text: 'line one\nline two' }]))
ok('an ampersand survives', same([{ text: 'R 48 215.60 & <costs>' }]))
/* The one that matters most: a merge field cut in half by a stray tag is braces on letterhead. */
ok('a merge field comes back whole',
  trip([{ text: 'owes {{balance}} now' }])[0].text === 'owes {{balance}} now')

/*
 * WHAT COMES BACK FROM ELSEWHERE. A paste out of Word is forty tags of Office markup; it has to
 * land as bold, italic, underline and the words, with everything else dropped.
 */
const word = editableHtmlToSpans(
  '<p class=MsoNormal><o:p></o:p><span lang=EN-ZA style=\'font-family:"Calibri"\'>Dear <b>Mr M</b></span></p>')
check('a paste from Word keeps the words and the bold',
  word.map((s) => `${s.text}${s.bold ? '*' : ''}`).join('|'), 'Dear |Mr M*')
/*
 * A BROWSER NORMALISES colour TO rgb() ON THE WAY OUT. Refusing rgb() would silently lose every
 * colour the first time a box was read back, which is the kind of fault that only appears after
 * somebody edits an unrelated paragraph.
 */
check('a colour normalised to rgb() comes back as hex',
  editableHtmlToSpans('<span style="color: rgb(31, 41, 55)">x</span>')[0].colour, '#1f2937')

/*
 * AND WHAT IS INSIDE <script> AND <style> IS NOT TEXT. Dropping the tags alone leaves their
 * CONTENTS as words, so pasting a block copied off a web page drops a stylesheet into the middle
 * of a statutory notice. Not a security hole -- everything is escaped on the way out -- but it is
 * a notice with CSS printed in it, which looks like a mistake the firm made.
 */
check('a pasted stylesheet does not become words',
  editableHtmlToSpans('<style>p{color:red}</style>hello<script>alert(1)</script> there')[0].text,
  'hello there')

/* Runs with identical marks are joined, or typing one character at a time in a browser that wraps
   each keystroke produces a document of one-letter spans. */
check('identical runs are joined', editableHtmlToSpans('<b>a</b><b>b</b>').length, 1)
check('...and different ones are not', editableHtmlToSpans('<b>a</b><i>b</i>').length, 2)

/* ---------- the firm's own section 129, as it is seeded ---------- */

/*
 * READ OUT OF schema.sql, like check-pre-legal-workflow.mjs reads the workflow: the checks run
 * with no network and no credentials, and schema.sql is the checked-in record of what the
 * database holds. A notice seeded in a state that refuses to send is worth knowing about here
 * rather than on the day somebody tries to send it.
 */
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const seeded = /where seed_key = 'letter-s129';/.test(schema)
  ? /set format = 'document',\s*\n\s*body = '([\s\S]*?)',\s*\n\s*updated_at/.exec(schema)?.[1] ?? null
  : null
ok('the section 129 is seeded as a document', seeded !== null)
const s129 = seeded === null ? null : parseLetter(seeded.replace(/''/g, "'"))
ok('...and it parses', s129 !== null)

if (s129) {
  check('...with nothing wrong with it', letterProblems(s129, 'collections'), [])
  ok('...so it can actually be sent', canUseLetter(letterProblems(s129, 'collections')))
  /*
   * ITS FOUR NUMBERED SECTIONS, in the firm's own order, with the legal-process heading between
   * three and four taking no number. That is the structure of the document they supplied, and it
   * is the thing that breaks silently when somebody inserts a section.
   */
  check('...and four numbered sections',
    [...draw(s129).matchAll(/class="ltr-n">(\d+)</g)].map((m) => m[1]).join(','), '1,2,3,4')
  ok('...with the legal-process heading unnumbered between the third and the fourth',
    /THE LEGAL PROCESS WE FOLLOW FOR NON-PAYMENT/.test(draw(s129))
    && /ltr-n">4<\/span>HOW TO PAY/.test(draw(s129)))
  /* The three tables the firm's document has: the date strip, the reference block and the banking
     details, plus the legal-process grid. */
  ok(`...and its tables (${s129.blocks.filter((b) => b.kind === 'table').length})`,
    s129.blocks.filter((b) => b.kind === 'table').length === 4)
  ok('...and its bullets', s129.blocks.some((b) => b.kind === 'list' && b.items.length === 3))
  /*
   * NOT ONE FACT ABOUT A REAL DEBTOR. This repository is public. A notice with a name, an
   * identity number or an address written into it is the one thing that must never be committed,
   * and a template is supposed to carry fields rather than values in any case.
   */
  const text = lettersText(s129)
  ok('nothing in it is a real debtor', !/Mokoena|Protea Street|Wonderboom/i.test(text))
  ok('...no identity number', !/\b\d{6}\s?\d{4}\s?\d{2}\s?\d\b/.test(text))
  ok('...no account number typed in as a value',
    !/\b92322880\b/.test(text) && text.includes('{{account_number}}'))
  ok('...and no banking details', !/\b051001\b/.test(text) && text.includes('{{firm_bank}}'))
  /* It is a section 129 and it says so, which is the one sentence the Act actually requires. */
  ok('it cites section 129(1)(a)', /section 129\(1\)\(a\)/i.test(text))
  ok('...and the ten business days', /10 \(ten\) business days/i.test(text))
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A letter stored as data rather than as markup, so the editor and the printed page cannot disagree;
every merged value escaped, because a surname can contain an ampersand; section numbers counted
rather than typed; a contenteditable round trip that keeps its marks and its merge fields whole;
and the firm's own section 129 checked as it is seeded, carrying fields rather than a real
debtor's name.`)
