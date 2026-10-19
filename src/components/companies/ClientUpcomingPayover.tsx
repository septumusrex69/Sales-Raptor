import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Landmark } from 'lucide-react'
import { Card } from '../ui/Card'
import { supabase } from '../../lib/supabase'
import { payoverStage, type ClientPayover } from '../../lib/clientPayovers'
import { paysOnFor } from '../../lib/payoverGroups'
import { formatDate } from '../../data/mockData'

const rand0 = (v: number): string => `R ${Math.round(v).toLocaleString('en-ZA')}`

/**
 * THE NEXT PAYOVER TO THIS CLIENT (S9, 19 Oct, after the firm's mock): the day it pays, the cycle it
 * covers, what goes to the client and what the firm keeps.
 *
 * TRUST ONLY, decided by the page: this is client money and the firm's commission on it, which is
 * what `finance.view` guards everywhere else. The Payovers tab is where the whole history is; this
 * is the one run a liaison is asked about on the phone -- "when do we get paid?"
 *
 * THE EARLIEST RUN NOT YET PAID OUT (being checked, waiting for approval, approved, advice sent),
 * and the day it pays on from the lag in Trust settings, the same `paysOnFor` the queue uses.
 */
export function ClientUpcomingPayover({ companyId, onOpen }: { companyId: string; onOpen?: () => void }) {
  const [run, setRun] = useState<(ClientPayover & { dueToUs: number }) | null | undefined>(undefined)
  const [lag, setLag] = useState(1)

  useEffect(() => {
    let live = true
    void (async () => {
      const [{ data }, { data: fs }] = await Promise.all([
        supabase.from('payover_runs')
          .select('id, invoice_number, status, period_start, period_end, net_payover, paid_at, eft_reference, trust_commission, commission_vat, due_to_bf')
          .eq('company_id', companyId).in('status', ['needs_review', 'ready', 'approved', 'sent'])
          .order('period_end', { ascending: true }).limit(1),
        supabase.from('firm_settings').select('payover_lag_months').limit(1).maybeSingle(),
      ])
      if (!live) return
      setLag(Number((fs as { payover_lag_months?: number } | null)?.payover_lag_months ?? 1))
      const r = ((data ?? []) as Record<string, unknown>[])[0]
      setRun(r ? {
        id: String(r.id), invoiceNumber: String(r.invoice_number), status: r.status as ClientPayover['status'],
        periodStart: String(r.period_start), periodEnd: String(r.period_end), netPayover: Number(r.net_payover),
        paidAt: null, eftReference: null, statementDate: null,
        /* WHAT THE FIRM KEEPS on this run: commission and its VAT on what came through the trust,
           and what is owed back on money the debtor paid the client direct. */
        dueToUs: Number(r.trust_commission ?? 0) + Number(r.commission_vat ?? 0) + Number(r.due_to_bf ?? 0),
      } : null)
    })().catch(() => { if (live) setRun(null) })
    return () => { live = false }
  }, [companyId])

  return (
    <Card>
      <div data-testid="client-upcoming-payover">
        <h3 className="mb-3 inline-flex items-center gap-2 font-semibold text-[15px] text-slate-800">
          <Landmark size={16} className="text-slate-400" /> Upcoming payover
        </h3>
        {run === undefined ? (
          <p className="text-sm text-slate-400">Reading…</p>
        ) : run === null ? (
          <p className="text-sm text-slate-500">Nothing waiting to be paid out to this client.</p>
        ) : (
          <>
            <p className="text-2xl font-bold text-navy-950">{formatDate(paysOnFor(run.periodEnd, lag))}</p>
            <p className="text-[12px] text-slate-500">
              Payments collected {formatDate(run.periodStart)} to {formatDate(run.periodEnd)} · {payoverStage(run).label.toLowerCase()}
            </p>
            <dl className="mt-3 space-y-1.5 rounded-lg bg-slate-50 p-3 text-[13px]">
              <div className="flex justify-between gap-2"><dt className="text-slate-600">Amount due to client</dt><dd className="font-semibold tabular-nums text-slate-800">{rand0(run.netPayover)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-600">Amount due to us (commission + VAT)</dt><dd className="font-semibold tabular-nums text-slate-800">{rand0(run.dueToUs)}</dd></div>
            </dl>
            <div className="mt-2 flex items-center justify-between text-xs">
              <Link to={`/trust/runs/${run.id}`} className="font-medium text-navy-700 hover:underline">{run.invoiceNumber}</Link>
              {onOpen && <button type="button" onClick={onOpen} className="text-slate-500 hover:text-slate-700">Every payover</button>}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
