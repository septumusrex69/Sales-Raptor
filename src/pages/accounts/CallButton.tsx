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
export function CallButton({ accountId, numbers, actor, className, onDone }: {
  accountId: string
  /**
   * Every number that could reach this debtor, primary first. More than one and the button asks
   * which; exactly one and it just rings it.
   */
  numbers: { label: string; value: string }[]
  actor: { id: string | null; name: string | null }
  /** The action row's styling, so this matches the buttons beside it. */
  className: string
  onDone: () => Promise<void>
}) {
  const [choosing, setChoosing] = useState(false)
  const [asking, setAsking] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ChargeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const schedule = scheduleFor(new Date())
  const consultationRate = schedule.items.find((i) => i.id === '7')?.amount ?? 0
  const callRate = schedule.items.find((i) => i.id === '2')?.amount ?? 0

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
    setComment('')
    setChoosing(false)
    setAsking(call.to)
  }

  async function answered(yes: boolean) {
    if (!asking) return
    setBusy(true)
    setError(null)
    try {
      setResult(yes
        ? await recordConsultation({ accountId, number: asking, comment, actor })
        : await recordNoAnswer({ accountId, number: asking, comment, actor }))
      setAsking(null)
      setComment('')
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      {/*
        One number rings straight away; several ask first.

        A debtor is rarely one number, and the button was dialling the primary with no way to
        reach the others -- the firm's words, "it doesn't give me an option about who to call".
        The chooser is a list of PhoneLinks rather than a picker plus a dial call of its own, so
        every number goes out through exactly the same path, tel: fallback and all.
      */}
      {numbers.length <= 1 ? (
        <PhoneLink number={numbers[0]?.value ?? ''} className={className} iconSize={14}
          onDialled={(c) => void dialled(c)}>
          <Phone size={14} /> Call
        </PhoneLink>
      ) : (
        <button type="button" onClick={() => setChoosing(true)} className={className}
          title={`Ring this debtor — ${numbers.length} numbers on file`}>
          <Phone size={14} /> Call
        </button>
      )}

      {result && (
        <span className={`text-[11px] ${result.reason === 'charged' ? 'text-[var(--c-green)]' : 'text-slate-500'}`}>
          {result.reason === 'charged'
            ? `Charged R${result.exclVat.toFixed(2)} + VAT`
            : result.reason === 'written-off'
              ? 'Recorded · no charge (account written off)'
              : 'Recorded · no charge (fee ceiling)'}
        </span>
      )}

      {choosing && (
        <Modal title="Which number?" onClose={() => setChoosing(false)} width={440}>
          <p className="text-sm text-slate-500">
            The primary is first. A number that has been retired is not offered at all.
          </p>
          <div className="mt-4 space-y-1.5">
            {numbers.map((n) => (
              <PhoneLink key={n.value} number={n.value} iconSize={14} onDialled={(c) => void dialled(c)}
                className="w-full text-left text-sm px-3 py-2 rounded-lg border border-slate-200 hover:border-[#c9a052] hover:bg-gold-50">
                <Phone size={14} className="inline mr-2 text-slate-400" />
                <span className="font-medium text-slate-700">{n.value}</span>
                <span className="text-slate-400"> &mdash; {n.label}</span>
              </PhoneLink>
            ))}
          </div>
        </Modal>
      )}

      {asking && (
        <Modal title="Did they answer?" onClose={() => setAsking(null)} width={440}>
          <p className="text-sm text-slate-500">
            The call to <span className="font-medium text-slate-700">{asking}</span> is on the
            timeline either way. Either answer charges the debtor &mdash; a call they answered is
            a consultation, a call that rang out is a phone call. They are different items and
            never both.
          </p>
          {/*
            The one moment the answer exists, so it is also the moment to ask what was said.
            A call Raptor recorded by itself is bookkeeping and hides under "just what people
            wrote"; a call with a collector's words on it is the story, and stays.
          */}
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="What was said? Optional — leave it blank and only the call is recorded."
            className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 mt-3 resize-none focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
          <p className="text-xs text-slate-400 mt-3">
            {consultationRate > 0 && callRate > 0 && (
              <>Answered R{consultationRate.toFixed(2)} (item 7), no answer R{callRate.toFixed(2)}
                {' '}(item 2), both plus VAT. </>
            )}
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
