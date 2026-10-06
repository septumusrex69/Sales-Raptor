import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, ChevronRight, ChevronDown, Plus } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { formatCurrency } from '../../data/mockData'
import {
  topLevelClients, rollupClient, rollupBookTotals, registerGap, type ClientBookTotals,
} from '../../lib/companyRollup'
import { fetchClientBookTotals } from '../../lib/clientTotals'
import { AddClientModal } from '../../components/companies/AddClientModal'
import { useAuth } from '../../store/AuthContext'
import type { ID } from '../../types'
import { canBeClientLiaison } from '../../lib/permissions'

export function CompaniesList() {
  const { companies, deals, users, addCompany } = useAppStore()
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  // Sub-accounts start collapsed — only expand the ones someone actually opens.
  const [expanded, setExpanded] = useState<Set<ID>>(new Set())
  /*
   * THE REAL FIGURES, COUNTED OFF THE ACCOUNTS. Its own request and failing quietly: a clients list
   * that refused to draw because a count did not come back would trade the thing people came for
   * against a decoration. Until it lands the columns read as a dash, which is what they already did.
   */
  const [totals, setTotals] = useState<Map<string, ClientBookTotals>>(new Map())
  useEffect(() => {
    let cancelled = false
    void fetchClientBookTotals().then((t) => { if (!cancelled) setTotals(t) })
    return () => { cancelled = true }
  }, [])

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
                <th className="font-medium px-3 py-3 text-right">Capital handed over</th>
                <th className="font-medium px-3 py-3 text-right">Paid to date</th>
                <th className="font-medium px-3 py-3 text-center">Active Deals</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const kids = childrenOf(c.id)
                const isExpanded = expanded.has(c.id)
                /* WHAT SWORDFISH SAID AT IMPORT, kept and labelled as that -- see the gap below. */
                const register = rollupClient(c, companies)
                const book = rollupBookTotals(c, companies, totals)
                const gap = registerGap(register, book)
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
                      {/*
                        THE CLIENT'S OWN LIAISON, NOT THE ACCOUNT OWNER.
                        THE FIRM: "Client Liaison column shows 'Nicole' for every client.
                        companies.liaison is correct in the database (Ryno for Baobab, Karoo and
                        Meridian; Rinda for Kestrel; Nicole for Summit). Even Rinda Roo Company,
                        whose liaison is null, shows Nicole."

                        It was reading `accountOwnerId`, which is the same value on every row the
                        import created -- so the column was true of nothing and looked true of
                        everything. `liaison` is a NAME, the way Swordfish holds it, so the avatar
                        is drawn only where that name resolves to somebody with a login; a liaison
                        who has not been invited yet is still their liaison and is still named.

                        AND NULL DRAWS AS A DASH. A client with nobody looking after them is a fact
                        worth seeing, and the old column could not show it at all.
                      */}
                      <td className="px-3 py-3.5">
                        <LiaisonCell name={c.liaison} users={users} />
                      </td>
                      {/*
                        COUNTED OFF THE ACCOUNTS, NOT READ OFF THE REGISTER.
                        THE FIRM: "The real Meridian test client showed 277 accounts while it held
                        6. Summit Fitness showed '—' while it had 5."

                        Where the register disagrees it is drawn UNDER the real figure rather than
                        instead of it: a client who was told they handed over 277 and whose file
                        holds 6 is a conversation somebody needs to have, and which of the two is
                        right is the firm's question to ask the client, not Raptor's to decide.
                      */}
                      <td className="px-3 py-3.5 text-right text-slate-600 tabular-nums">
                        {book.accounts.toLocaleString('en-ZA')}
                        {gap !== null && gap !== 0 && (
                          <div className="text-[11px] text-gold-700" title="What Swordfish's summary said when this client was imported.">
                            {register.accountCount?.toLocaleString('en-ZA')} per Swordfish
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-right text-slate-600 tabular-nums">{formatCurrency(book.capital)}</td>
                      <td className="px-3 py-3.5 text-right text-slate-600 tabular-nums">{formatCurrency(book.paid)}</td>
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
                          <td className="px-3 py-2.5"><LiaisonCell name={k.liaison} users={users} small /></td>
                          <td className="px-3 py-2.5 text-right text-[13px] text-slate-500 tabular-nums">
                            {(totals.get(k.id)?.accounts ?? 0).toLocaleString('en-ZA')}
                          </td>
                          <td className="px-3 py-2.5 text-right text-[13px] text-slate-500 tabular-nums">{formatCurrency(totals.get(k.id)?.capital ?? 0)}</td>
                          <td className="px-3 py-2.5 text-right text-[13px] text-slate-500 tabular-nums">{formatCurrency(totals.get(k.id)?.paid ?? 0)}</td>
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
          /* THE PROP WAS ALWAYS CALLED `liaisons` AND NOTHING HAD EVER FILTERED IT. The firm:
             "there should only be liaisons or liaison manager, not anybody else, any other user
             when adding a client." See canBeClientLiaison. */
          liaisons={users.filter((u) => u.status === 'Active' && canBeClientLiaison(u))}
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

/**
 * The liaison, by the name the firm recorded.
 *
 * THE AVATAR ONLY WHERE THE NAME IS SOMEBODY WITH A LOGIN. `companies.liaison` is a name, not a
 * foreign key -- Swordfish holds it that way and the import keeps it that way -- so a liaison who
 * has not been invited to Raptor yet is still the client's liaison and is still named here. An
 * avatar for a person the app has never heard of would be a circle with the wrong initials in it.
 *
 * AND NOBODY IS DRAWN AS NOBODY. A client with no liaison is a fact worth seeing; the column this
 * replaced could not show it, because it read a field that is set on every row.
 */
function LiaisonCell({ name, users, small }: {
  name?: string
  users: { id: ID; name: string }[]
  small?: boolean
}) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return <span className="text-slate-300">—</span>
  /* First name or full name, case-insensitively: the register says "Ryno" and the profile says
     "Ryno Bredell". */
  const match = users.find((u) =>
    u.name.toLowerCase() === trimmed.toLowerCase()
    || u.name.toLowerCase().split(' ')[0] === trimmed.toLowerCase())
  return (
    <div className="flex items-center gap-1.5">
      {match && <UserAvatar userId={match.id} size={small ? 18 : 22} />}
      <span className={`text-slate-500 ${small ? 'text-[11px]' : 'text-xs'}`}>{trimmed}</span>
    </div>
  )
}
