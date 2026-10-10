import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Modal, FormField, inputClass, controlClass } from '../ui/Modal'
import { HARD_STOP_HOLDS, HOLD_REASONS, type HoldReason } from '../../lib/accountBooks'
import { holdAccount, releaseAccount } from '../../lib/accountHoldApi'
import { clockNow } from '../../lib/clock.ts'

/**
 * PUTTING AN ACCOUNT ON HOLD, AND TAKING IT OFF AGAIN.
 *
 * THE FIRM'S THREE BOOKS: "Active -- open and workable. On hold -- frozen, debt review, deceased,
 * insolvent / sequestrated / business rescue, written dispute received and unresolved, awaiting
 * client instruction. Closed -- paid up, settled, written off, withdrawn."
 *
 * A HOLD IS NOT AN ENDING AND THIS IS NOT THAT BOX. EndAccountModal asks which of four ways an
 * account finished; this asks the firm to stop work on one that has not. The difference somebody
 * needs to feel is that this is reversible and that one is not, so the two are never on one screen.
 *
 * THE REVIEW DATE IS REQUIRED, IN THE DATABASE AS WELL AS HERE. An account parked with nobody
 * booked to look at it again is the hole the whole diary design exists to close -- and the firm's
 * own instruction was that On hold has a review queue, which an undated hold would never reach.
 *
 * AND IT SAYS WHAT STOPS. Four of the seven reasons are the call scripts' own hard stops, so a
 * hold for one of them is saying the same thing about the whole file; and any running sequence is
 * PAUSED at the node it had reached rather than cancelled, because a hold is a decision to wait.
 */
export function HoldAccountModal({ accountId, caseNumber, onClose, onDone }: {
  accountId: string
  caseNumber: string | null
  onClose: () => void
  onDone: (paused: number) => void
}) {
  const [reason, setReason] = useState<HoldReason>('awaiting_client')
  /* A MONTH OUT, which is the firm's own weekly-review rhythm rounded to something a person would
     pick anyway. Pre-filled rather than blank: a required field nobody can guess at is a field
     people fill with today's date to get past it. */
  const [reviewOn, setReviewOn] = useState(() => {
    const d = clockNow()
    d.setMonth(d.getMonth() + 1)
    return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })
  })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = HOLD_REASONS.find((h) => h.id === reason)
  const hardStop = HARD_STOP_HOLDS.includes(reason)
  const valid = note.trim().length > 0 && !!reviewOn

  async function submit() {
    if (busy || !valid) return
    setBusy(true); setError(null)
    try {
      const paused = await holdAccount({ accountId, reason, reviewOn, note: note.trim() })
      onDone(paused)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Put ${caseNumber ?? 'this account'} on hold`}
      subtitle="Work stops and a date is set to come back to it. Nothing about the debt changes."
      width={560}
      onClose={onClose}
    >
      <div className="space-y-4">
        <FormField label="Why it is stopping">
          <div className="grid gap-1.5">
            {HOLD_REASONS.map((h) => (
              <label key={h.id}
                className={clsx('flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer',
                  reason === h.id ? 'border-gold-500 bg-gold-50' : 'border-slate-200 hover:bg-slate-50')}>
                <input type="radio" className="mt-1" checked={reason === h.id}
                  onChange={() => setReason(h.id)} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium text-slate-800">{h.label}</span>
                  <span className="block text-[12px] text-slate-500">{h.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </FormField>

        {/*
          THE FOUR THAT ARE ALSO CALL-SCRIPT HARD STOPS, said here rather than discovered later. A
          collector who rings a debtor in debt review is not making a mistake about this account --
          they are doing something the Act does not allow.
        */}
        {hardStop && (
          <p className="rounded-lg bg-negative-50 border border-negative-100 px-3 py-2 text-[12.5px] text-negative-700">
            Nobody may ring this debtor while it is on hold for {chosen?.label.toLowerCase()}. It
            comes off every queue and every dialler list, which is the same stop the call scripts
            already make.
          </p>
        )}

        <FormField label="Come back to it on">
          <input type="date" className={inputClass} value={reviewOn}
            onChange={(e) => setReviewOn(e.target.value)} />
          <span className="block text-[11px] text-slate-400 mt-1">
            Required. An account nobody is booked to look at again is one nobody looks at again.
          </span>
        </FormField>

        <FormField label="What happened">
          <textarea className={controlClass} rows={2} value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Debt counsellor 17 of 2019 wrote in on 3 October" />
          <span className="block text-[11px] text-slate-400 mt-1">
            Goes on the account&rsquo;s history against this move.
          </span>
        </FormField>

        <p className="text-[12px] text-slate-500 leading-relaxed">
          Any sequence running on this account is PAUSED where it had reached, not cancelled. It
          picks up from the same step when the account comes back.
        </p>

        {error && (
          <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Never mind</button>
          <button type="button" className="btn-primary inline-flex items-center gap-2"
            disabled={!valid || busy} onClick={() => { void submit() }}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            Put it on hold
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * BACK ONTO THE ACTIVE BOOK.
 *
 * ONE BOX FOR BOTH DOORS, because `release_account` is one function for both: an account comes back
 * from a hold, from the Frozen status it was imported with, or from a closure, and the firm's
 * question is the same in all three cases -- why is it being worked again. The heading changes; the
 * decision does not.
 *
 * A REASON IS REQUIRED AND THE DATABASE REFUSES WITHOUT ONE. Re-opening a closed account is the
 * move most worth being able to explain a year later.
 */
export function ReleaseAccountModal({ accountId, caseNumber, from, onClose, onDone }: {
  accountId: string
  caseNumber: string | null
  from: 'on_hold' | 'closed'
  onClose: () => void
  onDone: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (busy || !note.trim()) return
    setBusy(true); setError(null)
    try {
      await releaseAccount(accountId, note.trim())
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={from === 'closed'
        ? `Re-open ${caseNumber ?? 'this account'}`
        : `Put ${caseNumber ?? 'this account'} back on the active book`}
      subtitle={from === 'closed'
        ? 'It goes back onto the active book and its closure is cleared.'
        : 'Work starts again and the hold comes off.'}
      width={520}
      onClose={onClose}
    >
      <div className="space-y-4">
        <FormField label="Why it is coming back">
          <textarea className={controlClass} rows={3} value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={from === 'closed'
              ? 'The compromise fell through and the client wants it worked again'
              : 'Debt review withdrawn by the counsellor'} />
          <span className="block text-[11px] text-slate-400 mt-1">
            Required. This is the move most worth being able to explain a year from now.
          </span>
        </FormField>

        {from === 'closed' && (
          <p className="rounded-lg bg-gold-50 border border-gold-100 px-3 py-2 text-[12.5px] text-gold-800">
            The closure is cleared, not kept alongside. The history keeps both: how it closed, and
            this.
          </p>
        )}
        <p className="text-[12px] text-slate-500 leading-relaxed">
          A sequence paused by the hold resumes from the step it stopped on. One paused by a promise
          or a dispute stays paused &mdash; those end when the promise or the dispute does.
        </p>

        {error && (
          <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Never mind</button>
          <button type="button" className="btn-primary inline-flex items-center gap-2"
            disabled={!note.trim() || busy} onClick={() => { void submit() }}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            {from === 'closed' ? 'Re-open it' : 'Back on the active book'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
