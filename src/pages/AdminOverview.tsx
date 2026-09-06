import { useState } from 'react'
import { Dashboard } from './Dashboard'
import { CommunicationsDashboard } from './CommunicationsDashboard'
import { CommunicationsSnapshot } from '../components/dashboard/CommunicationsSnapshot'

type View = 'overview' | 'sales' | 'communications'

const TABS: { key: View; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'sales', label: 'Sales' },
  { key: 'communications', label: 'Communications' },
]

/**
 * Administrators oversee both departments.
 *
 * Overview used to stack both full dashboards, which meant scrolling past one department to
 * reach the other — two dashboards, not an overview. It now shows the sales dashboard with
 * the handful of Communications figures that answer "how much servicing happened", and the
 * two full dashboards stay one click away.
 *
 * The switcher sits among the hero's own controls rather than above it, so the banner starts
 * directly under the top bar and the toggle reads as a control rather than a heading.
 */
export function AdminOverview() {
  const [view, setView] = useState<View>('overview')

  const switcher = (
    <div className="inline-flex items-center gap-0.5 bg-white/10 border border-white/15 rounded-lg p-0.5">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => setView(t.key)}
          aria-pressed={view === t.key}
          className={`text-[13px] font-medium px-2.5 py-1.5 rounded-md transition-colors ${
            view === t.key ? 'bg-white text-navy-950' : 'text-white/70 hover:text-white'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  if (view === 'communications') return <CommunicationsDashboard viewSwitcher={switcher} />

  return (
    <Dashboard
      viewSwitcher={switcher}
      communicationsSnapshot={
        view === 'overview'
          ? (period) => <CommunicationsSnapshot period={period} onOpenFull={() => setView('communications')} />
          : undefined
      }
    />
  )
}
