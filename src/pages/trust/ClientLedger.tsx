import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Loader2, Search } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import { fetchWorkQueue, type WorkQueueRow } from '../../lib/payover'
import { fetchSettledRunIds } from '../../lib/clientBusinessReceipts'
import { clientPayovers, ledgerClients, matchesClient, payoverDay } from '../../lib/paidOverLedger'
import { ClientsOweUs } from './ClientsOweUs'

/**
 * THE CLIENT LEDGER (S21 · Raptor H19): every payover that has left the trust account, filed by client.
 *
 * Stephan, 9 Nov: "you'll have a client ledger. And the client ledger you would click on it and it'll show you the list
 * of the clients. Then you can search a client or search a payment in there ... Then you click on the client ... all
 * the historical payovers. If you click on the historical payover, then it shows you all the payments ... You should
 * also be able to preview the payover report that was sent ... and you should still be able to do things with those
 * payments."
 *
 * THE PAYOVER OPENS AS THE RUN IT ALWAYS WAS (/trust/runs/:id): its payments, the advice as drawn, and the copy that
 * was actually emailed -- one screen for a run, whether it is being approved or looked back on, so nothing about a paid
 * run is rebuilt here from today's figures. Which runs count as paid over is isPaidOver, the rule the Payover runs page
 * uses to let them go.
 */
export function ClientLedger() {
  const [params, setParams] = useSearchParams()
  const companyId = params.get('client')
  /* CLIENTS OWE US, AS A FILTER HERE (S21 · Raptor H19) rather than a menu item: the same clients, the other way round. */
  const view: 'paid' | 'owe' = params.get('view') === 'owe' ? 'owe' : 'paid'
  const [rows, setRows] = useState<WorkQueueRow[] | null>(null)
  const [settled, setSettled] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    let live = true
    Promise.all([fetchWorkQueue(null), fetchSettledRunIds().catch(() => new Set<string>())])
      .then(([r, s]) => { if (live) { setRows(r); setSettled(s) } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])

  const clients = useMemo(() => (rows ? ledgerClients(rows, settled) : []), [rows, settled])
  const shown = clients.filter((c) => matchesClient(c, q))
  const open = companyId ? clients.find((c) => c.companyId === companyId) ?? null : null
  const payovers = useMemo(() => (rows && companyId ? clientPayovers(rows, settled, companyId) : []), [rows, settled, companyId])

  if (error) return <Card className="p-5 text-sm text-negative-700 bg-negative-50">The client ledger could not be read: {error}</Card>
  if (!rows) return <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Reading the client ledger…</div>

  if (companyId) {
    return (
      <div className="space-y-4" data-testid="client-ledger-client">
        <button type="button" onClick={() => setParams({}, { replace: false })}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 hover:text-slate-800">
          <ArrowLeft size={14} /> Every client
        </button>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-slate-800">
            {open?.client ?? 'This client'}{open?.clientCode ? <span className="ml-2 font-mono text-[14px] text-slate-400">{open.clientCode}</span> : null}
          </h1>
          {open && <span className="text-sm text-slate-500">{open.payovers} payover{open.payovers === 1 ? '' : 's'} · {rand(open.paidOver)} paid over</span>}
        </div>
        <Card padded={false} className="overflow-x-auto">
          {payovers.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing has been paid over to this client yet.</p>
          ) : (
            <table className="w-full list-table whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  <th className="px-3 py-2 font-medium">Cycle</th>
                  <th className="px-2 py-2 font-medium">Advice</th>
                  <th className="px-2 py-2 text-right font-medium">Payments</th>
                  <th className="px-2 py-2 text-right font-medium">Paid over</th>
                  <th className="px-2 py-2 font-medium">Paid</th>
                  <th className="px-2 py-2 font-medium">Bank reference</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {payovers.map((r) => (
                  <tr key={r.runId} className="border-b border-slate-50 hover:bg-slate-50" data-testid="client-ledger-payover">
                    <td className="px-3 py-1.5 text-slate-700">{cycleWords(r.periodStart, r.periodEnd)}</td>
                    <td className="px-2 py-1.5 font-mono text-[12px] text-slate-600">{r.invoiceNumber}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{r.payments}</td>
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums text-slate-800">{rand(r.netPayover)}</td>
                    <td className="px-2 py-1.5 text-slate-600">{shortDay(payoverDay(r))}</td>
                    <td className="px-2 py-1.5 font-mono text-[12px] text-slate-500">{r.eftReference ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right">
                      <Link to={`/trust/runs/${r.runId}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-sky-700 hover:text-sky-900">
                        Payments and advice <ArrowRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5" data-testid="client-ledger">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Client ledger</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every payover that has been approved and paid, filed by client. What is still waiting to be paid over is on Payover runs.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Which clients">
        {([['paid', 'Paid over'], ['owe', 'Owe us']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} data-testid={`ledger-view-${k}`}
            onClick={() => setParams(k === 'owe' ? { view: 'owe' } : {})}
            className={`rounded-full border px-3 py-1 text-[13px] font-medium ${view === k ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'owe' ? <ClientsOweUs embedded /> : (<>
      <label className="flex max-w-md items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <Search size={15} className="text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a client by name or code"
          aria-label="Search a client" className="w-full bg-transparent outline-none" />
      </label>

      <Card padded={false} className="overflow-x-auto">
        {shown.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            {clients.length === 0 ? 'Nothing has been paid over yet.' : 'No client matches that.'}
          </p>
        ) : (
          <table className="w-full list-table whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-2 py-2 text-right font-medium">Payovers</th>
                <th className="px-2 py-2 text-right font-medium">Paid over</th>
                <th className="px-2 py-2 font-medium">Last paid</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.companyId} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" data-testid="client-ledger-row"
                  onClick={() => setParams({ client: c.companyId })}>
                  <td className="px-3 py-1.5 font-medium text-slate-800">
                    {c.client}{c.clientCode ? <span className="ml-2 font-mono text-[11.5px] text-slate-400">{c.clientCode}</span> : null}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{c.payovers}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums text-slate-800">{rand(c.paidOver)}</td>
                  <td className="px-2 py-1.5 text-slate-600">{shortDay(c.lastPaid)}</td>
                  <td className="px-3 py-1.5 text-right"><ArrowRight size={14} className="inline text-slate-400" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      </>)}

      <p className="text-[12.5px] text-slate-500">
        Looking for one payment? Type its amount, case number or a name in the search bar at the top.{' '}
        <Link to="/trust/check" className="font-medium text-sky-700 hover:text-sky-900" data-testid="all-processed">Every processed payment, by client &rarr;</Link>
      </p>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/* Written out rather than through Intl: en-ZA abbreviates September to "Sept" (CLAUDE.md). */
function shortDay(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
function cycleWords(start: string, end: string): string {
  return `${shortDay(start)} – ${shortDay(end)}`
}
