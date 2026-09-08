import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Loader2, Search } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { inputClass } from '../../components/ui/Modal'
import { useAppStore } from '../../store/AppStore'
import { fetchAccounts, fetchBookSummary, hasCommissionDrift, type DebtorAccount, type BookSummary } from '../../lib/accountBook'
import { formatCurrency, formatDate } from '../../data/mockData'

const PAGE_SIZE = 50

/**
 * The collections book.
 *
 * Paged from the database rather than held in the app: this is the table that will reach hundreds
 * of thousands of rows, and a list that loads everything to show fifty is a list that stops
 * working the month it matters.
 */
export function AccountsList() {
  const { companies } = useAppStore()
  const [params, setParams] = useSearchParams()
  const [accounts, setAccounts] = useState<DebtorAccount[]>([])
  const [summary, setSummary] = useState<BookSummary | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState(params.get('q') ?? '')

  const companyId = params.get('client') ?? undefined
  const driftOnly = params.get('drift') === '1'
  const companyName = companies.find((c) => c.id === companyId)?.name

  const setParam = useCallback((key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key); else next.set(key, value)
    setParams(next, { replace: true })
    setPage(0)
  }, [params, setParams])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    // Debounced so typing a surname doesn't fire a query per keystroke.
    const t = window.setTimeout(async () => {
      try {
        const [res, sum] = await Promise.all([
          fetchAccounts({ companyId, search, commissionDriftOnly: driftOnly, page, pageSize: PAGE_SIZE }),
          fetchBookSummary(companyId),
        ])
        if (cancelled) return
        setAccounts(res.accounts); setTotal(res.total); setSummary(sum)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, search ? 300 : 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [companyId, search, driftOnly, page])

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min(total, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Accounts" value={summary.accounts.toLocaleString('en-ZA')} />
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
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-100">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className={`${inputClass} pl-9`}
              placeholder="Account number, client reference or surname"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
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
          {driftOnly && (
            <button className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5"
              onClick={() => setParam('drift', null)}>
              Off their mandate rate · clear
            </button>
          )}
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
            <p className="text-sm text-slate-600">No accounts here yet.</p>
            <p className="text-xs text-slate-400 mt-1">
              The book comes across from Swordfish in <Link className="text-brand-600 underline" to="/settings">Settings → Data Import</Link>.
            </p>
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
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Last payment</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const drift = hasCommissionDrift(a)
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
                        <StatusPill status={a.status} inDuplum={a.inDuplum} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{a.lastPaymentAt ? formatDate(a.lastPaymentAt) : '—'}</td>
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

export function StatusPill({ status, inDuplum }: { status: string; inDuplum?: boolean }) {
  // Written off and in duplum are the two states that change what may still be collected, so they
  // are the two that get colour. Everything else is just a label.
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
