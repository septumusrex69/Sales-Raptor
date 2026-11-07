import { useState } from 'react'

/**
 * A HUNDRED DRAWN AT A TIME, AND A WAY TO THE REST (S19, Raptor H18).
 *
 * Stephan, on the iPad, 7 Nov: "it looks like the entire trust area is lagging." The database was not the
 * cause -- every trust function answers in well under a fifth of a second -- the BROWSER was: Needs an account
 * drew 1 805 receipts at once, To sort 2 135 statement lines (each with its own drop-downs), the Bank statement
 * 2 160 rows. Tens of thousands of elements to scroll past on a tablet.
 *
 * So a long list draws its first hundred and says how many there are. What is READ is unchanged: totals, tiles
 * and searches still cover every row, so narrowing a list is never the same as hiding money. Only the drawing is
 * a page. "Show all" stays, for the day somebody wants to scroll the lot.
 */
export const PER_PAGE = 100

/**
 * How many to draw, starting again at the first hundred whenever `resetKey` changes -- a new search, a new
 * month -- so a narrowed list does not open scrolled into its old fourth page. Reset during render (React's own
 * pattern for state that follows a prop), not in an effect, so the first paint of a new search is already right.
 */
export function useDrawn(resetKey: unknown, per = PER_PAGE) {
  const [drawn, setDrawn] = useState(per)
  const [key, setKey] = useState(resetKey)
  if (!Object.is(key, resetKey)) { setKey(resetKey); setDrawn(per) }
  return [drawn, setDrawn] as const
}

/** The line under a long list: how many of how many, the next hundred, or all of them. Nothing when all are drawn. */
export function ShowMore({ total, drawn, setDrawn, per = PER_PAGE, testId = 'show-more' }: {
  total: number
  drawn: number
  setDrawn: (n: number) => void
  per?: number
  testId?: string
}) {
  if (total <= drawn) return null
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-3 text-[13px]" data-testid={testId}>
      <span className="text-slate-500">
        Showing {drawn.toLocaleString('en-ZA')} of {total.toLocaleString('en-ZA')}
      </span>
      <button type="button" onClick={() => setDrawn(drawn + per)}
        className="font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
        Show {Math.min(per, total - drawn).toLocaleString('en-ZA')} more
      </button>
      <button type="button" onClick={() => setDrawn(total)}
        title="Every one at once is slow on an iPad. The search finds one without drawing them all."
        className="font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2">
        Show all
      </button>
    </div>
  )
}
