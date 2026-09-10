import { useState } from 'react'
import { Search, ExternalLink } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { recordTrace, XDS_PORTAL_URL } from '../../lib/accountTrace'
import { scheduleFor } from '../../lib/annexureB'
import type { ChargeResult } from '../../lib/accountCharges'

/**
 * Trace a debtor through XDS.
 *
 * It asks first rather than firing on the click, for one reason: this charges the debtor. The
 * portal cannot tell us whether a search was actually run, so opening it IS the billable event as
 * far as Raptor can see, and a fee raised by a stray tap on an iPad is a fee somebody has to
 * explain later. One sentence and a button is a cheap way never to have that conversation.
 */
export function TraceModal({ accountId, actor, onClose, onDone }: {
  accountId: string
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ChargeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fee = scheduleFor(new Date()).items.find((i) => i.id === '4c')?.amount ?? null

  async function go() {
    setBusy(true)
    setError(null)
    /*
     * Opened FIRST, inside the click, and never after the await. Safari only allows a new tab
     * while it can still see the tap that asked for one; open it after a round trip to Postgres
     * and the tab is silently blocked, which looks exactly like a broken button.
     */
    window.open(XDS_PORTAL_URL, '_blank', 'noopener,noreferrer')
    try {
      const charge = await recordTrace({ accountId, actor })
      setResult(charge)
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Trace this debtor" onClose={onClose} width={520}>
      {result ? (
        <div>
          <p className="text-sm text-slate-700">
            XDS is open in a new tab, and the trace is on the account&apos;s timeline.
          </p>
          <p className="text-sm text-slate-500 mt-2">
            {result.reason === 'charged'
              ? `Charged R${result.exclVat.toFixed(2)} plus VAT under Annexure B item 4(c).`
              : result.reason === 'monthly-limit'
                ? 'Not charged — four bureau searches have already been charged on this account this month. The trace is still recorded, and the allowance resets next month.'
                : 'Not charged — the account is at the Annexure B fee ceiling. The trace is still recorded.'}
          </p>
          <div className="flex justify-end mt-5">
            <button onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900">
              Done
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm text-slate-700">
            This opens the XDS portal in a new tab and records a credit bureau search on this account.
          </p>
          <p className="text-sm text-slate-500 mt-2">
            A search is Annexure B item 4(c){fee !== null && <> — <span className="font-medium text-slate-700">R{fee.toFixed(2)} plus VAT</span></>}.
            Past the fee ceiling the trace is still recorded but earns nothing.
          </p>
          <p className="text-xs text-slate-400 mt-3">
            XDS cannot be handed a debtor, so you will need to search for them once it opens.
          </p>
          {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100">
              Cancel
            </button>
            <button
              onClick={() => void go()}
              disabled={busy}
              className="inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50"
            >
              <Search size={14} />
              {busy ? 'Recording…' : 'Open XDS and charge'}
              {!busy && <ExternalLink size={13} />}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
