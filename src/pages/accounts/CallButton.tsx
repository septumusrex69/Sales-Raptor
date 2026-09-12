import { useEffect, useRef, useState } from 'react'
import { Loader2, Phone } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { PhoneLink } from '../../components/PhoneLink'
import { callOutcome, recordConsultation, recordDial, recordNoAnswer } from '../../lib/accountCalls'
import { scheduleFor } from '../../lib/annexureB'
import type { ChargeResult } from '../../lib/accountCharges'

/**
 * Call a debtor, and put the call on the account.
 *
 * The dial charges Annexure B item 2 straight away -- the firm's rule, every outgoing call is
 * charged whether or not anybody picks up -- and writes the call to the timeline.
 *
 * What happens next depends on whether BuzzBox can see the call. When it can, it tells us: its
 * webhook reports the two legs bridging, and the consultation is raised server-side without
 * anyone being asked anything. This component only watches for that and says what happened.
 *
 * When it cannot -- no BuzzBox connected, or no extension set, so PhoneLink fell back to a tel:
 * link and the call went out through the device's own dialler -- nothing will ever report back,
 * and the collector is asked. That is not a fallback for the webhook being slow; it is the only
 * thing that can work when the PABX was never involved.
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
  /** Set only where nothing can report back — see the note about tel: above. */
  const [asking, setAsking] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const watching = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (watching.current) clearInterval(watching.current) }, [])

  const schedule = scheduleFor(new Date())
  const consultationRate = schedule.items.find((i) => i.id === '7')?.amount ?? 0
  const callRate = schedule.items.find((i) => i.id === '2')?.amount ?? 0

  async function dialled(call: { from: string; to: string; viaPabx: boolean }) {
    setError(null)
    setComment('')
    setChoosing(false)
    setStatus(null)

    let placed: { charge: ChargeResult; callId: string | null }
    try {
      placed = await recordDial({ accountId, number: call.to, extension: call.from || null, actor })
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }

    setStatus(placed.charge.reason === 'charged'
      ? `Call charged R${placed.charge.exclVat.toFixed(2)} + VAT`
      : 'Call recorded · no charge')

    // Through the PABX, BuzzBox will say whether they answered. Through a tel: link nothing will.
    if (call.viaPabx && placed.callId) watchForAnswer(placed.callId)
    else setAsking(call.to)
  }

  /*
   * Watch, rather than ask.
   *
   * The fee is raised by the webhook whether or not this page is still open, so this poll is only
   * how the collector gets told. It gives up after three minutes: by then the answer is on the
   * timeline, and a page left open on a desk should not poll all afternoon.
   */
  function watchForAnswer(callId: string) {
    if (watching.current) clearInterval(watching.current)
    const started = Date.now()
    watching.current = setInterval(() => {
      void (async () => {
        const outcome = await callOutcome(callId)
        if (outcome?.answeredAt) {
          setStatus(`Answered · consultation charged R${consultationRate.toFixed(2)} + VAT`)
          await onDone()
        } else if (outcome?.endedAt) {
          setStatus(outcome.hangupCause === 'NO_USER_RESPONSE' ? 'No answer' : 'Call ended · not answered')
          await onDone()
        } else if (Date.now() - started <= 180_000) {
          return
        }
        if (watching.current) clearInterval(watching.current)
        watching.current = null
      })()
    }, 3000)
  }

  async function answered(yes: boolean) {
    if (!asking) return
    setBusy(true)
    setError(null)
    try {
      if (yes) {
        const charge = await recordConsultation({ accountId, number: asking, comment, actor })
        setStatus(charge.reason === 'charged'
          ? `Consultation charged R${charge.exclVat.toFixed(2)} + VAT`
          : 'Consultation recorded · no charge')
      } else {
        await recordNoAnswer({ accountId, number: asking, comment, actor })
        setStatus('No answer')
      }
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

      {status && <span className="text-[11px] text-[var(--c-green)]">{status}</span>}
      {error && <span className="text-[11px] text-negative-700">{error}</span>}

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
          {callRate > 0 && (
            <p className="text-xs text-slate-400 mt-4">
              Calling charges R{callRate.toFixed(2)} plus VAT under item 2, whether or not they answer.
            </p>
          )}
        </Modal>
      )}

      {asking && (
        <Modal title="Did they answer?" onClose={() => setAsking(null)} width={440}>
          <p className="text-sm text-slate-500">
            That call went out through the device&rsquo;s own dialler, so nothing reports back to
            Raptor. The call to <span className="font-medium text-slate-700">{asking}</span> is
            already on the timeline and already charged &mdash; this is only about the consultation.
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
            {consultationRate > 0 && <>A consultation adds R{consultationRate.toFixed(2)} plus VAT under item 7. </>}
            Nothing further is charged until you choose.
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
