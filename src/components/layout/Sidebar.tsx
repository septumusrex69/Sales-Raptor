import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Target,
  Handshake,
  Users,
  Building2,
  CheckSquare,
  Calendar,
  Activity,
  BarChart3,
  Settings,
  ChevronDown,
  LogOut,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '../../store/AuthContext'
import { UserAvatar } from '../ui/Avatar'
import { useTheme } from '../../store/ThemeContext'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/leads', label: 'Leads', icon: Target },
  { to: '/deals', label: 'Deals', icon: Handshake },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/companies', label: 'Clients', icon: Building2 },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/activities', label: 'Activities', icon: Activity },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const { currentUser, signOut } = useAuth()
  const { theme } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <aside className="app-sidebar w-60 shrink-0 bg-navy-950 text-slate-300 flex flex-col h-full">
      <div className="flex items-center px-5 h-16 border-b border-white/10">
        <img src={theme.lockupLight} alt="Bredell Ferreira" className="w-full h-auto" />
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors',
                isActive ? 'bg-gold-500 text-navy-950' : 'text-slate-300 hover:bg-white/5 hover:text-white',
              )
            }
          >
            <Icon size={17} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div ref={menuRef} className="relative border-t border-white/10 p-3">
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
        <button onClick={() => setMenuOpen((o) => !o)} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors text-left">
          <UserAvatar userId={currentUser?.id} size={32} />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold text-white truncate">{currentUser?.name ?? 'Loading…'}</span>
            <span className="block text-[11px] text-slate-400 truncate">{currentUser?.role ?? ''}</span>
          </span>
          <ChevronDown size={14} className="text-slate-500 shrink-0" />
        </button>
      </div>
    </aside>
  )
}
