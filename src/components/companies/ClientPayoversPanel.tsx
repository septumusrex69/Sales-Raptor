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
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <h2 className="text-[14px] font-semibold text-slate-800">Payovers</h2>
        <div className="flex gap-5 text-[12.5px] text-slate-500" data-testid="payover-totals">
          <span>Paid out <span className="font-semibold tabular-nums text-slate-800">{rand(totals.paid)}</span></span>
          {totals.owed > 0 && <span>Still to pay <span className="font-semibold tabular-nums text-slate-800">{rand(totals.owed)}</span></span>}
        </div>
      </div>
      {runs.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-400">No payover has been run for this client yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {runs.map((r) => {
            const stage = payoverStage(r)
            const mine = sends.filter((x) => x.runId === r.id)
            return (
              <li key={r.id} className="px-5 py-3.5" data-testid="client-payover">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link to={`/trust/runs/${r.id}`} className="text-[13.5px] font-medium text-brand-500 hover:underline">{r.invoiceNumber}</Link>
                    <span className="ml-2 text-[12.5px] text-slate-500">{fmtDay(r.periodStart)} – {fmtDay(r.periodEnd)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={clsx('rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold', TONE[stage.tone])}>{stage.label}</span>
                    <span className="w-28 text-right text-[13.5px] font-semibold tabular-nums text-slate-800">{rand(r.netPayover)}</span>
                  </div>
                </div>
                {r.status === 'paid' && r.eftReference && (
                  <p className="mt-1 text-[12px] text-slate-500">
                    Paid{r.paidAt ? ` ${fmtDay(r.paidAt.slice(0, 10))}` : ''} with reference <span className="font-mono">{r.eftReference}</span>
                  </p>
                )}
                {mine.length > 0 ? (
                  <div className="mt-1.5 space-y-1">
                    {mine.map((x) => (
                      <div key={x.id} className="flex flex-wrap items-center gap-3 text-[12px] text-slate-600">
                        <span>{x.version === 1 ? 'Advice sent' : `Sent again (${x.version})`} {fmtStamp(x.sentAt)} to {x.sentTo}</span>
                        <button type="button" onClick={() => open(x.pdfPath)} className="font-medium text-navy-700 underline">Statement (PDF)</button>
                        <button type="button" onClick={() => open(x.xlsxPath)} className="font-medium text-navy-700 underline">Schedule</button>
                      </div>
                    ))}
                  </div>
                ) : (r.status === 'sent' || r.status === 'paid') && (
                  <p className="mt-1 text-[12px] text-slate-400">Sent before copies were kept — no copy of what went.</p>
                )}
              </li>
            )
          })}
        </ul>
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
