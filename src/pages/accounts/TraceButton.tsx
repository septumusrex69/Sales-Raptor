import { useEffect, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { recordTrace, XDS_PORTAL_URL } from '../../lib/accountTrace'
import type { ChargeResult } from '../../lib/accountCharges'

/**
 * Trace a debtor: one click here, then the login on the XDS side.
 *
 * This asked "are you sure?" first, because the charge is raised when the portal OPENS rather
 * than when a result comes back — XDS never tells us what happened inside it. The firm's answer
 * was that a collector tracing all day does not need to confirm a R16 fee they meant to raise,
 * and they are right that a dialog on every trace is a tax on the common case.
 *
 * So the safeguard moved rather than disappearing: the outcome is shown, in words, next to the
 * button that caused it. A mis-tap is a fee you can see and a note on the timeline you can read,
 * which is a better safety net than a dialog people learn to dismiss without reading.
 */
export function TraceButton({ accountId, actor, className, onDone }: {
  accountId: string
  actor: { id: string | null; name: string | null }
  /** The action row's styling, so this matches the buttons beside it. */
  className: string
  onDone: () => Promise<void>
}) {
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; charge: ChargeResult } | { kind: 'error'; message: string }
  >({ kind: 'idle' })
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  async function go() {
    if (state.kind === 'working') return
    /*
     * Opened FIRST, inside the click, and never after the await. Safari only allows a new tab
     * while it can still see the tap that asked for one; open it after a round trip to Postgres
     * and the tab is silently blocked, which looks exactly like a broken button.
     */
    window.open(XDS_PORTAL_URL, '_blank', 'noopener,noreferrer')
    setState({ kind: 'working' })
    try {
      const charge = await recordTrace({ accountId, actor })
      setState({ kind: 'done', charge })
      await onDone()
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setState({ kind: 'idle' }), 8000)
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={() => void go()}
        disabled={state.kind === 'working'}
        title="Open XDS and record a credit bureau search on this account — Annexure B item 4(c)"
        className={`${className} disabled:opacity-60`}
      >
        {state.kind === 'working' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Trace
      </button>
      {state.kind === 'done' && (
        <span className="text-[11px] text-[var(--c-green)]">
          {state.charge.reason === 'charged'
            ? `XDS opened · charged R${state.charge.exclVat.toFixed(2)} + VAT`
            : 'XDS opened · recorded, no charge (fee ceiling)'}
        </span>
      )}
      {state.kind === 'error' && <span className="text-[11px] text-red-600">{state.message}</span>}
    </span>
  )
}
