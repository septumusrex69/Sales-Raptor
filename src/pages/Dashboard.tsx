import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { ArrowUpRight, ArrowDownRight, CheckCircle2, Circle } from 'lucide-react'
import { useAppStore } from '../store/AppStore'
import { Card, CardHeader } from '../components/ui/Card'
import { StageBadge, PriorityBadge } from '../components/ui/Badge'
import { UserAvatar } from '../components/ui/Avatar'
import { companyById, formatCurrency, formatDate, timeAgo, TODAY } from '../data/mockData'
import type { DealStage } from '../types'

const FUNNEL_STAGES: DealStage[] = ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Negotiation', 'Won']
const FUNNEL_COLORS = ['#6086a9', '#416281', '#406d58', '#b28e34', '#2b4055', '#957323']

const SOURCE_COLORS: Record<string, string> = {
  Website: '#5f86ab',
  Referral: '#406d58',
  'Google Ads': '#b28e34',
  LinkedIn: '#a1b8ce',
  Facebook: '#957323',
  Direct: '#799ab9',
  Email: '#ad6452',
  'Existing Client': '#794234',
  'Sales Rep': '#4d7193',
  Event: '#30465a',
  Other: '#94a3b8',
}

function daysAgoLabel(dateIso: string) {
  const diff = Math.round((new Date(dateIso).getTime() - TODAY.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Today'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  if (diff === 1) return 'Tomorrow'
  return `In ${diff}d`
}

export function Dashboard() {
  const { leads, deals, tasks, activities, updateTask } = useAppStore()
  const [period, setPeriod] = useState<'This Month' | 'Last Month' | 'This Quarter'>('This Month')

  const kpis = useMemo(() => {
    const openDeals = deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost')
    const wonDeals = deals.filter((d) => d.stage === 'Won')
    const lostDeals = deals.filter((d) => d.stage === 'Lost')
    const revenueWon = wonDeals.reduce((sum, d) => sum + d.value, 0)
    const pipelineValue = openDeals.reduce((sum, d) => sum + d.value, 0)
    const conversionRate = wonDeals.length + lostDeals.length > 0 ? Math.round((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100) : 0
    return {
      totalLeads: leads.length,
      newLeads: leads.filter((l) => l.status === 'New').length,
      openDeals: openDeals.length,
      wonDeals: wonDeals.length,
      lostDeals: lostDeals.length,
      revenueWon,
      pipelineValue,
      conversionRate,
    }
  }, [leads, deals])

  const funnelCounts = useMemo(() => {
    const counts = FUNNEL_STAGES.map((stage) => deals.filter((d) => d.stage === stage).length)
    const total = deals.length || 1
    const max = Math.max(...counts, 1)
    return FUNNEL_STAGES.map((stage, i) => ({
      stage,
      count: counts[i],
      pct: Math.round((counts[i] / max) * 100),
      shareOfTotal: Math.round((counts[i] / total) * 100),
    }))
  }, [deals])

  const leadsBySource = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of leads) map.set(l.source, (map.get(l.source) ?? 0) + 1)
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [leads])

  const recentActivities = activities.slice(0, 6)

  const topDeals = useMemo(
    () =>
      [...deals]
        .filter((d) => d.stage !== 'Lost')
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
    [deals],
  )

  const tasksDue = useMemo(
    () =>
      tasks
        .filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled')
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
        .slice(0, 6),
    [tasks],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Welcome back, Stephan Ferreira</h2>
          <p className="text-sm text-slate-400 mt-0.5">Here's what's happening with your sales today.</p>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as typeof period)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-600 outline-none"
        >
          <option>This Month</option>
          <option>Last Month</option>
          <option>This Quarter</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Leads" value={kpis.totalLeads.toString()} delta={18} />
        <KpiCard label="Open Deals" value={kpis.openDeals.toString()} delta={12} />
        <KpiCard label="Won Deals" value={kpis.wonDeals.toString()} delta={25} />
        <KpiCard label="Revenue Won" value={formatCurrency(kpis.revenueWon)} delta={30} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="New Leads" value={kpis.newLeads.toString()} delta={9} small />
        <KpiCard label="Lost Deals" value={kpis.lostDeals.toString()} delta={-4} small />
        <KpiCard label="Pipeline Value" value={formatCurrency(kpis.pipelineValue)} delta={14} small />
        <KpiCard label="Conversion Rate" value={`${kpis.conversionRate}%`} delta={5} small />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Sales Pipeline" subtitle="Deals currently at each stage" />
          <div className="space-y-2">
            {funnelCounts.map((f, i) => (
              <div key={f.stage} className="flex items-center gap-3">
                <span className="w-28 text-xs font-medium text-slate-500 shrink-0">{f.stage}</span>
                <div className="flex-1 bg-slate-50 rounded-md h-8 relative overflow-hidden">
                  <div
                    className="h-full rounded-md flex items-center justify-end px-2.5 transition-all"
                    style={{ width: `${Math.max(f.pct, 8)}%`, backgroundColor: FUNNEL_COLORS[i] }}
                  >
                    <span className="text-white text-xs font-semibold">{f.count}</span>
                  </div>
                </div>
                <span className="w-10 text-xs text-slate-400 text-right shrink-0">{f.shareOfTotal}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Leads by Source" />
          <div className="h-44 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={leadsBySource} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} paddingAngle={2} isAnimationActive={false}>
                  {leadsBySource.map((entry) => (
                    <Cell key={entry.name} fill={SOURCE_COLORS[entry.name] ?? '#94a3b8'} stroke="none" />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} leads`, name]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xl font-bold text-slate-800">{leads.length}</span>
              <span className="text-[11px] text-slate-400">Total</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2">
            {leadsBySource.slice(0, 6).map((s) => (
              <div key={s.name} className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SOURCE_COLORS[s.name] ?? '#94a3b8' }} />
                <span className="truncate">{s.name}</span>
                <span className="ml-auto text-slate-400 shrink-0">{Math.round((s.value / leads.length) * 100)}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2" padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Top Deals" action={<Link to="/deals" className="text-xs font-medium text-brand-600 hover:underline">View all deals</Link>} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
                  <th className="font-medium px-5 py-2.5">Deal</th>
                  <th className="font-medium px-3 py-2.5">Company</th>
                  <th className="font-medium px-3 py-2.5 text-right">Value</th>
                  <th className="font-medium px-3 py-2.5">Stage</th>
                  <th className="font-medium px-3 py-2.5">Close Date</th>
                </tr>
              </thead>
              <tbody>
                {topDeals.map((d) => (
                  <tr key={d.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-2.5">
                      <Link to={`/deals/${d.id}`} className="font-medium text-slate-700 hover:text-brand-600">
                        {d.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">{companyById(d.companyId)?.name}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-700">{formatCurrency(d.value)}</td>
                    <td className="px-3 py-2.5">
                      <StageBadge stage={d.stage} />
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">{formatDate(d.expectedCloseDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Recent Activities" action={<Link to="/activities" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>} />
          </div>
          <div className="px-5 pb-5 space-y-3.5 max-h-80 overflow-y-auto">
            {recentActivities.map((a) => (
              <div key={a.id} className="flex gap-3">
                <UserAvatar userId={a.userId} size={26} />
                <div className="min-w-0">
                  <p className="text-[13px] text-slate-700 leading-snug">{a.subject}</p>
                  <p className="text-[11px] text-slate-400">{timeAgo(a.activityDate)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-5 pb-0">
          <CardHeader title="Tasks Due" subtitle="Overdue, due today, and this week" action={<Link to="/tasks" className="text-xs font-medium text-brand-600 hover:underline">View all tasks</Link>} />
        </div>
        <div className="px-5 pb-5 divide-y divide-slate-50">
          {tasksDue.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <button onClick={() => updateTask(t.id, { status: 'Completed', completedAt: new Date().toISOString() })} className="text-slate-300 hover:text-[#406d58] shrink-0">
                <Circle size={18} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-slate-700 truncate">{t.title}</p>
                <p className="text-[11px] text-slate-400">{t.relatedToLabel ?? t.type}</p>
              </div>
              <PriorityBadge priority={t.priority} />
              <span className={`text-xs font-medium w-20 text-right shrink-0 ${new Date(t.dueDate) < TODAY ? 'text-[#794234]' : 'text-slate-500'}`}>
                {daysAgoLabel(t.dueDate)}
              </span>
              <UserAvatar userId={t.ownerId} size={24} />
            </div>
          ))}
          {tasksDue.length === 0 && (
            <div className="py-6 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
              <CheckCircle2 size={22} className="text-[#406d58]" />
              All caught up — no tasks due.
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

function KpiCard({ label, value, delta, small }: { label: string; value: string; delta: number; small?: boolean }) {
  const positive = delta >= 0
  return (
    <Card className={small ? 'p-4' : undefined}>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className={`font-bold text-slate-800 mt-1 ${small ? 'text-xl' : 'text-2xl'}`}>{value}</p>
      <p className={`flex items-center gap-1 text-xs font-medium mt-1.5 ${positive ? 'text-[#406d58]' : 'text-[#794234]'}`}>
        {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
        {Math.abs(delta)}% <span className="text-slate-400 font-normal">vs last month</span>
      </p>
    </Card>
  )
}
