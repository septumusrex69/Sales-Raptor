import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAppStore } from '../../store/AppStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { formatCurrency, users } from '../../data/mockData'
import { DEAL_STAGES } from '../../types'

const TABS = ['Overview', 'Leads', 'Pipeline', 'Salespeople', 'Sources', 'Lost Deals'] as const
type Tab = (typeof TABS)[number]
const reps = users.filter((u) => u.role.includes('Sales') || u.role === 'Administrator')
const BAR_COLOR = '#2b4055'

export function ReportsPage() {
  const { leads, deals, activities, tasks } = useAppStore()
  const [tab, setTab] = useState<Tab>('Overview')

  const stats = useMemo(() => {
    const won = deals.filter((d) => d.stage === 'Won')
    const lost = deals.filter((d) => d.stage === 'Lost')
    const open = deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost')
    const qualified = leads.filter((l) => l.status === 'Qualified' || l.status === 'Converted')
    const unqualified = leads.filter((l) => l.status === 'Unqualified')
    return {
      totalLeads: leads.length,
      qualified: qualified.length,
      unqualified: unqualified.length,
      conversionRate: leads.length ? Math.round((won.length / leads.length) * 100) : 0,
      pipelineValue: open.reduce((s, d) => s + d.value, 0),
      revenueWon: won.reduce((s, d) => s + d.value, 0),
      avgDealValue: deals.length ? Math.round(deals.reduce((s, d) => s + d.value, 0) / deals.length) : 0,
      weightedPipeline: open.reduce((s, d) => s + (d.value * d.probability) / 100, 0),
      winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0,
    }
  }, [leads, deals])

  const leadsBySource = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of leads) map.set(l.source, (map.get(l.source) ?? 0) + 1)
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [leads])

  const leadsByRep = useMemo(() => {
    return reps.map((r) => ({ name: r.name.split(' ')[0], value: leads.filter((l) => l.ownerId === r.id).length }))
  }, [leads])

  const dealsByStage = useMemo(() => DEAL_STAGES.map((stage) => ({ name: stage, value: deals.filter((d) => d.stage === stage).length })), [deals])

  const lostByReason = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of deals.filter((d) => d.stage === 'Lost')) {
      const reason = d.lossReason ?? 'Other'
      map.set(reason, (map.get(reason) ?? 0) + 1)
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [deals])

  const salespeople = useMemo(
    () =>
      reps.map((r) => {
        const repLeads = leads.filter((l) => l.ownerId === r.id)
        const repDeals = deals.filter((d) => d.ownerId === r.id)
        const won = repDeals.filter((d) => d.stage === 'Won')
        const lost = repDeals.filter((d) => d.stage === 'Lost')
        const calls = activities.filter((a) => a.userId === r.id && a.type === 'Call').length
        const meetings = activities.filter((a) => a.userId === r.id && a.type === 'Meeting').length
        const proposals = activities.filter((a) => a.userId === r.id && a.type === 'Proposal').length
        return {
          rep: r,
          leadsAssigned: repLeads.length,
          calls,
          meetings,
          proposals,
          dealsWon: won.length,
          revenueWon: won.reduce((s, d) => s + d.value, 0),
          conversionRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0,
          openTasks: tasks.filter((t) => t.ownerId === r.id && t.status !== 'Completed' && t.status !== 'Cancelled').length,
        }
      }),
    [leads, deals, activities, tasks],
  )

  const sourcePerformance = useMemo(
    () =>
      leadsBySource.map((s) => {
        const sourceLeads = leads.filter((l) => l.source === s.name)
        const qualifiedLeads = sourceLeads.filter((l) => l.status === 'Qualified' || l.status === 'Converted')
        const sourceDeals = deals.filter((d) => d.source === s.name)
        const won = sourceDeals.filter((d) => d.stage === 'Won')
        return {
          source: s.name,
          leads: sourceLeads.length,
          qualified: qualifiedLeads.length,
          deals: sourceDeals.length,
          revenue: won.reduce((sum, d) => sum + d.value, 0),
          conversionRate: sourceLeads.length ? Math.round((qualifiedLeads.length / sourceLeads.length) * 100) : 0,
        }
      }),
    [leadsBySource, leads, deals],
  )

  const forecast = useMemo(
    () =>
      deals
        .filter((d) => d.stage !== 'Won' && d.stage !== 'Lost')
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map((d) => ({ ...d, weighted: Math.round((d.value * d.probability) / 100) })),
    [deals],
  )

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Pipeline Value" value={formatCurrency(stats.pipelineValue)} />
            <Stat label="Weighted Pipeline" value={formatCurrency(Math.round(stats.weightedPipeline))} />
            <Stat label="Revenue Won" value={formatCurrency(stats.revenueWon)} tone="text-[#957323]" />
            <Stat label="Win Rate" value={`${stats.winRate}%`} />
            <Stat label="Total Leads" value={String(stats.totalLeads)} />
            <Stat label="Qualified Leads" value={String(stats.qualified)} />
            <Stat label="Avg Deal Value" value={formatCurrency(stats.avgDealValue)} />
            <Stat label="Lead → Won Conversion" value={`${stats.conversionRate}%`} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader title="Deals by Stage" />
              <ChartBar data={dealsByStage} />
            </Card>
            <Card>
              <CardHeader title="Leads by Source" />
              <ChartBar data={leadsBySource} />
            </Card>
          </div>
        </div>
      )}

      {tab === 'Leads' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Leads Created" value={String(stats.totalLeads)} />
            <Stat label="Qualified" value={String(stats.qualified)} tone="text-[#406d58]" />
            <Stat label="Unqualified" value={String(stats.unqualified)} tone="text-[#794234]" />
            <Stat label="Conversion Rate" value={`${stats.conversionRate}%`} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader title="Leads by Source" />
              <ChartBar data={leadsBySource} />
            </Card>
            <Card>
              <CardHeader title="Leads by Salesperson" />
              <ChartBar data={leadsByRep} />
            </Card>
          </div>
        </div>
      )}

      {tab === 'Pipeline' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Pipeline Value" value={formatCurrency(stats.pipelineValue)} />
            <Stat label="Weighted Pipeline" value={formatCurrency(Math.round(stats.weightedPipeline))} />
            <Stat label="Average Deal Value" value={formatCurrency(stats.avgDealValue)} />
            <Stat label="Expected Revenue (Top 10)" value={formatCurrency(forecast.reduce((s, d) => s + d.weighted, 0))} />
          </div>
          <Card>
            <CardHeader title="Deals by Stage" />
            <ChartBar data={dealsByStage} />
          </Card>
          <Card padded={false}>
            <div className="p-5 pb-0">
              <CardHeader title="Sales Forecast" subtitle="Weighted value = deal value × probability" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
                    <th className="font-medium px-5 py-2.5">Deal</th>
                    <th className="font-medium px-3 py-2.5 text-right">Value</th>
                    <th className="font-medium px-3 py-2.5 text-right">Probability</th>
                    <th className="font-medium px-3 py-2.5 text-right">Weighted Value</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((d) => (
                    <tr key={d.id} className="border-t border-slate-50">
                      <td className="px-5 py-2.5 font-medium text-slate-700">{d.name}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">{formatCurrency(d.value)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">{d.probability}%</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{formatCurrency(d.weighted)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'Salespeople' && (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="font-medium px-5 py-3">Salesperson</th>
                  <th className="font-medium px-3 py-3 text-center">Leads Assigned</th>
                  <th className="font-medium px-3 py-3 text-center">Calls Made</th>
                  <th className="font-medium px-3 py-3 text-center">Meetings</th>
                  <th className="font-medium px-3 py-3 text-center">Proposals Sent</th>
                  <th className="font-medium px-3 py-3 text-center">Deals Won</th>
                  <th className="font-medium px-3 py-3 text-right">Revenue Won</th>
                  <th className="font-medium px-3 py-3 text-center">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {salespeople
                  .sort((a, b) => b.revenueWon - a.revenueWon)
                  .map((s) => (
                    <tr key={s.rep.id} className="border-t border-slate-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar userId={s.rep.id} size={26} />
                          <span className="font-medium text-slate-700">{s.rep.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.leadsAssigned}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.calls}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.meetings}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.proposals}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.dealsWon}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-700">{formatCurrency(s.revenueWon)}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.conversionRate}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'Sources' && (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="font-medium px-5 py-3">Source</th>
                  <th className="font-medium px-3 py-3 text-center">Leads</th>
                  <th className="font-medium px-3 py-3 text-center">Qualified Leads</th>
                  <th className="font-medium px-3 py-3 text-center">Deals</th>
                  <th className="font-medium px-3 py-3 text-right">Revenue</th>
                  <th className="font-medium px-3 py-3 text-center">Conversion Rate</th>
                </tr>
              </thead>
              <tbody>
                {sourcePerformance
                  .sort((a, b) => b.revenue - a.revenue)
                  .map((s) => (
                    <tr key={s.source} className="border-t border-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-700">{s.source}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.leads}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.qualified}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.deals}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-700">{formatCurrency(s.revenue)}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.conversionRate}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'Lost Deals' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader title="Lost Deals by Reason" />
              {lostByReason.length === 0 ? (
                <p className="text-sm text-slate-400">No lost deals recorded.</p>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={lostByReason} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2} isAnimationActive={false}>
                        {lostByReason.map((_, i) => (
                          <Cell key={i} fill={['#794234', '#b28e34', '#5f86ab', '#406d58', '#ad6452', '#3f5d78', '#957323', '#94a3b8', '#799ab9', '#a1b8ce'][i % 10]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <CardHeader title="Breakdown" />
              <div className="space-y-2">
                {lostByReason.map((r) => (
                  <div key={r.name} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{r.name}</span>
                    <span className="font-semibold text-slate-700">{r.value}</span>
                  </div>
                ))}
                {lostByReason.length === 0 && <p className="text-sm text-slate-400">No lost deals recorded.</p>}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-xl font-bold mt-1 ${tone ?? 'text-slate-800'}`}>{value}</p>
    </Card>
  )
}

function ChartBar({ data }: { data: { name: string; value: number }[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} interval={0} angle={-20} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
          <Tooltip cursor={{ fill: '#f8fafc' }} />
          <Bar dataKey="value" fill={BAR_COLOR} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
