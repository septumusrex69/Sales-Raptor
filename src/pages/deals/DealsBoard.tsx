import { Fragment, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { LayoutGrid, List, Plus, Search } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { canEditOwned, useDefaultOwnerFilter, isAssignableOwner} from '../../lib/permissions'
import { Card } from '../../components/ui/Card'
import { StageBadge } from '../../components/ui/Badge'
import { SortHeader } from '../../components/ui/SortHeader'
import { dealKind, dealStageLabel, stageColumnLabel } from '../../lib/dealKind'
import { DATE_GROUP_CLASS } from '../../components/ui/DateGroupHeading'
import { dateGroupLabel, relativeDayLabel } from '../../lib/dateLabels'
import { UserAvatar } from '../../components/ui/Avatar'
import { DealForm } from '../../components/layout/QuickAdd'
import { MarkRejectedModal, MarkWonModal } from './DealStageModals'
import { formatCurrency, formatDate, TODAY } from '../../data/mockData'
import { FUNNEL_STAGES, STAGE_COLORS } from '../../lib/colors'
import { readParam } from '../../lib/drilldown'
import { decodeSalesMonthParam, isWithinPeriod } from '../../lib/salesMonth'
import { DEAL_STAGES, OPEN_DEAL_STAGES } from '../../types'
import type { Deal, DealStage } from '../../types'
import type { WonDealDetails } from '../../store/AppStore'

const OPEN_STAGES = OPEN_DEAL_STAGES

type DealSortKey = 'name' | 'company' | 'value' | 'stage' | 'probability' | 'owner' | 'createdAt' | 'expectedCloseDate'

export function DealsBoard() {
  const store = useAppStore()
  const { deals, users, companyById, userById, moveDealStage, markDealWon, markDealRejected } = store
  const { currentUser } = useAuth()
  const reps = useMemo(() => users.filter((u) => isAssignableOwner(u.role)), [users])
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // One-time drill-down filters carried in from Dashboard links — not exposed as UI controls.
  const [stageFilter, setStageFilter] = useState(() => readParam(searchParams, 'stage'))
  // "atLeast" matches the Sales Funnel's "at this stage or further" framing (deals pile up
  // further down the pipeline in a snapshot, so an exact-stage match would undercount).
  const [stageAtLeast] = useState(() => readParam(searchParams, 'atLeast') === '1')
  const [noNextActionFilter] = useState(() => readParam(searchParams, 'noNextAction') === '1')
  const [overdueFilter] = useState(() => readParam(searchParams, 'overdue') === '1')
  const [salesMonthFilter] = useState(() => decodeSalesMonthParam(searchParams.get('salesMonth')))
  const [companyIdFilter] = useState(() => readParam(searchParams, 'company'))
  const [openOnlyFilter] = useState(() => readParam(searchParams, 'open') === '1')

  const [view, setView] = useState<'kanban' | 'table'>(() =>
    readParam(searchParams, 'view') === 'table' || stageFilter || noNextActionFilter || overdueFilter || companyIdFilter || openOnlyFilter
      ? 'table'
      : 'kanban',
  )
  const [search, setSearch] = useState('')
  const [owner, setOwner] = useDefaultOwnerFilter(readParam(searchParams, 'owner'), currentUser)
  const [addOpen, setAddOpen] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  // Newest first: the question the table gets asked most often is "what came in recently?"
  const [sortKey, setSortKey] = useState<DealSortKey>('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [wonModalFor, setWonModalFor] = useState<Deal | null>(null)
  const [rejectModalFor, setRejectModalFor] = useState<Deal | null>(null)

  const filtered = useMemo(() => {
    return deals.filter((d) => {
      if (owner !== 'All' && d.ownerId !== owner) return false
      if (search) {
        const q = search.toLowerCase()
        const company = companyById(d.companyId)?.name.toLowerCase() ?? ''
        const haystack = `${d.name} ${company} ${d.service ?? ''} ${d.notes ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
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
      if (noNextActionFilter && (d.stage === 'Won' || d.stage === 'Rejected' || d.nextActionAt)) return false
      if (overdueFilter && (d.stage === 'Won' || d.stage === 'Rejected' || new Date(d.expectedCloseDate) >= TODAY)) return false
      if (companyIdFilter && d.companyId !== companyIdFilter) return false
      if (openOnlyFilter && (d.stage === 'Won' || d.stage === 'Rejected')) return false
      if (salesMonthFilter) {
        const dateField = d.stage === 'Won' ? d.wonAt : d.stage === 'Rejected' ? d.rejectedAt : d.createdAt
        if (!isWithinPeriod(dateField, salesMonthFilter)) return false
      }
      return true
    })
  }, [filtered, view, stageFilter, stageAtLeast, noNextActionFilter, overdueFilter, salesMonthFilter, companyIdFilter, openOnlyFilter])

  // Annotated rather than asserted: `as DealStage[]` would let a retired stage name through,
  // and a column nothing matches is a column of deals nobody can see.
  const columns: DealStage[] = [...OPEN_STAGES, 'Won', 'Rejected']

  function sortValue(d: Deal, key: DealSortKey): string | number | undefined {
    switch (key) {
      case 'name':
        return d.name.toLowerCase()
      case 'company':
        return companyById(d.companyId)?.name.toLowerCase()
      case 'value':
        return d.value
      case 'stage':
        // Pipeline order, not alphabetical — sorted by name, Rejected would land before Won.
        return DEAL_STAGES.indexOf(d.stage)
      case 'probability':
        return d.probability
      case 'owner':
        return userById(d.ownerId)?.name.toLowerCase()
      case 'createdAt':
        return d.createdAt
      case 'expectedCloseDate':
        return d.expectedCloseDate
    }
  }

  const tableSorted = useMemo(() => {
    const arr = [...tableRows]
    arr.sort((a, b) => {
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      // Deals missing the sorted field sink to the bottom either way, so flipping the
      // direction never floats a row of blanks to the top.
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [tableRows, sortKey, sortDir])

  function toggleSort(key: DealSortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function header(key: DealSortKey, label: string, align: 'left' | 'right' | 'center' = 'left') {
    return <SortHeader label={label} align={align} active={sortKey === key} dir={sortDir} onSort={() => toggleSort(key)} />
  }

  const totals = useMemo(() => {
    const open = deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Rejected')
    const won = deals.filter((d) => d.stage === 'Won')
    return { pipeline: open.reduce((s, d) => s + d.value, 0), won: won.reduce((s, d) => s + d.value, 0), count: deals.length }
  }, [deals])

  return (
    <div className="space-y-4">
      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <span className="flex items-baseline gap-2">
            <span className="text-xs text-slate-400">Total Deals</span>
            <span className="text-lg font-bold text-slate-800 tabular-nums">{totals.count}</span>
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-xs text-slate-400">Pipeline Value</span>
            <span className="text-lg font-bold text-slate-800 tabular-nums">{formatCurrency(totals.pipeline)}</span>
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-xs text-slate-400">Revenue Won</span>
            <span className="text-lg font-bold text-[var(--c-gold-deep)] tabular-nums">{formatCurrency(totals.won)}</span>
          </span>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 w-64">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deals..." className="text-sm outline-none flex-1 min-w-0" />
        </div>
        {/* Working a stage is how the day is actually organised — every mandate that has gone
            out and is waiting, all in one list — so it needs a control, not only a drill-down
            link from somewhere else. */}
        <select
          value={stageFilter ?? ''}
          onChange={(e) => setStageFilter(e.target.value || undefined)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-600 outline-none"
        >
          <option value="">All Stages</option>
          {DEAL_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
        </select>
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
                    else if (stage === 'Rejected') setRejectModalFor(deal)
                    else moveDealStage(deal.id, stage)
                  }
                  setDragging(null)
                }}
                className="w-72 shrink-0 bg-slate-50 rounded-xl flex flex-col max-h-[calc(100vh-320px)]"
              >
                <div className="px-3.5 py-3 flex items-center justify-between sticky top-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STAGE_COLORS[stage] }} />
                    <span className="text-sm font-semibold text-slate-700">{stageColumnLabel(stage)}</span>
                    <span className="text-xs text-slate-400">({stageDeals.length})</span>
                  </div>
                </div>
                <p className="px-3.5 text-xs text-slate-400 -mt-2 mb-2">{formatCurrency(stageValue)}</p>
                <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
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
            <table className="w-full text-[12.5px] whitespace-nowrap">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-100">
                  <th className="font-medium px-3 py-1.5">{header('name', 'Deal')}</th>
                  <th className="font-medium px-2 py-1.5">{header('company', 'Company')}</th>
                  <th className="font-medium px-2 py-1.5 text-right">{header('value', 'Value', 'right')}</th>
                  <th className="font-medium px-2 py-1.5">{header('stage', 'Stage')}</th>
                  <th className="font-medium px-2 py-1.5">{header('probability', 'Probability')}</th>
                  <th className="font-medium px-2 py-1.5">{header('owner', 'Owner')}</th>
                  <th className="font-medium px-2 py-1.5">{header('expectedCloseDate', 'Expected Close')}</th>
                </tr>
              </thead>
              <tbody>
                {tableSorted.map((deal, i) => {
                  // Headings only make sense while the rows are in date order — under a sort by
                  // value they'd be dividing the list on something it isn't sorted by.
                  const group = sortKey === 'createdAt' ? dateGroupLabel(deal.createdAt) : null
                  const isFirstOfGroup = group !== null && (i === 0 || group !== dateGroupLabel(tableSorted[i - 1].createdAt))
                  return (
                  <Fragment key={deal.id}>
                  {isFirstOfGroup && (
                    <tr>
                      <td colSpan={7} className={DATE_GROUP_CLASS}>
                        {group}
                      </td>
                    </tr>
                  )}
                  <tr onClick={() => navigate(`/deals/${deal.id}`)} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer">
                    <td className="px-3 py-1.5">
                      {/* The note rides after the name, not under it — under it, every deal with a
                          note was a two-line row, and the firm asked for one line throughout. */}
                      <span className="block max-w-[24rem] truncate" title={deal.notes ? `${deal.name} · ${deal.notes}` : deal.name}>
                        <Link to={`/deals/${deal.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-700 hover:text-brand-600">
                          {deal.name}
                        </Link>
                        {deal.notes && <span className="text-slate-400"> · {deal.notes}</span>}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-slate-500"><span className="block max-w-[16rem] truncate" title={companyById(deal.companyId)?.name}>{companyById(deal.companyId)?.name}</span></td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap font-medium text-slate-700">{formatCurrency(deal.value)}</td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setStageFilter(deal.stage)
                        }}
                        title={`Show only ${deal.stage}`}
                        className="cursor-pointer"
                      >
                        <StageBadge stage={deal.stage} label={dealStageLabel(deal)} />
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-slate-500 tabular-nums">{deal.probability}%</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <UserAvatar userId={deal.ownerId} size={18} />
                        <span className="text-slate-500">{userById(deal.ownerId)?.name.split(' ')[0]}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{formatDate(deal.expectedCloseDate)}</td>
                  </tr>
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {addOpen && <DealForm onClose={() => setAddOpen(false)} store={store} navigate={navigate} />}
      {wonModalFor && (
        <MarkWonModal
          deal={wonModalFor}
          onClose={() => setWonModalFor(null)}
          onSave={(details: WonDealDetails) => markDealWon(wonModalFor.id, details)}
        />
      )}
      {rejectModalFor && <MarkRejectedModal onClose={() => setRejectModalFor(null)} onSave={(reason, note) => markDealRejected(rejectModalFor.id, reason, note)} />}
    </div>
  )
}

function DealCard({ deal, canDrag, onDragStart, onOpen }: { deal: Deal; canDrag: boolean; onDragStart: () => void; onOpen: () => void }) {
  const { companyById, contactById } = useAppStore()
  const company = companyById(deal.companyId)
  const contact = contactById(deal.contactId)
  // Two short lines, which is what the firm asked every list to come down to: who and how much,
  // then everything else after a " · ". The note was a third block and the owner row a fourth;
  // the note is now the card's tooltip, so it is still one hover away.
  const lockedHint = canDrag ? null : "Only this deal's owner, a Sales Manager, or an Administrator can move its stage"
  const tip = [lockedHint, deal.notes].filter(Boolean).join('\n') || undefined
  return (
    <div
      draggable={canDrag}
      onDragStart={onDragStart}
      onClick={onOpen}
      title={tip}
      className={`bg-white rounded-md border border-slate-200 px-2.5 py-1.5 text-[12.5px] hover:border-slate-300 hover:shadow-sm transition-shadow ${canDrag ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium text-slate-800 truncate min-w-0">{company?.name ?? deal.name}</p>
        {dealKind(deal) === 'Handover' ? (
          <p className="font-semibold text-slate-800 tabular-nums whitespace-nowrap shrink-0">
            {deal.handoverAmount != null ? formatCurrency(deal.handoverAmount) : '—'}
            <span className="text-[10px] font-medium text-slate-400 ml-1">book</span>
          </p>
        ) : (
          <p className="font-semibold text-slate-800 tabular-nums whitespace-nowrap shrink-0">{formatCurrency(deal.value)}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 min-w-0">
        <UserAvatar userId={deal.ownerId} size={14} />
        <span className="truncate min-w-0" title={`Opened ${formatDate(deal.createdAt)} · Close ${formatDate(deal.expectedCloseDate)}`}>
          {deal.service ?? deal.name}
          {contact ? ` · ${contact.firstName} ${contact.lastName}` : ''}
          {` · ${relativeDayLabel(deal.createdAt)} · closes ${formatDate(deal.expectedCloseDate)}`}
        </span>
        <span className="ml-auto shrink-0 tabular-nums">{deal.probability}%</span>
      </div>
    </div>
  )
}
