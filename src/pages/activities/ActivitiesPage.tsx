import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Phone, Mail, MessageCircle, Calendar, StickyNote, FileText, CheckSquare, ArrowRightLeft, Trophy, XOctagon, Inbox } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { formatDateTime } from '../../data/mockData'
import { ACTIVITY_TYPE_TAILWIND } from '../../lib/colors'
import { readParam } from '../../lib/drilldown'
import { decodeSalesMonthParam, isWithinPeriod } from '../../lib/salesMonth'
import type { ActivityType } from '../../types'

const ACTIVITY_TYPES: ActivityType[] = [
  'Call',
  'Email',
  'WhatsApp',
  'Meeting',
  'Note',
  'Proposal',
  'Task',
  'Status change',
  'Deal update',
  'Deal Stage Change',
  'Deal Won',
  'Deal Lost',
  'Courtesy Call',
  'Handover Received',
]

const ICONS: Record<ActivityType, typeof Phone> = {
  Call: Phone,
  Email: Mail,
  WhatsApp: MessageCircle,
  Meeting: Calendar,
  Note: StickyNote,
  Proposal: FileText,
  Task: CheckSquare,
  'Status change': ArrowRightLeft,
  'Deal update': ArrowRightLeft,
  'Deal Stage Change': ArrowRightLeft,
  'Deal Won': Trophy,
  'Deal Lost': XOctagon,
  'Courtesy Call': Phone,
  'Handover Received': Inbox,
}

const ICON_COLORS = ACTIVITY_TYPE_TAILWIND

export function ActivitiesPage() {
  const { activities, deals, companies, users, companyById, leadById } = useAppStore()
  const reps = useMemo(() => users.filter((u) => u.role.includes('Sales') || u.role === 'Administrator'), [users])
  const [searchParams] = useSearchParams()
  const [user, setUser] = useState(() => readParam(searchParams, 'owner') ?? 'All')
  const [type, setType] = useState(() => readParam(searchParams, 'type') ?? 'All')
  const [company, setCompany] = useState('All')

  // One-time drill-down filter carried in from Dashboard links — not exposed as a UI control.
  const [salesMonthFilter] = useState(() => decodeSalesMonthParam(searchParams.get('salesMonth')))

  const filtered = useMemo(() => {
    return activities.filter((a) => {
      if (user !== 'All' && a.userId !== user) return false
      if (type !== 'All' && a.type !== type) return false
      if (company !== 'All' && a.companyId !== company) return false
      if (salesMonthFilter && !isWithinPeriod(a.activityDate, salesMonthFilter)) return false
      return true
    })
  }, [activities, user, type, company, salesMonthFilter])

  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = {}
    for (const a of filtered) {
      const key = new Date(a.activityDate).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })
      groups[key] = groups[key] ? [...groups[key], a] : [a]
    }
    return groups
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <select value={user} onChange={(e) => setUser(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-600 outline-none">
          <option value="All">All Users</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-600 outline-none">
          <option value="All">All Types</option>
          {ACTIVITY_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select value={company} onChange={(e) => setCompany(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-600 outline-none">
          <option value="All">All Companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-400 ml-auto">{filtered.length} activities</span>
      </div>

      <div className="space-y-6">
        {Object.entries(grouped).map(([day, items]) => (
          <div key={day}>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{day}</p>
            <Card padded={false}>
              <div className="divide-y divide-slate-50">
                {items.map((a) => {
                  const Icon = ICONS[a.type]
                  const lead = leadById(a.leadId)
                  const deal = deals.find((d) => d.id === a.dealId)
                  const co = companyById(a.companyId)
                  return (
                    <div key={a.id} className="flex items-start gap-3 px-5 py-3">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ICON_COLORS[a.type]}`}>
                        <Icon size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-700">{a.subject}</p>
                        {a.notes && <p className="text-xs text-slate-500 mt-0.5">{a.notes}</p>}
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                          <UserAvatar userId={a.userId} size={16} />
                          <span>{formatDateTime(a.activityDate)}</span>
                          {lead && (
                            <>
                              ·{' '}
                              <Link to={`/leads/${lead.id}`} className="text-brand-600 hover:underline">
                                {lead.firstName} {lead.lastName}
                              </Link>
                            </>
                          )}
                          {deal && (
                            <>
                              ·{' '}
                              <Link to={`/deals/${deal.id}`} className="text-brand-600 hover:underline">
                                {deal.name}
                              </Link>
                            </>
                          )}
                          {co && !deal && !lead && (
                            <>
                              ·{' '}
                              <Link to={`/companies/${co.id}`} className="text-brand-600 hover:underline">
                                {co.name}
                              </Link>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center text-slate-400 text-sm py-10">No activities match your filters.</p>}
      </div>
    </div>
  )
}
