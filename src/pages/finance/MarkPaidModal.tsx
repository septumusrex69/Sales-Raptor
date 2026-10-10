import { useState } from 'react'
import { Modal, inputClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { paymentReference } from '../../lib/paymentsOut'

export interface PayableRun {
  id: string
  client: string
  invoiceNumber: string | null
  amount: number
}

/**
 * 'MARK PAID' ASKS FOR THE EFT REFERENCE AND THE DATE -- the firm's own instruction. The reference
 * is what reconciles the payover to the bank statement, so it is required, and it starts as the
 * one the run should have gone out on (BF PO-...), still editable because the bank's wins.
 *
 * ONE RUN OR SEVERAL (the firm, 10 Oct: "you should be able to mark it as paid from here. Even ...
 * in bulk by selecting all"). Several share the date -- they go out in one sitting -- and each keeps
 * its own reference, because every client is paid on their own.
 */
export function MarkPaidModal({ runs, onClose, onSave }: {
  runs: PayableRun[]
  onClose: () => void
  onSave: (refs: Record<string, string>, date: string) => Promise<void>
}) {
  const [refs, setRefs] = useState<Record<string, string>>(
    () => Object.fromEntries(runs.map((r) => [r.id, paymentReference(r.invoiceNumber) ?? ''])))
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const one = runs.length === 1
  const ready = runs.every((r) => (refs[r.id] ?? '').trim())
  const total = runs.reduce((s, r) => s + r.amount, 0)
  return (
    <Modal title={one ? 'Mark this payover paid' : `Mark ${runs.length} payovers paid`} onClose={onClose} width={one ? 420 : 560}>
      <div className="space-y-3">
        {one ? (
          <div>
            <p className="mb-2 text-[13px] text-slate-600">{runs[0].client} &middot; {rand(runs[0].amount)}</p>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="eft-ref">EFT reference</label>
            <input id="eft-ref" value={refs[runs[0].id] ?? ''} onChange={(e) => setRefs({ [runs[0].id]: e.target.value })}
              className={inputClass} placeholder="As it appears on the bank statement" />
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-100">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="px-3 py-1.5 font-medium">Client</th>
                  <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                  <th className="px-3 py-1.5 font-medium">EFT reference</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-slate-50">
                    <td className="px-3 py-1 text-slate-800 max-w-[12rem] truncate" title={r.client}>{r.client}</td>
                    <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{rand(r.amount)}</td>
                    <td className="px-3 py-1">
                      <input aria-label={`EFT reference for ${r.client}`} value={refs[r.id] ?? ''}
                        onChange={(e) => setRefs((p) => ({ ...p, [r.id]: e.target.value }))}
                        className="w-full rounded-md border border-slate-200 px-2 py-1 font-mono text-[12px]" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 text-slate-600">
                  <td className="px-3 py-1.5 font-medium">Total</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{rand(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="eft-date">Payment date</label>
          <input id="eft-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={() => { setBusy(true); void onSave(refs, date).finally(() => setBusy(false)) }}
            className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            {one ? 'Mark paid' : `Mark ${runs.length} paid`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
