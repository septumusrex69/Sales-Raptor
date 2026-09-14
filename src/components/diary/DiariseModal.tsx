import { useState } from 'react'
import { AlertTriangle, CalendarClock, Loader2 } from 'lucide-react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { DiaryDatePicker, longDate } from './DiaryDatePicker'
import {
  DIARY_KINDS, DIARY_KIND_ORDER, daysBetween, shiftDate,
  type DiaryKind,
} from '../../lib/diaryPriority.ts'
import { diarise } from '../../lib/diary.ts'
import { addWorkingDays } from '../../lib/workingDays.ts'
import { DictateButton } from '../ui/Dictate'
import { appendSpeech } from '../../lib/dictation.ts'

/**
 * Put an account back in somebody's diary.
 *
 * Three decisions, in the order they actually get made: WHEN it comes back, WHAT it is, and a
 * note. The date comes first because it is the one the agent has usually already made — they
 * told the debtor "I'll call you on the fifth" before they opened this box.
 *
 * It always lands in the diary of whoever is doing it. Moving work to somebody else is
 * escalation, not diarising — see the note where the owner picker used to be.
 */
export function DiariseModal({ accountId, accountLabel, prescriptionDate, defaultOwnerId, onClose, onDone }: {
  accountId: string
  /** How the account reads in the confirmation: "Piet Pompies · BF-10023". */
  accountLabel: string
  /** Warns if the chosen date is past it, or close. Null for an account with no date on file. */
  prescriptionDate: string | null
  /** Whose diary to put it in. Defaults to the person doing the diarising. */
  defaultOwnerId?: string | null
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { currentUser } = useAuth()
  const { users } = useAppStore()

  const today = new Date().toISOString().slice(0, 10)
  // Always the person doing the diarising. See the note where the picker used to be.
  const ownerId = defaultOwnerId ?? currentUser?.id ?? null
  // Five working days out: far enough that a debtor has had time to do what they said, near
  // enough that nothing goes cold. The agent overrides it constantly, which is the point.
  const [dueOn, setDueOn] = useState(() => addWorkingDays(today, 5))
  const [kind, setKind] = useState<DiaryKind>('review')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const owner = users.find((u) => u.id === ownerId)
  const capacity = owner?.diaryCapacity ?? null

  /*
   * Prescription is the one deadline that cannot be argued with: after it the debt cannot be
   * enforced at all, so a diary date on the far side of it books work on something that will no
   * longer exist. Warned rather than blocked — there are real reasons to diarise a prescribed
   * account (a written acknowledgement, a client instruction) and the agent knows them.
   */
  const daysToPrescription = prescriptionDate ? daysBetween(dueOn, prescriptionDate) : null
  const prescriptionWarning = daysToPrescription === null ? null
    : daysToPrescription < 0
      ? `This account prescribes on ${longDate(prescriptionDate as string)} — before the day you have chosen. By then it cannot be enforced.`
      : daysToPrescription <= 30
        ? `Only ${daysToPrescription} day${daysToPrescription === 1 ? '' : 's'} between that day and prescription on ${longDate(prescriptionDate as string)}.`
        : null

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await diarise({
        accountId,
        ownerId,
        dueOn,
        kind,
        reason,
        alsoNoteOnAccount: true,
        actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
      })
      await onDone()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Diarise this account" onClose={onClose} width={560}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          {accountLabel} comes back on a day you choose.
        </p>

        <div>
          <span className="block text-xs font-medium text-slate-500 mb-1.5">When</span>
          <DiaryDatePicker
            ownerId={ownerId}
            capacity={capacity}
            value={dueOn}
            onChange={setDueOn}
            today={today}
          />
        </div>

        {prescriptionWarning && (
          <p className="flex items-start gap-2 text-xs text-[var(--c-rust-deep)] bg-[var(--tint-rust-deep)] rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-px" />
            <span>{prescriptionWarning}</span>
          </p>
        )}

        <FormField label="What kind of work">
          <select value={kind} onChange={(e) => setKind(e.target.value as DiaryKind)} className={inputClass}>
            {DIARY_KIND_ORDER.map((k) => (
              <option key={k} value={k}>{DIARY_KINDS[k].label}</option>
            ))}
          </select>
          {/*
            The ladder is not obvious from the labels, so the box says what choosing this one
            does. An agent who knows that "Broken promise" jumps the queue will use it honestly;
            one who does not will pick whatever is at the top.
          */}
          <span className="block text-[11px] text-slate-400 mt-1.5">{DIARY_KINDS[kind].why}</span>
        </FormField>

        {/*
          Optional, at the firm's instruction. It was required, and required is wrong: sometimes
          the date IS the whole thought ("ring him Tuesday"), and a mandatory box only teaches
          people to type a full stop. Where somebody does write one it lands on the account's
          timeline too, so it is findable by whoever reads the account rather than the diary.
        */}
        <FormField label="Note">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Said he would pay R2 000 on the 25th once his commission is in."
            className={`${inputClass} resize-none`}
          />
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {/* Talk it instead of typing it. Free, built into the browser — see Dictate.tsx. */}
            <DictateButton size="small" onText={(said) => setReason((r) => appendSpeech(r, said))} />
            <span className="text-[11px] text-slate-400">
              Goes on the account&rsquo;s timeline as well as the diary.
            </span>
          </div>
        </FormField>

        {/*
          NO "whose diary" PICKER, at the firm's instruction: one person does not put work into
          another person's diary. It lands in yours, and if it belongs to somebody else — a team
          leader, or the liaison with a recommendation for litigation — that is an escalation,
          which is a different act with a different record. See the Dispute action on the account.
        */}

        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
            Diarise
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** The default a "call me back" style action should use: a week's working days out. */
export function defaultDiaryDate(today: string): string {
  return addWorkingDays(today, 5)
}

export { shiftDate }
