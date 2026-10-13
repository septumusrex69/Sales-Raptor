import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { rand } from '../../lib/money'
import { fetchBouncedCandidates, returnBouncedReceipt, type BouncedCandidate } from '../../lib/bankAllocationApi'

/**
 * WHICH RECEIPT CAME BACK UNPAID (prompt 12). A returned debit order or bounced cheque is a debtor's
 * receipt that was never money. This offers the receipts of exactly the debit's amount, received on
 * or before it, the one whose account number the bank quotes first -- "Looks like the 15 Aug R1 000
 * from SBB/2003 bounced" -- and a person confirms. Never paired silently: the suggestion is a sentence
 * and a button, not something that has already happened.
 */
export function ReturnedReceiptPicker({ lineId, onDone, compact = false }: { lineId: string; onDone: () => void; compact?: boolean }) {
  const [list, setList] = useState<BouncedCandidate[] | null>(null)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchBouncedCandidates(lineId)
      .then((c) => { if (live) { setList(c); if (c[0]?.named) setPicked(c[0].paymentId) } })
      .catch((e: unknown) => { if (live) { setList([]); setError(e instanceof Error ? e.message : String(e)) } })
    return () => { live = false }
  }, [lineId])

  async function go() {
    if (!picked) return
    setBusy(true); setError(null)
    try { await returnBouncedReceipt(lineId, picked); onDone() } catch (e) {
      setError(e instanceof Error ? e.message : 'That receipt could not be returned.')
    } finally { setBusy(false) }
  }

  if (list === null) return <Loader2 size={13} className="animate-spin text-slate-400" />
  if (list.length === 0) {
    return <span className="text-[12px] text-slate-500" data-testid="no-bounced-candidate">{error ?? 'No receipt of exactly this amount in the 60 days before it.'}</span>
  }
  const best = list[0].named ? list[0] : null
  const label = (c: BouncedCandidate) => `${day(c.receivedOn)} ${rand(c.amount)} from ${c.accountNumber}${c.debtor ? ` (${c.debtor})` : ''}`
  return (
    <span className={compact ? 'inline-flex flex-wrap items-center justify-end gap-2' : 'flex flex-wrap items-center gap-2'} data-testid="returned-receipt-picker">
      {best && picked === best.paymentId ? (
        <span className="text-[12.5px] text-amber-800" data-testid="bounced-suggestion">
          Looks like the {label(best)} bounced
        </span>
      ) : (
        <select aria-label="Which receipt came back" value={picked} onChange={(e) => setPicked(e.target.value)}
          className="text-[12.5px] rounded-lg border border-slate-200 px-2 py-1 bg-white">
          <option value="">Which receipt came back…</option>
          {list.map((c) => <option key={c.paymentId} value={c.paymentId}>{label(c)}</option>)}
        </select>
      )}
      <button type="button" disabled={!picked || busy} onClick={() => void go()} data-testid="confirm-returned"
        className="inline-flex items-center gap-1.5 rounded-md bg-navy-950 px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Confirm, it came back unpaid
      </button>
      {best && picked === best.paymentId && list.length > 1 && (
        <button type="button" onClick={() => setPicked('')} className="text-[12px] text-slate-500 underline">A different one</button>
      )}
      {error && <span className="text-[12px] text-negative-700">{error}</span>}
    </span>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function day(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}
