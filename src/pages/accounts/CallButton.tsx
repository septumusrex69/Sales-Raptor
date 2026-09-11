import { useState } from 'react'
import { Loader2, Phone } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { PhoneLink } from '../../components/PhoneLink'
import { recordConsultation, recordDial, recordNoAnswer } from '../../lib/accountCalls'
import { scheduleFor } from '../../lib/annexureB'
import type { ChargeResult } from '../../lib/accountCharges'

/**
 * Call a debtor, and put the call on the account.
 *
 * Two things the firm found missing: dialling left no trace on the timeline at all, and an
 * answered call raised no fee. Both are handled here rather than inside PhoneLink, which logs
 * CRM Activities against leads and contacts and should not learn about Annexure B.
 *
 * The dial is recorded immediately and charged for nothing -- placing a call is not yet work
 * done to the debtor, and the phone may ring out. Then it asks. Asking is the honest mechanism:
 * BuzzBox can call us back about a call (`CallSetup.webhookUrl`), but the payload is undocumented,
 * so today nothing on our side can tell a conversation from a ringing phone. The same shape as
 * the trace count, which asks the one question only the person who just did the work can answer.
 */
export function CallButton({ accountId, number, actor, className, onDone }: {
  accountId: string
  number: string
  actor: { id: string | null; name: string | null }
  /** The action row's styling, so this matches the buttons beside it. */
  className: string
  onDone: () => Promise<void>
}) {
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ChargeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rate = scheduleFor(new Date()).items.find((i) => i.id === '7')?.amount ?? 0

  async function dialled(call: { from: string; to: string }) {
    setResult(null)
    setError(null)
    // The dial goes on the timeline whatever happens next, including if the collector closes
    // this without answering. A call that was made is a fact; whether it connected is a question.
    try {
      await recordDial({ accountId, number: call.to, extension: call.from || null, actor })
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setAsking(call.to)
  }

  async function answered(yes: boolean) {
    if (!asking) return
    setBusy(true)
    setError(null)
    try {
      if (yes) setResult(await recordConsultation({ accountId, number: asking, actor }))
      else await recordNoAnswer({ accountId, number: asking, actor })
      setAsking(null)
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <PhoneLink number={number} className={className} iconSize={14} onDialled={(c) => void dialled(c)}>
        <Phone size={14} /> Call
      </PhoneLink>

      {result && (
        <span className={`text-[11px] ${result.reason === 'charged' ? 'text-[var(--c-green)]' : 'text-slate-500'}`}>
          {result.reason === 'charged'
            ? `Consultation charged R${result.exclVat.toFixed(2)} + VAT`
            : result.reason === 'written-off'
              ? 'Recorded · no charge (account written off)'
              : 'Recorded · no charge (fee ceiling)'}
        </span>
      )}

      {asking && (
        <Modal title="Did they answer?" onClose={() => setAsking(null)} width={440}>
          <p className="text-sm text-slate-500">
            The call to <span className="font-medium text-slate-700">{asking}</span> is on the
            timeline either way. A call the debtor answers is a consultation and goes on their
            statement; a phone that rings out does not.
          </p>
          {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
          <p className="text-xs text-slate-400 mt-3">
            {rate > 0 && <>R{rate.toFixed(2)} plus VAT, under Annexure B item 7. </>}
            Nothing is charged until you choose.
          </p>
          <div className="flex items-center justify-end gap-2 mt-5">
            {busy && <Loader2 size={15} className="animate-spin text-slate-400" />}
            <button onClick={() => void answered(false)} disabled={busy}
              className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
              No answer
            </button>
            <button onClick={() => void answered(true)} disabled={busy}
              className="text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 disabled:opacity-50">
              They answered
            </button>
          </div>
        </Modal>
      )}
    </span>
  )
}
