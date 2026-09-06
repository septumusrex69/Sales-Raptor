import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { Dashboard } from './Dashboard'
import { CommunicationsDashboard } from './CommunicationsDashboard'
import { CommunicationsSnapshot } from '../components/dashboard/CommunicationsSnapshot'
import { useTitleSlot } from '../components/layout/TitleSlot'

type View = 'overview' | 'sales' | 'communications'

const VIEWS: { key: View; label: string; hint: string }[] = [
  { key: 'overview', label: 'Overview', hint: 'Sales, with the key communications figures' },
  { key: 'sales', label: 'Sales', hint: 'The full sales dashboard' },
  { key: 'communications', label: 'Communications', hint: 'The full communications dashboard' },
]

/**
 * Administrators oversee both departments.
 *
 * Overview used to stack both full dashboards, which meant scrolling past one to reach the
 * other — two dashboards, not an overview. It now shows the sales dashboard with the handful
 * of Communications figures that answer "how much servicing happened", and both full
 * dashboards stay one click away.
 */
export function AdminOverview() {
  const [view, setView] = useState<View>('overview')

  // Which dashboard you're looking at is part of the page's identity, so the control sits on
  // the title rather than among the filters inside the page.
  useTitleSlot(<ViewMenu view={view} onChange={setView} />, [view])

  if (view === 'communications') return <CommunicationsDashboard />

  return (
    <Dashboard
      communicationsSnapshot={
        view === 'overview'
          ? (period) => <CommunicationsSnapshot period={period} onOpenFull={() => setView('communications')} />
          : undefined
      }
    />
  )
}

function ViewMenu({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = VIEWS.find((v) => v.key === view) ?? VIEWS[0]

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition-colors"
      >
        {current.label}
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1.5 w-64 bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-50">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="menuitem"
              onClick={() => {
                onChange(v.key)
                setOpen(false)
              }}
              className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-start gap-2.5"
            >
              <Check size={14} className={`mt-0.5 shrink-0 ${v.key === view ? 'text-gold-600' : 'text-transparent'}`} />
              <span>
                <span className={`block text-sm ${v.key === view ? 'font-semibold text-slate-800' : 'font-medium text-slate-600'}`}>{v.label}</span>
                <span className="block text-xs text-slate-400">{v.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
