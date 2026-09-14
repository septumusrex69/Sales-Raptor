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
import { isAssignableOwner } from '../../lib/permissions'

/**
 * Put an account back in somebody's diary.
 *
 * Three decisions, in the order they actually get made: WHEN it comes back, WHAT it is, and WHY.
 * The date comes first because it is the one the agent has usually already made — they told the
 * debtor "I'll call you on the fifth" before they opened this box.
 *
 * The reason is not optional dressing. It is what the next person to open the account reads
 * before they ring, and on the imported book that field is exactly what is missing: 327 diarised
 * accounts and not one word about why any of them is coming back.
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
  const [ownerId, setOwnerId] = useState<string | null>(defaultOwnerId ?? currentUser?.id ?? null)
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
    if (!reason.trim()) { setError('Say why it is coming back — the next person to open it reads this first.'); return }
    setBusy(true)
    setError(null)
    try {
      await diarise({
        accountId,
        ownerId,
        dueOn,
        kind,
        reason,
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

        <FormField label="Why it is coming back" required>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Said he would pay R2 000 on the 25th once his commission is in."
            className={`${inputClass} resize-none`}
          />
        </FormField>

        {/* Booking work for a colleague is ordinary practice — a leader handing out the pile, a
            clerk covering somebody who is off. Only shown to people who can reassign. */}
        {users.length > 1 && (
          <FormField label="In whose diary">
            <select value={ownerId ?? ''} onChange={(e) => setOwnerId(e.target.value || null)} className={inputClass}>
              <option value="">Nobody yet — a team leader hands it out</option>
              {users.filter((u) => u.status === 'Active' && (u.id === currentUser?.id || isAssignableOwner(u.role) || u.role.startsWith('Pre-legal')))
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.id === currentUser?.id ? `${u.name} (me)` : u.name}</option>
                ))}
            </select>
          </FormField>
        )}

        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={busy || !reason.trim()}
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
