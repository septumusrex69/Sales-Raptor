import { NavLink } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { useCollapsed } from '../../lib/sidebarCollapsed'

/**
 * THE RAIL A WORKSPACE IS NAVIGATED BY, and what it replaced.
 *
 * Finance was six tabs in a strip under the global search. The firm, pointing at it: "I don't
 * like that pane where you toggle between the top. It's like too small. We need like a whole
 * different section for the finance area... those things there on the top just make it look
 * messy."
 *
 * A STRIP CANNOT CARRY A HEADING, which is the half that actually matters. Six tabs was already
 * cramped; with expenses, income, drawings and the client ledgers it is eleven, and eleven in one
 * row has no way of saying that the first six are OTHER PEOPLE'S MONEY and the rest are the
 * firm's. A rail says it in the structure: each workspace is its own place, with its own name at
 * the top of its own list.
 *
 * IT IS A COLUMN INSIDE THE PAGE, NOT A THIRD BAR OF CHROME, and that is deliberate. Settings has
 * worked this way since the firm asked for it -- "that pane should also be able to collapse,
 * because now the screen is getting small" -- so this is a pattern already in the app rather than
 * a new one, and it folds away on an iPad the same way.
 *
 * ITS OWN FOLD KEY. Somebody who folds this to read a forty-column payover run still wants the
 * main menu where they left it; the main menu, Settings and this each remember separately.
 */

export interface RailItem {
  to: string
  label: string
  icon: LucideIcon
  /** `end` for the index route, or /trust would light up on every page under it. */
  end?: boolean
  /**
   * A COUNT ONLY WHERE IT IS SOMETHING ONE PERSON CAN CLEAR TODAY -- the main menu's rule, and it
   * holds here for the same reason. A badge on a catalogue reads the same number for ever and
   * teaches people to ignore the ones that mean something. Left undefined draws nothing.
   */
  badge?: number
}

/** The other book, one click away. */
export interface RailDoor {
  to: string
  label: string
  icon: LucideIcon
}

export function WorkspaceRail({
  title, subtitle, items, settings, door,
}: {
  title: string
  /** One line under the name saying whose money this workspace is about. */
  subtitle: string
  items: RailItem[]
  /** Drawn under a rule, because a setting is not a place you work. */
  settings?: RailItem
  door?: RailDoor
}) {
  const [collapsed, toggle] = useCollapsed('crm.workspaceNav.collapsed')

  if (collapsed) {
    /*
     * FOLDED, IT IS A RAIL OF ICONS -- STILL EVERY PLACE, STILL ONE CLICK. It used to fold into a
     * single button carrying the workspace's name, which reclaimed the width and took every item
     * with it. The firm: "when you narrow this menu, you can't click on the business account or you
     * can't see any of the icons. It would be much more convenient if you narrow the menu so that
     * you can see the icons that you can click on them." Which is how the main menu has always
     * folded, so this is the same pattern rather than a new one.
     *
     * AND IT STILL SAYS WHICH BOOK YOU ARE IN. The name over the icons is the reason the old fold
     * existed -- a column of bare icons would leave somebody unable to tell the trust account from
     * the business one, which is the single thing this whole split exists to keep clear -- so it
     * stays, small, as the control that widens the rail again. Each icon carries its label as a
     * tooltip and an accessible name: a row of unlabelled icons is a quiz.
     *
     * AND IT IS NARROW. The firm (8 Oct), of the 56px rail and the 24px gap after it: "still quite
     * big ... it can just be a little bit smaller." 48px holds the 16px icons and "Business" at
     * 10.5px; the gap is the rail's own margin, so folded it can close to 12px while the open menu
     * keeps its 24.
     *
     * THE WIDEN BUTTON STAYS WHERE THE NARROW ONE WAS -- at the bottom, under the door. The firm
     * (8 Oct): "the narrow option is at the bottom, but then it moves to the top. Keep it at the
     * bottom to keep consistency." The name stays on top as a plain label: it is there to say which
     * book this is, not to be pressed.
     */
    /*
     * IT STAYS WHERE IT IS WHILE THE PAGE SCROLLS (the firm, 10 Oct: "When I scroll down on a
     * specific pane, that thing disappears. It should stay ... so I can just go to any other pane").
     * Sticky inside <main>, which is what scrolls, and as tall as the window under the top bar
     * (4rem) less main's padding (3rem), so the door and the widen button stay at its foot. And
     * 42px folded, not 48 ("take a millimeter and a half out of that").
     */
    return (
      <nav aria-label={`${title} menu`} className="sticky top-0 self-start h-[calc(100dvh-7rem)] w-[42px] mr-3 shrink-0 flex flex-col items-center">
        <div className="w-full pb-2 mb-1 text-center text-[10.5px] font-semibold leading-tight text-slate-500">
          {title}
        </div>

        <div className="space-y-0.5 w-full">
          {items.map((item) => <RailLink key={item.to} {...item} folded />)}
        </div>

        {settings && (
          <div className="mt-3 pt-2 border-t border-slate-100 w-full">
            <RailLink {...settings} folded />
          </div>
        )}

        {door && (
          <div className="mt-auto pt-3 border-t border-slate-100 w-full">
            <NavLink
              to={door.to} title={door.label} aria-label={door.label}
              className="flex items-center justify-center py-2 rounded-lg text-slate-400
                hover:bg-slate-100 hover:text-slate-600"
            >
              <door.icon size={16} />
            </NavLink>
          </div>
        )}

        <button
          type="button" onClick={toggle} aria-expanded="false"
          title={`Show the ${title} menu`} aria-label={`Show the ${title} menu`}
          className={clsx('w-full flex items-center justify-center mt-2 py-2 rounded-lg',
            'text-slate-400 hover:bg-slate-100 hover:text-slate-600', !door && 'mt-auto')}
        >
          <PanelLeftOpen size={15} />
        </button>
      </nav>
    )
  }

  return (
    <nav aria-label={`${title} menu`} className="sticky top-0 self-start h-[calc(100dvh-7rem)] w-56 mr-6 shrink-0 flex flex-col">
      <div className="px-3 pb-3">
        <div className="text-[15px] font-semibold text-slate-800 tracking-tight">{title}</div>
        <div className="text-[11.5px] text-slate-400 mt-0.5">{subtitle}</div>
      </div>

      <div className="space-y-0.5">
        {items.map((item) => <RailLink key={item.to} {...item} />)}
      </div>

      {settings && (
        <div className="mt-3 pt-2 border-t border-slate-100">
          <RailLink {...settings} />
        </div>
      )}

      {door && (
        /*
          A DOOR, NOT A TAB, and the difference is the point. A tab would say these are two views
          of one thing. They are two books: separately governed, separately audited, and the firm
          asked for them apart precisely so that nobody can slide between them without noticing.
          So it sits under a rule, at the bottom, in the quiet weight -- a way out of here rather
          than another item of here.
        */
        <div className="mt-auto pt-3 border-t border-slate-100">
          <NavLink
            to={door.to}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-slate-400
              hover:bg-slate-100 hover:text-slate-600"
          >
            <door.icon size={15} className="shrink-0" />
            {door.label}
          </NavLink>
        </div>
      )}

      {/* At the bottom, under the list, which is where the main menu and Settings keep theirs. */}
      <button
        type="button" onClick={toggle} aria-expanded="true" title={`Narrow the ${title} menu`}
        className="w-full flex items-center gap-2 mt-2 px-3 py-2 rounded-lg text-[12px]
          text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <PanelLeftClose size={15} /> Narrow this menu
      </button>
    </nav>
  )
}

function RailLink({ to, label, icon: Icon, end, badge, folded = false }: RailItem & { folded?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      /* Folded, the label is the tooltip and the accessible name, because it is no longer drawn. */
      title={folded ? label : undefined}
      aria-label={folded ? label : undefined}
      className={({ isActive }) => clsx(
        'relative flex items-center rounded-lg text-[13.5px] font-medium',
        folded ? 'justify-center py-2' : 'gap-2.5 px-3 py-2',
        isActive ? 'bg-gold-50 text-gold-800' : 'text-slate-500 hover:bg-slate-100',
      )}
    >
      {({ isActive }) => (
        <>
          {/* The active edge, in the gold the main menu already marks the current section with. */}
          {isActive && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-gold-500" />
          )}
          <Icon size={16} className="shrink-0" />
          {!folded && <span className="truncate">{label}</span>}
          {/* Folded, the count becomes a dot, as on the main menu: "38" does not fit beside a
              16px icon, and a dot still says there is something to clear here. */}
          {folded && badge !== undefined && badge > 0 && (
            <span title={`${badge}`} className="absolute top-1 right-2 w-2 h-2 rounded-full bg-negative" />
          )}
          {!folded && badge !== undefined && badge > 0 && (
            <span className="ml-auto min-w-[18px] text-center rounded-full bg-negative px-1.5
              py-px text-[11px] font-semibold text-white tabular-nums">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}
