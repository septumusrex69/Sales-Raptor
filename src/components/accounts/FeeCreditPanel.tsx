import { useMemo, useState } from 'react'
import { Loader2, ReceiptText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatMoney } from '../../data/mockData'
import { inputClass } from '../ui/Modal'
import type { LedgerFee } from '../../lib/accountBook'

/**
 * CREDIT NOTES ON FEES (S10, prompt 13 item 8). Administrator only.
 *
 * THE FIRM: "No deleting fees. Use a credit note. For an Annexure B fee raised in error: a credit note
 * against the account with a required reason, logged with who and when, shown on the statement ...
 * The same credit note is how a discount on fees is given: credit one or more specific fees, in full
 * or in part (up to what is left of that fee). It never credits capital or interest."
 *
 * So the list here is FEES and nothing else -- capital and interest are not offered, because they
 * are not things this can credit. Each fee shows what is left of it after earlier credits; the box
 * defaults to all of it and can be lowered for a discount. ONE reason for the press, because a
 * discount on five fees is one decision. The database decides the rest (credit_fee): Administrator,
 * reason, never more than is still OWING on the fee -- what the debtor already paid towards it is a
 * reversal, not a credit -- and a receipt fee is refused. Its refusal is shown as it says it.
 */
export function FeeCreditPanel({ fees, onDone }: { fees: LedgerFee[]; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  /* Each fee with what earlier credit notes left of it. Credit notes, receipt fees on a payment,
     cancelled and unbilled rows are not offered: there is nothing of them to credit. */
  const creditable = useMemo(() => {
    const credited = new Map<string, number>()
    for (const f of fees) {
      if (f.creditsFeeId) credited.set(f.creditsFeeId, (credited.get(f.creditsFeeId) ?? 0) + f.amountExclVat + f.vatAmount)
    }
    return fees
      .filter((f) => !f.creditsFeeId && !f.cancelledAt && f.billed && !(f.annexureItem === '9' && f.paymentId))
      .map((f) => ({ fee: f, left: Math.round((f.amountExclVat + f.vatAmount + (credited.get(f.id) ?? 0)) * 100) / 100 }))
      .filter((x) => x.left > 0)
  }, [fees])
  const notes = fees.filter((f) => f.creditsFeeId)

  async function credit() {
    const chosen = Object.entries(picked).filter(([, v]) => Number(v) > 0)
    if (chosen.length === 0) { setError('Tick at least one fee.'); return }
    if (!reason.trim()) { setError('Say why — it is kept with the credit note.'); return }
    setBusy(true); setError(null); setDone(null)
    let n = 0
    try {
      for (const [feeId, amount] of chosen) {
        const { error: e } = await supabase.rpc('credit_fee', { p_fee: feeId, p_amount: Number(amount), p_reason: reason.trim() })
        if (e) throw new Error(e.message)
        n += 1
      }
      setDone(`${n} credit note${n === 1 ? '' : 's'} raised.`)
      setPicked({}); setReason(''); setOpen(false)
      onDone()
    } catch (e) {
      setError(`${n > 0 ? `${n} credited, then: ` : ''}${e instanceof Error ? e.message : String(e)}`)
      if (n > 0) onDone()
    } finally { setBusy(false) }
  }

  return (
    <div className="mb-4" data-testid="fee-credit-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">Credit notes</p>
        {!open && creditable.length > 0 && (
          <button type="button" onClick={() => setOpen(true)} data-testid="credit-fees"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50">
            <ReceiptText size={13} /> Credit fees
          </button>
        )}
      </div>
      {done && <p className="mt-1 text-sm text-positive-700" role="status">{done}</p>}

      {notes.length > 0 && (
        <ul className="mt-1.5 space-y-1 text-[12.5px] text-slate-600">
          {notes.map((n) => (
            <li key={n.id}>
              <span className="tabular-nums font-medium">{formatMoney(-(n.amountExclVat + n.vatAmount))}</span>
              {' '}{n.description} &middot; {n.creditedByName ?? 'Administrator'}, {n.incurredAt.slice(0, 10)}
              {n.creditReason && <span className="text-slate-400"> &middot; {n.creditReason}</span>}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-[12px] text-slate-500 mb-2">
            Fees only — never capital or interest. Each fee stays on the statement with the credit beside it.
          </p>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 bg-white rounded-md border border-slate-100">
            {creditable.map(({ fee, left }) => {
              const on = picked[fee.id] !== undefined
              return (
                <label key={fee.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px]">
                  <input type="checkbox" checked={on}
                    onChange={(e) => setPicked((p) => {
                      const next = { ...p }
                      if (e.target.checked) next[fee.id] = left.toFixed(2); else delete next[fee.id]
                      return next
                    })} />
                  <span className="text-slate-400 tabular-nums w-20 shrink-0">{fee.incurredAt.slice(0, 10)}</span>
                  <span className="flex-1 min-w-0 truncate text-slate-700">{fee.description}</span>
                  <span className="text-slate-400 tabular-nums">{formatMoney(left)} left</span>
                  {on && (
                    <input className="w-24 rounded border border-slate-200 px-1.5 py-0.5 text-right tabular-nums"
                      aria-label={`Credit on ${fee.description}`} value={picked[fee.id]}
                      onChange={(e) => setPicked((p) => ({ ...p, [fee.id]: e.target.value }))} />
                  )}
                </label>
              )
            })}
          </div>
          <label className="block mt-2 text-xs font-medium text-slate-600" htmlFor="fee-credit-reason">Why? Required</label>
          <input id="fee-credit-reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Raised in error — the SMS went twice" />
          {error && <p className="mt-2 text-sm text-negative-700" role="alert">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void credit()} disabled={busy}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 disabled:opacity-50">
              {busy && <Loader2 size={13} className="animate-spin" />} Raise credit note
            </button>
            <button type="button" onClick={() => { setOpen(false); setError(null) }} disabled={busy}
              className="text-sm px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
