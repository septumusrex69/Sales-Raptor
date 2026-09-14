import { useState } from 'react'
import { AlarmClock, AlertTriangle, CalendarClock, Loader2 } from 'lucide-react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { DiaryDatePicker, longDate } from './DiaryDatePicker'
import {
  DIARY_KINDS, DIARY_KIND_ORDER, daysBetween, shiftDate,
  type DiaryKind,
} from '../../lib/diaryPriority.ts'
import { diarise } from '../../lib/diary.ts'
import { setReminder } from '../../lib/reminders.ts'
import { REMINDER_PRESETS, atClockTime, clockTime, dueAt } from '../../lib/reminderTime.ts'
import { addWorkingDays } from '../../lib/workingDays.ts'
import { DictateButton } from '../ui/Dictate'

/**
 * When does this account come back?
 *
 * ONE BOX FOR BOTH SCALES, at the firm's instruction — the action row had grown to ten buttons
 * and two of them were asking the same question. "Ring me back in an hour" and "I'll call you on
 * the fifth" are the same sentence from the debtor's side; only the horizon differs, and the
 * horizon is exactly what this box is for.
 *
 *   LATER TODAY is a reminder. It pops on screen wherever you are and has to be answered. It is
 *   not in anybody's diary and it does not survive the day, because an hour is not a day.
 *
 *   ON A DAY is the diary: the queue somebody sits down to work, ordered by the priority ladder
 *   and counted by a team leader.
 *
 * The day is the default because it is the common case, and because the consequence of getting
 * it wrong is smaller: a diary entry waits, a reminder interrupts.
 *
 * Either way it lands on whoever is doing it. Moving work to somebody else is escalation, not
 * diarising — see the note where the owner picker used to be.
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
  const [mode, setMode] = useState<'day' | 'today'>('day')
  const [dueOn, setDueOn] = useState(() => addWorkingDays(today, 5))
  const [kind, setKind] = useState<DiaryKind>('review')
  const [reason, setReason] = useState('')
  /** Minutes out, for the "later today" side. An hour is what a debtor says most often. */
  const [minutes, setMinutes] = useState(60)
  const [custom, setCustom] = useState('')
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

  /** Where "later today" lands. Null while a typed time is unusable, which disables the button. */
  const remindAt = mode === 'today'
    ? (custom ? atClockTime(custom) : dueAt(minutes))
    : null
  const customBad = mode === 'today' && custom !== '' && remindAt === null

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'today') {
        if (!remindAt || !ownerId) return
        await setReminder({
          accountId,
          ownerId,
          minutes,
          at: remindAt,
          body: reason.trim() || `Come back to ${accountLabel.split(' · ')[0]}`,
          createdBy: currentUser?.id ?? null,
        })
        await onDone()
        onClose()
        return
      }
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
    <Modal title="When does this come back?" onClose={onClose} width={560}>
      <div className="space-y-4">
        {/*
          The two horizons, side by side, because the debtor's sentence is the same either way
          and only the scale differs. Two buttons rather than a dropdown: there are exactly two,
          and which one you are on has to be obvious at a glance — the consequence of being on
          the wrong one is a reminder that interrupts a colleague's afternoon, or a callback that
          never happens.
        */}
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100">
          {([
            ['day', 'On a day', 'Goes in your diary'],
            ['today', 'Later today', 'Pops up on your screen'],
          ] as const).map(([value, label, hint]) => (
            <button key={value} type="button" onClick={() => setMode(value)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                mode === value ? 'bg-white shadow-sm font-medium text-navy-950' : 'text-slate-500 hover:text-slate-700'}`}>
              {label}
              <span className="block text-[11px] font-normal text-slate-400">{hint}</span>
            </button>
          ))}
        </div>

        <p className="text-sm text-slate-500">
          {mode === 'today'
            ? `${accountLabel} — a nudge later today. Not the diary; nothing is booked.`
            : `${accountLabel} comes back on a day you choose.`}
        </p>

        {mode === 'today' ? (
          <>
            <div className="flex flex-wrap gap-2">
              {REMINDER_PRESETS.map((p) => (
                <button key={p.minutes} type="button"
                  onClick={() => { setMinutes(p.minutes); setCustom('') }}
                  className={`text-sm px-3 py-2 rounded-lg border transition-colors ${
                    !custom && minutes === p.minutes
                      ? 'border-gold-500 bg-gold-400 text-navy-950 font-medium'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {p.label}
                  <span className="block text-[11px] opacity-70 tabular-nums">{clockTime(dueAt(p.minutes))}</span>
                </button>
              ))}
            </div>

            <FormField label="Or at a time today">
              <input className={`${inputClass} max-w-[9rem]`} placeholder="15:40" value={custom}
                onChange={(e) => setCustom(e.target.value)} />
              {customBad && (
                // A time already gone would pop the instant it saved, which reads as a fault.
                <p className="text-[11px] text-[var(--c-rust-deep)] mt-1">
                  Not a time later today. Use 24-hour, like 15:40.
                </p>
              )}
            </FormField>
          </>
        ) : (
          <>
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
            does. An agent who knows that "Broken PTP" jumps the queue will use it honestly;
            one who does not will pick whatever is at the top.
          */}
          <span className="block text-[11px] text-slate-400 mt-1.5">{DIARY_KINDS[kind].why}</span>
        </FormField>
          </>
        )}

        {/*
          Optional, at the firm's instruction. It was required, and required is wrong: sometimes
          the date IS the whole thought ("ring him Tuesday"), and a mandatory box only teaches
          people to type a full stop. Where somebody does write one it lands on the account's
          timeline too, so it is findable by whoever reads the account rather than the diary.
        */}
        {/* One field, both sides: on a day it is the note, later today it is what the nudge says. */}
        <FormField label={mode === 'today' ? 'What for' : 'Note'}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={mode === 'today'
              ? 'Ring him back — he is in a meeting until three.'
              : 'Said he would pay R2 000 on the 25th once his commission is in.'}
            className={`${inputClass} resize-none`}
          />
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {/* Talk it instead of typing it. Free, built into the browser — see Dictate.tsx. */}
            <DictateButton size="small" value={reason} onChange={setReason} />
            <span className="text-[11px] text-slate-400">
              {mode === 'today'
                ? 'Optional — it is what the popup will say.'
                : 'Goes on the account\u2019s timeline as well as the diary.'}
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

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-400">
            {mode === 'today'
              ? remindAt ? `Pops up at ${clockTime(remindAt)}, on whatever page you are on.` : 'Pick a time.'
              : `Lands in your diary for ${longDate(dueOn)}.`}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
              Cancel
            </button>
            <button type="button" onClick={() => void save()}
              disabled={busy || (mode === 'today' && !remindAt)}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
              {busy
                ? <Loader2 size={14} className="animate-spin" />
                : mode === 'today' ? <AlarmClock size={14} /> : <CalendarClock size={14} />}
              {mode === 'today' ? 'Remind me' : 'Diarise'}
            </button>
          </div>
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
