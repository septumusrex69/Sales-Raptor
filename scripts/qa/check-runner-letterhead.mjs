/**
 * THE MORNING RUN PRINTS ON THE FIRM'S OWN PAPER.
 *
 * THE FIRM SENT BACK A SECTION 129 AND SAID "fix it with the letterhead". What they had was a
 * notice with forty-three millimetres of blank paper at the top of every page and the body set in
 * TIMES: the runner drew on `A4_LETTERHEAD`, which RESERVES that margin FOR a letterhead, and then
 * passed no letterhead to put in it -- and Charter's four faces had not loaded either, so the
 * fallback the font stack names took over.
 *
 * TWO WAYS TO DRAW ONE LETTER, AND THE UNWATCHED ONE WAS WRONG. letterPdfBytes -- the browser's
 * path, used by Attach a letter, the template picker and the preview -- has always read the
 * letterheads table, fetched the image and handed both to letterToPdf. The runner is the other
 * half of CLAUDE.md's clause-builder rule and this half had never been written. Every notice the
 * morning run has ever sent went out on blank paper.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-runner-letterhead.mjs
 */
import { readFileSync } from 'node:fs'
import { charterFor } from '../../api/_lib/workflow/fonts.ts'
import { letterToPdf } from '../../src/lib/letterPdf.ts'
import { A4_LETTERHEAD } from '../../src/lib/letterDocument.ts'
import { CHARTER_TTF, isCharter } from '../../src/lib/charter.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const step = read('../../api/_lib/workflow/step.ts')
const paper = read('../../api/_lib/workflow/letterhead.ts')
const fonts = read('../../api/_lib/workflow/fonts.ts')

/* ------------------------------------------------ the runner asks for the paper */

ok('the runner fetches the letterhead', /const paper = await letterheadFor\(admin\)/.test(step))
ok('...and hands the image to the drawing', /letterhead: paper\.image/.test(step))
/*
 * THE PAGE COMES WITH THE PICTURE. letterheads.ts: the image is a full-page A4 with the logo, the
 * rule down the side and the footer block DRAWN INTO IT, and nothing in the picture keeps body
 * text off them -- only the margins do. The firm's own margins and a generic page are how body
 * text lands on top of their footer.
 */
ok('...on the page that came with it', /page: paper\.page/.test(step))
/*
 * AND THE GENERIC ONE IS NOT NAMED HERE ANY MORE. It was the whole bug: A4_LETTERHEAD reserves a
 * letterhead's margin and carries no letterhead, so using it without one is a promise the draw
 * cannot keep. It survives as letterhead.ts's fallback, where plain paper is the honest answer.
 */
ok('...and never on the generic one', !/page: A4_LETTERHEAD/.test(step))

/* ------------------------------------------------ what the paper fetch does */

/* THE SAME CHOICE defaultOf MAKES on the browser side: the default active one, else any active
   one -- ordered in the query so the answer cannot depend on which row Postgres last rewrote. */
ok('the default letterhead is the one taken', /\.eq\('active', true\)/.test(paper))
ok('...preferring the one marked default', /\.order\('is_default', \{ ascending: false \}\)/.test(paper))
/* NUMBER() ON EVERY MEASUREMENT: numeric(6,2) arrives from PostgREST as a STRING, and a margin of
   "37.5" reads correctly and then silently does nothing the first time anything does arithmetic
   on it -- on the numbers that decide where a statutory demand's text lands. */
for (const col of ['width_mm', 'height_mm', 'margin_top_mm', 'margin_right_mm',
  'margin_bottom_mm', 'margin_left_mm']) {
  ok(`${col} is read as a number`, new RegExp(`Number\\(row\\.${col}\\)`).test(paper))
}
/*
 * PLAIN PAPER IS THE FALLBACK AND IT IS THE RIGHT ONE. A notice that cannot find the letterhead
 * still has to go -- the ten business days a section 129 gives do not pause because an image was
 * unreachable. What must not happen is the OLD behaviour: reserving the letterhead's margin and
 * printing nothing in it.
 */
ok('an unreachable letterhead falls back to plain paper',
  /const plain: RunnerLetterhead = \{ page: A4_LETTERHEAD, image: null \}/.test(paper))
ok('...on a missing row', /if \(!data\) return plain/.test(paper))
ok('...on a fetch that failed', /if \(!res\.ok\) return plain/.test(paper))
ok('...and on anything thrown', /\} catch \{\s*return plain\s*\}/.test(paper))
/* THE STORED PATH DECIDES THE FORMAT, not the public URL: a query string with ".jpg" in it
   somewhere would otherwise decide the format of an image that is a PNG. */
ok('the image type is read off the stored path', /type: \/\\\.jpe\?g\$\/i\.test\(path\)/.test(paper))
/* CACHED, like the fonts beside it: the morning run draws up to two hundred notices off one
   letterhead, and fetched per notice that is two hundred reads of the same image. */
ok('it is fetched once per function instance', /if \(cached !== undefined\) return cached/.test(paper))

/* ------------------------------------------------ and the notice is set in Charter */

/*
 * OFF THE DISK FIRST. The HTTP fetch asks the project's PRODUCTION host, which is the right guess
 * and not always a reachable one: a preview fetching production gets whatever production happens
 * to be, a deployment behind Vercel's protection answers 401 to its own function, and a function
 * running anywhere else has no origin at all. The firm's Times-set section 129 is what that looks
 * like from the outside.
 */
ok('Charter is read off the deployment’s own disk', /readFile\(new URL\('\.\.\/\.\.\/\.\.\/public\/fonts\/charter\//.test(fonts))
/* LITERAL PATHS, ONE PER FACE. A path assembled from a variable is a file Vercel's tracer cannot
   see, so the lambda does not carry it -- which is the same failure with extra steps. */
for (const face of ['charter-regular', 'charter-bold', 'charter-italic', 'charter-bold-italic']) {
  ok(`...${face} by a literal path`, fonts.includes(`public/fonts/charter/${face}.ttf`))
}
/* AND THE FETCH SURVIVES AS THE FALLBACK. It is the path that has worked in production, and a
   deployment whose bundle somehow lacks the files still has an origin that serves them. */
ok('...with the origin fetch kept behind it', /return \(await fromDisk\(\)\) \?\? \(await fromOrigin\(\)\)/.test(fonts))

const vercel = JSON.parse(read('../../vercel.json'))
/* BELT AS WELL AS BRACES. The tracer usually finds a literal readFile; includeFiles says so
   outright, and costs 140 kB in a lambda that already carries pdf-lib. */
ok('the fonts are shipped inside the function',
  /public\/fonts\/charter/.test(vercel.functions?.['api/**/*.ts']?.includeFiles ?? ''))

/* ------------------------------------------------ drawn, and read back out of the bytes */

/*
 * THE ONLY ASSERTION HERE THAT IS NOT A SOURCE READ, and the one the firm would recognise: draw a
 * notice the way the runner now draws it and look inside the PDF. Everything above can be true
 * while the bytes still come out on blank paper in Times -- that is exactly what shipped.
 */
const DOC = {
  defaults: { font: '"Charter", "Bitstream Charter", Georgia, serif', size: 10.5, colour: '#1f2937', lineHeight: 1.45 },
  blocks: [
    { kind: 'heading', level: 1, spans: [{ text: 'NOTICE IN TERMS OF SECTION 129' }] },
    { kind: 'paragraph', spans: [{ text: 'Dear Mr T Mokoena — your account is in arrears.' }] },
  ],
}
ok('the document is a Charter one to begin with', isCharter(DOC.defaults.font))
const charter = await charterFor()
ok('Charter’s four faces load in this environment', charter !== null)

/* A one-pixel PNG is enough: what is asserted is that an image reached the page at all. */
const PIXEL = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'))
const PAGE = { widthMm: 210, heightMm: 297, marginTopMm: 37.5, marginRightMm: 20,
  marginBottomMm: 24, marginLeftMm: 20, backgroundUrl: 'x' }

const drawn = await letterToPdf({
  doc: DOC, page: PAGE, filled: true, values: {},
  letterhead: { bytes: PIXEL, type: 'png' }, charter,
})
const inside = await import('node:zlib').then(({ inflateSync }) => {
  const raw = Buffer.from(drawn)
  let text = raw.toString('latin1')
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const s = m.index + m[0].length
    const e = raw.indexOf('endstream', s)
    try { text += inflateSync(raw.subarray(s, e)).toString('latin1') } catch { /* not deflate */ }
  }
  return text
})
ok('the drawn notice carries the letterhead image', /\/Subtype\s*\/Image/.test(inside))
ok('...and is set in Charter', /\/BaseFont\s*\/Charter/.test(inside))
ok('...with the font programs embedded, not merely named', /\/FontFile2/.test(inside))
ok('...and no Times anywhere in it', !/\/BaseFont\s*\/Times/.test(inside))

/*
 * AND THE OLD WAY STILL PRODUCES THE FIRM'S COMPLAINT, which is what makes the four above mean
 * something: the same document, the generic page, no letterhead and no fonts.
 */
const old = await letterToPdf({ doc: DOC, page: A4_LETTERHEAD, filled: true, values: {}, charter: null })
const oldInside = Buffer.from(old).toString('latin1')
  + (await import('node:zlib').then(({ inflateSync }) => {
    const raw = Buffer.from(old)
    let t = ''
    for (const m of raw.toString('latin1').matchAll(/stream\r?\n/g)) {
      const s = m.index + m[0].length
      const e = raw.indexOf('endstream', s)
      try { t += inflateSync(raw.subarray(s, e)).toString('latin1') } catch { /* not deflate */ }
    }
    return t
  }))
ok('the way it used to be drawn has no letterhead in it', !/\/Subtype\s*\/Image/.test(oldInside))
ok('...and falls back to Times', /\/BaseFont\s*\/Times/.test(oldInside))

/* THE FOUR FACES ARE THE FOUR THE MODULE NAMES, so a renamed file is caught here rather than by a
   notice going out in the wrong weight. */
check('Charter is four faces', Object.keys(CHARTER_TTF).sort().join(','),
  'bold,boldItalic,italic,regular')

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-runner-letterhead: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
