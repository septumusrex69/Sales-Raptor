import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../ui/Card'
import { rand } from '../../lib/money'
import { supabase } from '../../lib/supabase'
import { payoverStage, payoverTotals, type ClientPayover } from '../../lib/clientPayovers'
import { fetchAdviceSends, openAdviceCopy, type AdviceSend } from '../../lib/remittanceEmail'

/**
 * EVERY PAYOVER TO THIS CLIENT, AND THE PAPERS THAT WENT WITH IT.
 *
 * The client's folder for payovers (the firm, 8 Oct: "if we have a payover and a payover is done,
 * it goes to ... save in the client folder"). Each run, newest first, with where it has got to and,
 * under it, every advice actually sent -- the stored PDF and schedule, not one rebuilt today. See
 * clientPayovers.ts for why "paid" and "on the statement" are two different answers.
 */
const TONE = {
  wait: 'bg-amber-100 text-amber-800',
  todo: 'bg-gold-100 text-gold-800',
  done: 'bg-emerald-100 text-emerald-700',
  off: 'bg-slate-100 text-slate-400',
} as const

export function ClientPayoversPanel({ companyId }: { companyId: string }) {
  const [runs, setRuns] = useState<ClientPayover[]>([])
  const [sends, setSends] = useState<AdviceSend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    void (async () => {
      try {
        const { data, error: e } = await supabase.from('payover_runs')
          .select('id, invoice_number, status, period_start, period_end, net_payover, paid_at, eft_reference')
          .eq('company_id', companyId)
          .order('period_start', { ascending: false })
        if (e) throw new Error(e.message)
        const rows = (data ?? []) as Record<string, unknown>[]
        const ids = rows.map((r) => String(r.id))
        const onStatement = new Map<string, string>()
        if (ids.length) {
          const { data: lines } = await supabase.from('bank_statement_lines')
            .select('payover_run_id, txn_date').in('payover_run_id', ids)
          for (const l of (lines ?? []) as { payover_run_id: string; txn_date: string }[]) {
            const was = onStatement.get(l.payover_run_id)
            if (!was || l.txn_date < was) onStatement.set(l.payover_run_id, l.txn_date)
          }
        }
        const s = await fetchAdviceSends({ companyId })
        if (!live) return
        setRuns(rows.map((r) => ({
          id: String(r.id), invoiceNumber: String(r.invoice_number), status: r.status as ClientPayover['status'],
          periodStart: String(r.period_start), periodEnd: String(r.period_end), netPayover: Number(r.net_payover),
          paidAt: (r.paid_at as string | null) ?? null, eftReference: (r.eft_reference as string | null) ?? null,
          statementDate: onStatement.get(String(r.id)) ?? null,
        })))
        setSends(s)
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => { live = false }
  }, [companyId])

  if (loading) return <Card><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></Card>
  if (error) return <Card><p className="text-sm text-negative-700">{error}</p></Card>

  const totals = payoverTotals(runs)
  const open = (path: string) => {
    void openAdviceCopy(path).catch((e: unknown) => setError(e instanceof Error ? e.message : 'That copy could not be opened.'))
  }

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <h2 className="text-[14px] font-semibold text-slate-800">Payovers</h2>
        <div className="flex gap-5 text-[12.5px] text-slate-500" data-testid="payover-totals">
          <span>Paid out <span className="font-semibold tabular-nums text-slate-800">{rand(totals.paid)}</span></span>
          {totals.owed > 0 && <span>Still to pay <span className="font-semibold tabular-nums text-slate-800">{rand(totals.owed)}</span></span>}
        </div>
      </div>
      {runs.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-400">No payover has been run for this client yet.</p>
      ) : (
        /* ONE THIN LINE A RUN, like Trust -> Check (the firm, 10 Oct: "make the lists look like the
           check"). Every copy of the advice that went sits on the run's own line, newest first. */
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="px-5 py-2 font-medium">Run</th>
                <th className="px-2 py-2 font-medium">Period</th>
                <th className="px-2 py-2 font-medium">Where it is</th>
                <th className="px-2 py-2 font-medium">Paid</th>
                <th className="px-2 py-2 font-medium">Advice sent</th>
                <th className="px-5 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const stage = payoverStage(r)
                const mine = sends.filter((x) => x.runId === r.id)
                return (
                  <tr key={r.id} className="border-b border-slate-50 last:border-b-0 text-slate-700" data-testid="client-payover">
                    <td className="px-5 py-1.5">
                      <Link to={`/trust/runs/${r.id}`} className="font-medium text-brand-500 hover:underline">{r.invoiceNumber}</Link>
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">{fmtDay(r.periodStart)} – {fmtDay(r.periodEnd)}</td>
                    <td className="px-2 py-1.5">
                      <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold', TONE[stage.tone])}>{stage.label}</span>
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">
                      {r.status === 'paid' && r.eftReference
                        ? <>{r.paidAt ? `${fmtDay(r.paidAt.slice(0, 10))} · ` : ''}reference <span className="font-mono">{r.eftReference}</span></>
                        : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {mine.length > 0 ? mine.map((x, i) => (
                        <span key={x.id} className="inline-flex items-center gap-2" title={`To ${x.sentTo}`}>
                          {i > 0 && <span className="text-slate-300">|</span>}
                          <span>{x.version === 1 ? 'Sent' : `Sent again (${x.version})`} {fmtStamp(x.sentAt)}</span>
                          <button type="button" onClick={() => open(x.pdfPath)} className="font-medium text-navy-700 underline">Statement (PDF)</button>
                          <button type="button" onClick={() => open(x.xlsxPath)} className="mr-2 font-medium text-navy-700 underline">Schedule</button>
                        </span>
                      )) : (r.status === 'sent' || r.status === 'paid')
                        ? <span className="text-slate-400" title="Sent before copies were kept">No copy kept</span>
                        : '—'}
                    </td>
                    <td className="px-5 py-1.5 text-right font-semibold tabular-nums text-slate-800">{rand(r.netPayover)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function fmtDay(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
