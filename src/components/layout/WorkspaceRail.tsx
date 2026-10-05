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
     * FOLDED, THE RAIL BECOMES THE WAY BACK AND THE ANSWER TO "WHERE AM I", exactly as the
     * settings menu does. The workspace's own name is the label and the control: without it a
     * folded rail would reclaim the width and leave somebody unable to tell the trust account
     * from the business one, which is the single thing this whole split exists to keep clear.
     */
    return (
      <button
        type="button" onClick={toggle} aria-expanded="false" title={`Show the ${title} menu`}
        className="flex items-center gap-2 mb-3 -mt-1 px-2 py-1.5 rounded-lg text-sm font-medium
          text-slate-500 hover:bg-slate-100 hover:text-slate-700 self-start shrink-0"
      >
        <PanelLeftOpen size={15} /> {title}
      </button>
    )
  }

  return (
    <nav className="w-56 shrink-0 flex flex-col">
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

function RailLink({ to, label, icon: Icon, end, badge }: RailItem) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => clsx(
        'relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] font-medium',
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
          <span className="truncate">{label}</span>
          {badge !== undefined && badge > 0 && (
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
