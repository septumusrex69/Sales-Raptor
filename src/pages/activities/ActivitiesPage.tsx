import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Phone, Mail, MessageCircle, Calendar, StickyNote, FileText, CheckSquare, ArrowRightLeft, Trophy, XOctagon } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { companyById, formatDateTime, leadById, users } from '../../data/mockData'
import type { ActivityType } from '../../types'

const ACTIVITY_TYPES: ActivityType[] = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Note', 'Proposal', 'Task', 'Status change', 'Deal update', 'Deal Stage Change', 'Deal Won', 'Deal Lost']

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
}

const ICON_COLORS: Record<ActivityType, string> = {
  Call: 'bg-blue-50 text-blue-600',
  Email: 'bg-purple-50 text-purple-600',
  WhatsApp: 'bg-emerald-50 text-emerald-600',
  Meeting: 'bg-amber-50 text-amber-600',
  Note: 'bg-slate-100 text-slate-500',
  Proposal: 'bg-indigo-50 text-indigo-600',
  Task: 'bg-cyan-50 text-cyan-600',
  'Status change': 'bg-slate-100 text-slate-500',
  'Deal update': 'bg-slate-100 text-slate-500',
  'Deal Stage Change': 'bg-orange-50 text-orange-600',
  'Deal Won': 'bg-emerald-50 text-emerald-600',
  'Deal Lost': 'bg-red-50 text-red-600',
}

const reps = users.filter((u) => u.role.includes('Sales') || u.role === 'Administrator')

export function ActivitiesPage() {
  const { activities, deals, companies } = useAppStore()
  const [user, setUser] = useState('All')
  const [type, setType] = useState('All')
  const [company, setCompany] = useState('All')

  const filtered = useMemo(() => {
    return activities.filter((a) => {
      if (user !== 'All' && a.userId !== user) return false
      if (type !== 'All' && a.type !== type) return false
      if (company !== 'All' && a.companyId !== company) return false
      return true
    })
  }, [activities, user, type, company])

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
