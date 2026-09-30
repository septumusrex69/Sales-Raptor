import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import { useAuth } from '../../store/AuthContext'
import { canViewFinance } from '../../lib/permissions'
import { RUN_STATUS_LABEL, fetchAccountLedger, type LedgerLine } from '../../lib/payover'

/**
 * THE ACCOUNT'S LEDGER: every payment, its split, and the run that paid it over.
 *
 * ADMINISTRATOR ONLY, like everything that shows the firm's own cut. A collector sees the
 * payments on the account already; what they do not see is where each one went.
 *
 * THE RUNNING BALANCES ARE CARRIED FORWARD, not read off each allocation's `capital_after`. Those
 * are right about the moment they were written and wrong after a replay reorders anything, so a
 * ledger built from them disagrees with itself the first time a payment is reversed. Computed
 * forward from the opening position in capture order, every line is consistent with the one above
 * it by construction.
 *
 * A REVERSED PAYMENT IS SHOWN AND MOVES NOTHING. Struck through, with the reason: that the money
 * arrived and went back is the thing the firm has to be able to explain to a debtor, and dropping
 * the line makes the account look as though it never happened.
 */
export function LedgerPanel({ accountId }: { accountId: string }) {
  const { currentUser } = useAuth()
  const [lines, setLines] = useState<LedgerLine[]>([])
  const [loading, setLoading] = useState(true)
  const maySee = canViewFinance(currentUser)

  const load = useCallback(async () => {
    if (!maySee) { setLoading(false); return }
    setLoading(true)
    try { setLines(await fetchAccountLedger(accountId)) }
    catch { setLines([]) }
    finally { setLoading(false) }
  }, [accountId, maySee])

  useEffect(() => { void load() }, [load])

  if (!maySee) return null
  if (loading) return <Card><div className="py-6 text-center"><Loader2 className="mx-auto w-4 h-4 animate-spin text-slate-400" /></div></Card>
  if (lines.length === 0) return null

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="text-[15px] font-semibold text-slate-800">Ledger</h3>
        <span className="text-xs text-slate-400">
          Administrator only · {lines.length} {lines.length === 1 ? 'payment' : 'payments'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px]">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">
              <th className="px-4 py-2.5">Payment</th>
              <th className="px-4 py-2.5 text-right">Gross</th>
              <th className="px-4 py-2.5 text-right">Receipt fee</th>
              <th className="px-4 py-2.5 text-right">Interest</th>
              <th className="px-4 py-2.5 text-right">Costs</th>
              <th className="px-4 py-2.5 text-right">Capital</th>
              <th className="px-4 py-2.5 text-right">Commission</th>
              <th className="px-4 py-2.5 text-right">Capital left</th>
              <th className="px-4 py-2.5 text-right">Interest left</th>
              <th className="px-4 py-2.5 text-right">Costs left</th>
              <th className="px-4 py-2.5">Paid over in</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.paymentId}
                className={clsx('border-b border-slate-50 text-sm', l.reversed && 'text-slate-400')}>
                <td className="px-4 py-2.5">
                  <div className={clsx('font-medium', l.reversed && 'line-through')}>
                    {l.receivedAt ? fmt(l.receivedAt) : '—'}
                  </div>
                  <div className="text-xs text-slate-400">
                    {l.paidToClient ? 'paid the client directly' : 'into the trust account'}
                    {l.capturedAt ? ` · captured ${fmt(l.capturedAt)}` : ''}
                    {l.reversed && l.reversalReason ? ` · reversed: ${l.reversalReason}` : ''}
                    {l.needsRate && ' · no commission rate'}
                    {l.excessCredit > 0 && ` · ${rand(l.excessCredit)} held as a credit`}
                  </div>
                </td>
                <td className={clsx('px-4 py-2.5 text-right tabular-nums', l.reversed && 'line-through')}>{rand(l.amount)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{rand(l.receiptFee)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{rand(l.toInterest)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{rand(l.toCosts)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{rand(l.toCapital)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{rand(l.commission + l.commissionVat)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{rand(l.capitalAfter)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{rand(l.interestAfter)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{rand(l.costsAfter)}</td>
                <td className="px-4 py-2.5 text-xs">
                  {l.runId
                    ? (
                      <Link to={`/finance/runs/${l.runId}`} className="text-navy-700 hover:underline">
                        {l.runInvoice}
                        <span className="block text-slate-400">
                          {l.runStatus ? RUN_STATUS_LABEL[l.runStatus] : ''}
                        </span>
                      </Link>
                      )
                    : <span className="text-slate-400">not yet in a run</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-xs text-slate-400">
        Balances are carried forward from what the account opened owing. A reversed payment is shown
        because it happened and moves nothing.
      </p>
    </Card>
  )
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}
