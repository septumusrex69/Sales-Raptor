import { useMemo } from 'react'
import {
  A4_LETTERHEAD, letterCss, letterToHtml, runningFootHtml,
  type LetterDocument, type PageSetup,
} from '../../lib/letterDocument.ts'

/**
 * The letter, on the page it will be printed on.
 *
 * WHAT THIS IS FOR. A section 129 is posted by registered post, and what the debtor opens is a
 * sheet of the firm's letterhead with text laid over it. The thing that goes wrong is never the
 * words — it is the last paragraph sitting on top of the footer block, or the address falling
 * under the logo, and neither is visible in a text box. So the preview is the real page at real
 * millimetres, with the real letterhead behind it, scaled down to fit the pane.
 *
 * SCALED WITH A TRANSFORM, NOT BY SHRINKING THE TYPE. `zoom` and a smaller font size both change
 * how the text WRAPS, so a paragraph that fits on paper spills in the preview or the reverse —
 * which would make the preview worse than useless on the one question it exists to answer.
 * transform: scale() photographs the page instead.
 *
 * dangerouslySetInnerHTML, DELIBERATELY. The HTML comes from letterToHtml, which escapes every
 * piece of text it is given including every merged field — see esc() there. Rendering the model
 * through React components instead would mean a second renderer, and the printed page and the
 * previewed page would eventually disagree. One renderer is worth more here than the comfort of
 * not seeing this prop.
 */
export function LetterPage({ doc, page = A4_LETTERHEAD, filled, values, scale = 1, pageNumber = 1, pages = 1 }: {
  doc: LetterDocument
  page?: PageSetup
  filled: boolean
  values: Record<string, string>
  /** 1 is actual size. The pane picks this from its own width. */
  scale?: number
  pageNumber?: number
  pages?: number
}) {
  const html = useMemo(() => letterToHtml(doc, { filled, values }), [doc, filled, values])
  const foot = useMemo(
    () => runningFootHtml(doc, { filled, values, page: pageNumber, pages }),
    [doc, filled, values, pageNumber, pages],
  )
  const css = useMemo(() => letterCss(doc, page), [doc, page])

  return (
    <div
      /* The wrapper takes the SCALED height, or the shrunken page leaves a column of white
         underneath it the length of the space it used to need. */
      style={{
        width: `${page.widthMm * scale}mm`,
        height: `${page.heightMm * scale}mm`,
        overflow: 'hidden',
      }}
      className="shadow-lg rounded-[2px] shrink-0"
    >
      <style>{css}</style>
      <div className="ltr-page" style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <div className="ltr-body" dangerouslySetInnerHTML={{ __html: html }} />
        <div dangerouslySetInnerHTML={{ __html: foot }} />
      </div>
    </div>
  )
}
