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
 * So every call ends with the same question, and what the webhook buys is CONTEXT for it rather
 * than an answer: the box can say whether the line connected at all, and when the call ended, so
 * it appears at the moment the collector actually knows what to write.
 *
 * An earlier version skipped the question entirely when BuzzBox reported no bridge. That was too
 * clever twice over. It lost the note on a call that rang out -- "tried again, still nothing" is
 * worth recording -- and it meant a collector who had plainly just had a conversation was told
 * "No answer" by a machine that had merely failed to see it. Ask every time; let the person
 * disagree with the PABX.
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
  /** What BuzzBox saw: true it connected, false it never did, null nothing reported. */
  const [connected, setConnected] = useState<boolean | null>(null)
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

    // Through the PABX, wait for the call to end and then ask. Through a tel: link nothing
    // reports back, so ask straight away -- the collector will answer it when they are done.
    if (call.viaPabx && placed.callId) watchForAnswer(placed.callId, call.to)
    else { setConnected(null); setAsking(call.to) }
  }

  /*
   * Ask when the call is over, not when it was placed.
   *
   * That is the moment the collector knows what to write, and BuzzBox telling us the call ended
   * is how we know it has arrived. The question is always asked; what the poll decides is only
   * WHEN, and what the box can say about what the PABX saw.
   *
   * Three minutes and it asks anyway. A webhook that never came must not swallow a consultation
   * the collector actually had.
   */
  function watchForAnswer(callId: string, number: string) {
    if (watching.current) clearInterval(watching.current)
    const started = Date.now()
    watching.current = setInterval(() => {
      void (async () => {
        const outcome = await callOutcome(callId)
        const timedOut = Date.now() - started > 180_000
        if (!outcome?.endedAt && !timedOut) return

        setStatus(null)
        setConnected(outcome?.endedAt ? !!outcome.answeredAt : null)
        setAnsweredCallId(callId)
        setAsking(number)
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
      setConnected(null)
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
          {/* A column, not a paragraph. `space-y` cannot separate inline-flex children, which is
              why these ran into one another; `block` makes each one a real row. */}
          <div className="mt-4 flex flex-col gap-1.5">
            {numbers.map((n) => (
              <PhoneLink key={n.value} number={n.value} iconSize={14} block
                onDialled={(c) => void dialled(c)}
                className="w-full text-left text-sm px-3 py-2 rounded-lg border border-slate-200 hover:border-[#c9a052] hover:bg-gold-50 flex items-center gap-2">
                <Phone size={14} className="shrink-0 text-slate-400" />
                <span className="font-medium text-slate-700 shrink-0">{n.value}</span>
                <span className="text-slate-400 truncate">{n.label}</span>
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
          {/*
            What the PABX saw, said plainly, and never as the final word. It can see that a line
            connected; it cannot see who was on it, and it can miss a call entirely. The person who
            just put the phone down knows better than it does and is allowed to say so.
          */}
          <p className="text-sm text-slate-500">
            The call to <span className="font-medium text-slate-700">{asking}</span> is on the
            timeline and the R{callRate.toFixed(2)} for it is already charged.{' '}
            {connected === true
              ? <>BuzzBox says the line connected &mdash; but a voicemail greeting answers exactly
                like a person does, and it cannot tell them apart.</>
              : connected === false
                ? <>BuzzBox says nobody picked up. If you did speak to someone, say so anyway
                  &mdash; it sees the line, not the conversation.</>
                : <>Nothing reported back on this one, so only you know how it went.</>}
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
