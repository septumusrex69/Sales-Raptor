import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * The shape every record page in Raptor wears.
 *
 * WHY THIS EXISTS. The debtor's Account page grew a grammar that works: a dark band naming the
 * record, a row of figures you can read at a glance, one row of things you can DO, then tabs over
 * the detail. A collector learns it once. But Leads and Clients had each grown their own — stats
 * strung inline inside a card, a wrapping row of outline buttons in a different size, no tabs at
 * all and one very long scroll — so moving between a debtor and the client who handed them over
 * meant learning the page again. The firm asked for one grammar, and they were right to.
 *
 * These are the four pieces of it, and nothing more: no data, no fetching, no opinions about what
 * a record is. A lead is not a debtor and must not be made to look like one where they genuinely
 * differ — what is shared here is the furniture, not the contents.
 *
 * The Account page uses these too rather than keeping its own copies, which is the only way the
 * pages stay in step. A shared component that its own model page does not use drifts within a
 * month, and then "uniform" means "uniform apart from the one that matters".
 */

/* ------------------------------------------------------------------ *
 * Figures
 * ------------------------------------------------------------------ */

/**
 * One figure.
 *
 * `small` is for the ones holding words rather than money — a status set at the size of a rand
 * amount reads as the most important thing on the page, and it is not.
 */
export function RecordFigure({ label, value, note, strong, danger, small, onClick, title }: {
  label: string
  value: string
  note?: ReactNode
  /** The one figure the page is really about. */
  strong?: boolean
  danger?: boolean
  small?: boolean
  /** Makes the whole tile a button — for a figure that has somewhere to go. */
  onClick?: () => void
  title?: string
}) {
  const body = (
    <>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`font-semibold mt-0.5 ${small ? 'text-sm leading-snug' : 'text-lg tabular-nums'} ${
        danger ? 'text-negative' : strong ? 'text-navy-950' : 'text-slate-800'}`}>{value}</p>
      {note && (
        <p className={`text-[11px] mt-0.5 leading-snug ${danger ? 'text-negative-700' : 'text-slate-500'}`}>
          {note}
        </p>
      )}
    </>
  )
  const shell = `card px-3.5 py-2.5 ${strong ? 'border-gold-100' : ''}`
  if (!onClick) return <div className={shell}>{body}</div>
  return (
    <button type="button" onClick={onClick} title={title}
      className={`${shell} text-left hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40`}>
      {body}
    </button>
  )
}

/**
 * A tile with the same skin, holding something other than a number.
 *
 * For the figures that are also controls — a lead's class and status are dropdowns you set from
 * here, not readings. Keeping them in the row rather than in a panel below is deliberate: they
 * are the first two things anybody looks at, and moving them would be tidier and worse.
 */
export function RecordFigureShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="card px-3.5 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

/**
 * The row of figures under the band.
 *
 * Two columns on a phone whatever the count, because three 110px tiles side by side is three
 * unreadable tiles. Above that it lays out to fit what it was given rather than to a fixed five,
 * so a lead with six figures and a client with four both look deliberate.
 */
export function RecordFigures({ children, count }: { children: ReactNode; count: number }) {
  const wide = count >= 6 ? 'lg:grid-cols-6' : count === 5 ? 'lg:grid-cols-5' : count === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
  return <div className={`grid grid-cols-2 ${wide} gap-2.5`}>{children}</div>
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

/** Shared with the Call and Trace buttons, which are links rather than Actions. */
export const ACTION_BASE =
  'inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors'
export const ACTION_ENABLED = 'border-slate-200 text-slate-700 bg-white hover:bg-slate-50'

/**
 * One thing you can do to this record.
 *
 * No handler means disabled, and disabled means a dashed border and a reason in the tooltip. That
 * is deliberate across every page: a button that looks live and swallows the click teaches people
 * not to trust the row, and a row nobody trusts is a row nobody uses.
 */
export function RecordAction({ icon: Icon, label, onClick, title, primary, danger }: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  title?: string
  /** The one action the page exists for. At most one per row. */
  primary?: boolean
  /** Destructive — delete, reject. Never primary. */
  danger?: boolean
}) {
  const disabled = !onClick
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${ACTION_BASE} ${
        disabled
          ? 'border-dashed border-slate-200 text-slate-300 cursor-not-allowed'
          : primary
            ? 'border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500'
            : danger
              ? 'border-slate-200 text-negative-700 bg-white hover:border-negative-100 hover:bg-negative-50'
              : ACTION_ENABLED}`}
    >
      <Icon size={14} /> {label}
    </button>
  )
}

/** Everything you can do, in one row that wraps rather than scrolling the page sideways. */
export function RecordActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

export interface RecordTab<T extends string> {
  id: T
  label: string
  /** Shown beside the label, so you can see there is nothing in there without opening it. */
  count?: number
}

/**
 * The tab strip over a record's detail.
 *
 * THE STRIP SCROLLS; THE PAGE DOES NOT. Four tabs are already wider than a phone, and without
 * this the whole page scrolled sideways — measured at 360 and 420px on the account page, not
 * guessed. The border sits on the OUTER div rather than on the scroller, because a scroller whose
 * children carry `-mb-px` overflows itself vertically by that pixel and grows a scrollbar inside
 * the tab row. Moving the -mb-px onto the scroller keeps the active tab's underline sitting on
 * the border with nothing to clip.
 *
 * `trailing` is for a control that belongs to the tabs rather than to a tab — the layout switcher
 * on the Account page. It sits inside the scroller so it cannot overlap the last tab.
 */
export function RecordTabs<T extends string>({ tabs, active, onChange, trailing }: {
  tabs: RecordTab<T>[]
  active: T
  onChange: (id: T) => void
  trailing?: ReactNode
}) {
  return (
    <div className="border-b border-slate-200">
      <div className="flex gap-1 overflow-x-auto -mb-px">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => onChange(t.id)}
            aria-current={active === t.id}
            className={`shrink-0 px-4 py-2 text-sm font-medium border-b-2 ${
              active === t.id
                ? 'border-gold-500 text-navy-950'
                : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t.label}
            {t.count !== undefined && (
              <span className="ml-1.5 text-[11px] text-slate-400 tabular-nums">{t.count}</span>
            )}
          </button>
        ))}
        {trailing}
      </div>
    </div>
  )
}
