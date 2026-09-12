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
 * The consultation is a separate question, and it is always a person's to answer. BuzzBox reports
 * that the line connected; it cannot report WHO picked up, and a voicemail greeting answers
 * exactly like a debtor. Charging item 7 off the bridge alone billed R60 every time a collector
 * left a message, which is what the firm found on their first real afternoon of calls.
 *
 * So what the webhook buys is not the answer -- it is not having to ask when the answer is
 * certain. A call that never bridged was never answered by anybody, and that case resolves
 * itself in silence. Only a call that DID connect raises the question, and then the collector
 * says whether they spoke to a person, and writes down what was said.
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
  /** The call row the question belongs to, so the fee can be claimed once. Null on a tel: call. */
  const [answeredCallId, setAnsweredCallId] = useState<string | null>(null)
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

    // Through the PABX, BuzzBox says whether the line connected, which decides whether the
    // question is worth asking. Through a tel: link nothing reports back, so it always is.
    if (call.viaPabx && placed.callId) watchForAnswer(placed.callId, call.to)
    else setAsking(call.to)
  }

  /*
   * Wait for BuzzBox to say whether the line connected, then decide whether to ask anything.
   *
   * Connected -> the question is live, because it could have been the debtor or their voicemail.
   * Ended without ever connecting -> nobody answered, nothing more to charge, no question.
   *
   * Gives up after three minutes and asks anyway: a webhook that never arrived should not silently
   * lose a consultation the collector actually had.
   */
  function watchForAnswer(callId: string, number: string) {
    if (watching.current) clearInterval(watching.current)
    const started = Date.now()
    watching.current = setInterval(() => {
      void (async () => {
        const outcome = await callOutcome(callId)
        const timedOut = Date.now() - started > 180_000
        if (outcome?.answeredAt) {
          setStatus(null)
          setAnsweredCallId(callId)
          setAsking(number)
        } else if (outcome?.endedAt) {
          setStatus('No answer')
          await onDone()
        } else if (timedOut) {
          setAnsweredCallId(callId)
          setAsking(number)
        } else {
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
        const charge = await recordConsultation({
          accountId, number: asking, comment, callId: answeredCallId, actor,
        })
        setStatus(charge.reason === 'charged'
          ? `Consultation charged R${charge.exclVat.toFixed(2)} + VAT`
          : 'Consultation recorded · no charge')
      } else {
        await recordNoAnswer({ accountId, number: asking, comment, actor })
        setStatus('Voicemail or no answer · no consultation')
      }
      setAsking(null)
      setAnsweredCallId(null)
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
        <Modal title="Did you speak to them?" onClose={() => { setAsking(null); setAnsweredCallId(null) }} width={460}>
          <p className="text-sm text-slate-500">
            {answeredCallId
              ? <>The line to <span className="font-medium text-slate-700">{asking}</span> connected
                &mdash; but a voicemail greeting answers exactly like a person does, and Raptor
                cannot tell them apart. Only a real conversation is a consultation.</>
              : <>That call went out through the device&rsquo;s own dialler, so nothing reports back
                to Raptor. The call to <span className="font-medium text-slate-700">{asking}</span> is
                already on the timeline and already charged &mdash; this is only about the
                consultation.</>}
          </p>
          {/*
            Required, at the firm's request: "many of the debtor answers you need to fill it out,
            so make that obligatory". A R60 consultation with nothing written about it is a fee
            with no evidence behind it -- the one kind nobody can defend when it is queried.
          */}
          <label className="block mt-3">
            <span className="text-sm font-medium text-slate-700">What was said?</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Needed before a consultation can be charged."
              className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 mt-1 resize-none focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
          {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
          <p className="text-xs text-slate-400 mt-3">
            {consultationRate > 0 && <>Speaking to them adds R{consultationRate.toFixed(2)} plus VAT
              under item 7. </>}
            A voicemail adds nothing &mdash; the call itself is already charged either way.
          </p>
          <div className="flex items-center justify-end gap-2 mt-5">
            {busy && <Loader2 size={15} className="animate-spin text-slate-400" />}
            <button onClick={() => void answered(false)} disabled={busy}
              className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
              Voicemail or no answer
            </button>
            <button
              onClick={() => void answered(true)}
              disabled={busy || !comment.trim()}
              title={comment.trim() ? undefined : 'Write what was said first'}
              className="text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 disabled:opacity-40"
            >
              I spoke to them
            </button>
          </div>
        </Modal>
      )}
    </span>
  )
}
