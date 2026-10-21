/**
 * WHAT ARRIVES ON THE CLIPBOARD, TURNED INTO A LETTER.
 *
 * The firm: "I try to paste something like this, you know, copy and paste. I think this is much
 * easier than just writing everything from scratch. So if someone, for example, makes something
 * in Claude, write something and you can just copy and paste it into the letterhead on the
 * system."
 *
 * WHAT THIS GUARDS. The page editor used to paste as plain text, so a whole section 129 pasted in
 * arrived as forty lines of body text: "1 YOUR DEFAULT" sitting in the middle of a paragraph,
 * both tables flattened into loose lines, and the list of what happens in court reading as one
 * grey block. Rebuilding that by hand is most of the work of writing it again, which is the
 * opposite of what pasting is for.
 *
 * THE TWO FAULTS WORTH THE CHECKS, and they pull in opposite directions:
 *
 *   - SHAPE LOST. A heading that arrives as a paragraph is invisible until somebody prints the
 *     notice and finds the sections unnumbered.
 *   - MARKUP KEPT. If what the clipboard carried reached the page, a section 129 would print at
 *     the mercy of whatever Word felt like emitting -- forty `mso-` properties, a `class=` on
 *     every line, and a `<span style="font-size:8pt">` nobody asked for. The closed tag set is
 *     the whole safety property of this editor and a paste must not be a hole in it.
 *
 * So nearly every check below asks both halves: did the shape survive, and did nothing else.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-letter-paste.mjs
 */
import {
  clipboardToLetterHtml, looksLikeMarkdown, markdownToLetterHtml, sanitiseToLetterHtml,
  tabbedTextToLetterHtml,
} from '../../src/lib/letterPaste.ts'
import { documentHtmlToBlocks } from '../../src/lib/letterDocument.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/** Every tag name in a fragment, so "nothing else survived" can be asserted as a set. */
const tags = (html) => [...new Set(
  [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()),
)].sort()

/** The kinds a paste turns into once it has been read back as a document. */
const kinds = (html) => documentHtmlToBlocks(html).map((b) => b.kind).join(',')

/** One block's words, defensively — see CLAUDE.md on indexing [0] when nothing was parsed. */
const spansOf = (b) => ((b ?? {}).spans ?? []).map((x) => x.text).join('')

/** All the words, so "the text survived" can be asserted apart from the shape. */
const words = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim()

/* ------------------------------------------------------------------ rich text */

/*
 * WORD. The firm writes in Word. This is what it actually puts on a clipboard -- the `mso-`
 * properties, the `class=MsoNormal` on every line, the `<o:p>` that closes nothing, and the
 * stylesheet it helpfully includes.
 */
const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head><style>p.MsoNormal {margin:0cm; font-size:11.0pt;}</style></head>
<body lang=EN-ZA>
<h1 class=MsoTitle><span style='mso-fareast-language:EN-US'>YOUR DEFAULT<o:p></o:p></span></h1>
<p class=MsoNormal>You are in <span style='font-weight:700'>default</span>.<o:p></o:p></p>
<table class=MsoTableGrid border=1>
 <tr><td><p class=MsoNormal>Creditor</p></td><td><p class=MsoNormal>Northfield Credit</p></td></tr>
 <tr><td><p class=MsoNormal>Balance</p></td><td><p class=MsoNormal>R 48 215.60</p></td></tr>
</table>
</body></html>`

const word = sanitiseToLetterHtml(WORD)
check('a Word paste keeps its heading, its paragraph and its table',
  kinds(word), 'heading,paragraph,table')
ok('...with the words intact', words(word).includes('Northfield Credit'))
/*
 * AND NOTHING ELSE CAME WITH IT. Asserted as the whole SET of tags rather than as "no <o:p>":
 * naming the tags to refuse is a list somebody has to keep up to date with Microsoft.
 */
check(`...and nothing else came with it (${tags(word).join(' ')})`,
  tags(word).every((t) => ['h1', 'p', 'b', 'table', 'tbody', 'tr', 'td'].includes(t)), true)
/*
 * THE STYLESHEET IS NOT TEXT, and dropping only the TAG leaves the CSS behind as words -- a
 * section 129 with `p.MsoNormal {margin:0cm}` printed in the middle of it.
 *
 * ASSERTED ON THE SANITISED HTML ITSELF, not through words(). The first cut read it through that
 * helper, which strips anything between angle brackets -- so Word's comment-wrapped stylesheet
 * was removed by the HELPER and the assertion passed with the muting deleted. Found by breaking
 * it. The fixture now carries a plain <style> as a web page and Google Docs both emit.
 */
ok('...and the stylesheet did not become words of the letter',
  !word.includes('MsoNormal') && !word.includes('margin:0cm'))
/* Word writes <table><tr> with no tbody; documentHtmlToBlocks wants one. */
const wordTable = documentHtmlToBlocks(word).find((b) => b.kind === 'table')
check('...and the table has both its rows', (wordTable?.rows ?? []).length, 2)
check('...each with both cells', (wordTable?.rows ?? []).map((r) => r.length), [2, 2])

/*
 * GOOGLE DOCS AND CLAUDE'S OWN ANSWER both emit weight in a style rather than a <b>. Dropping
 * attributes without reading them first loses every mark in a document written that way, which
 * is most of them.
 */
const styled = sanitiseToLetterHtml(
  '<p><span style="font-weight:700">Pay in full.</span> <span style="font-style:italic">Please</span></p>')
check('bold written as a style is still bold', /<b>Pay in full\.<\/b>/.test(styled), true)
check('...and italic likewise', /<i>Please<\/i>/.test(styled), true)
check('a span carrying nothing leaves nothing behind',
  sanitiseToLetterHtml('<p><span style="color:#111">Plain</span></p>'), '<p>Plain</p>')
/*
 * AND THE MARKS WRITTEN AS TAGS, which is what most of the world emits and what the style road
 * above does NOT cover: marksInStyle writes its own <b> directly, so deleting b/i/u from the kept
 * set left every one of these checks green while a literal <b> was being thrown away. Found by
 * break-testing, which is the only way it would have been.
 */
const literal = documentHtmlToBlocks(sanitiseToLetterHtml(
  '<p>Pay <strong>in full</strong> or <em>telephone</em> or <u>write</u>.</p>'))[0]
check('bold, italic and underline written as tags all survive',
  (literal?.spans ?? [])
    .map((x) => `${x.text}${x.bold ? '*' : ''}${x.italic ? '/' : ''}${x.underline ? '_' : ''}`)
    .join('|'),
  'Pay |in full*| or |telephone/| or |write_|.')

/* Six heading levels collapse onto the three this model has, rather than being dropped. */
check('a document with six heading levels keeps all six as headings',
  kinds(sanitiseToLetterHtml('<h1>a</h1><h2>b</h2><h4>c</h4><h6>d</h6>')),
  'heading,heading,heading,heading')
check('...at the levels the model has',
  documentHtmlToBlocks(sanitiseToLetterHtml('<h1>a</h1><h4>c</h4><h6>d</h6>')).map((b) => b.level),
  [1, 3, 3])

/* A header row folded into the one tbody documentHtmlToBlocks reads, or its cells are dropped. */
const withHead = documentHtmlToBlocks(sanitiseToLetterHtml(
  '<table><thead><tr><th>Creditor</th><th>Balance</th></tr></thead>'
  + '<tbody><tr><td>Northfield</td><td>R 1</td></tr></tbody></table>'))[0]
check('a table with a separate header keeps every row', (withHead?.rows ?? []).length, 2)
check('...and is marked as having one', withHead?.headerRow, true)

/*
 * A PASTE THAT IS JUST A SENTENCE gets no markup invented for it. A clipboard almost always has
 * an HTML flavour, and for a sentence copied out of a paragraph it is a <span> -- nothing this
 * file can improve on, and converting it would be the converter making things up.
 */
check('a sentence with no shape is left to the plain-text road',
  clipboardToLetterHtml({ html: '<span>Please telephone this office.</span>', text: 'Please telephone this office.' }),
  null)
/* And an HTML flavour that is all shape and no words must not swallow the paste. */
check('...and so is a flavour carrying shape but no words',
  clipboardToLetterHtml({ html: '<p></p><div> </div>', text: 'R 48 215.60' }), null)

/*
 * A COPY OUT OF THIS EDITOR, which is the likeliest paste of all: take a section, paste it lower
 * down.
 *
 * THE SECTION NUMBER IS DRAWN, NOT STORED. The renderer writes it into the heading as
 * `<span class="ltr-n">2.</span>`, so a copy carries that digit as words. Sanitised naively it
 * lands as "2.YOUR DEFAULT" -- and the next render numbers THAT, giving "1. 2.YOUR DEFAULT" and
 * every section after it wrong. Nothing throws; the notice just goes out misnumbered.
 */
const copied = documentHtmlToBlocks(sanitiseToLetterHtml(
  '<h2 class="ltr-h2"><span class="ltr-n">2.</span>YOUR DEFAULT</h2>'
  + '<p>You are in <b>default</b>.</p>'))
check('a section copied out of the editor keeps its words', spansOf(copied[0]), 'YOUR DEFAULT')
/* The drawn digit is NOT one of them. This is the assertion that matters. */
ok('...and not the number that was drawn into it', !spansOf(copied[0]).includes('2'))
/* And it is still a numbered section, or pasting one would quietly un-number it. */
check('...and is still numbered', copied[0]?.numbered, true)
check('...with what followed it intact', kinds(sanitiseToLetterHtml(
  '<h2 class="ltr-h2"><span class="ltr-n">2.</span>YOUR DEFAULT</h2><p>Words.</p>')),
  'heading,paragraph')

/* ------------------------------------------------------------------ markdown */

/*
 * WHAT THE FIRM ASKED FOR BY NAME: "if someone, for example, makes something in Claude". Copying
 * out of a code block, a .md file, or anywhere the text IS the markup gives these characters
 * literally -- and pasted as text the hashes and asterisks print on the notice.
 */
const MD = `## YOUR DEFAULT

You are in **default**. The full balance has become _due and payable_.

| Creditor | Northfield Credit (Pty) Ltd |
| --- | --- |
| Account number | 92322880 |
| Total outstanding | R 48 215.60 |

What happens next:

- Your name goes to the credit bureaux.
- A summons is served on you.
- The sheriff may attach your possessions.

### HOW TO PAY

1. Pay the full amount.
2. Telephone this office to arrange.`

const md = markdownToLetterHtml(MD)
check('a Markdown paste becomes the shapes it describes',
  kinds(md), 'heading,paragraph,table,paragraph,list,heading,list')
check('...with the heading levels it asked for',
  documentHtmlToBlocks(md).filter((b) => b.kind === 'heading').map((b) => b.level), [2, 3])
/* THE HASHES MUST NOT PRINT. That is the whole failure this road exists to prevent. */
ok('...and no hashes, pipes or asterisks left in the words',
  !/[#|*]/.test(words(md)))

const mdBlocks = documentHtmlToBlocks(md)
const mdTable = mdBlocks.find((b) => b.kind === 'table')
check('a Markdown table keeps every row', (mdTable?.rows ?? []).length, 3)
check('...two cells wide throughout', (mdTable?.rows ?? []).map((r) => r.length), [2, 2, 2])
/* The rule row is the table's own punctuation and is not a row of the letter. */
ok('...and the |---| rule is not one of them',
  !JSON.stringify(mdTable?.rows ?? []).includes('---'))

const lists = mdBlocks.filter((b) => b.kind === 'list')
check('a bulleted list stays unordered and a numbered one ordered',
  lists.map((l) => l.ordered), [false, true])
check('...with every item', lists.map((l) => l.items.length), [3, 2])

const firstPara = mdBlocks.find((b) => b.kind === 'paragraph')
/* Italic marked as well as bold: joined on the bold alone, an italic run that arrived plain
   would be indistinguishable from one that survived, and the check would prove half of what it
   claims. */
check('**bold** is bold, _italic_ is italic, and the punctuation is gone',
  (firstPara?.spans ?? [])
    .map((s) => `${s.text}${s.bold ? '*' : ''}${s.italic ? '/' : ''}`).join('|'),
  'You are in |default*|. The full balance has become |due and payable/|.')
/*
 * BOLD IS TAKEN BEFORE ITALIC. `**x**` also matches the italic pattern, and taking them the other
 * way round turns every bold word into an italic one wrapped in stray asterisks -- which is worse
 * than losing the mark, because it puts punctuation into a statutory notice.
 */
check('a bold run is not read as italic wrapped in asterisks',
  markdownToLetterHtml('**Pay in full.**'), '<p><b>Pay in full.</b></p>')

/*
 * ASKED BEFORE CONVERTING. A converter that ran on everything would turn "3. Call them back"
 * typed into a note into a numbered list of one -- inventing a shape nobody asked for.
 */
check('an ordinary sentence is not Markdown', looksLikeMarkdown('Please telephone this office.'), false)
check('...nor is one line that happens to start with a dash',
  looksLikeMarkdown('- telephone this office'), false)
check('...but two of them are a list', looksLikeMarkdown('- one\n- two'), true)
/* One heading is enough on its own: nothing else starts a line with a hash. */
check('...and one heading is enough on its own', looksLikeMarkdown('## YOUR DEFAULT\n\nYou are in default.'), true)

/* Paragraphs are separated by blank lines, and a single newline is a line break inside one. */
check('a blank line ends a paragraph',
  kinds(markdownToLetterHtml('One.\n\nTwo.')), 'paragraph,paragraph')
check('...and a single newline does not',
  kinds(markdownToLetterHtml('One.\nStill one.')), 'paragraph')

/*
 * THE WHOLE ROAD, END TO END. clipboardToLetterHtml is what the editor calls, and a check on the
 * pieces alone would not notice the two being wired together the wrong way round.
 */
check('the editor’s own entry point takes the Markdown road when there is no HTML',
  kinds(clipboardToLetterHtml({ html: '', text: MD }) ?? ''),
  'heading,paragraph,table,paragraph,list,heading,list')
/*
 * THE TWO FLAVOURS DELIBERATELY DISAGREE. A clipboard carries both, and the first cut of this
 * gave them the same shape -- so which road was taken could not be told apart and the assertion
 * proved nothing. The HTML says heading-then-table; the text says heading-then-list.
 */
check('...and prefers the HTML flavour when there is one',
  kinds(clipboardToLetterHtml({
    html: '<h2>Heading</h2><table><tr><td>a</td><td>b</td></tr></table>',
    text: '## Heading\n\n- one\n- two',
  }) ?? ''),
  'heading,table')

/*
 * AND THE RESULT IS ALWAYS SOMETHING THE MODEL CAN READ. Every paste above is run back through
 * documentHtmlToBlocks by the assertions, which is the real contract: whatever this file emits
 * has to be in the closed set, because the page is parsed as one string and anything foreign in
 * it is text at best.
 */
for (const [what, html] of [['Word', word], ['Markdown', md]]) {
  const back = documentHtmlToBlocks(html)
  ok(`a ${what} paste reads back as blocks with no empty debris`,
    back.length > 0 && back.every((b) => b.kind !== 'paragraph'
      || (b.spans ?? []).map((s) => s.text).join('').trim() !== ''))
}

/* ------------------------------------------------------------------ a table copied as text */

/*
 * THE CLIPBOARD A TABLET GIVES YOU. The firm works on an iPad, and copying out of a Word document
 * there puts PLAIN TEXT on the clipboard and nothing else -- no HTML flavour to read structure
 * from. A table copied that way separates its cells with TABS, one line per row.
 *
 * So their section 129, which is five tables, arrived as flat lines with invisible tabs in them.
 * And the tabs went on to stop the PDF being built at all: "WinAnsi cannot encode ' ' (0x0009)".
 */
const TABLET = 'DATE\t{{today}}\tOUR REF\t{{reference}}\n\n'
  + '1 YOUR DEFAULT\n\n'
  + 'Creditor\t{{client_name}}\n'
  + 'Account number\t{{account_number}}\n'
  + 'Total outstanding balance\t{{balance}}\n\n'
  + 'You are in default.'

const tablet = clipboardToLetterHtml({ html: '', text: TABLET }) ?? ''
check('a table copied as plain text comes back as a table',
  kinds(tablet), 'paragraph,paragraph,table,paragraph')
check('...with every row and both its columns',
  documentHtmlToBlocks(tablet).find((b) => b.kind === 'table')?.rows
    .map((r) => r.map((c) => c.spans.map((x) => x.text).join(''))),
  [['Creditor', '{{client_name}}'],
    ['Account number', '{{account_number}}'],
    ['Total outstanding balance', '{{balance}}']])
/*
 * AND NOT ONE TAB SURVIVES. This is the half that stopped the letter being sent: a tab is
 * invisible in the editor, because HTML collapses it, and fatal at the PDF.
 */
/*
 * ASKED OF THE WORDS, NOT OF JSON.stringify's OUTPUT. The first cut of this tested the stringified
 * document -- where a tab has already been escaped into a backslash and a "t", two ordinary
 * characters -- so the regex could never match and the check passed with the fix deleted. Found by
 * break-testing it.
 */
check('no tab reaches the document', /\t/.test(words(tablet)), false)
check('...nor the raw HTML on its way there', /\t/.test(tablet), false)
/* The merge fields are still whole -- a field cut in half posts braces to a debtor. */
ok('...and the merge fields are still in one piece',
  words(tablet).includes('{{client_name}}') && words(tablet).includes('{{balance}}'))

/*
 * TWO CONSECUTIVE ROWS, NOT ONE. A single line with a tab in it is somebody's stray keystroke,
 * and turning it into a one-row table would invent a shape that was never there.
 */
check('one line with a tab is not a table', tabbedTextToLetterHtml('Pay\tin full.'), null)
/* And the rows have to be the same width, or a paragraph containing a tab swallows the line
   after it. */
check('rows of different widths are not one table', tabbedTextToLetterHtml('a\tb\nc\td\te'), null)
/*
 * AND A ROW OF THE WRONG WIDTH ENDS THE TABLE rather than joining it ragged. A ragged table is the
 * one structural fault that renders as a page which looks fine and is missing a cell --
 * letterProblems refuses those, so a paste that made one could not be saved at all. The first cut
 * of the check above could not see this: its rows differed at the FIRST line, so the run never
 * started and the assertion passed without the width test doing anything.
 */
{
  const ragged = documentHtmlToBlocks(tabbedTextToLetterHtml('a\tb\nc\td\ne\tf\tg') ?? '')
  const table = ragged.find((b) => b.kind === 'table')
  check('a row of the wrong width ends the table',
    (table?.rows ?? []).map((r) => r.length), [2, 2])
  ok('...and is kept, as its own block rather than dropped',
    words(tabbedTextToLetterHtml('a\tb\nc\td\ne\tf\tg') ?? '').includes('g'))
}

/*
 * AND ORDINARY PROSE IS STILL LEFT ALONE. This road is the narrowest of the three: it answers
 * only when there is actually a table, so a pasted sentence still goes in as text at the caret
 * and behaves exactly as it did.
 */
check('a pasted sentence is still just a sentence',
  clipboardToLetterHtml({ html: '', text: 'Please telephone this office.' }), null)
check('...and so are two of them', clipboardToLetterHtml({ html: '', text: 'One.\n\nTwo.' }), null)



/*
 * A BULLET FOLLOWED BY A TAB IS A LIST, NOT A TWO-COLUMN TABLE.
 *
 * Word writes a bulleted list into plain text as "•<tab>the sentence", one line per item -- which
 * is indistinguishable from a two-cell row unless the first cell is read.
 *
 * TAKEN AS A TABLE IT WAS INVISIBLE ON SCREEN AND WRONG ON PAPER. A browser shrinks a column to
 * fit its content, so the editor drew the bullet column a bullet wide and it read as a list; the
 * PDF split its columns evenly and printed a bullet alone in the left half of the page. The firm
 * reported it as "the generation didn't work like the pasting". autoColumnWidths fixes the
 * printing; this stops it being a table at all, which is the honest half.
 */
{
  const WORD_BULLETS = '•\tPay in full. Payment of {{balance}} settles the account.\n'
    + '•\tPropose an arrangement. Tell us in writing what you can afford.\n'
    + '•\tDispute it. If the amount is wrong, tell us in writing.'
  const blocks = documentHtmlToBlocks(clipboardToLetterHtml({ html: '', text: WORD_BULLETS }) ?? '')
  check('bullets pasted out of Word are a list, not a table',
    blocks.map((b) => b.kind).join(','), 'list')
  check('...unordered, with every item',
    (blocks[0]?.items ?? []).map((i) => i.map((s) => s.text).join('').slice(0, 12)),
    ['Pay in full.', 'Propose an a', 'Dispute it. '])
  /* The bullet character itself is the list's, drawn by the renderer -- left in the text it would
     print twice. */
  ok('...and the bullet character is not left in the words',
    !JSON.stringify(blocks[0]?.items ?? []).includes('•'))
}
/* Numbered items likewise, and they stay ordered. */
{
  const blocks = documentHtmlToBlocks(
    clipboardToLetterHtml({ html: '', text: '1.\tPay in full.\n2.\tTelephone this office.' }) ?? '')
  check('numbered items pasted the same way are an ordered list',
    [blocks[0]?.kind, blocks[0]?.ordered], ['list', true])
}
/*
 * AND A REAL TWO-COLUMN TABLE IS STILL A TABLE. "Credit bureau listing<tab>Your default is
 * reported..." is the same shape on the wire and must not be swept up by the rule above -- the
 * difference is entirely in whether the first cell is a bullet.
 */
{
  const blocks = documentHtmlToBlocks(clipboardToLetterHtml({ html: '',
    text: 'Credit bureau listing\tYour default is reported.\nSummons\tIssued and served on you.' }) ?? '')
  check('a real two-column table is still a table',
    blocks.map((b) => b.kind).join(','), 'table')
  check('...with both its rows', (blocks[0]?.rows ?? []).length, 2)
}
/* The two in one paste, which is what a section 129 actually is. */
{
  const both = '•\tPay in full.\n•\tPropose an arrangement.\n\n'
    + 'Credit bureau listing\tYour default is reported.\nSummons\tIssued and served.'
  check('a notice carrying both keeps them apart',
    documentHtmlToBlocks(clipboardToLetterHtml({ html: '', text: both }) ?? '')
      .map((b) => b.kind).join(','), 'list,table')
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A paste keeps its shape and still not its markup. A section 129 out of Word arrives as a heading,
a paragraph and a table rather than as forty lines of body text -- and arrives without the forty
mso- properties, the stylesheet or the class on every line. Markdown out of Claude becomes the
same shapes instead of printing its own hashes. An ordinary sentence is still just a sentence.`)
