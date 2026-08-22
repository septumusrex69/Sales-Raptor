import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { LayoutGrid, List, Plus, Search } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { canEditOwned } from '../../lib/permissions'
import { Card } from '../../components/ui/Card'
import { StageBadge } from '../../components/ui/Badge'
import { UserAvatar } from '../../components/ui/Avatar'
import { DealForm } from '../../components/layout/QuickAdd'
import { MarkLostModal, MarkWonModal } from './DealStageModals'
import { formatCurrency, formatDate, TODAY } from '../../data/mockData'
import { FUNNEL_STAGES, STAGE_COLORS } from '../../lib/colors'
import { readParam } from '../../lib/drilldown'
import { decodeSalesMonthParam, isWithinPeriod } from '../../lib/salesMonth'
import { DEAL_STAGES } from '../../types'
import type { Deal, DealStage, LossReason } from '../../types'
import type { WonDealDetails } from '../../store/AppStore'

const OPEN_STAGES = DEAL_STAGES.filter((s) => s !== 'Won' && s !== 'Lost')

export function DealsBoard() {
  const store = useAppStore()
  const { deals, users, companyById, userById, moveDealStage, markDealWon, markDealLost } = store
  const { currentUser } = useAuth()
  const reps = useMemo(() => users.filter((u) => u.role.includes('Sales') || u.role === 'Administrator'), [users])
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // One-time drill-down filters carried in from Dashboard links — not exposed as UI controls.
  const [stageFilter] = useState(() => readParam(searchParams, 'stage'))
  // "atLeast" matches the Sales Funnel's "at this stage or further" framing (deals pile up
  // further down the pipeline in a snapshot, so an exact-stage match would undercount).
  const [stageAtLeast] = useState(() => readParam(searchParams, 'atLeast') === '1')
  const [noNextActionFilter] = useState(() => readParam(searchParams, 'noNextAction') === '1')
  const [overdueFilter] = useState(() => readParam(searchParams, 'overdue') === '1')
  const [salesMonthFilter] = useState(() => decodeSalesMonthParam(searchParams.get('salesMonth')))

  const [view, setView] = useState<'kanban' | 'table'>(() =>
    readParam(searchParams, 'view') === 'table' || stageFilter || noNextActionFilter || overdueFilter ? 'table' : 'kanban',
  )
  const [search, setSearch] = useState('')
  const [owner, setOwner] = useState(() => readParam(searchParams, 'owner') ?? 'All')
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

  // Further-restricted rows for Table view drill-down links — Kanban always shows the full board.
  const tableRows = useMemo(() => {
    if (view !== 'table') return filtered
    const stageFilterIndex = stageFilter ? FUNNEL_STAGES.indexOf(stageFilter as (typeof FUNNEL_STAGES)[number]) : -1
    return filtered.filter((d) => {
      if (stageFilter) {
        if (stageAtLeast && stageFilterIndex >= 0) {
          if (FUNNEL_STAGES.indexOf(d.stage as (typeof FUNNEL_STAGES)[number]) < stageFilterIndex) return false
        } else if (d.stage !== stageFilter) {
          return false
        }
      }
      if (noNextActionFilter && (d.stage === 'Won' || d.stage === 'Lost' || d.nextActionAt)) return false
      if (overdueFilter && (d.stage === 'Won' || d.stage === 'Lost' || new Date(d.expectedCloseDate) >= TODAY)) return false
      if (salesMonthFilter) {
        const dateField = d.stage === 'Won' ? d.wonAt : d.stage === 'Lost' ? d.lostAt : d.createdAt
        if (!isWithinPeriod(dateField, salesMonthFilter)) return false
      }
      return true
    })
  }, [filtered, view, stageFilter, stageAtLeast, noNextActionFilter, overdueFilter, salesMonthFilter])

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
          <p className="text-xl font-bold text-[#957323] mt-1">{formatCurrency(totals.won)}</p>
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
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      canDrag={canEditOwned(currentUser, deal.ownerId)}
                      onDragStart={() => setDragging(deal.id)}
                      onOpen={() => navigate(`/deals/${deal.id}`)}
                    />
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
                {tableRows.map((deal) => (
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
          defaultService={wonModalFor.service}
          onClose={() => setWonModalFor(null)}
          onSave={(details: WonDealDetails) => markDealWon(wonModalFor.id, details)}
        />
      )}
      {lostModalFor && <MarkLostModal onClose={() => setLostModalFor(null)} onSave={(reason: LossReason) => markDealLost(lostModalFor.id, reason)} />}
    </div>
  )
}

function DealCard({ deal, canDrag, onDragStart, onOpen }: { deal: Deal; canDrag: boolean; onDragStart: () => void; onOpen: () => void }) {
  const { companyById, contactById } = useAppStore()
  const company = companyById(deal.companyId)
  const contact = contactById(deal.contactId)
  return (
    <div
      draggable={canDrag}
      onDragStart={onDragStart}
      onClick={onOpen}
      title={canDrag ? undefined : "Only this deal's owner, a Sales Manager, or an Administrator can move its stage"}
      className={`bg-white rounded-lg border border-slate-200 p-3 hover:shadow-md hover:border-slate-300 transition-shadow ${canDrag ? 'cursor-pointer' : 'cursor-default'}`}
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
