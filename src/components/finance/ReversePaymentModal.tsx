import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Loader2 } from 'lucide-react'
import { Modal, inputClass } from '../ui/Modal'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { reversePayment, reversePaymentToUnplaced } from '../../lib/payover'
import { fetchReverseTarget, reverseSwitchingSide, type ReverseTarget } from '../../lib/paymentReverse'
import { reverseBlocked } from '../../lib/paymentSearch'

/**
 * REVERSING ASKS WHY, AND THE ANSWER IS KEPT -- ONE BOX, OPENED FROM EVERY PLACE A PAYMENT IS FOUND.
 *
 * It lived inside Payment history and was reachable only from there, four steps deep (prompt 11:
 * the firm looked on Payover runs, on To process and on the account first). Now History's row, the
 * account's payments and a payover run's line all open THIS box, by the payment's id, so each path
 * does exactly what the others do.
 *
 * The reason becomes the cancellation reason on the receipt fee, so the account's own ledger says a
 * fee was raised and then cancelled because the cheque came back rather than the fee vanishing.
 * Everything else follows in the database.
 */
export function ReversePaymentModal({ paymentId, onClose, onDone }: {
  paymentId: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [row, setRow] = useState<ReverseTarget | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
   * WHERE IT GOES (the firm, 10 Oct): back to the approval queue on this debtor (the figures were
   * wrong -- or move it to the right debtor there), or back to Needs an account (the wrong
   * reference -- it is somebody else's money). AND, 11 Oct, captured on the wrong side: "from a PTC
   * to an ACB or an ACB to a PTC" -- back to the queue as the other kind.
   */
  const [to, setTo] = useState<'queue' | 'unplaced' | 'switch'>('queue')

  useEffect(() => {
    let live = true
    void fetchReverseTarget(paymentId).then((t) => { if (live) setRow(t) })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'That payment could not be read.') })
    return () => { live = false }
  }, [paymentId])

  const blocked = row ? reverseBlocked(row) : null
  /* ALREADY ON A RUN THAT WENT OUT: the invoice that carried it is not touched. */
  const invoiced = !!row?.runStatus && ['approved', 'sent', 'paid'].includes(row.runStatus)
  /* A receipt off the trust statement arrived in trust: it cannot be called paid to the client. */
  const mayBecomePtc = !!row && !row.paidToClient && !row.fromStatement
  const switchLabel = row?.paidToClient
    ? 'It was paid into trust, not to the client'
    : 'It was paid to the client directly (a PTC)'

  return (
    <Modal title="Reverse this payment" onClose={onClose} width={460}>
      {!row ? (
        error
          ? <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>
          : <div className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-400" /></div>
      ) : blocked ? (
        <div className="space-y-3">
          <p className="text-[13px] text-slate-600" data-testid="reverse-blocked">{blocked}</p>
          <div className="flex justify-end border-t border-slate-100 pt-3">
            <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Close</button>
          </div>
        </div>
      ) : (
      <div className="space-y-3" data-testid="reverse-modal">
        <p className="text-[13px] text-slate-600">
          {rand(row.amount)} received {formatDate(row.receivedOn)}
          {row.paidToClient ? ', paid to the client directly' : ', into trust'}. The receipt fee is
          cancelled, the capital goes back on the account, and every later payment is re-split
          against the balances this one moved.
        </p>
        <div className="space-y-2" data-testid="reverse-to">
          <div className="text-xs font-medium text-slate-600">Where does the money go?</div>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-700">
            <input type="radio" className="mt-1" checked={to === 'queue'} onChange={() => setTo('queue')} />
            <span>
              <span className="font-medium">Back to the approval queue</span>
              <span className="block text-xs text-slate-500">
                The figures were wrong, or it belongs on another of this debtor&rsquo;s files. It waits
                on Payments in as {rand(row.amount)} to be moved or approved again.
              </span>
            </span>
          </label>
          <label className={clsx('flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px]',
            row.fromStatement ? 'text-slate-700' : 'text-slate-400')}>
            <input type="radio" className="mt-1" disabled={!row.fromStatement} checked={to === 'unplaced'}
              onChange={() => setTo('unplaced')} data-testid="reverse-to-unplaced" />
            <span>
              <span className="font-medium">Back to Needs an account</span>
              <span className="block text-xs text-slate-500">
                {row.fromStatement
                  ? 'The wrong reference: it is somebody else’s money. The statement line goes back to be placed on the right debtor.'
                  : 'Only for a receipt off a bank statement. This one was recorded by hand: send it to the queue and reject it there.'}
              </span>
            </span>
          </label>
          <label className={clsx('flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px]',
            row.paidToClient || mayBecomePtc ? 'text-slate-700' : 'text-slate-400')}>
            <input type="radio" className="mt-1" disabled={!(row.paidToClient || mayBecomePtc)} checked={to === 'switch'}
              onChange={() => setTo('switch')} data-testid="reverse-switch-side" />
            <span>
              <span className="font-medium">{switchLabel}</span>
              <span className="block text-xs text-slate-500">
                {row.paidToClient || mayBecomePtc
                  ? `Captured on the wrong side. It goes back to the approval queue as ${row.paidToClient ? 'a payment into trust' : 'a payment to the client'} and is split afresh when approved.`
                  : 'This one is on the trust bank statement, so the money came to us: it cannot be made a payment to the client.'}
              </span>
            </span>
          </label>
        </div>
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-[13px] text-slate-700">
          Until it is approved or placed again, the Trust overview shows it under
          {to === 'unplaced' ? ' Unallocated receipts' : ' Waiting for approval'}. This reversal stays on
          the ledger with your reason on it.
        </p>
        {invoiced && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900" data-testid="reverse-invoiced">
            This payment is on {row.runInvoice}, which is {row.runStatus}. That run is not changed: what
            the client was paid from this payment comes off their next payover as a negative line,
            and Bredell Ferreira&rsquo;s fees on it are taken back.
          </p>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="reverse-reason">Why</label>
          <input id="reverse-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}
            placeholder="Cheque returned, debit order unpaid, captured twice…" />
        </div>
        {error && <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          {/*
            THROUGH THE FUNCTION, NOT AT THE TABLE. account_payments is one of the four ledgers with
            no update policy: a direct PATCH matches no rows, PostgREST answers 204, and the box
            would close on a reversal that never happened.
          */}
          <button type="button" disabled={busy || !reason.trim()}
            onClick={() => {
              setBusy(true); setError(null)
              const why = reason.trim()
              void (to === 'unplaced' ? reversePaymentToUnplaced(row.paymentId, why)
                : to === 'switch' ? reverseSwitchingSide(row.paymentId, why, !row.paidToClient)
                  : reversePayment(row.paymentId, why))
                .then(async () => { await onDone(); setBusy(false) })
                .catch((e: unknown) => {
                  setError(e instanceof Error ? e.message : 'That payment could not be reversed.')
                  setBusy(false)
                })
            }}
            className="rounded-lg bg-negative-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-negative-700 disabled:opacity-50">
            {busy ? 'Reversing…' : 'Reverse it'}
          </button>
        </div>
      </div>
      )}
    </Modal>
  )
}
