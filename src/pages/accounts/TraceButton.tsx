import { useEffect, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { recordTrace, XDS_PORTAL_URL } from '../../lib/accountTrace'
import { scheduleFor } from '../../lib/annexureB'
import type { ChargeResult } from '../../lib/accountCharges'

/** Enough for a company and everyone who signed surety for it. */
const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/**
 * Trace a debtor: XDS opens on the click, and Raptor asks afterwards how many searches were run.
 *
 * Afterwards is the only moment the answer exists. An account can carry a company and three
 * sureties, and nobody knows before opening the portal how many of them they will end up looking
 * for — asking first would be asking someone to predict their own next ten minutes.
 *
 * So the click does the fast thing (open XDS) and nothing else; the charge waits for the count.
 * Closing without answering charges nothing, which is the right outcome for a portal opened by
 * mistake and for a search that turned out not to be needed.
 */
export function TraceButton({ accountId, actor, className, onDone }: {
  accountId: string
  actor: { id: string | null; name: string | null }
  /** The action row's styling, so this matches the buttons beside it. */
  className: string
  onDone: () => Promise<void>
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ charge: ChargeResult; count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  const rate = scheduleFor(new Date()).items.find((i) => i.id === '4c')?.amount ?? 0

  function open() {
    /*
     * Opened inside the click and before anything else. Safari only allows a new tab while it can
     * still see the tap that asked for one; open it after any await and the tab is silently
     * blocked, which looks exactly like a broken button.
     */
    window.open(XDS_PORTAL_URL, '_blank', 'noopener,noreferrer')
    setResult(null)
    setError(null)
    setAsking(true)
  }

  async function charge(count: number) {
    setBusy(true)
    setError(null)
    try {
      const c = await recordTrace({ accountId, actor, count })
      setResult({ charge: c, count })
      setAsking(false)
      await onDone()
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setResult(null), 10000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" onClick={open} title="Open XDS and record a credit bureau search — Annexure B item 4(c)" className={className}>
        <Search size={14} /> Trace
      </button>

      {result && (
        <span className={`text-[11px] ${result.charge.reason === 'charged' ? 'text-[var(--c-green)]' : 'text-slate-500'}`}>
          {result.charge.reason === 'charged'
            ? `XDS opened · ${result.count > 1 ? `${result.count} searches · ` : ''}charged R${result.charge.exclVat.toFixed(2)} + VAT`
            : result.charge.reason === 'written-off'
              ? 'Recorded · no charge (account written off)'
              : 'Recorded · no charge (fee ceiling)'}
        </span>
      )}

      {asking && (
        <Modal title="How many traces did you do?" onClose={() => setAsking(false)} width={460}>
          <p className="text-sm text-slate-500">
            XDS is open in a new tab. One account can carry a company and its sureties, so tell us how many
            searches you ran and they go on the statement as a single line.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            {COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => void charge(n)}
                disabled={busy}
                className="w-11 h-11 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 bg-white hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-50"
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            {rate > 0 && <>R{rate.toFixed(2)} plus VAT each, under Annexure B item 4(c). </>}
            Nothing is charged until you choose.
          </p>
          {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
          <div className="flex items-center justify-end gap-2 mt-5">
            {busy && <Loader2 size={15} className="animate-spin text-slate-400" />}
            <button onClick={() => setAsking(false)} disabled={busy} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
              Didn&apos;t trace
            </button>
          </div>
        </Modal>
      )}
    </span>
  )
}
