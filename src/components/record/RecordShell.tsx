import { Fragment, useState, type ReactNode } from 'react'
import { ChevronDown, Columns3, MoreHorizontal, PanelRight, Rows3, type LucideIcon } from 'lucide-react'

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

/**
 * The rest of what you can do, folded away.
 *
 * A row of twelve buttons is not a row, it is a wall — and on a lead or a client it wrapped to
 * three lines on an iPad and pushed the panels below it off the screen. The debtor's account gets
 * away with eight because every one of them is something a collector reaches for constantly.
 *
 * So the four the firm named — call, SMS, email, note — plus the one thing the page exists for
 * stay out here, and everything else lives behind this. Nothing is removed, which matters: the
 * fix for a crowded row is not to take away the button somebody needs twice a month.
 *
 * A details/summary rather than a popover, deliberately. It closes on Escape, it is reachable by
 * keyboard, it needs no outside-click handler to get right, and on a touch screen it is one tap.
 */
export function RecordActionsMore({ children, label = 'More' }: {
  children: ReactNode
  label?: string
}) {
  return (
    <details className="relative group">
      <summary
        className={`${ACTION_BASE} ${ACTION_ENABLED} list-none cursor-pointer select-none marker:hidden`}
      >
        <MoreHorizontal size={14} /> {label}
        <ChevronDown size={13} className="text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      {/*
        Which edge it hangs from depends on the screen, and getting this wrong is not cosmetic.

        From sm up the row is one line and More sits at its right end, so the menu opens leftwards
        from that edge — right-0 — or it would run off the right of the page.

        On a phone the row WRAPS, and More lands near the left of its line. Right-aligning there
        pushed the menu 67px off the left edge of the screen with no way to scroll to it, which is
        exactly what happened and how this was found. So below sm it hangs from the left instead,
        and the width is capped to the viewport so a long label cannot undo it either way.

        z-20 clears the cards below, which carry their own stacking context.
      */}
      <div className="absolute left-0 sm:left-auto sm:right-0 z-20 mt-1 min-w-[13rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
        <div className="flex flex-col gap-0.5">{children}</div>
      </div>
    </details>
  )
}

/**
 * One thing inside the More menu.
 *
 * A full-width row rather than the pill shape of the row outside, because in a list the pills
 * read as a heap of buttons rather than as a menu. Same disabled behaviour as RecordAction: a
 * dashed, unclickable row with the reason in its tooltip beats a row that swallows the tap.
 */
export function RecordMoreAction({ icon: Icon, label, onClick, title, danger }: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  title?: string
  danger?: boolean
}) {
  const disabled = !onClick
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        // Close the menu on the way out, or it stays open over whatever the click opened.
        e.currentTarget.closest('details')?.removeAttribute('open')
        onClick?.()
      }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${
        disabled
          ? 'text-slate-300 cursor-not-allowed'
          : danger
            ? 'text-negative-700 hover:bg-negative-50'
            : 'text-slate-700 hover:bg-slate-50'}`}
    >
      <Icon size={14} className={disabled ? '' : danger ? 'text-negative-700' : 'text-slate-400'} />
      {label}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

export interface RecordTab<T extends string> {
  id: T
  label: string
  /** Shown beside the label, so you can see there is nothing in there without opening it. */
  count?: number
  /**
   * SOMETHING IN THERE IS WAITING ON A PERSON.
   *
   * A COUNT CANNOT SAY THIS. "Workflow 2" is two runs on the account and says nothing about
   * whether either of them has stopped — and the held section 129 that used to shout from the
   * Overview rail is now behind a tab, so without a mark on the tab itself the move would have
   * hidden the one thing on this page that is somebody's work.
   */
  alert?: boolean
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
            {t.alert && (
              <span aria-label="Waiting on you"
                className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--c-gold)] align-middle" />
            )}
          </button>
        ))}
        {trailing}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Layouts
 * ------------------------------------------------------------------ */

/**
 * How the Overview is arranged.
 *
 * Not a preference for its own sake. The same page is worked on very different screens: a wide
 * desktop where three columns read at a glance, a laptop where the middle column gets squeezed,
 * an iPad held in one hand. The firm asked to be able to choose rather than have the page choose
 * for them — first on the debtor's account, and then, seeing it, on every other record page.
 */
export type RecordLayoutId = 'columns' | 'stacked' | 'wide'

export const RECORD_LAYOUTS: { id: RecordLayoutId; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'columns', label: 'Three columns', icon: Columns3, hint: 'Everything side by side' },
  { id: 'stacked', label: 'One column', icon: Rows3, hint: 'Under each other, in reading order' },
  { id: 'wide', label: 'Wide', icon: PanelRight, hint: 'The work two thirds, the rest one third' },
]

/**
 * The chosen layout, remembered per browser.
 *
 * The KEY is per page type, not per record: it is a preference about eyes, not about a debtor or
 * a client. Separate keys per page because the right arrangement genuinely differs — an account
 * has a long timeline to give width to, a lead has not.
 */
export function useRecordLayout(key: string): [RecordLayoutId, (next: RecordLayoutId) => void] {
  const [layout, setLayout] = useState<RecordLayoutId>(() => {
    try {
      const saved = localStorage.getItem(key)
      if (RECORD_LAYOUTS.some((l) => l.id === saved)) return saved as RecordLayoutId
    } catch { /* private browsing, or storage switched off. The default is fine. */ }
    return 'columns'
  })
  const choose = (next: RecordLayoutId) => {
    setLayout(next)
    try { localStorage.setItem(key, next) } catch { /* nothing to remember it with. */ }
  }
  return [layout, choose]
}

/**
 * The three little icons, for the tab row's trailing slot.
 *
 * Icons rather than words: this sits on a tab row, and three labelled buttons would read as three
 * more tabs. Hidden on a phone, where the tabs already fill the row and adding 95px to it pushes
 * the whole page sideways — measured, not guessed. Nothing is lost, because every layout collapses
 * to one column below lg anyway.
 */
export function RecordLayoutSwitcher({ layout, onChange }: {
  layout: RecordLayoutId
  onChange: (next: RecordLayoutId) => void
}) {
  return (
    <div className="ml-auto mb-1 hidden sm:flex items-center gap-0.5 self-end rounded-lg border border-slate-200 p-0.5">
      {RECORD_LAYOUTS.map((l) => (
        <button key={l.id} type="button" onClick={() => onChange(l.id)}
          title={`${l.label} — ${l.hint}`} aria-label={l.label} aria-pressed={layout === l.id}
          className={`p-1.5 rounded-md ${layout === l.id
            ? 'bg-navy-950 text-white'
            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
          <l.icon size={15} />
        </button>
      ))}
    </div>
  )
}

/**
 * Place a record's panels according to the chosen layout.
 *
 * Three roles, which every record page turns out to have: who this is (`details`), the thing you
 * came to work on (`main`), and the shorter cards beside it (`side`). Passing them in once and
 * letting this arrange them is the whole reason the three layouts can be trusted to stay the same
 * page — a prop added to one arrangement and forgotten in the other two is the bug this prevents,
 * and it is invisible until somebody switches layout.
 *
 * `side` is a list rather than one node because the stacked arrangement treats the first one
 * differently: it is the summary, and it belongs beside the details rather than under them.
 */
/**
 * Wrap each panel so React has a key for it.
 *
 * The panels come in as a plain array of elements the page built by hand, and most of them have
 * no key of their own — without this every layout logs a warning per panel, and a console full of
 * warnings is a console nobody reads when something real goes wrong. Position is a sound key
 * here: the list is fixed by the page, not by data that reorders.
 */
function keyed(panels: ReactNode[]): ReactNode[] {
  return panels.map((panel, i) => <Fragment key={i}>{panel}</Fragment>)
}

export function RecordLayout({ layout, details, main, side }: {
  layout: RecordLayoutId
  details: ReactNode
  /** The long one — a timeline, a list of deals. Gets the width. */
  main: ReactNode
  /** The shorter cards. The first is treated as the summary. */
  side: ReactNode[]
}) {
  const [first, ...rest] = side

  if (layout === 'stacked') {
    // One column, in reading order: who they are, what the figures say, what has happened, then
    // the rest. Capped to a readable measure — a full-width timeline on a 27" screen is a worse
    // read than a narrow one, not a better one.
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4">
        {/* Details beside the summary rather than above it. Reading order is preserved — left to
            right is still details then summary — and it saves most of a screen of scrolling. */}
        <div className="grid gap-4 items-start lg:grid-cols-3">
          <div className="lg:col-span-2">{details}</div>
          {first}
        </div>
        {main}
        {rest.length > 0 && (
          /* The short cards share a row rather than each taking a full one. `items-start`
             matters: without it the grid stretches them all to the height of the tallest, so one
             busy card leaves the others as mostly empty boxes the same height. */
          <div className="grid gap-4 items-start md:grid-cols-2 lg:grid-cols-3">{keyed(rest)}</div>
        )}
      </div>
    )
  }

  if (layout === 'wide') {
    // Two thirds and one third. The work gets the width; the figures sit beside it and stay in
    // view while you scroll.
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {details}
          {main}
        </div>
        <div className="space-y-4">{keyed(side)}</div>
      </div>
    )
  }

  /*
   * Three columns, but only from xl. At iPad width the fixed side columns leave the middle about
   * 120px wide, which is not a narrow column — it is unreadable. So lg drops to two columns with
   * the main panel full-width underneath, and anything narrower stacks.
   *
   * The middle is TWICE a side, at every width, and that is a proportion rather than a size on
   * purpose. Fixed 19rem sides read as three near-equal columns on an iPad — where the sidebar
   * leaves about 1000px of content, so 608 of it went to the sides and the middle was starved to
   * 370. The middle is the column you came to work in; it should look like it. Proportional
   * tracks keep that true on a 13" iPad and a 27" screen alike.
   *
   * The 13rem floor stops a side column collapsing to something a label/value pair cannot sit in
   * at the narrow end of the range.
   */
  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(13rem,1fr)_minmax(0,2fr)_minmax(13rem,1fr)]">
      <div className="lg:order-1 xl:order-none">{details}</div>
      <div className="lg:order-3 lg:col-span-2 xl:order-none xl:col-span-1">{main}</div>
      <div className="space-y-4 lg:order-2 xl:order-none">{keyed(side)}</div>
    </div>
  )
}
