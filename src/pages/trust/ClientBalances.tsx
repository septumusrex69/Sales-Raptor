import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import { fetchClientBalances, type ClientBalance } from '../../lib/business'

/**
 * EVERY CLIENT: WHAT WE HOLD FOR THEM, WHAT THEY OWE US, AND WHICH WAY IT POINTS.
 *
 * The firm, 10 Oct, after running a PTC: "we should have like a ledger for clients. Who owes us
 * and who we paid ... we need to understand where that lives." A PTC put the client in debit on
 * the trust ledger and nowhere else said so; Business -> Clients who owe the firm read only
 * charges. This is the one list, read from `client_balances` -- the same figures Business shows
 * for the clients who owe us -- and each row opens that client's ledger on their record.
 *
 * SAID IN WORDS, NEVER A BARE MINUS. "We owe them R x" or "They owe us R x": the firm's own
 * complaint about a remittance advice reading "-R 14 162.50" was that the sign is easy to misread
 * as the other direction.
 */
export function ClientBalances() {
  const [rows, setRows] = useState<ClientBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [only, setOnly] = useState<'all' | 'owe_us' | 'we_owe'>('all')

  useEffect(() => {
    let live = true
    fetchClientBalances()
      .then((r) => { if (live) setRows(r) })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  const shown = useMemo(() => rows.filter((r) =>
    only === 'all' ? true : only === 'owe_us' ? r.net < 0 : r.net > 0), [rows, only])
  const weOwe = rows.filter((r) => r.net > 0).reduce((s, r) => s + r.net, 0)
  const oweUs = rows.filter((r) => r.net < 0).reduce((s, r) => s - r.net, 0)

  if (loading) {
    return <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Reading every client&rsquo;s balance…</div>
  }
  if (error) {
    return <Card className="p-5 text-sm text-negative-700 bg-negative-50">The balances could not be read: {error}</Card>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Client balances</h1>
        <p className="mt-1 text-sm text-slate-500">
          What we hold for each client and what each owes us. Open a client for their ledger, line by line.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2" data-testid="client-balance-totals">
        <Card>
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">We owe clients</div>
          <div className="mt-1 text-[22px] font-medium tabular-nums text-positive-700">{rand(weOwe)}</div>
          <p className="mt-1 text-xs text-slate-400">Held in trust, waiting for their payovers.</p>
        </Card>
        <Card>
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">Clients owe us</div>
          <div className="mt-1 text-[22px] font-medium tabular-nums text-negative-700">{rand(oweUs)}</div>
          <p className="mt-1 text-xs text-slate-400">Fees on payments made to them directly, and charges. Comes off their next payover.</p>
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex gap-1 px-4 pt-3">
          {([['all', `All (${rows.length})`], ['owe_us', 'They owe us'], ['we_owe', 'We owe them']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setOnly(k)}
              className={clsx('rounded-lg px-3 py-1.5 text-[13px] font-medium',
                only === k ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:bg-slate-50')}>
              {label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-2 py-2 text-right font-medium" title="Negative where payments made to them directly leave them owing the trust">In trust for them</th>
                <th className="px-2 py-2 text-right font-medium">Charges due</th>
                <th className="px-2 py-2 text-right font-medium">Where it stands</th>
                <th className="px-3 py-2 font-medium">Last payover</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.companyId} className="border-b border-slate-50 text-slate-700 hover:bg-slate-50" data-testid="client-balance">
                  <td className="px-3 py-1.5 max-w-[18rem] truncate" title={r.client}>
                    <Link to={`/companies/${r.companyId}?tab=Account`} className="font-medium text-slate-800 hover:text-gold-700">{r.client}</Link>
                    {r.code && <span className="ml-2 text-slate-400">{r.code}</span>}
                  </td>
                  <td className={clsx('px-2 py-1.5 text-right tabular-nums', r.inTrust < 0 && 'text-negative-700')}>{rand(r.inTrust)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.chargesDue ? rand(r.chargesDue) : '—'}</td>
                  <td className={clsx('px-2 py-1.5 text-right font-semibold tabular-nums',
                    r.net > 0 ? 'text-positive-700' : r.net < 0 ? 'text-negative-700' : 'text-slate-400')}>
                    {r.net > 0 ? `We owe them ${rand(r.net)}` : r.net < 0 ? `They owe us ${rand(-r.net)}` : 'Settled'}
                  </td>
                  <td className="px-3 py-1.5 text-slate-500">
                    {r.lastPaidOn ? `${r.lastPaidOn} · ${rand(r.lastPaid ?? 0)}` : '—'}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">No client is in that list.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
