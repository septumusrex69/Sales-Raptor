import { useCallback, useEffect, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { fetchAccountPayments, type AccountPaymentRow } from '../../lib/paymentReverse'
import { reverseBlocked } from '../../lib/paymentSearch'
import { ReversePaymentModal } from '../finance/ReversePaymentModal'

/**
 * THE ACCOUNT'S OWN PAYMENTS, EACH WITH REVERSE (prompt 11).
 *
 * The account is where a collector or a liaison is standing when a debtor says "that payment isn't
 * mine", and it was the one place a payment could not be undone from. Every payment the account has
 * had, newest first, in the words the firm uses for it -- into trust or paid to the client, waiting
 * for approval, reversed, Swordfish history -- and the same Reverse box History opens.
 *
 * THE BUTTON IS THERE FOR WHOEVER HOLDS payment.reverse AND SAYS WHY WHEN IT CANNOT BE USED: a
 * Swordfish payment is history, an unapproved one is changed in the queue. A button that silently
 * is not there reads as a screen that is missing something.
 */
export function AccountPaymentsList({ accountId, mayReverse, onReversed }: {
  accountId: string
  mayReverse: boolean
  onReversed: () => Promise<void> | void
}) {
  const [rows, setRows] = useState<AccountPaymentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reversing, setReversing] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setRows(await fetchAccountPayments(accountId)); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'The payments could not be read.') }
  }, [accountId])
  useEffect(() => { void load() }, [load])

  if (error) return <p className="text-[13px] text-negative-700">{error}</p>
  if (!rows) return <div className="py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-400" /></div>
  if (rows.length === 0) return null

  return (
    <div className="mb-5" data-testid="account-payments">
      <h3 className="mb-2 text-[13px] font-semibold text-slate-700">Payments on this account</h3>
      <div className="overflow-x-auto">
        <table className="w-full list-table whitespace-nowrap">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="px-3 py-1.5 text-left font-medium">Received</th>
              <th className="px-2 py-1.5 text-right font-medium">Amount</th>
              <th className="px-2 py-1.5 text-left font-medium">How</th>
              <th className="px-2 py-1.5 text-left font-medium">Reference</th>
              <th className="px-2 py-1.5 text-left font-medium">Where it stands</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const blocked = reverseBlocked({ approved: p.approved, reversedOn: p.reversedOn, swordfish: p.swordfish })
              return (
                <tr key={p.id} className="border-b border-slate-50 last:border-0" data-testid="account-payment">
                  <td className="px-3 py-1.5 text-slate-600">{formatDate(p.receivedOn)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-800">{rand(p.amount)}</td>
                  <td className="px-2 py-1.5 text-slate-600">{p.paidToClient ? 'Paid to the client' : 'Into trust'}</td>
                  <td className="px-2 py-1.5 max-w-[14rem] truncate text-slate-500" title={p.reference ?? ''}>{p.reference ?? '—'}</td>
                  <td className="px-2 py-1.5 text-slate-500">
                    {p.reversedOn ? (
                      <span className="inline-flex items-center gap-1" title={p.reversalReason ?? ''}>
                        <RotateCcw size={11} /> Reversed {formatDate(p.reversedOn.slice(0, 10))}
                      </span>
                    ) : p.swordfish ? 'Swordfish history'
                      : p.approved ? 'Processed' : 'Waiting for approval'}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {mayReverse && (
                      <button type="button" disabled={!!blocked} onClick={() => setReversing(p.id)}
                        title={blocked ?? 'Reverse this payment'} data-testid="account-payment-reverse"
                        className="rounded-md border border-slate-200 px-2 py-0.5 text-[11.5px] font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">
                        Reverse
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {reversing && (
        <ReversePaymentModal paymentId={reversing} onClose={() => setReversing(null)}
          onDone={async () => { setReversing(null); await load(); await onReversed() }} />
      )}
    </div>
  )
}
