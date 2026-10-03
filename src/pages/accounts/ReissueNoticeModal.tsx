import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { markStepNotServed, startWorkflow } from '../../lib/accountRun.ts'
import { reissueReason, type Reissue } from '../../lib/reissueNotice.ts'
import { shortDate } from '../../lib/dateLabels.ts'

/**
 * THE ADDRESS WAS CORRECTED. DO YOU WANT TO ISSUE THE DEMAND AGAIN?
 *
 * THE FIRM: "when you've changed the primary email address, it should ask you, do you want to
 * restart the Section 129 process? And if you say yes, it restarts the Section 129 process in the
 * workflow. It still shows that the previous workflow went out to the wrong email address. Then the
 * email address was changed and now the new workflow is going out."
 *
 * TWO WRITES AND THEY ARE ONE DECISION, which is why they are one press rather than two screens:
 *
 *   1. The notice that went to the old address is marked as never served. It STAYS `sent` -- a send
 *      cannot be un-sent, and the file has to read "went to the wrong address on the 1st,
 *      re-issued on the 8th". Hiding the first attempt would make it look like one notice went out
 *      a week late, which is worse for the firm than the mistake.
 *   2. That unlocks `reissue_allowed` on the run, and a fresh sequence is started on the same
 *      version -- which the once-per-account-and-version rule otherwise refuses, because two runs
 *      of a statutory sequence are two clocks on one debt. A demand nobody received never started a
 *      clock, so the second one is the first good one.
 *
 * ORDER IS LOAD-BEARING. `api/workflow/start` reads `reissue_allowed` to decide whether this
 * account may go through again, so the marking has to land first; started the other way round the
 * press is simply refused.
 *
 * THE "NO" IS NOT A FAILURE AND WRITES NOTHING. Most address edits are typos on accounts with
 * nothing running, and `markStepNotServed` says in as many words that it must never be a side
 * effect of correcting an address. What changes here is only that the person who knows is asked at
 * the one moment they have the answer.
 */
export function ReissueNoticeModal({ accountId, offer, before, after, onClose, onDone }: {
  accountId: string
  offer: Reissue
  /** The address as it was. What the notice went to, and what the record will say. */
  before: string
  /** The address as it is now. What the fresh sequence will go to. */
  after: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  /* The same door every other workflow control uses -- the panel's Start button reads the token
     off this too, so one expired session is one sentence rather than two. */
  const { session, currentUser } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reissue() {
    setBusy(true)
    setError(null)
    try {
      if (!session?.access_token) throw new Error('Your session has expired. Sign in again.')
      /* FIRST, or the start below is refused -- see the header. */
      await markStepNotServed({
        stepId: offer.stepId,
        reason: reissueReason(before, after),
        by: currentUser?.id ?? null,
      })
      await startWorkflow(session.access_token, accountId, offer.versionId)
      await onDone()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Issue the ${offer.workflowName.toLowerCase()} again?`} onClose={onClose} width={500}>
      <p className="text-sm text-slate-600">
        <span className="font-medium text-slate-800">{offer.stepLabel}</span> went to{' '}
        <span className="font-medium text-slate-800 break-words">{offer.sentTo}</span>
        {offer.sentAt ? ` on ${shortDate(offer.sentAt.slice(0, 10))}` : ''}, which is the address you
        have just corrected.
      </p>
      {/*
        WHAT IS ACTUALLY AT STAKE, said plainly: a section 129 turns on DELIVERY. A demand to an
        address the debtor does not read starts no clock, and every interval after it -- the ten
        business days, the final notice, the twenty before a listing -- is counted from a day
        nothing happened on.
      */}
      <p className="text-sm text-slate-600 mt-3">
        If they never received it, the notice period never started. Issuing it again sends the
        sequence to <span className="font-medium text-slate-800 break-words">{after}</span> and
        counts the days from today.
      </p>
      <p className="text-xs text-slate-500 mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
        The first attempt stays on the file, marked as never reaching them, with the address it went
        to. Nothing is deleted.
      </p>
      {/*
        AND THE CASE FOR SAYING NO, because it is the ordinary answer. A debtor can have three
        addresses and a tidied record is not a finding that service failed.
      */}
      <p className="text-xs text-slate-500 mt-2">
        If this was a second address, or a typo on one that still reaches them, say no &mdash;
        nothing is recorded.
      </p>

      {error && (
        <p className="text-sm text-negative-700 mt-3 inline-flex items-start gap-1.5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 mt-5">
        {busy && <Loader2 size={15} className="animate-spin text-slate-400" />}
        <button type="button" onClick={onClose} disabled={busy}
          className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
          No, it still reaches them
        </button>
        <button type="button" onClick={() => void reissue()} disabled={busy}
          className="text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-900 text-white disabled:opacity-50">
          Yes, issue it again
        </button>
      </div>
    </Modal>
  )
}
