import { Fragment, type ReactNode } from 'react'
import { RecordLayoutSwitcher, useRecordLayout, type RecordLayoutId } from '../record/RecordShell'

/**
 * A DASHBOARD'S PANES, IN THE THREE ARRANGEMENTS A RECORD PAGE HAS (S9, 19 Oct). The firm, on the
 * Communications dashboard: "on the panes, I also want the three different views ... the one under
 * the other, the three panes, and that one that's left that's bigger and small on the right."
 *
 * THE SAME THREE, THE SAME SWITCHER, THE SAME MEMORY as an account or a client (useRecordLayout,
 * RecordLayoutSwitcher), so somebody who has learned the icons on a record page knows them here.
 *
 * WHAT A PANE IS DECIDES WHERE IT GOES, not its position in a hand-made grid:
 *   - `full`  -- a row of figures. Always across the whole page, in every arrangement: a tile row
 *                folded into a third of the width is eight unreadable numbers.
 *   - `wide`  -- a chart or a table, which needs the width.
 *   - `narrow` -- a list, which reads fine in a third.
 *
 *   One column     -- everything under each other, in the page's order.
 *   Three columns  -- wide panes across the page; the narrow ones between them three abreast.
 *   Wide           -- wide panes in the left two thirds, narrow ones down the right third, the
 *                     two columns running independently so neither is stretched to the other.
 *
 * A `full` pane splits the page into stretches and each stretch is arranged on its own, so the
 * figure rows stay exactly where the page put them.
 */
export interface DashboardPane {
  id: string
  kind?: 'full' | 'wide' | 'narrow'
  node: ReactNode
}

export function DashboardPanes({ layoutKey, panes, initial }: {
  /** Where the choice is remembered, per dashboard. */
  layoutKey: string
  /** The arrangement before anybody has chosen one: the page's own drawing, where it had one. */
  initial?: RecordLayoutId
  /** In reading order. `false`/`null` entries are skipped, so a pane can be conditional inline. */
  panes: (DashboardPane | false | null | undefined)[]
}) {
  const [layout, choose] = useRecordLayout(layoutKey, initial)
  const list = panes.filter((p): p is DashboardPane => !!p)
  /* Stretches between the full-width rows. */
  const stretches: (DashboardPane | DashboardPane[])[] = []
  for (const p of list) {
    if ((p.kind ?? 'narrow') === 'full') stretches.push(p)
    else {
      const last = stretches[stretches.length - 1]
      if (Array.isArray(last)) last.push(p)
      else stretches.push([p])
    }
  }
  return (
    <div className="space-y-5" data-testid="dashboard-panes" data-layout={layout}>
      <div className="flex justify-end -mb-2">
        <RecordLayoutSwitcher layout={layout} onChange={choose} />
      </div>
      {stretches.map((s, i) => Array.isArray(s)
        ? <Fragment key={i}>{arrange(layout, s)}</Fragment>
        : <div key={s.id} data-pane={s.id}>{s.node}</div>)}
    </div>
  )
}

function arrange(layout: RecordLayoutId, panes: DashboardPane[]): ReactNode {
  const cell = (p: DashboardPane) => <div key={p.id} data-pane={p.id} className="min-w-0">{p.node}</div>
  if (layout === 'stacked') return <div className="space-y-5">{panes.map(cell)}</div>
  if (layout === 'wide') {
    const wide = panes.filter((p) => p.kind === 'wide')
    const narrow = panes.filter((p) => p.kind !== 'wide')
    /* Only one kind in this stretch: give it the page rather than two thirds of it. */
    if (wide.length === 0 || narrow.length === 0) return <div className="space-y-5">{panes.map(cell)}</div>
    return (
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">{wide.map(cell)}</div>
        <div className="min-w-0 space-y-5">{narrow.map(cell)}</div>
      </div>
    )
  }
  /* Three columns: each wide pane across the page, the narrow ones between them three abreast. */
  const out: ReactNode[] = []
  let run: DashboardPane[] = []
  const flush = () => {
    if (run.length) out.push(<div key={`run-${run[0].id}`} className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">{run.map(cell)}</div>)
    run = []
  }
  for (const p of panes) {
    if (p.kind === 'wide') { flush(); out.push(cell(p)) } else run.push(p)
  }
  flush()
  return <div className="space-y-5">{out}</div>
}
