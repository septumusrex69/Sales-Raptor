import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { DictateButton } from '../../components/ui/Dictate'
import { CANCEL_CHOICES, type CancelCause } from '../../lib/promiseRules.ts'
import {
  QUERY_CATEGORIES, classificationMissing, explanationMissing,
} from '../../lib/disputeCategories.ts'

/**
 * CANCELLING AN ARRANGEMENT ASKS WHY, AND THE ANSWER DECIDES WHAT HAPPENS NEXT.
 *
 * THE FIRM, HAVING PRESSED THE OLD ONE-CLICK CANCEL AND WATCHED NOTHING HAPPEN: "I cancelled the
 * payment arrangement but the workflow is still in motion... If the payment arrangement is
 * cancelled, there should be a reason. So the person should write a reason, say why has it been
 * cancelled. And if it's because of a dispute, a dispute should be raised. And if it's because the
 * debtor just decided not to pay, then it should go back to the section 129. So that needs to be
 * done and it can't go out of the workflow. It should be in a workflow. All accounts should be
 * somewhere and somehow in a workflow."
 *
 * TWO FIELDS, AND THEY ARE DIFFERENT KINDS OF THING. The CAUSE is a closed list the database acts
 * on -- workflow_on_promise_cancelled ends the arrangement's own sequence and gives back the
 * collection sequence the promise was holding -- and the REASON is what the debtor actually said,
 * which is what the next person reads and no machine will ever use.
 *
 * WHAT IT WILL DO IS ON THE SCREEN, under each choice, rather than left to be discovered. Two of
 * these three press a statutory sequence back into motion; a collector who did not know that is a
 * collector who cancels an arrangement to tidy the screen up and puts a final notice in the post.
 *
 * AND IT DICTATES, like the call box and the note box. This is written with the debtor still on
 * the telephone, and the reason field is exactly the one that gets left blank.
 */
export function CancelArrangementModal({ amount, onClose, onConfirm }: {
  /** What the arrangement was for, so the box says which one is being cancelled. */
  amount: string
  onClose: () => void
  /**
   * DOES THE WORK AND REPORTS WHAT IT COULD NOT DO.
   *
   * The cancellation, the dispute where one is called for, and the reload all belong to the page
   * that owns the account. Returning the error rather than throwing keeps the box open with the
   * words still in it: a reason typed once on a call is not one somebody will type again.
   */
  onConfirm: (choice: {
    cause: CancelCause
    reason: string
    /** Only on 'disputed', and required there: the dispute this raises must say what it is about. */
    category: string
  }) => Promise<string | null>
}) {
  const [cause, setCause] = useState<CancelCause | null>(null)
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  /* BOTH, OR NEITHER. The column refuses a cancellation with no cause and the firm asked for the
     sentence as well, so the button is the place that says so rather than an error afterwards. */
  /*
   * AND A THIRD WHERE THIS RAISES A DISPUTE. "Because of a dispute" makes one, the firm made the
   * classification compulsory on a dispute, and raiseQuery refuses it without one -- so without this
   * the arrangement would cancel and the dispute would be lost with a sentence in red underneath.
   * Asked here, while the debtor is still on the telephone, rather than reported afterwards.
   */
  const needsClassification = cause === 'disputed'
    && (classificationMissing('dispute', category) || explanationMissing(category, reason))
  const ready = cause !== null && reason.trim().length > 0 && !needsClassification

  async function confirm() {
    if (!cause || !ready) return
    setBusy(true)
    setFailed(null)
    const problem = await onConfirm({ cause, reason, category })
    setBusy(false)
    if (problem) setFailed(problem)
    else onClose()
  }

  return (
    <Modal title="Cancel this arrangement" subtitle={amount} onClose={onClose} width={520}>
      <p className="text-sm text-slate-500">
        The arrangement stops and its reminders are cancelled. What happens to the rest of the
        account depends on why.
      </p>

      <div className="mt-4 flex flex-col gap-1.5">
        {CANCEL_CHOICES.map((c) => (
          <button
            key={c.cause}
            type="button"
            onClick={() => setCause(c.cause)}
            className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
              cause === c.cause
                ? 'border-[#c9a052] bg-gold-50'
                : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
          >
            <span className="block text-sm font-medium text-slate-700">{c.label}</span>
            {/* WHAT RAPTOR WILL DO, said plainly and always -- not only on the one that is
                selected, because the choice is made by comparing them. */}
            <span className="block text-[11px] text-slate-500 mt-0.5 leading-snug">{c.consequence}</span>
          </button>
        ))}
      </div>

      {cause === 'disputed' && (
        /* ABOVE THE WORDS, because on "Other" the words ARE the classification and the question
           has to come first. Same order as the diary's call box, for the same reason. */
        <div className="mt-4">
          <label htmlFor="cancel-category" className="text-sm font-medium text-slate-700">
            What kind of dispute
          </label>
          <select id="cancel-category" value={category} onChange={(e) => setCategory(e.target.value)}
            className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 mt-1 bg-white">
            {/* Disabled, not "None": a selectable blank is the optional field back again. */}
            <option value="" disabled>Pick one…</option>
            {QUERY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
          </select>
          <span className="block text-[11px] text-slate-500 mt-1">
            {QUERY_CATEGORIES.find((c) => c.value === category)?.examples
              ?? 'The dispute this raises is classified like any other.'}
          </span>
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="cancel-reason" className="text-sm font-medium text-slate-700">
            What did they say?
          </label>
          <DictateButton size="small" value={reason} onChange={setReason} />
        </div>
        <textarea
          id="cancel-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="In their words, so the next person knows what was agreed and what was not."
          className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 mt-1 resize-none focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </div>

      {failed && <p className="text-sm text-negative-700 mt-3">{failed}</p>}

      <div className="flex items-center justify-end gap-2 mt-5">
        {busy && <Loader2 size={15} className="animate-spin text-slate-400" />}
        <button type="button" onClick={onClose} disabled={busy}
          className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
          Keep it
        </button>
        <button type="button" onClick={() => void confirm()} disabled={busy || !ready}
          className="text-sm font-medium px-3.5 py-2 rounded-lg border border-negative-100 text-negative-700 bg-white hover:bg-negative-50 disabled:opacity-40">
          Cancel the arrangement
        </button>
      </div>
    </Modal>
  )
}
