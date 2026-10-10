import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Phone, Mail, MessageCircle, MessageSquare, Calendar, StickyNote, FileText, CheckSquare, ArrowRightLeft, Trophy, XOctagon, Inbox } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { ClientPicker } from '../../components/ui/ClientPicker'
import { Card } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { formatDateTime } from '../../data/mockData'
import { ACTIVITY_TYPE_TAILWIND } from '../../lib/colors'
import { readParam } from '../../lib/drilldown'
import { decodeSalesMonthParam, isWithinPeriod } from '../../lib/salesMonth'
import type { ActivityType } from '../../types'
import { isAssignableOwner } from '../../lib/permissions'

const ACTIVITY_TYPES: ActivityType[] = [
  'Call',
  'Email',
  'WhatsApp',
  'SMS',
  'Meeting',
  'Note',
  'Proposal',
  'Task',
  'Status change',
  'Deal update',
  'Deal Stage Change',
  'Deal Won',
  'Deal Rejected',
  'Courtesy Call',
  'Handover Received',
]

const ICONS: Record<ActivityType, typeof Phone> = {
  Call: Phone,
  Email: Mail,
  WhatsApp: MessageCircle,
  SMS: MessageSquare,
  Meeting: Calendar,
  Note: StickyNote,
  Proposal: FileText,
  Task: CheckSquare,
  'Status change': ArrowRightLeft,
  'Deal update': ArrowRightLeft,
  'Deal Stage Change': ArrowRightLeft,
  'Deal Won': Trophy,
  'Deal Rejected': XOctagon,
  'Courtesy Call': Phone,
  'Handover Received': Inbox,
}

const ICON_COLORS = ACTIVITY_TYPE_TAILWIND

export function ActivitiesPage() {
  const { activities, deals, companies, users, companyById, leadById } = useAppStore()
  const reps = useMemo(() => users.filter((u) => isAssignableOwner(u.role)), [users])
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
        {/* Searchable: the same picker as the book's filter and the handover import, so there is
            one way of finding a client in this app. 'All' rather than '' because this screen's
            filter has always used the word. */}
        <div className="w-56">
          <ClientPicker
            clients={companies}
            value={company === 'All' ? '' : company}
            onChange={(id) => setCompany(id || 'All')}
            clearLabel="All companies" />
        </div>
        <span className="text-xs text-slate-400 ml-auto">{filtered.length} activities</span>
      </div>

      <div className="space-y-4">
        {Object.entries(grouped).map(([day, items]) => (
          <div key={day}>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">{day}</p>
            <Card padded={false}>
              {/* A ROW AN ACTIVITY, in the checking list's shape, which the firm asked for on every
                  list in the app. The notes used to be a second line and who/when/regarding a
                  third; the notes now ride after the subject (whole in the tooltip) and the rest
                  are columns, so a day of thirty calls is thirty lines. */}
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px] whitespace-nowrap">
                  <tbody>
                    {items.map((a) => {
                      const Icon = ICONS[a.type]
                      const lead = leadById(a.leadId)
                      const deal = deals.find((d) => d.id === a.dealId)
                      const co = companyById(a.companyId)
                      return (
                        <tr key={a.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                          <td className="pl-3 pr-1 py-1.5 w-7">
                            <span className={`w-5 h-5 rounded-md flex items-center justify-center ${ICON_COLORS[a.type]}`} title={a.type}>
                              <Icon size={12} />
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="block max-w-[32rem] truncate" title={a.notes ? `${a.subject} · ${a.notes}` : a.subject}>
                              <span className="font-medium text-slate-700">{a.subject}</span>
                              {a.notes && <span className="text-slate-500"> · {a.notes}</span>}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="block max-w-[16rem] truncate">
                              {lead && (
                                <Link to={`/leads/${lead.id}`} className="text-brand-600 hover:underline">
                                  {lead.firstName} {lead.lastName}
                                </Link>
                              )}
                              {lead && deal && <span className="text-slate-400"> · </span>}
                              {deal && (
                                <Link to={`/deals/${deal.id}`} className="text-brand-600 hover:underline">
                                  {deal.name}
                                </Link>
                              )}
                              {co && !deal && !lead && (
                                <Link to={`/companies/${co.id}`} className="text-brand-600 hover:underline">
                                  {co.name}
                                </Link>
                              )}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 w-6"><UserAvatar userId={a.userId} size={16} /></td>
                          <td className="pl-2 pr-3 py-1.5 text-right text-slate-400 tabular-nums">{formatDateTime(a.activityDate)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center text-slate-400 text-sm py-10">No activities match your filters.</p>}
      </div>
    </div>
  )
}
