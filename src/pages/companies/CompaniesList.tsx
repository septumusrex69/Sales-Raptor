import { Fragment, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, ChevronRight, ChevronDown, Plus } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { formatCurrency } from '../../data/mockData'
import { topLevelClients, rollupClient } from '../../lib/companyRollup'
import { AddClientModal } from '../../components/companies/AddClientModal'
import { useAuth } from '../../store/AuthContext'
import type { ID } from '../../types'

export function CompaniesList() {
  const { companies, deals, users, addCompany } = useAppStore()
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  // Sub-accounts start collapsed — only expand the ones someone actually opens.
  const [expanded, setExpanded] = useState<Set<ID>>(new Set())

  const wonDealsFor = (companyId: string) => deals.filter((d) => d.companyId === companyId && d.stage === 'Won')
  const childrenOf = (companyId: ID) => companies.filter((c) => c.parentCompanyId === companyId)

  const clients = useMemo(
    () => topLevelClients(companies, (id) => wonDealsFor(id).length > 0),
    [companies, deals],
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return clients
    return clients.filter((c) => c.name.toLowerCase().includes(q) || childrenOf(c.id).some((ch) => ch.name.toLowerCase().includes(q)))
  }, [clients, search, companies])

  const activeDealsFor = (companyId: string) => deals.filter((d) => d.companyId === companyId && d.stage !== 'Won' && d.stage !== 'Rejected')

  function toggleExpanded(id: ID) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 w-64">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients..." className="text-sm outline-none flex-1 min-w-0" />
        </div>
        <span className="text-xs text-slate-400">{filtered.length} clients</span>
        {/*
          LOADING A CLIENT DIRECTLY, at the firm's instruction -- "this isn't the traditional way
          of converting a lead to a client, this is just loading a client directly." The lead path
          learns the services, the mandate and the contacts on the way; a client with no lead
          behind it has nowhere to have learned them, so this asks.
        */}
        <button type="button" onClick={() => { setAddError(null); setAdding(true) }}
          className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2
            rounded-lg bg-gold-400 text-navy-950 border border-gold-500 hover:bg-gold-500">
          <Plus size={15} /> Add client
        </button>
      </div>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="font-medium px-5 py-3 w-[32%]">Client Name</th>
                <th className="font-medium px-3 py-3">Code</th>
                <th className="font-medium px-3 py-3">Client Liaison</th>
                <th className="font-medium px-3 py-3 text-right">Accounts</th>
                <th className="font-medium px-3 py-3 text-right">Handover Amount</th>
                <th className="font-medium px-3 py-3 text-right">Payments to Date</th>
                <th className="font-medium px-3 py-3 text-center">Active Deals</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const kids = childrenOf(c.id)
                const isExpanded = expanded.has(c.id)
                const totals = rollupClient(c, companies)
                return (
                  <Fragment key={c.id}>
                    <tr onClick={() => navigate(`/companies/${c.id}`)} className="border-t border-slate-50 hover:bg-slate-50/60 cursor-pointer">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          {kids.length > 0 ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleExpanded(c.id)
                              }}
                              className="text-slate-400 hover:text-slate-600 shrink-0"
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          ) : (
                            <span className="w-3.5 shrink-0" />
                          )}
                          <div>
                            <Link to={`/companies/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-700 hover:text-brand-600">
                              {c.name}
                            </Link>
                            {kids.length > 0 && <p className="text-[11px] text-slate-400">{kids.length} sub-account{kids.length === 1 ? '' : 's'}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        {c.code ? <span className="font-mono text-[11px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">{c.code}</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <UserAvatar userId={c.accountOwnerId} size={22} />
                          <span className="text-slate-500 text-xs">{users.find((u) => u.id === c.accountOwnerId)?.name.split(' ')[0]}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-right text-slate-600 tabular-nums">{totals.accountCount ?? '—'}</td>
                      <td className="px-3 py-3.5 text-right text-slate-600 tabular-nums">{totals.handoverAmount !== undefined ? formatCurrency(totals.handoverAmount) : '—'}</td>
                      <td className="px-3 py-3.5 text-right text-slate-600 tabular-nums">{totals.paymentsToDate !== undefined ? formatCurrency(totals.paymentsToDate) : '—'}</td>
                      <td className="px-3 py-3.5 text-center text-slate-600 font-medium">{activeDealsFor(c.id).length}</td>
                    </tr>
                    {isExpanded &&
                      kids.map((k) => (
                        <tr key={k.id} onClick={() => navigate(`/companies/${k.id}`)} className="border-t border-slate-50 bg-slate-50/40 hover:bg-slate-50 cursor-pointer">
                          <td className="px-5 py-2.5 pl-14">
                            <Link to={`/companies/${k.id}`} onClick={(e) => e.stopPropagation()} className="text-[13px] text-slate-600 hover:text-brand-600">
                              ↳ {k.name}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5">
                            {k.code ? <span className="font-mono text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">{k.code}</span> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-3 py-2.5"></td>
                          <td className="px-3 py-2.5 text-right text-[13px] text-slate-500 tabular-nums">{k.accountCount ?? '—'}</td>
                          <td className="px-3 py-2.5 text-right text-[13px] text-slate-500 tabular-nums">{k.handoverAmount !== undefined ? formatCurrency(k.handoverAmount) : '—'}</td>
                          <td className="px-3 py-2.5 text-right text-[13px] text-slate-500 tabular-nums">{k.paymentsToDate !== undefined ? formatCurrency(k.paymentsToDate) : '—'}</td>
                          <td className="px-3 py-2.5"></td>
                        </tr>
                      ))}
                  </Fragment>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  {/*
                    THE RULE, IN FULL. This said only "once one of its deals is marked Won", which
                    is half of it -- topLevelClients also accepts a company with a CODE, and every
                    client that came across from Swordfish is here on that half. The firm added a
                    company by hand, could not find it, and reasonably read a rule as a bug.
                  */}
                  <td colSpan={7} className="text-center text-slate-400 text-sm py-10">
                    {search
                      ? 'No client matches that.'
                      : 'No clients yet. A company lands here once it has a client code — which '
                        + '"Add client" gives it — or once one of its deals is marked Won.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {adding && (
        <AddClientModal
          /* EVERY code in use, parents and children alike. The unique index only covers top-level
             clients -- Adowa and its Ellis Park property share APM, which is Swordfish's doing and
             is frozen -- but proposing a code a child already holds would still read as a clash. */
          takenCodes={companies.map((c) => c.code ?? '').filter(Boolean)}
          liaisons={users.filter((u) => u.status === 'Active')}
          busy={false}
          error={addError}
          onClose={() => setAdding(false)}
          onSave={(input) => {
            try {
              const created = addCompany({ ...input, accountOwnerId: input.accountOwnerId ?? currentUser?.id ?? '' })
              setAdding(false)
              navigate(`/companies/${created.id}`)
            } catch (e) {
              setAddError(e instanceof Error ? e.message : String(e))
            }
          }} />
      )}
    </div>
  )
}
