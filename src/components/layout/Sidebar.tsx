import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useNavCounts, type NavCounts } from '../../lib/navCounts'
import {
  Activity, BarChart3, BookOpen, Building2, Calendar, CalendarClock, CheckSquare, ChevronDown, Handshake, Inbox, LayoutDashboard, Library, LogOut, MessageCircleQuestion, PanelLeftClose, PanelLeftOpen, Settings, Target, TrendingUp, Users, type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '../../store/AuthContext'
import { UserAvatar } from '../ui/Avatar'
import { useTheme } from '../../store/ThemeContext'
import { canViewClients, canViewLibrary } from '../../lib/permissions'
import { useSidebarCollapsed } from '../../lib/sidebarCollapsed'

/**
 * The navigation, and the three items that carry a count.
 *
 * Only three, and the rule is strict: a badge earns its place if it counts something ONE PERSON
 * CAN CLEAR TODAY. Accounts, Leads, Deals and Clients are catalogues rather than inboxes — a
 * number on Accounts would read "100 000" forever and teach everybody to ignore the others.
 * See src/lib/navCounts.ts.
 */
const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: keyof NavCounts }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  // Second, under Dashboard, at the firm's request. It is the first thing an agent checks:
  // debtor mail that could not be matched to an account is waiting here to be filed, and
  // nothing else in Raptor will tell them it arrived.
  { to: '/mail', label: 'Mail', icon: Inbox, badge: 'mail' },
  { to: '/leads', label: 'Leads', icon: Target },
  { to: '/deals', label: 'Deals', icon: Handshake },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/companies', label: 'Clients', icon: Building2 },
  // The collections book: the debtor accounts a client hands over, which is a different thing
  // from the client record and much larger than it.
  { to: '/accounts', label: 'Accounts', icon: BookOpen },
  // The collections work queue: which accounts this person is due to work today, and what they
  // are behind on. Badged, because it is the definition of something one person clears in a day.
  { to: '/diary', label: 'Diary', icon: CalendarClock, badge: 'diary' },
  // How the collections work is actually going. Beside the diary, because the diary is today's
  // work and this is whether the month's is landing.
  //
  // CALLED "COLLECTIONS", AT THE FIRM'S INSTRUCTION. "Performance" said nothing about which half
  // of the firm it was: the sales side has its own figures on the Dashboard, and a rep clicking
  // "Performance" expecting theirs found a book they do not work. The route stays /performance so
  // nobody's bookmark breaks.
  { to: '/performance', label: 'Collections', icon: TrendingUp },
  { to: '/queries', label: 'Disputes', icon: MessageCircleQuestion, badge: 'disputes' },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare, badge: 'tasks' },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/activities', label: 'Activities', icon: Activity },
  // Everything the firm SAYS -- the SMS, emails, call scripts and letters, and the workflows that
  // schedule them. OPEN TO EVERYONE, at the firm's instruction: "perhaps everyone can view
  // everything in the library. Only [an administrator] can edit." A collector reading a script on
  // a live call benefits from seeing the ladder it sits on; the risk is in writing it, not reading.
  //
  // Its own item rather than a Settings tab, where the workflow builder currently hides: a
  // library is content a person maintains and comes back to, not a switch they set once. It sits
  // by Reports because both are reference rather than a queue somebody works down.
  { to: '/library', label: 'Library', icon: Library },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const { currentUser, signOut } = useAuth()
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()
  const { theme } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const counts = useNavCounts()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <aside className={clsx(
      'app-sidebar shrink-0 bg-navy-950 text-slate-300 flex flex-col h-full',
      /* Width transitions rather than snapping: at 176px of travel a snap reads as the page
         breaking, and the same movement animated reads as a drawer. */
      'transition-[width] duration-200 ease-out',
      collapsed ? 'w-16' : 'w-60',
    )}>
      <div className={clsx(
        'flex items-center h-16 border-b border-white/10',
        collapsed ? 'px-2 justify-center' : 'px-5',
      )}>
        {/*
          THE MARK BECOMES THE BIRD. The full lockup is a wordmark and does not survive being
          squeezed into 48px — it goes to an unreadable smear. Collapsed, the sidebar shows the
          icon alone, which is what the favicon already is.
        */}
        {collapsed
          ? <img src="/favicon.svg" alt="Bredell Ferreira" className="w-7 h-7" />
          : <img src={theme.lockupLight} alt="Bredell Ferreira" className="w-full h-auto" />}
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {NAV
          .filter((n) => n.to !== '/companies' || canViewClients(currentUser?.role))
          /* A menu item that always refuses is worse than no menu item: it advertises a room
             nobody may enter and teaches people that the sidebar lies. The page keeps its own
             guard for anyone who types the address. */
          .filter((n) => n.to !== '/library' || canViewLibrary(currentUser?.role))
          .map(({ to, label, icon: Icon, end, badge }) => {
          const count = badge ? counts[badge] : 0
          return (
          <NavLink
            key={to}
            to={to}
            end={end}
            /* The label is the only thing naming the item once it is a rail, so it moves into a
               tooltip rather than disappearing. A row of unlabelled icons is a quiz. */
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              clsx(
                /* `relative` anchors the collapsed badge's dot, which has nowhere else to sit
                   once the row is 40px wide and the number is gone. */
                'relative flex items-center gap-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors',
                collapsed ? 'px-0 justify-center' : 'px-3',
                isActive ? 'bg-gold-500 text-navy-950' : 'text-slate-300 hover:bg-white/5 hover:text-white',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={17} strokeWidth={2} className="shrink-0" />
                {!collapsed && label}
                {/*
                  A count, never a dot. "3" tells you whether to look now; a dot only says
                  something exists, which you could have assumed.

                  Nothing at zero: a badge that is always there showing 0 is furniture, and it
                  is the thing that teaches people to stop reading the others.

                  On the active item the gold background is already carrying the emphasis, so
                  the badge goes dark-on-gold rather than competing with it.
                */}
                {/*
                  COLLAPSED, THE COUNT BECOMES A DOT. There is no room for "38" beside a 17px
                  icon, and shrinking the number to fit makes it unreadable — which would quietly
                  remove the one thing the badge is for. A dot still says "there is something
                  here"; the number comes back with the label.
                */}
                {count > 0 && (collapsed ? (
                  <span title={`${count}`}
                    className="absolute top-1 right-2 w-2 h-2 rounded-full bg-gold-500" />
                ) : (
                  <span className={clsx(
                    'ml-auto min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold',
                    'inline-flex items-center justify-center tabular-nums',
                    isActive ? 'bg-navy-950/15 text-navy-950' : 'bg-gold-500 text-navy-950',
                  )}>
                    {count > 99 ? '99+' : count}
                  </span>
                ))}
              </>
            )}
          </NavLink>
          )
        })}
      </nav>

      {/*
        THE FOLD, at the bottom of the nav rather than at the top.
        
        Away from the logo, which people click to go home, and beside the account card, which is
        the other thing on this bar that is about the person rather than the work.
      */}
      <div className={clsx('px-3 pb-1', collapsed && 'flex justify-center')}>
        <button type="button" onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? 'Widen the menu' : 'Narrow the menu'}
          className={clsx(
            'flex items-center gap-2.5 py-2 rounded-lg text-[12px] text-slate-400',
            'hover:bg-white/5 hover:text-white transition-colors',
            collapsed ? 'px-0 w-10 justify-center' : 'px-3 w-full',
          )}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && 'Narrow the menu'}
        </button>
      </div>

      <div ref={menuRef} className={clsx('relative border-t border-white/10', collapsed ? 'p-2' : 'p-3')}>
        {menuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-1.5 bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-50">
            <button
              onClick={() => {
                setMenuOpen(false)
                signOut()
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <LogOut size={14} /> Log out
            </button>
          </div>
        )}
        <button onClick={() => setMenuOpen((o) => !o)}
          title={collapsed ? (currentUser?.name ?? undefined) : undefined}
          className={clsx(
            'w-full flex items-center gap-2.5 py-2 rounded-lg hover:bg-white/5 transition-colors text-left',
            collapsed ? 'px-0 justify-center' : 'px-2',
          )}>
          <UserAvatar userId={currentUser?.id} size={32} />
          {!collapsed && (
            <>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold text-white truncate">{currentUser?.name ?? 'Loading…'}</span>
                <span className="block text-[11px] text-slate-400 truncate">{currentUser?.role ?? ''}</span>
              </span>
              <ChevronDown size={14} className="text-slate-500 shrink-0" />
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
