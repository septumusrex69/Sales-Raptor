/**
 * WHERE THE PAGE ENDS, ON A SHEET THAT IS STILL ONE BOX.
 *
 * The firm, pointing at the letterhead's footer block sitting on top of a paragraph: "I don't
 * think that page breaks are there. I think the page should break automatically. I don't think it
 * works." It did not. The editor drew ONE continuous sheet with the letterhead painted once at
 * the top, so on a two-page notice the phone number and the VAT number were printed across the
 * middle of the text, and everything below them had no letterhead at all.
 *
 * WHY THE SHEET STAYS ONE BOX. The obvious fix is one contenteditable per page, and it is a trap:
 * a sentence typed at the foot of page one has to flow onto page two as you type, which means
 * moving the caret between boxes mid-keystroke. Every editor that has tried it has a list of bugs
 * about text appearing in the wrong order.
 *
 * SO THE CONTENT IS PUSHED INSTEAD. The sheet stays one box; each block that would straddle a
 * boundary is given enough padding above it to start at the top of the next page. The padding is
 * PRESENTATION and never reaches the document -- see the note on the unit below, and on why
 * padding rather than margin.
 *
 * PURE, AND IN ONE UNIT. The caller measures in pixels and passes pixels; the checks beside this
 * folder work in millimetres because they are easier to read that way. Nothing here knows which,
 * which is what makes it testable without a browser.
 */

export interface PageBreakInput {
  /**
   * The top of each block, in order, measured with NO pushes applied — its natural position in
   * the flow. Relative to the top of the body, so the first block is at 0.
   */
  tops: number[]
  /** The height of each block, in the same unit. Margins between them are implied by `tops`. */
  heights: number[]
  /** A whole sheet of paper, top to bottom. */
  pageHeight: number
  /** The letterhead's own margins. The band between one page's bottom and the next page's top is
   *  where its footer block is drawn, and nothing may be laid over it. */
  marginTop: number
  marginBottom: number
  /**
   * How close to a boundary still counts as being ON it. Defaults to a whisker.
   *
   * REAL, NOT PEDANTRY. The editor measures a browser, and a block pushed to exactly one page
   * down comes back a fraction short of it — `offsetTop` is rounded to whole pixels, and even a
   * sub-pixel rect drifts. Read as the page ABOVE, the block is judged against that page's
   * bottom, found to overflow, and pushed again. The caller passes the size of the error its own
   * measurement can have; a browser's is about a pixel.
   */
  tolerance?: number
}

export interface PageBreakPlan {
  /**
   * How far to push each block down, in order. Zero for almost all of them — a plan that pushed
   * everything would be a plan that had lost track of where it was.
   */
  pushes: number[]
  /** How many sheets of paper this comes to. At least one, even for an empty letter. */
  pages: number
  /**
   * Blocks too tall for any page, by index. A table of forty rows cannot be pushed anywhere that
   * helps, and pushing it would leave a blank page followed by the same problem. The caller says
   * so on screen instead of pretending.
   */
  overlong: number[]
}

/**
 * Where each block has to start so that none of them lands in a letterhead's footer.
 *
 * THE ARITHMETIC, in body coordinates — the body starts at the first page's top margin, so block
 * positions are measured from there rather than from the top of the paper:
 *
 *   page k holds content from  k * pageHeight  to  k * pageHeight + usable
 *   where usable = pageHeight - marginTop - marginBottom
 *
 * A block whose foot passes its page's usable bottom is pushed to the start of the next page, and
 * everything after it shifts by the same amount. Shifts ACCUMULATE, which is the part that is
 * easy to get wrong: a block pushed onto page two can push the one after it onto page three.
 */
export function planPageBreaks(input: PageBreakInput): PageBreakPlan {
  const { tops, heights, pageHeight, marginTop, marginBottom } = input
  const usable = pageHeight - marginTop - marginBottom
  const tolerance = input.tolerance ?? pageHeight * 1e-9
  const pushes: number[] = []
  const overlong: number[] = []

  /*
   * A PAGE WITH NO ROOM ON IT IS NOT A PAGE. Margins bigger than the paper would make `usable`
   * zero or negative, and every block would be "too tall", pushed for ever down an infinite
   * sheet. Refused by doing nothing, which leaves the editor exactly as it was.
   */
  if (!(usable > 0) || !(pageHeight > 0)) {
    return { pushes: tops.map(() => 0), pages: 1, overlong: [] }
  }

  let shift = 0
  let bottom = 0

  for (let i = 0; i < tops.length; i += 1) {
    const height = heights[i] ?? 0
    const top = tops[i] + shift

    /*
     * TOO TALL FOR ANY PAGE. Pushed, it would leave a blank page and then straddle the next
     * boundary anyway. Left where it is and reported, so the screen can say which block it is.
     */
    if (height > usable) {
      overlong.push(i)
      pushes.push(0)
      bottom = Math.max(bottom, top + height)
      continue
    }

    /*
     * WHICH PAGE THIS BLOCK STARTS ON. A block sitting exactly on a boundary belongs to the page
     * BELOW it, not the one whose foot it is touching.
     *
     * THE TOLERANCE IS FOR MEASUREMENT ERROR, said plainly rather than left to sound more
     * important than it is. A block pushed to exactly 2 * pageHeight is measured back at
     * 593.9999999 — or, because `offsetTop` is rounded to whole pixels, a good deal further out
     * than that. Floored without the tolerance that reads as the page above, and the block is
     * judged against the wrong page's bottom and pushed a second time.
     */
    const page = Math.floor((top + tolerance) / pageHeight)
    const room = page * pageHeight + usable

    if (top + height > room + tolerance) {
      const push = (page + 1) * pageHeight - top
      pushes.push(push)
      shift += push
      bottom = Math.max(bottom, top + push + height)
    } else {
      pushes.push(0)
      bottom = Math.max(bottom, top + height)
    }
  }

  /* One page for an empty letter, and a whole page for anything that reaches into one. */
  const pages = Math.max(1, Math.ceil((bottom - tolerance) / pageHeight))
  return { pushes, pages, overlong }
}
