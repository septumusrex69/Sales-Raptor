/**
 * WHERE THE PAGE ENDS.
 *
 * The firm, pointing at the letterhead's footer block sitting on top of a paragraph: "I don't
 * think that page breaks are there. I think the page should break automatically. I don't think
 * it works."
 *
 * WHAT GOES WRONG IF THIS IS WRONG, and none of it announces itself:
 *
 *   - A BLOCK LEFT STRADDLING A BOUNDARY prints across the letterhead's footer -- the phone
 *     number and the VAT number drawn over a sentence. That is the fault the firm circled.
 *   - A SHIFT THAT DOES NOT ACCUMULATE. Pushing one block onto page two moves everything after
 *     it; forget that and the second overflow of a long notice is missed, so pages three and
 *     four are wrong while page two looks right.
 *   - A BLOCK PUSHED FOR EVER. A block landing exactly on a boundary is on the page BELOW it. Read
 *     as still being on the page above, it is pushed a page at a time down a sheet that grows
 *     without limit, and the editor hangs.
 *
 * MEASURED IN MILLIMETRES HERE and in pixels by the editor. planPageBreaks does not know which,
 * which is the whole reason it can be checked without a browser -- A4 is 297 tall with the firm's
 * own 37.5 and 24 margins, leaving 235.5 of usable page.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-page-breaks.mjs
 */
import { planPageBreaks } from '../../src/lib/pageBreaks.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* The firm's own paper. See the letterheads table: 37.5 at the top to clear the logo, 24 at the
   foot to clear the block with the phone and VAT numbers. */
const A4 = { pageHeight: 297, marginTop: 37.5, marginBottom: 24 }
const USABLE = 297 - 37.5 - 24   /* 235.5 */

/** Blocks of the given heights, stacked with no gaps, which is what `tops` means. */
function stacked(heights, gap = 0) {
  const tops = []
  let y = 0
  for (const h of heights) { tops.push(y); y += h + gap }
  return { tops, heights }
}

/** Where each block actually ends up, which is what the editor draws. */
const placed = (plan, tops) => {
  let shift = 0
  return tops.map((t, i) => { shift += plan.pushes[i]; return t + shift })
}

/* ------------------------------------------------------------------ nothing to do */

check('a letter that fits on one page is not pushed anywhere',
  planPageBreaks({ ...A4, ...stacked([50, 50, 50]) }).pushes, [0, 0, 0])
check('...and is one page', planPageBreaks({ ...A4, ...stacked([50, 50, 50]) }).pages, 1)
check('an empty letter is still one page',
  planPageBreaks({ ...A4, tops: [], heights: [] }), { pushes: [], pages: 1, overlong: [] })

/*
 * EXACTLY FULL IS NOT OVERFULL. A block whose foot lands precisely on the usable bottom fits, and
 * pushing it would leave a page ending a line early for ever.
 */
check('a block ending exactly at the foot of the page stays on it',
  planPageBreaks({ ...A4, ...stacked([USABLE]) }).pushes, [0])
check('...and that is still one page', planPageBreaks({ ...A4, ...stacked([USABLE]) }).pages, 1)

/* ------------------------------------------------------------------ the fault they circled */

/*
 * ONE BLOCK STRADDLING THE BOUNDARY. 230 of the page is used, then a 20-tall paragraph -- which
 * would run 14.5 past the usable bottom and be printed across the letterhead's footer.
 */
{
  const { tops, heights } = stacked([230, 20])
  const plan = planPageBreaks({ ...A4, tops, heights })
  check('a block that would cross the foot of the page is pushed over it',
    plan.pushes, [0, 297 - 230])
  const at = placed(plan, tops)
  check('...to the very top of page two', at[1], 297)
  /*
   * AND THE REAL PROPERTY, asserted rather than inferred from the arithmetic: NOTHING lands in
   * the band where the letterhead draws its footer. That band runs from each page's usable
   * bottom to the next page's top.
   */
  ok('...so nothing at all sits in the letterhead’s footer band',
    at.every((t, i) => {
      const page = Math.floor((t + 1e-6) / 297)
      return t + heights[i] <= page * 297 + USABLE + 1e-6
    }))
  check('...and it comes to two pages', plan.pages, 2)
}

/* ------------------------------------------------------------------ the shifts accumulate */

/*
 * THE HALF THAT IS EASY TO GET WRONG. Pushing a block onto page two moves everything after it, so
 * the next overflow has to be judged from where blocks NOW are rather than where they started. A
 * planner that forgets this gets page two right and every page after it wrong.
 *
 * Eight blocks of 100: without accumulation the second and third pushes are computed against the
 * original tops and land in the wrong place.
 */
{
  const { tops, heights } = stacked([100, 100, 100, 100, 100, 100, 100, 100])
  const plan = planPageBreaks({ ...A4, tops, heights })
  const at = placed(plan, tops)
  /* Two blocks of 100 fit in 235.5; the third does not. So they go two to a page. */
  check('two to a page, with each third pushed over',
    at, [0, 100, 297, 397, 594, 694, 891, 991])
  ok('...and not one of the eight sits in a footer band',
    at.every((t, i) => {
      const page = Math.floor((t + 1e-6) / 297)
      return t + heights[i] <= page * 297 + USABLE + 1e-6
    }))
  check('...over four pages', plan.pages, 4)
}

/*
 * A BLOCK PUSHED ONTO A PAGE THAT IS ALREADY FULL. The one after a tall block can overflow the
 * page it was just moved to, and has to be pushed again -- once, to the page after.
 */
{
  const { tops, heights } = stacked([200, 200, 200])
  const plan = planPageBreaks({ ...A4, tops, heights })
  check('each of three tall blocks gets its own page', placed(plan, tops), [0, 297, 594])
  check('...which is three pages', plan.pages, 3)
}

/* ------------------------------------------------------------------ the ones that cannot be helped */

/*
 * TALLER THAN ANY PAGE. A table of forty rows fits nowhere. Pushed, it would leave a blank page
 * and then straddle the next boundary anyway, so it is left alone and REPORTED -- the screen can
 * then name it instead of the editor quietly doing something strange.
 */
{
  const plan = planPageBreaks({ ...A4, ...stacked([300]) })
  check('a block taller than a page is not pushed', plan.pushes, [0])
  check('...and is named as one that will not fit', plan.overlong, [0])
}
/* And one after it still lands correctly rather than being abandoned. */
{
  const { tops, heights } = stacked([300, 50])
  const plan = planPageBreaks({ ...A4, tops, heights })
  check('what follows an overlong block is still placed', plan.overlong, [0])
  ok('...on a page of its own rather than under the overflow',
    placed(plan, tops)[1] >= 297)
}

/*
 * MARGINS BIGGER THAN THE PAPER. Nonsense, and the honest response is to do nothing: every block
 * would be "too tall" and pushed down a sheet that never ends. Refused so the editor cannot hang
 * on a letterhead somebody mis-measured.
 */
{
  const plan = planPageBreaks({ pageHeight: 100, marginTop: 60, marginBottom: 60, ...stacked([20, 20]) })
  check('a page with no room on it pushes nothing', plan.pushes, [0, 0])
  check('...and is one page', plan.pages, 1)
}
{
  const plan = planPageBreaks({ pageHeight: 0, marginTop: 0, marginBottom: 0, ...stacked([10]) })
  check('a page height of zero pushes nothing', plan.pushes, [0])
  /*
   * AND COMES TO A FINITE NUMBER OF PAGES. Without the refusal above, the page count is
   * ceil(height / 0) -- which is Infinity, and the editor draws a sheet of that many pages. The
   * `pushes` assertion alone passed straight through that, because nothing needs pushing on a
   * page with no room; this is the one that catches it.
   */
  check('...and comes to one page rather than infinitely many', plan.pages, 1)
  ok('...which is a real number', Number.isFinite(plan.pages))
}

/*
 * A POSITION THAT DRIFTED. Pixel measurements are added up, so a block that should sit at exactly
 * two pages down arrives a hair short of it. Read as being on the page above, it is pushed by
 * that hair -- a page that ends one sliver early, and a plan that disagrees with itself about
 * which page the block is on.
 */
{
  const drift = 297 * 2 - 1e-9
  const plan = planPageBreaks({ ...A4, tops: [0, drift], heights: [100, 100] })
  check('a block that drifted a hair short of a boundary is left where it is', plan.pushes[1], 0)
}

/*
 * AND NO BLOCK IS EVER PUSHED MORE THAN ONE PAGE. A push bigger than a sheet means the planner
 * has lost its place -- the runaway that leaves the editor growing a page at a time. Asserted
 * across a long letter rather than on one case.
 */
{
  const { tops, heights } = stacked([90, 150, 90, 150, 90, 150, 90, 150, 90])
  const plan = planPageBreaks({ ...A4, tops, heights })
  ok(`no single push exceeds one sheet (${plan.pushes.join(' ')})`,
    plan.pushes.every((p) => p >= 0 && p < 297))
  const at = placed(plan, tops)
  ok('...and nothing sits in a footer band',
    at.every((t, i) => {
      const page = Math.floor((t + 1e-6) / 297)
      return t + heights[i] <= page * 297 + USABLE + 1e-6
    }))
}

/*
 * THE GAPS BETWEEN BLOCKS COUNT. `tops` carries them -- a paragraph's 3mm bottom margin is the
 * difference between one that fits and one that does not, which is exactly the case that prints
 * a line over the footer.
 */
{
  const { tops, heights } = stacked([115, 115], 10)
  const plan = planPageBreaks({ ...A4, tops, heights })
  /* 115 + 10 + 115 = 240, past 235.5, so the second one goes over. */
  check('a gap between blocks is what tips one over', plan.pushes, [0, 297 - 125])
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Where the page ends, on a sheet that is still one box. Nothing is left straddling a boundary --
which is the fault the firm circled, the letterhead's footer printed over a sentence -- the shifts
accumulate so page four is as right as page two, a block sitting exactly on a boundary is not
pushed round for ever, and a block too tall for any page is reported rather than shuffled.`)
