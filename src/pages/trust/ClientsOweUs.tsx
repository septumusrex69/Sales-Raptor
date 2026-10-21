import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import { clockToday } from '../../lib/clock.ts'
import {
  fetchClientsOwing, fetchPtcAgeing, fetchPtcByRun, type ClientOwing, type PtcAgeing, type PtcRun,
} from '../../lib/trust'
import { PtcAgeAnalysis, PtcByPayover } from './TrustPtc'

/**
 * CLIENTS OWE US (S7, the firm, 13 Oct: "we should have a dedicated tab ... the clients that owe us
 * money ... the moment you owe the trust, you owe the business. So let's keep it like that. We don't
 * distinguish ... everybody owes it").
 *
 * One list, one figure per client: the payover shortfall still standing (mostly the firm's share of
 * payments made straight to them) and invoices they have not paid -- clients_owing, the same items
 * a client's Account tab lists and a payment is applied to, oldest first. Open a client to record a
 * payment or set up an arrangement. Underneath, how old the debt is and the payments behind it, which
 * used to sit on the Trust overview -- the overview now carries the total and a link here.
 */
export function ClientsOweUs() {
  const [rows, setRows] = useState<ClientOwing[] | null>(null)
  const [ageing, setAgeing] = useState<PtcAgeing[]>([])
  const [ptc, setPtc] = useState<PtcRun[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([fetchClientsOwing(), fetchPtcAgeing().catch(() => []), fetchPtcByRun().catch(() => [])])
      .then(([r, a, p]) => { if (live) { setRows(r); setAgeing(a); setPtc(p) } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])

  if (error) return <Card className="p-5 text-sm text-negative-700 bg-negative-50">What clients owe could not be read: {error}</Card>
  if (!rows) return <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Reading what clients owe…</div>

  const total = Math.round(rows.reduce((t, r) => t + r.total, 0) * 100) / 100
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-800">Clients owe us</h1>
          <p className="mt-1 text-sm text-slate-500">
            Owing the trust is owing the firm: one figure per client, from payovers that came out below nil and invoices not yet paid.
          </p>
        </div>
        <div className="text-right" data-testid="clients-owe-total">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Owed to us</div>
          <div className="text-2xl font-semibold tabular-nums text-negative-700">{rand(total)}</div>
          <div className="text-[12.5px] text-slate-500">{rows.length} {rows.length === 1 ? 'client' : 'clients'}</div>
        </div>
      </div>

      <Card padded={false} className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-positive-700">No client owes the firm anything.</p>
        ) : (
          <table className="w-full list-table whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="px-5 py-2 font-medium">Client</th>
                <th className="px-3 py-2 text-right font-medium">From payovers</th>
                <th className="px-3 py-2 text-right font-medium">Invoices</th>
                <th className="px-3 py-2 text-right font-medium">Owed</th>
                <th className="px-3 py-2 font-medium">Owed since</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.companyId} className="border-b border-slate-50" data-testid="client-owing">
                  <td className="px-5 py-1.5 font-medium text-slate-800">{r.client}{r.code ? <span className="ml-2 text-slate-400">{r.code}</span> : null}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{r.fromPayovers ? rand(r.fromPayovers) : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{r.fromInvoices ? rand(r.fromInvoices) : '—'}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-negative-700">{rand(r.total)}</td>
                  <td className="px-3 py-1.5 tabular-nums text-slate-500">{r.oldestDue ? day(r.oldestDue) : '—'}</td>
                  <td className="px-5 py-1.5 text-right">
                    <Link to={`/companies/${r.companyId}?tab=Account`} className="text-[12.5px] font-medium text-gold-700 hover:text-gold-800">
                      Record a payment or arrangement
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <section>
        <h2 className="text-lg font-semibold tracking-tight text-slate-800">How old it is</h2>
        <p className="mt-1 text-sm text-slate-500">Counted from the payover that first invoiced it; a shortfall carried forward keeps its first date.</p>
        <PtcAgeAnalysis items={ageing} today={clockToday()} />
      </section>

      <section>
        <h2 className="text-lg font-semibold tracking-tight text-slate-800">Paid straight to clients (PTCs)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Where most of it comes from: a debtor paid the client, so the firm&rsquo;s share comes off that client&rsquo;s payover, and what their trust money does not cover they owe us.
        </p>
        <PtcByPayover runs={ptc} />
      </section>

      <p className="text-[12.5px] text-slate-500">
        Every client&rsquo;s balance, both ways: <Link to="/trust/clients/all" className="font-medium text-gold-700 hover:text-gold-800">Client balances</Link>.
      </p>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function day(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
