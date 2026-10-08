import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import { fetchPaymentsToMake } from '../../lib/bankAllocationApi'
import { totalToPay, type PaymentToMake } from '../../lib/paymentsOut'
import { shortDate } from '../../lib/trustCycles'

/**
 * PAYMENTS TO MAKE OUT OF TRUST.
 *
 * THE FIRM, 8 Oct: "if it's refunded to the debtor ... it should go to a place for payments that we
 * have to make ... there should be an outgoing due" -- and each one paid "with a client unique
 * reference", or for a refund "with the debtor's reference number".
 *
 * ONE LIST: every approved payover run and every decided refund, until the bank statement shows
 * the money went. NOTHING IS PAID FROM HERE -- paying happens at the bank -- and nothing is ticked
 * off by hand here either: a payment leaves this list when its debit on the trust statement is
 * allocated to it (Trust -> Exceptions), which is the only evidence that it actually went. Raptor
 * suggests that match from the reference on the statement line, so paying with the reference shown
 * is what makes the reconciliation do itself.
 */
export function TrustPaymentsOut() {
  const [rows, setRows] = useState<PaymentToMake[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchPaymentsToMake()
      .then((r) => { if (live) setRows(r) })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])

  async function copy(ref: string) {
    try {
      await navigator.clipboard.writeText(ref)
      setCopied(ref)
      setTimeout(() => setCopied((c) => (c === ref ? null : c)), 1500)
    } catch { /* the reference is on screen to type; copying is a convenience */ }
  }

  if (error) {
    return (
      <Card className="p-5 text-sm text-negative-700 bg-negative-50 border-negative-100">
        The payments to make could not be read: {error}
      </Card>
    )
  }
  if (rows === null) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-10">
        <Loader2 size={16} className="animate-spin" /> Reading what is still to be paid…
      </div>
    )
  }

  const runs = rows.filter((r) => r.kind === 'payover')
  const refunds = rows.filter((r) => r.kind === 'refund')

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Payments to make</h1>
        <span className="text-xs text-slate-400">Out of the trust account, each with the reference to pay it on</span>
      </div>

      <Card className="px-6 py-5" >
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2" data-testid="to-pay-total">
          <div>
            <div className="text-[12px] text-slate-500">Still to pay</div>
            <div className="text-2xl font-semibold tabular-nums text-slate-800">{rand(totalToPay(rows))}</div>
          </div>
          <div className="text-[13px] text-slate-500">
            {runs.length} {runs.length === 1 ? 'payover' : 'payovers'} · {refunds.length} {refunds.length === 1 ? 'refund' : 'refunds'}
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-slate-500">
          Pay each one at the bank <strong className="font-medium text-slate-700">with the reference shown</strong>. When it
          appears on the trust statement, import the statement and allocate the line under Exceptions —
          Raptor suggests the match from the reference, and the payment leaves this list.
        </p>
      </Card>

      {rows.length === 0 ? (
        <Card className="p-6 text-sm text-slate-500 text-center">
          Nothing is waiting to be paid. Approved payover runs and decided refunds appear here until the bank statement shows they went.
        </Card>
      ) : (
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                <th className="text-left px-5 py-3">Pay to</th>
                <th className="text-left px-3 py-3">What</th>
                <th className="text-left px-3 py-3">Reference</th>
                <th className="text-left px-3 py-3">When</th>
                <th className="text-right px-5 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={`${p.kind}-${p.id}`} className="border-b border-slate-100 last:border-b-0 align-top" data-testid="payment-to-make">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">{p.payee}</div>
                    {p.detail && <div className="mt-0.5 text-[12px] text-slate-500 whitespace-pre-line">{p.kind === 'payover' ? p.detail : `Why: ${p.detail}`}</div>}
                    {p.kind === 'payover' && !p.detail && <div className="mt-0.5 text-[12px] text-amber-700">No banking details on the client</div>}
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {p.kind === 'payover' ? (
                      <Link to={`/trust/runs/${p.id}`} className="text-gold-700 hover:text-gold-800">
                        Payover {p.caseNumber ?? ''}
                      </Link>
                    ) : (
                      <Link to={`/accounts/${p.accountId}`} className="text-gold-700 hover:text-gold-800">
                        Refund · {p.caseNumber ?? 'the debtor'}
                      </Link>
                    )}
                    <div className="text-[12px] text-slate-400">
                      {p.kind === 'payover' ? (p.status === 'sent' ? 'Advice sent' : 'Approved') : 'Overpayment refunded'}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {p.reference ? (
                      <button type="button" onClick={() => copy(p.reference!)}
                        title="Copy the reference"
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 font-mono text-[12.5px] text-slate-800 hover:bg-slate-50">
                        {p.reference}
                        {copied === p.reference ? <Check size={13} className="text-positive-700" /> : <Copy size={13} className="text-slate-400" />}
                      </button>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
                    {p.dueOn ? `Due ${shortDate(p.dueOn)}` : 'As soon as paid'}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-800 whitespace-nowrap">{rand(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
