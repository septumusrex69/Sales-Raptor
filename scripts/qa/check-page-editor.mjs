/**
 * THE WHOLE PAGE, READ BACK OFF A CONTENTEDITABLE.
 *
 * WHAT CHANGED, AND WHY IT NEEDS ITS OWN FILE. The letter used to be edited as a stack of boxes,
 * one per block — so a parse that went wrong lost one paragraph and the writer saw it. The firm
 * asked for the page instead: "can't it be just like one page which you immediately see how it
 * would look like." They are right, and the price of it is that the WHOLE section 129 is now one
 * string of browser HTML parsed in one go. A parse that gives up at the first thing it does not
 * recognise silently drops everything below the caret, and what saves is a statutory demand
 * missing its table. Nothing on screen says so.
 *
 * So the load-bearing property here is not "the parse is correct" but "the parse is TOTAL": every
 * top-level element contributes a block, whatever it is, and nothing is ever dropped on the floor.
 * Most of what follows is that one claim, asked in the ways a browser actually breaks it.
 *
 * THE OTHER HALF IS THE ROUND TRIP ON THE FIRM'S REAL NOTICE, read out of schema.sql rather than
 * written here: draw it, parse it back, and require the same document. A fixture written in this
 * file would drift from the seed the day somebody edits the seed, and would then be testing a
 * letter the firm does not have.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-page-editor.mjs
 */
import { readFileSync } from 'node:fs'
import { documentHtmlToBlocks, letterToHtml, parseLetter } from '../../src/lib/letterDocument.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/** The kinds a page parsed to, in order — the shape assertion most of this file is made of. */
const kinds = (html) => documentHtmlToBlocks(html).map((b) => b.kind).join(',')
/**
 * ONE BLOCK OF A PARSED PAGE, or an empty object where there is none.
 *
 * DEFENSIVELY, and the reason is in CLAUDE.md as a trap already seen here: indexing [0] when
 * nothing was parsed throws a TypeError two lines BELOW the check that should have reported it,
 * so the suite dies with a stack trace instead of naming the rule that broke. This cost a run
 * while these very checks were being break-tested.
 */
const block = (html, i = 0) => documentHtmlToBlocks(html)[i] ?? {}
const rowsOf = (b) => b.rows ?? []
const spansOf = (b) => (b.spans ?? []).map((x) => x.text).join('')

/** All the words on a page, joined — used to ask whether text SURVIVED, never how it is marked. */
const words = (html) => documentHtmlToBlocks(html)
  .map((b) => {
    if (b.spans) return b.spans.map((s) => s.text).join('')
    if (b.kind === 'list') return b.items.map((i) => i.map((s) => s.text).join('')).join(' ')
    if (b.kind === 'table') return b.rows.map((r) => r.map((c) => c.spans.map((s) => s.text).join('')).join(' ')).join(' ')
    return ''
  })
  .join(' ').replace(/\s+/g, ' ').trim()

/* ------------------------------------------------------------------ the parse is total */

/*
 * THE FAULT THIS GUARDS, stated as a page. A `<figure>` is not a shape this model has. What must
 * NOT happen is that the elements AFTER it stop existing.
 */
check('an element nobody recognises does not swallow the rest of the letter',
  kinds('<p>one</p><figure>a picture</figure><p>two</p><table><tr><td>x</td></tr></table>'),
  'paragraph,paragraph,paragraph,table')
ok('...and its own words are kept rather than dropped',
  words('<p>one</p><figure>a picture</figure><p>two</p>').includes('a picture'))

/*
 * A STRAY CLOSING TAG, which is what a browser leaves behind when a delete crosses a boundary.
 * Allowed to drive the depth negative it would swallow every element after it — the exact shape
 * of "the letter lost its second half" and invisible until somebody prints one.
 */
check('a stray closing tag does not swallow what follows',
  kinds('<p>one</p></div><p>two</p><p>three</p>'), 'paragraph,paragraph,paragraph')

/* Text typed outside any element at all — pressing Return at the very end of a document. */
check('a sentence typed outside any element is still a paragraph',
  kinds('<p>one</p>loose words<p>two</p>'), 'paragraph,paragraph,paragraph')
ok('...carrying its words', words('<p>one</p>loose words<p>two</p>').includes('loose words'))

/*
 * NEVER EMPTY. An empty result would be serialised and written over a notice an attorney settled,
 * and the writer would be looking at a page they had just been typing on.
 */
check('a page that parses to nothing is one empty paragraph, never no letter at all',
  documentHtmlToBlocks(''), [{ kind: 'paragraph', spans: [{ text: '' }] }])
/* And a page whose every element is one we refuse outright, which is the case that reaches the
   fallback rather than the loose-text path below it. */
check('...and so is a page that is nothing but a stylesheet',
  kinds('<style>p{color:red}</style>'), 'paragraph')
/* Debris reaches a paragraph by a different road -- the loose-text path -- and is asserted here
   so the line above is not doing two jobs and answering for neither. */
check('a page of browser debris is still a letter', kinds('<br><hr>'), 'paragraph')

/*
 * WHAT IS INSIDE <style> IS NOT TEXT. Pasting a block copied off a web page otherwise drops a
 * stylesheet into the middle of a statutory notice.
 */
ok('a stylesheet pasted in does not become words of the letter',
  !words('<p>one</p><style>p{color:red}</style><p>two</p>').includes('color'))

/* ------------------------------------------------------------------ what a browser emits */

/*
 * WORD. The firm writes in Word and pastes. clipboardToLetterHtml now converts a paste into this
 * model's own tag set before it reaches the page, so Office markup should never get this far --
 * which is exactly why it is asserted here too. This is the belt to that brace: whatever route
 * markup arrives by, forty tags of it must still come out as paragraphs of words and nothing
 * else. See check-letter-paste.mjs for the conversion itself.
 */
const WORD = '<p class=MsoNormal><span style=\'font-family:"Calibri",sans-serif\'>'
  + 'Dear Mr Van Der Westhuizen<o:p></o:p></span></p>'
  + '<p class=MsoNormal><o:p>&nbsp;</o:p></p>'
  + '<p class=MsoNormal>You are in default.<o:p></o:p></p>'
check('a paste out of Word arrives as paragraphs', kinds(WORD), 'paragraph,paragraph,paragraph')
check('...carrying the words and none of the markup',
  words(WORD), 'Dear Mr Van Der Westhuizen You are in default.')

/*
 * Chromium writes a <div> where a <p> was the moment somebody presses Return in one.
 *
 * ASKED BESIDE A REAL PARAGRAPH, deliberately. On its own, a page whose only element is dropped
 * comes back as one paragraph anyway -- from the never-empty fallback above -- so the assertion
 * would go green on an implementation that throws every div away.
 */
check('a div the browser invented is a paragraph',
  kinds('<p>a</p><div>typed</div>'), 'paragraph,paragraph')
check('...carrying what was typed in it', words('<p>a</p><div>typed</div>'), 'a typed')
/* And a <font> tag, which execCommand still emits in some states. */
ok('a font tag keeps its words', words('<p>a <font color="#ff0000">red</font> word</p>') === 'a red word')

/* ------------------------------------------------------------------ the shapes we do keep */

check('a heading keeps its level', block('<h2 class="ltr-h2">YOUR DEFAULT</h2>').level, 2)
/*
 * THE SECTION NUMBER IS COUNTED, NOT STORED. The renderer draws it into the heading, so it comes
 * back in the text and has to be taken out again — otherwise every save bakes the current number
 * into the words, and inserting a section leaves three headings numbered 1, 1 and 2 for ever.
 */
const numbered = block('<h2 class="ltr-h2"><span class="ltr-n">2.</span>HOW TO PAY</h2>')
check('a numbered heading comes back numbered', numbered.numbered, true)
check('...with the digit taken back OUT of its words', spansOf(numbered), 'HOW TO PAY')
check('...and an unnumbered one stays unnumbered',
  block('<h2 class="ltr-h2">HOW TO PAY</h2>').numbered, undefined)

const table = block(
  '<table class="ltr-t ltr-b-all"><colgroup><col style="width:40%"><col style="width:60%"></colgroup>'
  + '<tbody><tr><th>Creditor</th><th>Balance</th></tr>'
  + '<tr><td>Gauteng Property Services</td><td>R 48,250.00</td></tr></tbody></table>')
check('a table keeps its columns', table.widths, [40, 60])
check('...its borders', table.borders, 'all')
check('...its header row', table.headerRow, true)
check('...and every cell', rowsOf(table).map((r) => r.length), [2, 2])
/* Browsers disagree about whether a tbody is there; both shapes are the same table. */
check('a table without a tbody is the same table',
  rowsOf(block('<table class="ltr-t"><tr><td>a</td><td>b</td></tr></table>')).map((r) => r.length), [2])

const bullets = block('<ul><li>Pay in full.</li><li>Telephone us.</li></ul>')
check('a bulleted list stays unordered', bullets.ordered, false)
check('...with an item each', (bullets.items ?? []).length, 2)
check('a numbered list is ordered', block('<ol><li>a</li></ol>').ordered, true)

check('a hard page break survives', kinds('<p>a</p><div class="ltr-break"></div><p>b</p>'),
  'paragraph,pagebreak,paragraph')
const spacer = block('<div style="height:12mm"></div>')
check('a spacer keeps its millimetres', [spacer.kind, spacer.mm], ['spacer', 12])
const sig = block(
  '<div class="ltr-sig"><div class="ltr-rule" style="width:70mm"></div><div>J Bredell</div></div>')
check('a line to sign on keeps its width', [sig.kind, sig.widthMm], ['signature', 70])
check('...and the name under it', spansOf(sig), 'J Bredell')

/*
 * MILLIMETRES ONLY. A browser hands spacing back in px, and a margin of "12" read as 12mm is a
 * gap four times too big on paper. Refused rather than converted, because the conversion depends
 * on a zoom level this code cannot see.
 */
check('spacing in pixels is not read as millimetres',
  block('<p style="margin-top:12px">a</p>').spacing, undefined)
/*
 * AND ZERO IS NOT ABSENT. "No gap after this paragraph" and "the default gap after this
 * paragraph" are different instructions and the default is 3mm — a letter laid out tight against
 * the next line reflows if zero is lost.
 */
check('no gap at all is kept as no gap',
  block('<p style="margin-top:2mm;margin-bottom:0mm">a</p>').spacing, { before: 2, after: 0 })

/*
 * KEEP-WITH-NEXT HAS NO LOOK, WHICH IS WHY IT NEEDS THE ATTRIBUTE. It is an instruction to the
 * page-breaker — "do not leave this line alone at the foot of a page" — so there is nothing on
 * screen to read it back from. Carried as data-keep or lost on the first edit, and the loss shows
 * up months later as a signature block alone on page three.
 */
check('an instruction with no look still survives an edit',
  block('<p data-keep="1">Yours faithfully</p>').keepWithNext, true)
check('...and is not invented where it was not asked for',
  block('<p>Yours faithfully</p>').keepWithNext, undefined)

check('alignment survives', block('<p style="text-align:center">a</p>').align, 'center')

/* ------------------------------------------------------------------ the firm's own notice */

/*
 * THE REAL SECTION 129, read out of schema.sql rather than written here — a copy in this file
 * would drift from the seed and then be testing a letter the firm does not have.
 *
 * DRAWN AND PARSED BACK, and required to be THE SAME DOCUMENT. This is the whole editor in one
 * assertion: the page is an input surface, the block model is the truth, and a trip through the
 * browser's markup and back must not change a statutory demand.
 */
const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const seeded = (() => {
  /* The letter is seeded as a JSON string inside a SQL literal, so the doubled quotes come out
     before it is JSON. Taken from the LAST match: schema.sql is append-only and the section 129
     has been revised, so an earlier definition is one the database no longer has. */
  const all = [...sql.matchAll(/'(\{"defaults":[\s\S]*?)'\s*(?:,|\))/g)]
  for (let i = all.length - 1; i >= 0; i--) {
    const doc = parseLetter(all[i][1].replace(/''/g, "'"))
    if (doc && doc.blocks.length > 5) return doc
  }
  return null
})()

ok('the firm’s section 129 was found in schema.sql', seeded !== null)
if (seeded) {
  /*
   * CANONICAL, so the comparison is about CONTENT rather than key order or the difference between
   * a missing field and a false one. Without this the check fails on a re-ordering nobody can see
   * and passes on a dropped `false` that matters.
   */
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === 'object') {
      const out = {}
      for (const k of Object.keys(v).sort()) {
        if (v[k] === undefined || v[k] === false) continue
        out[k] = canon(v[k])
      }
      return out
    }
    return v
  }
  const drawn = letterToHtml(seeded, { filled: false, values: {} })
  const back = documentHtmlToBlocks(drawn)

  /* Asserted BEFORE the comparison: a seed that somehow had no blocks would make every
     assertion below pass on nothing at all. */
  ok(`the notice has its sections (${seeded.blocks.length} blocks)`, seeded.blocks.length > 5)
  check('every block of it comes back',
    back.map((b) => b.kind).join(','), seeded.blocks.map((b) => b.kind).join(','))
  const differ = seeded.blocks
    .map((b, i) => (JSON.stringify(canon(b)) === JSON.stringify(canon(back[i])) ? null : i))
    .filter((i) => i !== null)
  check(`...unchanged, block for block${differ.length ? ` (${differ.map((i) => JSON.stringify(canon(back[i]))).join(' | ')})` : ''}`,
    differ, [])
  /*
   * AND THE MERGE FIELDS ARE STILL WHOLE. A stray span cutting {{balance}} in half leaves
   * "{{bal" and "ance}}", which renderTemplate cannot match — so the notice posts with braces in
   * it and the number missing. The words come back identical above, but this says it in the terms
   * the failure would actually appear in.
   */
  const fieldsIn = (blocks) => JSON.stringify(blocks).match(/\{\{[a-z_]+\}\}/g)?.sort() ?? []
  check('...with every merge field still in one piece',
    fieldsIn(back), fieldsIn(seeded.blocks))
}

/*
 * AND IT IS IDEMPOTENT. A letter is drawn, edited and parsed back every time somebody opens it,
 * so a trip that ADDS something is a document that grows a little each time it is touched. The
 * empty paragraph is the one that nearly did it: kept as a blank line the writer typed, it has to
 * come back as the same blank line and not as two.
 */
{
  const start = {
    defaults: { font: 'Georgia, serif', size: 10.5, colour: '#1f2937', lineHeight: 1.45 },
    blocks: [
      { kind: 'paragraph', spans: [{ text: 'Dear {{debtor_name}}' }] },
      { kind: 'paragraph', spans: [{ text: '' }] },
      { kind: 'paragraph', spans: [{ text: 'You are in default.' }] },
    ],
  }
  let doc = start
  const seen = []
  for (let i = 0; i < 4; i++) {
    doc = { ...doc, blocks: documentHtmlToBlocks(letterToHtml(doc, { filled: false, values: {} })) }
    seen.push(JSON.stringify(doc.blocks))
  }
  check('a blank line the writer typed is still one blank line', seen[0], JSON.stringify(start.blocks))
  check('...after being opened and saved four times over',
    [...new Set(seen)].length, 1)
}

/* ------------------------------------------------------------------ the editor itself */

/*
 * THREE THINGS ABOUT THE COMPONENT THAT ARE DECISIONS, NOT STYLE — each here because getting it
 * wrong produces a page that works in a demo and loses somebody's letter in use.
 */
const editor = readFileSync(
  new URL('../../src/pages/library/LetterPageEditor.tsx', import.meta.url), 'utf8')

/*
 * THE SHEET IS NEVER TRANSFORM-SCALED. A preview may be photographed down; a thing you TYPE in
 * may not, because the browser hit-tests the caret in unscaled coordinates and the cursor lands
 * a growing distance from the pointer the further down the page you click.
 */
ok('the page you type on is drawn at 1:1',
  !/transform:\s*`?scale/.test(editor.slice(editor.indexOf('contentEditable'), editor.indexOf('runningFootHtml('))))

/*
 * WHAT IS STORED IS THE PARSE, NEVER THE MARKUP. If innerHTML were ever handed to onChange, a
 * section 129 would print at the mercy of whatever Chrome felt like emitting.
 */
ok('the document is built by the parse and never from the browser’s own markup',
  /documentHtmlToBlocks\(sheet\.current\.innerHTML\)/.test(editor)
  && !/onChange\(\s*\{[^}]*innerHTML/.test(editor))

/*
 * A PASTE KEEPS ITS SHAPE AND STILL NOT ITS MARKUP.
 *
 * This used to assert the opposite -- that a paste was inserted as plain TEXT -- and that was the
 * wrong trade for the way the firm works: a whole section 129 pasted in arrived as forty lines of
 * body text with "1 YOUR DEFAULT" in the middle of one. The honesty was never in the plain text,
 * it was in the closed tag set, so the paste now goes through clipboardToLetterHtml, which
 * converts INTO that set. check-letter-paste.mjs is where the conversion itself is asserted.
 *
 * THE FALLBACK STAYS, and is the half worth naming here: most pastes are a sentence, and for
 * those clipboardToLetterHtml returns null and the text is inserted unchanged.
 */
ok('a paste is converted into the letter\u2019s own tag set',
  /onPaste[\s\S]{0,900}?clipboardToLetterHtml\(\{/.test(editor))
ok('...and an ordinary sentence still arrives as text',
  /onPaste[\s\S]{0,900}?else document\.execCommand\('insertText'/.test(editor))

/*
 * AND THE SELECTION IS WATCHED RATHER THAN SAMPLED. The first cut of this remembered the caret
 * from the sheet's own key and mouse events, so a selection made any other way was never seen —
 * and pressing Bold then restored a stale caret OVER the live selection and bolded nothing at
 * all, while the bar went on offering Bold inside a heading that cannot take one.
 */
ok('the caret is followed by selectionchange, not guessed from keystrokes',
  /addEventListener\('selectionchange'/.test(editor))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The whole page read back off a contenteditable, asked mostly one question: is the parse TOTAL?
An element nobody recognises, a stray closing tag, a paste out of Word and a sentence typed
outside any element all have to contribute their words and leave everything below them standing —
because the letter is now one string of browser HTML, and a parse that gives up halfway saves a
statutory demand missing its table with nothing on screen to say so. Then the firm's own section
129, read out of schema.sql, drawn and parsed back and required to be the same document.`)
