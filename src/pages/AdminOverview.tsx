import { useState } from 'react'
import { Dashboard } from './Dashboard'
import { CommunicationsDashboard } from './CommunicationsDashboard'

type View = 'overview' | 'sales' | 'communications'

const TABS: { key: View; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'sales', label: 'Sales' },
  { key: 'communications', label: 'Communications' },
]

/**
 * Administrators oversee both departments, so instead of picking one
 * dashboard for them, they get all three views with a switcher — Overview
 * shows the full Sales and Communications dashboards stacked, and the
 * other two tabs jump straight to just one.
 */
export function AdminOverview() {
  const [view, setView] = useState<View>('overview')

  return (
    <div className="space-y-6">
      <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`text-sm font-medium px-4 py-1.5 rounded-lg ${view === t.key ? 'bg-navy-950 text-white' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === 'overview' && (
        <div className="space-y-10">
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Sales</h3>
            <Dashboard />
          </section>
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Communications</h3>
            <CommunicationsDashboard />
          </section>
        </div>
      )}
      {view === 'sales' && <Dashboard />}
      {view === 'communications' && <CommunicationsDashboard />}
    </div>
  )
}
