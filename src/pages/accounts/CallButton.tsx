import { useEffect, useRef, useState } from 'react'
import { Loader2, Phone } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { RecordActionNote } from '../../components/record/RecordShell'
import { PhoneLink } from '../../components/PhoneLink'
import { callOutcome, recordConsultation, recordDial, recordNoAnswer } from '../../lib/accountCalls'
import { saveMainComment } from '../../lib/accountWorkspace'
import { DictateButton } from '../../components/ui/Dictate'
import { scheduleFor } from '../../lib/annexureB'
import { OutcomePicker } from '../../components/diary/OutcomePicker'
import {
  CALL_OUTCOMES, CALL_OUTCOME_ORDER, EMPTY_OUTCOME, outcomeReady, type OutcomeChoice,
} from '../../lib/callOutcome'
import { recordOutcome } from '../../lib/recordOutcome'
import type { ChargeResult } from '../../lib/accountCharges'

/**
 * THE FIVE OUTCOMES A CALL SOMEBODY ANSWERED CAN HAVE.
 *
 * `reached` is the whole test, and it is a test about a FEE. Pressing "I spoke to them" raises the
 * R60 consultation; the firm's instruction for this control was that choosing an outcome here is
 * the same press -- "either way, it records, and it's then accepted as spoken to the debtor, so it
 * charges the consultation and the other thing, the phone call". So an outcome that means nobody
 * was reached cannot live on it. No answer is the OTHER button on this box, and a trace or a
 * practitioner answering for the debtor is something to record from the diary or the account's own
 * controls, where nothing is charged for it.
 *
 * Derived from CALL_OUTCOMES rather than listed, so a ninth outcome lands on the right side of
 * this line by saying what it is rather than by somebody remembering this file.
 */
const SPOKE_TO_THEM = CALL_OUTCOME_ORDER.filter((k) => CALL_OUTCOMES[k].reached)

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
export function CallButton({ accountId, numbers, actor, livePromise, className, onDone }: {
  accountId: string
  /**
   * Every number that could reach this debtor, primary first. More than one and the button asks
   * which; exactly one and it just rings it.
   */
  numbers: { label: string; value: string }[]
  actor: { id: string | null; name: string | null }
  /**
   * A PROMISE ALREADY STANDING ON THIS ACCOUNT, so the box does not ask for one that exists.
   *
   * THE FIRM'S OBJECTION, made about the diary and true here as well: "there's already a PTP in
   * place, why do you need to redo this?" A retyped promise is a SECOND promise -- two rows, two
   * due dates, and a client told about an arrangement that is now ambiguous.
   */
  livePromise?: { amount: number; dueOn: string } | null
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
  /**
   * Put the same words at the top of the account as well.
   *
   * OFF EVERY TIME THE BOX OPENS, never remembered. The main comment is overwritten rather than
   * appended to, so a tick that stuck would replace a carefully written summary with "left a
   * message" on the next call that rang out -- and the collector who set it three calls ago would
   * have no idea why.
   */
  const [alsoMain, setAlsoMain] = useState(false)
  /**
   * WHERE THE CALL LEAVES THE ACCOUNT, answered on the same box and saved by the same press.
   *
   * THE FIRM, having run their first afternoon of calls: "I think we can as well add to this thing
   * immediately -- add a question. As you raise a ticket, or you can raise a PTP immediately from
   * the screen. Either way, it records." What they were describing is the thing that already
   * existed on the diary's own box and was unreachable from a call: a promise taken with an amount
   * and a date, or a dispute raised, instead of a note that says one happened.
   *
   * THE WORDS ARE NOT KEPT HERE. `comment` is the only place a sentence is typed -- see the choice
   * below -- which is the half of this the firm actually complained about.
   */
  const [came, setCame] = useState<OutcomeChoice>(EMPTY_OUTCOME)
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
    setAlsoMain(false)
    setCame(EMPTY_OUTCOME)
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
      /*
       * AND WHERE THE ACCOUNT NOW STANDS, OFF THE SAME WORDS AND THE SAME PRESS.
       *
       * ONE TYPING. `words: comment` is the whole point: the promise's note, the dispute's
       * description and the call's own note are the sentence the collector wrote once, in the box
       * above. Before this, a call that ended in a dispute was written up here and then written
       * again in the Escalate box, and the firm said so -- "you're double making notes, notes
       * should be made only at one place".
       *
       * AFTER THE CONSULTATION, NEVER INSTEAD OF IT, for the same reason the main comment is: the
       * fee and the note behind it are the thing that must not be lost. A promise that would not
       * write must not take the record of the call with it.
       *
       * IT DOES NOT THROW, SO IT CANNOT CLAIM THE CALL FAILED. recordOutcome reports what it could
       * not write and writes the status only when everything above it landed -- so a red line here
       * says exactly which half is missing, over a call that is on the timeline either way. The
       * box closes regardless: re-pressing it would charge a second consultation for one
       * conversation, which is worse than a promise the collector has to take again.
       */
      if (yes && came.outcome) {
        const chosen = came.outcome
        const r = await recordOutcome({
          accountId,
          outcome: chosen,
          /* NULL WHERE THE STANDING PROMISE IS BEING KEPT -- the picker asked for nothing, so
             there is nothing to write and a row here would be a second arrangement. */
          promise: chosen === 'promised' && (!livePromise || came.repromise)
            ? { amount: Number(came.amount.replace(/[^\d.]/g, '')), dueOn: came.dueOn }
            : null,
          words: comment,
          /* Only a dispute carries one, and raiseQuery refuses one without it. */
          category: chosen === 'disputed' ? came.category : null,
          actor,
        })
        if (r.failed.length) {
          setError(`The call is recorded. ${CALL_OUTCOMES[chosen].label} is not — could not write `
            + `${r.failed.join(' or ')}.`)
        } else {
          setStatus((prev) => `${prev ?? 'Call recorded'} · ${CALL_OUTCOMES[chosen].label}`)
        }
      }
      /*
       * AND THE SAME WORDS AS THE MAIN COMMENT, where the collector ticked the box.
       *
       * THE FIRM ASKED FOR IT HERE because this is where the sentence gets written. The main
       * comment is "the two lines the next person needs" and the most recent call is usually
       * exactly that -- but it lives at the top of the account, four inches and a scroll away
       * from the box somebody has just typed into, so in practice it went stale.
       *
       * AFTER THE CALL IS RECORDED, NEVER INSTEAD OF IT. The consultation and its fee are the
       * thing that must not be lost; the main comment is a convenience on top. Written first, a
       * failure here would leave a fee with no note behind it -- the one kind nobody can defend
       * when it is queried.
       *
       * AND IT DOES NOT FAIL THE CALL. The call went, the fee is raised and the note is on the
       * timeline either way; a red error over all of that because one more field would not save
       * would be a lie about what happened.
       */
      if (alsoMain && comment.trim()) {
        try {
          await saveMainComment(accountId, comment, actor.id, actor.name)
        } catch (e) {
          console.error('[call] the call was recorded but the main comment was not:', e)
        }
      }
      setAsking(null)
      setAnsweredCallId(null)
      setConnected(null)
      setComment('')
      setAlsoMain(false)
      setCame(EMPTY_OUTCOME)
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /*
   * ONE SENTENCE, TWO USES. The picker needs `words` to decide whether it has enough to save, and
   * the only place a sentence is typed on this box is the note. Folded in HERE rather than kept on
   * `came`, so there is no second copy that can fall out of step with the box somebody is typing
   * in -- and `onChange` writes '' back for the same reason.
   */
  const choice: OutcomeChoice = { ...came, words: comment }
  /*
   * WHY THE BUTTON IS OFF, SAID ON THE BUTTON. It refused on an empty note before and said so;
   * now it can also be refused by a promise with no date or a dispute with no classification, and
   * "nothing happens when I press it" is how a collector decides the screen is broken.
   */
  const whyNot = !comment.trim()
    ? 'Write what was said first'
    : !outcomeReady(choice, !!livePromise)
      ? `Finish ${came.outcome ? CALL_OUTCOMES[came.outcome].label.toLowerCase() : 'the outcome'} below`
        + ' — it still needs the rest of its details'
      : null

  return (
    /*
      THE LINE THIS BUTTON REPORTS IN -- "consultation recorded", or why it could not be -- hangs
      under the button rather than sitting in the action row's flow. In the flow it made this
      column taller than every button beside it and moved the row for the seconds the message
      lasts. See RecordActions.
    */
    <RecordActionNote note={(status || error) && (
      <>
        {status && <span className="text-[11px] text-[var(--c-green)]">{status}</span>}
        {error && <span className="text-[11px] text-negative-700">{error}</span>}
      </>
    )}>
      {/*
        One number rings straight away; several ask first.

        The chooser is a list of PhoneLinks rather than a picker plus a dial call of its own, so
        every number goes out through exactly the same path, tel: fallback and all.
      */}
      {numbers.length <= 1 ? (
        <PhoneLink number={numbers[0]?.value ?? ''} className={className} iconSize={14} inActionRow
          onDialled={(c) => void dialled(c)}>
          <Phone size={14} /> Call
        </PhoneLink>
      ) : (
        <button type="button" onClick={() => setChoosing(true)} className={className}
          title={`Ring this debtor — ${numbers.length} numbers on file`}>
          <Phone size={14} /> Call
        </button>
      )}

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
        <Modal title="Did you speak to them?"
          onClose={() => { setAsking(null); setAnsweredCallId(null); setCame(EMPTY_OUTCOME) }}
          width={560}>
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
          <div className="mt-3">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="what-was-said" className="text-sm font-medium text-slate-700">
                What was said?
              </label>
              {/*
                DICTATED, BECAUSE THIS IS THE BOX SOMEBODY FILLS WITH A PHONE IN THEIR HAND.
                
                The firm asked for it here by name, and it is the field in Raptor with the best
                claim to it: the collector has just put the receiver down, the conversation is
                still in their head, and typing it out is the step that gets skipped -- which
                leaves a R60 consultation with no evidence behind it.
                
                The same control the note box and the compose box use, so the language somebody
                dictates in is remembered once across all of them.
              */}
              <DictateButton size="small" value={comment} onChange={setComment} />
            </div>
            <textarea
              id="what-was-said"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Needed before a consultation can be charged."
              className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 mt-1 resize-none focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
          {/*
            AND WHERE THE CALL LEAVES THE ACCOUNT.
            
            UNDER THE NOTE, NOT ABOVE IT, and the firm asked which way round: "I don't know if you
            click on that first and then make the note, or make the note first and then click on
            the PTP. What do you think should be done?"
            
            THE NOTE FIRST. The words are in somebody's head the second the receiver goes down and
            they leave it fast; the rung the account lands on is still true in a minute. Asking for
            the classification first also makes people commit to "Arranged" before writing why,
            and what they then write is shorter -- which is how a R60 consultation ends up with
            four words behind it. So the box reads in the order the call happened: what was said,
            then what it means.
            
            OPTIONAL, like it is on the diary's box. A collector who did something the five choices
            do not cover must still be able to record the call; a required field with no honest
            answer is how "Review" came to mean nothing.
          */}
          <div className="mt-3.5 pt-3.5 border-t border-slate-100">
            <OutcomePicker
              value={choice}
              offer={SPOKE_TO_THEM}
              livePromise={livePromise ?? null}
              /* THE NOTE ABOVE IS THE WORDS. One sentence, typed once -- see wordsAskedAs. */
              wordsAskedAs="What was said?"
              onChange={(next) => setCame({ ...next, words: '' })} />
          </div>

          {/*
            AND THE SAME WORDS AT THE TOP OF THE ACCOUNT, if they are worth it.
            
            THE MAIN COMMENT IS "the two lines the next person needs" and the last call is usually
            exactly that. It sits four inches up the page from this box, so the person best placed
            to write it is the one least likely to go and do it.
            
            OFF BY DEFAULT, on purpose. The main comment is OVERWRITTEN -- saveMainComment replaces
            it and puts the old one on the timeline -- so a tick that defaulted on would quietly
            replace a carefully written summary with "left a message" on every call that rang out.
            It is offered, not assumed.
          */}
          <label className="mt-2.5 flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={alsoMain}
              onChange={(e) => setAlsoMain(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[#c9a052] focus:ring-[#c9a052]" />
            <span className="text-[13px] leading-snug text-slate-600">
              Also make this the main comment
              <span className="block text-[11px] text-slate-400">
                Replaces what is at the top of the account. The one it replaces goes on the timeline.
              </span>
            </span>
          </label>
          {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
          <p className="text-xs text-slate-400 mt-3">
            {consultationRate > 0 && <>Speaking to them adds R{consultationRate.toFixed(2)} plus VAT
              under item 7. </>}
            A voicemail adds nothing &mdash; the call itself is already charged either way.
            {/* AND THE OUTCOME IS FREE, SAID WHERE THE CHOICE IS MADE. Item 3 is for a dispute
                taken up with somebody else; one a collector writes down mid-call is the job, not
                an expense recoverable from the debtor. See raiseQuery's `charge`. */}
            {' '}Saying where the account stands adds nothing at all.
          </p>
          <div className="flex items-center justify-end gap-2 mt-5">
            {busy && <Loader2 size={15} className="animate-spin text-slate-400" />}
            {/*
              OFF ONCE AN OUTCOME IS CHOSEN, because all five of them mean somebody was reached.
              "Arranged" and "nobody picked up" on one press is an account claiming a promise with
              a voicemail behind it, and the fee would be wrong in whichever direction it landed.
              Disabled with the reason rather than hidden: the voicemail path is still the right
              one, and the way back to it is to clear the choice.
            */}
            <button onClick={() => void answered(false)} disabled={busy || !!came.outcome}
              title={came.outcome
                ? `You have said the account is ${CALL_OUTCOMES[came.outcome].label.toLowerCase()}`
                  + ' — that is somebody you spoke to. Press the choice again to clear it.'
                : undefined}
              className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
              Voicemail or no answer
            </button>
            <button
              onClick={() => void answered(true)}
              disabled={busy || !!whyNot}
              title={whyNot ?? undefined}
              className="text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 disabled:opacity-40"
            >
              {/* THE BUTTON SAYS WHAT IT IS ABOUT TO DO. Pressed with "Arranged" chosen it takes a
                  promise as well as the consultation, and a label that still read "I spoke to
                  them" would hide the half that writes a record. */}
              {came.outcome ? `I spoke to them · ${CALL_OUTCOMES[came.outcome].label}` : 'I spoke to them'}
            </button>
          </div>
        </Modal>
      )}
    </RecordActionNote>
  )
}
