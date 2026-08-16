import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LayoutGrid, List, Plus, Search } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card } from '../../components/ui/Card'
import { StageBadge } from '../../components/ui/Badge'
import { UserAvatar } from '../../components/ui/Avatar'
import { DealForm } from '../../components/layout/QuickAdd'
import { MarkLostModal, MarkWonModal } from './DealStageModals'
import { companyById, contactById, formatCurrency, formatDate, userById, users } from '../../data/mockData'
import { DEAL_STAGES } from '../../types'
import type { Deal, DealStage, LossReason } from '../../types'
import type { WonDealDetails } from '../../store/AppStore'

const OPEN_STAGES = DEAL_STAGES.filter((s) => s !== 'Won' && s !== 'Lost')
const STAGE_COLORS: Record<DealStage, string> = {
  'New Lead': '#3b5bdb',
  Contacted: '#0e9aa7',
  Qualified: '#2f9e6e',
  'Proposal Sent': '#c9a227',
  Negotiation: '#e0673f',
  Won: '#22c55e',
  Lost: '#ef4444',
}
const reps = users.filter((u) => u.role.includes('Sales') || u.role === 'Administrator')

export function DealsBoard() {
  const store = useAppStore()
  const { deals, moveDealStage, markDealWon, markDealLost } = store
  const navigate = useNavigate()
  const [view, setView] = useState<'kanban' | 'table'>('kanban')
  const [search, setSearch] = useState('')
  const [owner, setOwner] = useState('All')
  const [addOpen, setAddOpen] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [wonModalFor, setWonModalFor] = useState<Deal | null>(null)
  const [lostModalFor, setLostModalFor] = useState<Deal | null>(null)

  const filtered = useMemo(() => {
    return deals.filter((d) => {
      if (owner !== 'All' && d.ownerId !== owner) return false
      if (search) {
        const q = search.toLowerCase()
        const company = companyById(d.companyId)?.name.toLowerCase() ?? ''
        if (!d.name.toLowerCase().includes(q) && !company.includes(q)) return false
      }
      return true
    })
  }, [deals, owner, search])

  const columns = [...OPEN_STAGES, 'Won', 'Lost'] as DealStage[]

  const totals = useMemo(() => {
    const open = deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost')
    const won = deals.filter((d) => d.stage === 'Won')
    return { pipeline: open.reduce((s, d) => s + d.value, 0), won: won.reduce((s, d) => s + d.value, 0), count: deals.length }
  }, [deals])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-xs text-slate-400">Total Deals</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{totals.count}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-400">Pipeline Value</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{formatCurrency(totals.pipeline)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-400">Revenue Won</p>
          <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(totals.won)}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 w-64">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deals..." className="text-sm outline-none flex-1 min-w-0" />
        </div>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-600 outline-none">
          <option value="All">All Owners</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <div className="flex items-center bg-slate-100 rounded-lg p-1">
          <button onClick={() => setView('kanban')} className={`p-1.5 rounded-md ${view === 'kanban' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400'}`}>
            <LayoutGrid size={15} />
          </button>
          <button onClick={() => setView('table')} className={`p-1.5 rounded-md ${view === 'table' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400'}`}>
            <List size={15} />
          </button>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700"
        >
          <Plus size={15} /> Add Deal
        </button>
      </div>

      {view === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-3">
          {columns.map((stage) => {
            const stageDeals = filtered.filter((d) => d.stage === stage)
            const stageValue = stageDeals.reduce((s, d) => s + d.value, 0)
            return (
              <div
                key={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  const deal = deals.find((d) => d.id === dragging)
                  if (deal) {
                    if (stage === 'Won') setWonModalFor(deal)
                    else if (stage === 'Lost') setLostModalFor(deal)
                    else moveDealStage(deal.id, stage)
                  }
                  setDragging(null)
                }}
                className="w-72 shrink-0 bg-slate-50 rounded-xl flex flex-col max-h-[calc(100vh-320px)]"
              >
                <div className="px-3.5 py-3 flex items-center justify-between sticky top-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STAGE_COLORS[stage] }} />
                    <span className="text-sm font-semibold text-slate-700">{stage}</span>
                    <span className="text-xs text-slate-400">({stageDeals.length})</span>
                  </div>
                </div>
                <p className="px-3.5 text-xs text-slate-400 -mt-2 mb-2">{formatCurrency(stageValue)}</p>
                <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2.5">
                  {stageDeals.map((deal) => (
                    <DealCard key={deal.id} deal={deal} onDragStart={() => setDragging(deal.id)} onOpen={() => navigate(`/deals/${deal.id}`)} />
                  ))}
                  {stageDeals.length === 0 && <div className="text-xs text-slate-300 text-center py-6 border border-dashed border-slate-200 rounded-lg">Drop deals here</div>}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="font-medium px-5 py-3">Deal</th>
                  <th className="font-medium px-3 py-3">Company</th>
                  <th className="font-medium px-3 py-3 text-right">Value</th>
                  <th className="font-medium px-3 py-3">Stage</th>
                  <th className="font-medium px-3 py-3">Probability</th>
                  <th className="font-medium px-3 py-3">Owner</th>
                  <th className="font-medium px-3 py-3">Expected Close</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((deal) => (
                  <tr key={deal.id} onClick={() => navigate(`/deals/${deal.id}`)} className="border-t border-slate-50 hover:bg-slate-50/60 cursor-pointer">
                    <td className="px-5 py-3">
                      <Link to={`/deals/${deal.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-700 hover:text-brand-600">
                        {deal.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-slate-500">{companyById(deal.companyId)?.name}</td>
                    <td className="px-3 py-3 text-right font-medium text-slate-700">{formatCurrency(deal.value)}</td>
                    <td className="px-3 py-3">
                      <StageBadge stage={deal.stage} />
                    </td>
                    <td className="px-3 py-3 text-slate-500">{deal.probability}%</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <UserAvatar userId={deal.ownerId} size={22} />
                        <span className="text-slate-500 text-xs">{userById(deal.ownerId)?.name.split(' ')[0]}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-500">{formatDate(deal.expectedCloseDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {addOpen && <DealForm onClose={() => setAddOpen(false)} store={store} navigate={navigate} />}
      {wonModalFor && (
        <MarkWonModal
          defaultValue={wonModalFor.value}
          defaultService={wonModalFor.service}
          onClose={() => setWonModalFor(null)}
          onSave={(details: WonDealDetails) => markDealWon(wonModalFor.id, details)}
        />
      )}
      {lostModalFor && <MarkLostModal onClose={() => setLostModalFor(null)} onSave={(reason: LossReason) => markDealLost(lostModalFor.id, reason)} />}
    </div>
  )
}

function DealCard({ deal, onDragStart, onOpen }: { deal: Deal; onDragStart: () => void; onOpen: () => void }) {
  const company = companyById(deal.companyId)
  const contact = contactById(deal.contactId)
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className="bg-white rounded-lg border border-slate-200 p-3 cursor-pointer hover:shadow-md hover:border-slate-300 transition-shadow"
    >
      <p className="text-sm font-semibold text-slate-800 truncate">{company?.name ?? deal.name}</p>
      {contact && <p className="text-xs text-slate-400 truncate">{contact.firstName} {contact.lastName}</p>}
      <p className="text-base font-bold text-slate-800 mt-1.5">{formatCurrency(deal.value)}</p>
      <div className="flex items-center justify-between mt-2.5">
        <UserAvatar userId={deal.ownerId} size={22} />
        <span className="text-xs font-medium text-slate-500">{deal.probability}%</span>
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-50 text-[11px] text-slate-400">
        <span>Close</span>
        <span>{formatDate(deal.expectedCloseDate)}</span>
      </div>
    </div>
  )
}
