import { useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { NextDiaryFields, initialPlan, type NextPlan } from './NextDiaryFields'
import { workEntry, debtorName, type DiaryRow } from '../../lib/diary.ts'
import { DIARY_KINDS } from '../../lib/diaryPriority.ts'
import { addWorkingDays } from '../../lib/workingDays.ts'
import { DictateButton } from '../ui/Dictate'
import { ClientLinePreview } from './ClientLinePreview'
import { OutcomePicker, EMPTY_OUTCOME, outcomeReady, type OutcomeChoice } from './OutcomePicker'
import { CALL_OUTCOMES, type CallOutcome } from '../../lib/callOutcome.ts'
import { recordOutcome } from '../../lib/recordOutcome.ts'

/**
 * Mark one diary entry worked, and say what happens to the account next.
 *
 * It used to just close the entry. That was wrong, and the firm said so: an account whose
 * appointment is closed and whose next one is never booked drops out of circulation entirely,
 * which is how three hundred and fifty-five accounts arrived here with nobody on them and no
 * date. Closing and re-booking is one act, so it is one button.
 *
 * The outcome line is kept on the entry itself rather than only in the account's timeline,
 * because "how much did we get through yesterday, and what came of it" is a question about diary
 * rows. Answering it out of a timeline means reading every note on every account.
 */
export function CompleteDiaryModal({ entry, onClose, onDone }: {
  entry: DiaryRow
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { currentUser } = useAuth()
  const { users } = useAppStore()

  const today = new Date().toISOString().slice(0, 10)
  const [outcome, setOutcome] = useState('')
  const [came, setCame] = useState<OutcomeChoice>(EMPTY_OUTCOME)
  const [plan, setPlan] = useState<NextPlan>(() => initialPlan(entry.kind, addWorkingDays(today, 5)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const owner = users.find((u) => u.id === entry.ownerId)
  /*
   * Only an OPEN promise stands. One already kept or already broken is history, and offering to
   * reuse it would book a check on a commitment that is finished.
   */
  const livePromise = entry.promise && entry.promise.status === 'open'
    ? { amount: entry.promise.amount, dueOn: entry.promise.dueOn }
    : null

  async function save() {
    setBusy(true); setError(null)
    try {
      /*
        THE RECORDS FIRST, THE DIARY SECOND. If the promise cannot be written there is nothing
        to check on the date, so booking the check anyway would leave a diary entry pointing at
        a commitment that does not exist. Failing here stops the whole save and says why.
      */
      if (came.outcome) {
        const r = await recordOutcome({
          accountId: entry.accountId,
          outcome: came.outcome,
          /*
           * NULL WHERE THE EXISTING PROMISE IS BEING KEPT. Writing one anyway would make a second
           * row for the same commitment — two due dates on one account, and a client report that
           * cannot say which arrangement is the arrangement.
           */
          promise: came.outcome === 'promised' && (!livePromise || came.repromise)
            ? { amount: Number(came.amount.replace(/[^\d.]/g, '')), dueOn: came.dueOn }
            : null,
          words: came.words,
          actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
        })
        if (r.failed.length) throw new Error(`Could not record ${r.failed.join(' or ')}.`)
      }

      await workEntry({
        entry,
        outcome,
        next: plan.comesBack
          ? { comesBack: true, dueOn: plan.dueOn, kind: plan.kind }
          : { comesBack: false, exit: plan.exit },
        actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
      })
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Mark this worked" onClose={onClose} width={560}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {debtorName(entry)} — {DIARY_KINDS[entry.kind].label.toLowerCase()}
          {entry.reason && <span className="text-slate-400"> · {entry.reason}</span>}
        </p>

        <FormField label="What came of it">
          <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} autoFocus
            placeholder="No answer on either number. Left an SMS."
            className={`${inputClass} resize-none`} />
          {/* Talk it instead of typing it. Free, built into the browser — see Dictate.tsx. */}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {/* Talk it instead of typing it — the words land in the box above. See Dictate.tsx. */}
            <DictateButton size="small" value={outcome} onChange={setOutcome} />
            <span className="text-[11px] text-slate-400">
              Optional. Goes on the account&rsquo;s timeline too.
            </span>
          </div>
        </FormField>

        {/*
          WHAT CAME OF IT, as a choice rather than only as prose. The typed note stays — it is
          where the detail lives — but the choice is what writes the promise, raises the dispute
          and moves the status, so the client's report can say something a machine derived rather
          than something nobody recorded.
        */}
        <OutcomePicker value={came} livePromise={livePromise} onChange={(next) => {
          setCame(next)
          // The diary's own suggestion follows the answer: a promise wants checking on its date.
          if (next.outcome && next.outcome !== came.outcome) {
            setPlan((p) => ({ ...p, kind: CALL_OUTCOMES[next.outcome as CallOutcome].suggests }))
          }
        }} />

        {/* The client's own line, before the date is committed. See ClientLinePreview. */}
        <ClientLinePreview account={entry.account} next={plan.comesBack ? { kind: plan.kind, dueOn: plan.dueOn } : null} />

        <NextDiaryFields
          plan={plan}
          onChange={setPlan}
          ownerId={entry.ownerId}
          capacity={owner?.diaryCapacity ?? null}
          today={today}
          prescriptionDate={entry.account.prescriptionDate}
        />

        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={busy || !outcomeReady(came, !!livePromise)}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {plan.comesBack ? 'Worked, book the next' : 'Worked, close the account'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
