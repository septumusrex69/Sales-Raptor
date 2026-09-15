import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Loader2, Search } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { inputClass } from '../../components/ui/Modal'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import {
  fetchAccounts, fetchBookFacets, fetchBookSummary, hasCommissionDrift,
  type BookFacets, type BookSummary, type DebtorAccount,
} from '../../lib/accountBook'
import { clearedFilters, filterChips, queryFromParams } from '../../lib/accountFilters'
import { CLIENT_FLAGS, CLIENT_POSITIONS, clientFlag, clientPosition } from '../../lib/clientPosition'
import { AccountFilters } from './AccountFilters'
import { formatCurrency, formatDate } from '../../data/mockData'

const PAGE_SIZE = 50

/** Who may ask for somebody else's desk. An agent's book is their own. */
const CAN_SEE_OTHER_DESKS = ['Administrator', 'Sales Manager', 'Liaison Manager', 'Pre-legal Team Leader']

/**
 * The collections book.
 *
 * Paged from the database rather than held in the app: this is the table that will reach hundreds
 * of thousands of rows, and a list that loads everything to show fifty is a list that stops
 * working the month it matters. Every filter goes to the database for the same reason — a
 * `.filter()` over the fifty rows on screen gives an answer that is right about the page and
 * wrong about the book.
 *
 * THE URL IS THE STATE. Narrowing the book is how somebody asks a question of it, and a question
 * you cannot paste into a message is half a tool.
 */
export function AccountsList() {
  const { companies, users } = useAppStore()
  const { currentUser } = useAuth()
  const [params, setParams] = useSearchParams()
  const [accounts, setAccounts] = useState<DebtorAccount[]>([])
  const [summary, setSummary] = useState<BookSummary | null>(null)
  const [facets, setFacets] = useState<BookFacets | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState(params.get('q') ?? '')

  const companyId = params.get('client') ?? undefined
  const companyName = companies.find((c) => c.id === companyId)?.name
  const canSeeOthers = CAN_SEE_OTHER_DESKS.includes(currentUser?.role ?? '')

  const setParam = useCallback((key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null || value === '') next.delete(key); else next.set(key, value)
    setParams(next, { replace: true })
    setPage(0)
  }, [params, setParams])

  const clearFilters = useCallback(() => {
    setParams(clearedFilters(params), { replace: true })
    setPage(0)
  }, [params, setParams])

  // The typed box is local so it stays responsive; the URL catches up after a pause. Writing
  // every keystroke into history would make the back button walk the surname letter by letter.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((params.get('q') ?? '') !== search) setParam('q', search || null)
    }, 300)
    return () => window.clearTimeout(t)
  }, [search, params, setParam])

  const key = params.toString()
  const query = useMemo(() => queryFromParams(new URLSearchParams(key)), [key])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    void (async () => {
      try {
        const [res, sum] = await Promise.all([
          fetchAccounts({ ...query, page, pageSize: PAGE_SIZE }),
          fetchBookSummary(query.companyId),
        ])
        if (cancelled) return
        setAccounts(res.accounts); setTotal(res.total); setSummary(sum)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [query, page])

  // The dropdowns offer what the book holds, which changes with the client. Its own request, so
  // a slow facet count never holds up the list itself.
  useEffect(() => {
    let cancelled = false
    void fetchBookFacets(companyId)
      .then((f) => { if (!cancelled) setFacets(f) })
      .catch(() => { if (!cancelled) setFacets(null) })
    return () => { cancelled = true }
  }, [companyId])

  const driftOnly = params.get('drift') === '1'
  const narrowed = filterChips(params).length > 0 || !!query.search
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min(total, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/*
            The summary is the CLIENT'S WHOLE BOOK, not the filtered list, and says so. A tile
            that silently followed the filters would read "Accounts 3" next to a list of three
            and there would be no number left anywhere saying how big the book really is.
          */}
          <Tile label={narrowed ? 'Accounts (whole book)' : 'Accounts'} value={summary.accounts.toLocaleString('en-ZA')} />
          <Tile label="Capital handed over" value={formatCurrency(summary.capital)} />
          <Tile label={companyId ? 'Client' : 'Clients'} value={companyId ? (companyName ?? '—') : String(summary.clients)} />
          <Tile
            label="Off their mandate rate"
            value={summary.commissionDrift.toLocaleString('en-ZA')}
            tone={summary.commissionDrift > 0 ? 'warn' : undefined}
            action={summary.commissionDrift > 0
              ? { label: driftOnly ? 'Show all' : 'Show these', onClick: () => setParam('drift', driftOnly ? null : '1') }
              : undefined}
          />
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-100">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className={`${inputClass} pl-9`}
              placeholder="Account number, client reference or surname"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className={`${inputClass} w-auto`}
            value={companyId ?? ''}
            onChange={(e) => setParam('client', e.target.value || null)}
          >
            <option value="">All clients</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <AccountFilters
            params={params} setParam={setParam} onClear={clearFilters}
            facets={facets} users={users} canSeeOthers={canSeeOthers}
          />
        </div>

        {error && (
          <div className="p-4 text-sm text-rose-700 bg-rose-50/50 flex items-start gap-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="p-10 grid place-items-center text-slate-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="p-10 text-center">
            {narrowed ? (
              <>
                <p className="text-sm text-slate-600">No accounts match these filters.</p>
                <button className="text-xs font-medium text-brand-600 hover:underline mt-1" onClick={clearFilters}>
                  Clear the filters
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600">No accounts here yet.</p>
                <p className="text-xs text-slate-400 mt-1">
                  The book comes across from Swordfish in <Link className="text-brand-600 underline" to="/settings">Settings → Data Import</Link>.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2.5 font-medium">Account</th>
                  <th className="px-4 py-2.5 font-medium">Debtor</th>
                  <th className="px-4 py-2.5 font-medium text-right">Capital</th>
                  <th className="px-4 py-2.5 font-medium text-right">Paid</th>
                  <th className="px-4 py-2.5 font-medium text-right">Rate</th>
                  <th className="px-4 py-2.5 font-medium">Position</th>
                  <th className="px-4 py-2.5 font-medium">Desk</th>
                  <th className="px-4 py-2.5 font-medium">Last worked</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const drift = hasCommissionDrift(a)
                  const desk = a.assignedTo ? users.find((u) => u.id === a.assignedTo)?.name : null
                  return (
                    <tr key={a.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-2.5">
                        <Link to={`/accounts/${a.id}`} className="font-medium text-brand-700 hover:underline">
                          {a.accountNumber ?? '—'}
                        </Link>
                        {a.clientReference && <span className="block text-[11px] text-slate-400">{a.clientReference}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {[a.debtorFirstName, a.debtorSurname].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatCurrency(a.capitalHandedOver)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                        {a.paymentsToDate ? formatCurrency(a.paymentsToDate) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {a.commissionRate === null ? (
                          <span className="text-slate-400">—</span>
                        ) : drift ? (
                          <span className="text-amber-700" title={`Mandate says ${pct(a.commissionRateExpected)}`}>
                            {pct(a.commissionRate)} <span className="text-amber-500">≠</span>
                          </span>
                        ) : (
                          <span className="text-slate-600">{pct(a.commissionRate)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <PositionPill account={a} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {desk ?? <span className="text-amber-600" title="Nobody is carrying this account.">Unallocated</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{a.lastActionAt ? formatDate(a.lastActionAt) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between p-4 border-t border-slate-100 text-sm">
            <span className="text-slate-500 tabular-nums">{from}–{to} of {total.toLocaleString('en-ZA')}</span>
            <div className="flex gap-2">
              <button className="btn-secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <button className="btn-secondary" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 1)}%`)

function Tile({ label, value, tone, action }: {
  label: string; value: string; tone?: 'warn'; action?: { label: string; onClick: () => void }
}) {
  return (
    <Card className={tone === 'warn' ? 'border-amber-200' : undefined}>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-xl font-semibold tabular-nums mt-0.5 ${tone === 'warn' ? 'text-amber-700' : 'text-slate-800'}`}>{value}</p>
      {action && (
        <button className="text-[11px] font-medium text-brand-600 hover:underline mt-1" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </Card>
  )
}

/**
 * Where the account stands, in the firm's own words.
 *
 * This column used to print debtor_accounts.status raw — "Active: Unfrozen", which describes how
 * the row got into the table and not one thing about the debtor. The position is derived from the
 * status, the sub-status and the freeze, by the same function the client's report uses, so the
 * list and the report cannot disagree about an account.
 *
 * NO PAYMENT SIGNAL HERE. `paidInPeriod` needs a reporting period and this list has none, so an
 * account that paid this month reads as whatever it was before the money — Arranged, usually.
 * The alternative would be to infer a period the person did not choose.
 */
export function PositionPill({ account }: { account: DebtorAccount }) {
  // status carries the freeze: freezeAccount() writes 'Frozen' to it, which is what
  // clientPosition() reads. frozenBy says who asked, not whether.
  const position = clientPosition({ status: account.status, subStatus: account.subStatus })
  const flag = clientFlag(position, !!account.clientActionAsk)
  const meta = CLIENT_POSITIONS[position]
  const tone = flag === 'client_action' ? 'bg-rose-50 text-rose-700'
    : flag === 'attention' ? 'bg-amber-50 text-amber-700'
      : flag === 'inactive' ? 'bg-slate-100 text-slate-500'
        : 'bg-emerald-50 text-emerald-700'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${tone}`} title={meta.meaning}>
        {meta.label}
      </span>
      {account.clientActionAsk && (
        <span className="text-[11px] text-rose-600" title={account.clientActionAsk}>{CLIENT_FLAGS.client_action.dot}</span>
      )}
      {account.inDuplum && (
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700"
          title="Non-capital has reached the capital handed over; it may not grow further.">
          in duplum
        </span>
      )}
    </span>
  )
}

/** The raw inherited status, where the raw status is what is being shown. */
export function StatusPill({ status, inDuplum }: { status: string; inDuplum?: boolean }) {
  const written = /written.off/i.test(status)
  const tone = written ? 'bg-slate-100 text-slate-500'
    : /active/i.test(status) ? 'bg-emerald-50 text-emerald-700'
      : 'bg-slate-100 text-slate-600'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${tone}`}>{status || '—'}</span>
      {inDuplum && (
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700" title="Non-capital has reached the capital handed over; it may not grow further.">
          in duplum
        </span>
      )}
    </span>
  )
}
