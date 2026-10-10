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
        <table className="w-full text-[12.5px] whitespace-nowrap">
          <thead>
            <tr className="border-b border-slate-100 text-left text-slate-400">
              <th className="px-3 py-1.5 font-medium">Payment</th>
              <th className="px-2 py-1.5 font-medium text-right">Gross</th>
              <th className="px-2 py-1.5 font-medium text-right">Receipt fee</th>
              <th className="px-2 py-1.5 font-medium text-right">Interest</th>
              <th className="px-2 py-1.5 font-medium text-right">Costs</th>
              <th className="px-2 py-1.5 font-medium text-right">Capital</th>
              <th className="px-2 py-1.5 font-medium text-right">Commission</th>
              <th className="px-2 py-1.5 font-medium text-right">Capital left</th>
              <th className="px-2 py-1.5 font-medium text-right">Interest left</th>
              <th className="px-2 py-1.5 font-medium text-right">Costs left</th>
              <th className="px-3 py-1.5 font-medium">Paid over in</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.paymentId}
                className={clsx('border-b border-slate-50 hover:bg-slate-50', l.reversed && 'text-slate-400')}>
                {/* ONE LINE A PAYMENT, the checking list's shape (the firm: "thin, sleek, easy to
                    read"). What used to sit under the date follows it after a dot, truncated, with
                    the whole of it on the title. */}
                <td className="px-3 py-1.5 max-w-[22rem] truncate" title={aboutPayment(l)}>
                  <span className={clsx('font-medium', l.reversed && 'line-through')}>
                    {l.receivedAt ? fmt(l.receivedAt) : '—'}
                  </span>
                  <span className="text-slate-400"> · {aboutPayment(l)}</span>
                </td>
                <td className={clsx('px-2 py-1.5 text-right tabular-nums', l.reversed && 'line-through')}>{rand(l.amount)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rand(l.receiptFee)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rand(l.toInterest)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rand(l.toCosts)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rand(l.toCapital)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rand(l.commission + l.commissionVat)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium">{rand(l.capitalAfter)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{rand(l.interestAfter)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{rand(l.costsAfter)}</td>
                <td className="px-3 py-1.5">
                  {l.runId
                    ? (
                      <Link to={`/trust/runs/${l.runId}`} className="text-navy-700 hover:underline">
                        {l.runInvoice}
                        {l.runStatus && <span className="text-slate-400"> · {RUN_STATUS_LABEL[l.runStatus]}</span>}
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

/** What used to be the payment's second line: where the money went and anything odd about it. */
function aboutPayment(l: LedgerLine): string {
  return [
    l.paidToClient ? 'paid the client directly' : 'into the trust account',
    l.capturedAt ? `captured ${fmt(l.capturedAt)}` : null,
    l.reversed && l.reversalReason ? `reversed: ${l.reversalReason}` : null,
    l.needsRate ? 'no commission rate' : null,
    l.excessCredit > 0 ? (l.paidToClient
      ? `${rand(l.excessCredit)} overpaid to the client, theirs to sort out`
      : `${rand(l.excessCredit)} held as a credit`) : null,
  ].filter(Boolean).join(' · ')
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}
