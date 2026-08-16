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
} from 'lucide-react'
import clsx from 'clsx'
import { currentUser } from '../../data/mockData'
import { UserAvatar } from '../ui/Avatar'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/leads', label: 'Leads', icon: Target },
  { to: '/deals', label: 'Deals', icon: Handshake },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/companies', label: 'Companies', icon: Building2 },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/activities', label: 'Activities', icon: Activity },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  return (
    <aside className="w-60 shrink-0 bg-navy-950 text-slate-300 flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-white/10">
        <div className="w-8 h-8 rounded-full border border-gold-500 flex items-center justify-center shrink-0">
          <span className="text-white font-semibold text-[13px] tracking-tighter">BF</span>
        </div>
        <span className="font-semibold text-white text-[15px] tracking-tight">Bredell Ferreira</span>
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

      <div className="border-t border-white/10 p-3">
        <button className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors text-left">
          <UserAvatar userId={currentUser.id} size={32} />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold text-white truncate">{currentUser.name}</span>
            <span className="block text-[11px] text-slate-400 truncate">{currentUser.role}</span>
          </span>
          <ChevronDown size={14} className="text-slate-500 shrink-0" />
        </button>
      </div>
    </aside>
  )
}
